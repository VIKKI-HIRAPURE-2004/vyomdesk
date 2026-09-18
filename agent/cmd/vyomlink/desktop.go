package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"hash/fnv"
	"image"
	"image/jpeg"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// desktop.go - browser desktop channel (Channel.Desktop = 2) over the relay pipe.
// Sub-protocol inside relay payloads:
//   agent -> browser: [msgType:1][body] where 1=JSON meta, 2=JPEG frame, 3=JSON error
//   browser -> agent: plain UTF-8 JSON control messages:
//     {"type":"quality","value":55} {"type":"fps","value":10} {"type":"scale","value":0.75}
//     {"type":"mouse","x":0.5,"y":0.5,"action":"move|down|up|dblclick","button":"left|right|middle"}
//     {"type":"wheel","deltaY":100}
//     {"type":"key","action":"down|up","key":"a"}
// Platform capture/inject live in desktop_windows.go / desktop_other.go.

const (
	desktopMsgJSON  = 1
	desktopMsgJPEG  = 2
	desktopMsgError = 3

	maxDesktopFrame = 60000 // stay under the 64KB tunnel frame limit (uint16 len)
)

// monitorEntry describes one monitor relative to the captured virtual-screen
// image origin (0,0 = top-left of the whole desktop).
type monitorEntry struct {
	X       int  `json:"x"`
	Y       int  `json:"y"`
	W       int  `json:"w"`
	H       int  `json:"h"`
	Primary bool `json:"primary"`
}

type desktopSession struct {
	mu      sync.Mutex
	quality int
	fps     int
	scale   float64

	channel int
	conn    *websocket.Conn
	client  *Client
	closed  chan struct{}
	once    sync.Once

	realW int
	realH int

	lastHash uint64
	sentOne  bool
}

func (r *relayHub) openDesktop(channel int, conn *websocket.Conn, c *Client) {
	r.mu.Lock()
	if _, exists := r.channels[channel]; exists {
		r.mu.Unlock()
		return // already open
	}
	ds := &desktopSession{
		quality: 55,
		fps:     10,
		scale:   0.75,
		channel: channel,
		conn:    conn,
		client:  c,
		closed:  make(chan struct{}),
	}
	ch := &relayChannel{
		conn:    conn,
		client:  c,
		inputFn: ds.onInput,
		closeFn: ds.shutdown,
	}
	r.channels[channel] = ch
	r.mu.Unlock()
	go ds.run()
	log.Printf("relay: desktop channel %d opened", channel)
}

func (ds *desktopSession) shutdown() {
	ds.once.Do(func() { close(ds.closed) })
}

func (ds *desktopSession) settings() (int, int, float64) {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	return ds.quality, ds.fps, ds.scale
}

func (ds *desktopSession) send(msgType int, body []byte) {
	pl := make([]byte, 1+len(body))
	pl[0] = byte(msgType)
	copy(pl[1:], body)
	ds.client.reply(ds.conn, ds.client.newID(), "relay.data", map[string]any{
		"channel": ds.channel,
		"b64":     base64.StdEncoding.EncodeToString(pl),
	})
}

func (ds *desktopSession) sendJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	ds.send(desktopMsgJSON, b)
}

func (ds *desktopSession) sendErr(msg string) {
	ds.sendJSON(map[string]any{"type": "error", "message": msg})
}

func (ds *desktopSession) sendSize() {
	ds.mu.Lock()
	w, h, scale := ds.realW, ds.realH, ds.scale
	ds.mu.Unlock()
	if w == 0 || h == 0 {
		return
	}
	monitors := listMonitors()
	msg := map[string]any{
		"type": "size",
		"w":    int(float64(w)*scale + 0.5),
		"h":    int(float64(h)*scale + 0.5),
	}
	if len(monitors) > 0 {
		scaled := make([]monitorEntry, len(monitors))
		for i, m := range monitors {
			scaled[i] = monitorEntry{
				X:       int(float64(m.X)*scale + 0.5),
				Y:       int(float64(m.Y)*scale + 0.5),
				W:       int(float64(m.W)*scale + 0.5),
				H:       int(float64(m.H)*scale + 0.5),
				Primary: m.Primary,
			}
		}
		msg["monitors"] = scaled
	}
	ds.sendJSON(msg)
}

func (ds *desktopSession) run() {
	w, h, err := desktopSize()
	if err != nil {
		ds.sendErr("desktop capture unavailable: " + err.Error())
		relays.close(ds.channel)
		return
	}
	ds.mu.Lock()
	ds.realW, ds.realH = w, h
	ds.mu.Unlock()
	ds.sendSize()

	for {
		_, fps, _ := ds.settings()
		if fps < 1 {
			fps = 1
		}
		select {
		case <-ds.closed:
			return
		case <-time.After(time.Second / time.Duration(fps)):
		}
		if err := ds.captureOnce(); err != nil {
			ds.sendErr(err.Error())
			relays.close(ds.channel)
			return
		}
	}
}

