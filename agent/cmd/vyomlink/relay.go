package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// relay.go - browser relay channel handlers on the agent side.
// relay.open starts a channel backend (terminal PTY / desktop capture /
// files manager); relay.data carries base64 bytes browser->agent; output
// bytes are streamed back as cmd=relay.data envelopes on the control socket.
// (Relay concept adapted from MeshCentral agent, Apache-2.0.)

const (
	channelTerminal = 1
	channelDesktop  = 2
	channelFiles    = 5
)

// shellHandle is a platform shell backend for the terminal channel
// (ConPTY on Windows, creack/pty on Unix).
type shellHandle struct {
	stdin  io.WriteCloser
	stdout io.ReadCloser
	resize func(cols, rows int) // nil when the backend cannot resize
	wait   func() error
	close  func()
	intro  []byte // startup bytes drained by a backend probe, replayed first
}

type relayChannel struct {
	mu       sync.Mutex
	conn     *websocket.Conn
	client   *Client
	stdin    io.WriteCloser
	inputFn  func([]byte)
	closeFn  func()
	resizeFn func(cols, rows int)
	pending  [][]byte // input buffered before stdin/inputFn is attached
	ready    bool     // backend produced its first output (safe to feed input)
	firstOut chan struct{}
	closed   bool
}

type relayHub struct {
	mu       sync.Mutex
	channels map[int]*relayChannel
}

var relays = &relayHub{channels: map[int]*relayChannel{}}

func (r *relayHub) handleOpen(env envelope, conn *websocket.Conn, c *Client) {
	var d struct {
		Channel int `json:"channel"`
		Rights  int `json:"rights"`
	}
	if err := json.Unmarshal(env.Data, &d); err != nil {
		return
	}
	switch d.Channel {
	case channelTerminal:
		r.openTerminal(d.Channel, conn, c)
	case channelDesktop:
		r.openDesktop(d.Channel, conn, c)
	case channelFiles:
		r.openFiles(d.Channel, conn, c)
	default:
		log.Printf("relay: unsupported channel %d", d.Channel)
	}
}

// attach wires the shell backend into the channel and flushes any input
// that arrived while the shell was starting.
func (ch *relayChannel) attach(stdin io.WriteCloser, resize func(cols, rows int), closeFn func()) {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if ch.closed {
		return
	}
	ch.stdin = stdin
	ch.resizeFn = resize
	ch.closeFn = closeFn
	// ConPTY swallows input written before conhost finishes initializing
	// (the startup screen reset). Feed pending only after the first pty
	// output (banner = ready), with a 2s safety timeout for quiet shells.
	go func() {
		timer := time.NewTimer(10 * time.Second) // safety only; shells always emit a banner
		defer timer.Stop()
		select {
		case <-ch.firstOut:
		case <-timer.C:
		}
		ch.mu.Lock()
		ch.ready = true
		pend := ch.pending
		ch.pending = nil
		ch.mu.Unlock()
		for _, raw := range pend {
			ch.deliver(raw)
		}
	}()
}

// markReady flips the ready flag and returns the pending queue (pump calls
// this on first stdout bytes).
func (ch *relayChannel) markReady() [][]byte {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if ch.ready {
		return nil
	}
	ch.ready = true
	pend := ch.pending
	ch.pending = nil // take ownership: prevents double flush
	return pend
}

// deliver must be called without holding the hub lock; takes ch.mu itself.
func (ch *relayChannel) deliver(raw []byte) {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if ch.closed {
		return
	}
	// buffer while unattached, or while a stdin (shell) backend awaits its
	// first output; inputFn channels (desktop/files) deliver immediately
	if ch.stdin == nil && ch.inputFn == nil {
		ch.pending = append(ch.pending, raw) // backend not attached yet
		return
	}
	if ch.stdin != nil && !ch.ready {
		ch.pending = append(ch.pending, raw) // pty not proven live yet
		return
	}
	if ch.inputFn != nil {
		ch.inputFn(raw)
		return
	}
	// terminal control escape: [0x00][0x01][cols:2 BE][rows:2 BE] = resize;
	// swallowed even when the backend cannot resize, never forwarded to stdin
	if len(raw) >= 6 && raw[0] == 0x00 && raw[1] == 0x01 {
		if ch.resizeFn != nil {
			cols := int(binary.BigEndian.Uint16(raw[2:4]))
			rows := int(binary.BigEndian.Uint16(raw[4:6]))
			ch.resizeFn(cols, rows)
		}
		return
	}
	if ch.stdin != nil {
		if _, err := ch.stdin.Write(raw); err != nil {
			// shell died; mark closed without re-entrant locking
			ch.closed = true
			if ch.closeFn != nil {
				ch.closeFn()
			}
		}
	}
}

func (r *relayHub) openTerminal(channel int, conn *websocket.Conn, c *Client) {
	r.mu.Lock()
	if _, exists := r.channels[channel]; exists {
		r.mu.Unlock()
		return // already open
	}
	// register immediately so early input gets buffered instead of dropped
	ch := &relayChannel{conn: conn, client: c, firstOut: make(chan struct{})}
	r.channels[channel] = ch
	r.mu.Unlock()

	sh, err := startShell()
	if err != nil {
		log.Printf("relay: shell: %v", err)
		r.close(channel)
		return
	}
	ch.attach(sh.stdin, sh.resize, sh.close)

	// pump: shell stdout -> server (base64 relay.data)
	go func() {
		defer sh.stdout.Close()
		if len(sh.intro) > 0 {
			b64 := base64.StdEncoding.EncodeToString(sh.intro)
			c.reply(conn, c.newID(), "relay.data", map[string]any{
				"channel": channel,
				"b64":     b64,
			})
		}
		buf := make([]byte, 8192)
		for {
			n, err := sh.stdout.Read(buf)
			if n > 0 {
				if pend := ch.markReady(); pend != nil {
					close(ch.firstOut) // wake the deferred flush
					for _, raw := range pend {
						ch.deliver(raw)
					}
				}
				b64 := base64.StdEncoding.EncodeToString(buf[:n])
				c.reply(conn, c.newID(), "relay.data", map[string]any{
					"channel": channel,
					"b64":     b64,
				})
			}
			if err != nil && err != io.EOF {
				r.close(channel)
				return
			}
			if err == io.EOF {
				r.close(channel)
				return
			}
		}
	}()

	// reaper
	go func() {
		_ = sh.wait()
		r.close(channel)
	}()

	log.Printf("relay: terminal channel %d opened", channel)
}

func (r *relayHub) handleData(env envelope) {
	var d struct {
		Channel int    `json:"channel"`
		B64     string `json:"b64"`
	}
	if err := json.Unmarshal(env.Data, &d); err != nil {
		return
	}
	r.mu.Lock()
	ch := r.channels[d.Channel]
	r.mu.Unlock()
	if ch == nil {
		return
	}
	raw, err := base64.StdEncoding.DecodeString(d.B64)
	if err != nil {
		return
	}
	ch.deliver(raw)
}

func (r *relayHub) handleClose(env envelope) {
	var d struct {
		Channel int `json:"channel"`
	}
	if err := json.Unmarshal(env.Data, &d); err != nil {
		return
	}
	r.close(d.Channel)
}

func (r *relayHub) close(channel int) {
	r.mu.Lock()
	ch := r.channels[channel]
	delete(r.channels, channel)
	r.mu.Unlock()
	if ch == nil {
		return
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if !ch.closed {
		ch.closed = true
		if ch.closeFn != nil {
			ch.closeFn()
		}
		if ch.stdin != nil {
			_ = ch.stdin.Close()
		}
	}
}