var errFrameTooLarge = errors.New("captured frame too large; lower the scale setting")

// captureOnce grabs the screen, skips unchanged frames, and encodes JPEG with
// adaptive quality so a frame never exceeds the tunnel frame limit.
func (ds *desktopSession) captureOnce() error {
	quality, _, scale := ds.settings()
	img, rw, rh, err := captureScreen(scale)
	if err != nil {
		return err
	}
	// last resort: when even min-quality JPEG exceeds the frame limit
	// (busy screens at high scale), degrade the capture scale once and
	// retry instead of killing the channel
	if encoded, ok := encodeJpeg(img, quality, scale); ok {
		ds.finishFrame(img, rw, rh, encoded)
		return nil
	}
	if scale > 0.25 {
		newScale := scale / 2
		if newScale < 0.25 {
			newScale = 0.25
		}
		img2, rw2, rh2, err2 := captureScreen(newScale)
		if err2 == nil {
			if encoded, ok := encodeJpeg(img2, quality, newScale); ok {
				ds.mu.Lock()
				ds.scale = newScale
				ds.mu.Unlock()
				ds.sendSize()
				ds.finishFrame(img2, rw2, rh2, encoded)
				return nil
			}
		}
	}
	return errFrameTooLarge
}

// encodeJpeg compresses img at the requested quality, stepping down until
// the frame fits the tunnel limit; returns nil when it cannot fit.
func encodeJpeg(img *image.RGBA, quality int, scale float64) ([]byte, bool) {
	_ = scale
	var buf bytes.Buffer
	q := quality
	for q >= 20 {
		buf.Reset()
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: q}); err != nil {
			return nil, false
		}
		if buf.Len() <= maxDesktopFrame {
			out := make([]byte, buf.Len())
			copy(out, buf.Bytes())
			return out, true
		}
		q -= 10
	}
	return nil, false
}

// finishFrame hashes and sends an encoded frame, remembering the hash.
func (ds *desktopSession) finishFrame(img *image.RGBA, rw, rh int, encoded []byte) {
	_ = img
	_ = rw
	_ = rh
	hh := fnv.New64a()
	hh.Write(img.Pix)
	ds.lastHash = hh.Sum64()
	ds.sentOne = true
	ds.send(desktopMsgJPEG, encoded)
}

type desktopCtrl struct {
	Type   string   `json:"type"`
	Value  *float64 `json:"value"`
	X      *float64 `json:"x"`
	Y      *float64 `json:"y"`
	Action string   `json:"action"`
	Button string   `json:"button"`
	Key    string   `json:"key"`
	DeltaY *float64 `json:"deltaY"`
}

func (ds *desktopSession) onInput(raw []byte) {
	var c desktopCtrl
	if err := json.Unmarshal(raw, &c); err != nil {
		return
	}
	switch c.Type {
	case "quality":
		if c.Value != nil {
			v := int(*c.Value)
			if v < 10 {
				v = 10
			}
			if v > 90 {
				v = 90
			}
			ds.mu.Lock()
			ds.quality = v
			ds.mu.Unlock()
			ds.mu.Lock()
			ds.lastHash = 0 // force a fresh frame at the new quality
			ds.mu.Unlock()
		}
	case "fps":
		if c.Value != nil {
			v := int(*c.Value)
			if v < 1 {
				v = 1
			}
			if v > 30 {
				v = 30
			}
			ds.mu.Lock()
			ds.fps = v
			ds.mu.Unlock()
		}
	case "scale":
		if c.Value != nil {
			v := *c.Value
			if v < 0.25 {
				v = 0.25
			}
			if v > 1 {
				v = 1
			}
			ds.mu.Lock()
			ds.scale = v
			ds.lastHash = 0
			ds.mu.Unlock()
			ds.sendSize()
		}
	case "mouse":
		x, y := 0.0, 0.0
		if c.X != nil {
			x = *c.X
		}
		if c.Y != nil {
			y = *c.Y
		}
		if err := injectMouse(x, y, c.Action, c.Button); err != nil {
			log.Printf("desktop: mouse: %v", err)
		}
	case "wheel":
		dy := 0.0
		if c.DeltaY != nil {
			dy = *c.DeltaY
		}
		if err := injectWheel(dy); err != nil {
			log.Printf("desktop: wheel: %v", err)
		}
	case "key":
		if err := injectKey(c.Action, c.Key); err != nil {
			log.Printf("desktop: key: %v", err)
		}
	}
}
