package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/gorilla/websocket"
)

// files.go - browser file-manager channel (Channel.Files = 5) over the relay
// pipe. Fully portable: plain os.* APIs only, no platform-specific code.
//
// Sub-protocol inside relay payloads:
//   agent -> browser: [msgType:1][body] where 1=JSON, 2=download chunk;
//     a chunk body is [seq:4 BE][offset:8 BE][raw bytes].
//   browser -> agent: plain UTF-8 JSON:
//     {"type":"root"}
//     {"type":"list","path":"...","seq":n}
//     {"type":"download","path":"...","seq":n}
//     {"type":"dl-ack","seq":n}                  flow-control ack per chunk
//     {"type":"cancel","seq":n}                  cancel an active download
//     {"type":"upload","path":"...","seq":n}
//     {"type":"upload-data","seq":n,"data":"<base64>"}
//     {"type":"upload-done","seq":n}
//     {"type":"upload-cancel","seq":n}
//     {"type":"mkdir","path":"...","seq":n}
//     {"type":"delete","path":"...","seq":n}
//     {"type":"rename","from":"...","to":"...","seq":n}
// JSON replies echo the browser-supplied seq.

const (
	filesMsgJSON  = 1
	filesMsgChunk = 2

	maxFileChunk  = 48 * 1024 // download chunk raw bytes (frame stays under 64KB)
	dlWindowDepth = 8         // max download chunks in flight before acks
)

type filesSession struct {
	mu      sync.Mutex
	channel int
	conn    *websocket.Conn
	client  *Client
	closed  chan struct{}
	once    sync.Once

	dlCancel chan struct{}
	dlWindow chan struct{}
	dlSeq    uint32

	upTemp  *os.File
	upFinal string
	upSeq   uint32
	upGot   int64
}

func (r *relayHub) openFiles(channel int, conn *websocket.Conn, c *Client) {
	r.mu.Lock()
	if _, exists := r.channels[channel]; exists {
		r.mu.Unlock()
		return // already open
	}
	fs := &filesSession{
		channel: channel,
		conn:    conn,
		client:  c,
		closed:  make(chan struct{}),
	}
	ch := &relayChannel{
		conn:    conn,
		client:  c,
		inputFn: fs.onInput,
		closeFn: fs.shutdown,
	}
	r.channels[channel] = ch
	r.mu.Unlock()
	log.Printf("relay: files channel %d opened", channel)
}

func (fs *filesSession) shutdown() {
	fs.once.Do(func() { close(fs.closed) })
	fs.mu.Lock()
	if fs.dlCancel != nil {
		close(fs.dlCancel)
		fs.dlCancel = nil
	}
	fs.dlWindow = nil
	t := fs.upTemp
	fs.upTemp = nil
	fs.upFinal = ""
	fs.upSeq = 0
	fs.upGot = 0
	fs.mu.Unlock()
	if t != nil {
		t.Close()
		os.Remove(t.Name())
	}
}

func (fs *filesSession) send(msgType int, body []byte) {
	pl := make([]byte, 1+len(body))
	pl[0] = byte(msgType)
	copy(pl[1:], body)
	fs.client.reply(fs.conn, fs.client.newID(), "relay.data", map[string]any{
		"channel": fs.channel,
		"b64":     base64.StdEncoding.EncodeToString(pl),
	})
}

func (fs *filesSession) sendJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	fs.send(filesMsgJSON, b)
}

func (fs *filesSession) sendErr(seq uint32, msg string) {
	fs.sendJSON(map[string]any{"type": "error", "seq": seq, "message": msg})
}

func (fs *filesSession) sendRoot() {
	home, _ := os.UserHomeDir()
	drives := []string{}
	if runtime.GOOS == "windows" {
		for c := 'A'; c <= 'Z'; c++ {
			p := string(c) + `:\`
			if _, err := os.Stat(p); err == nil {
				drives = append(drives, p)
			}
		}
	}
	fs.sendJSON(map[string]any{
		"type":   "root",
		"home":   home,
		"sep":    string(filepath.Separator),
		"drives": drives,
	})
}

type fileEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Dir     bool   `json:"dir"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"modTime"`
}

func (fs *filesSession) sendList(seq uint32, path string) {
	clean := filepath.Clean(path)
	entries, err := os.ReadDir(clean)
	if err != nil {
		fs.sendErr(seq, err.Error())
		return
	}
	out := make([]fileEntry, 0, len(entries))
	for _, e := range entries {
		info, ierr := e.Info()
		if ierr != nil {
			continue // entry vanished mid-list
		}
		out = append(out, fileEntry{
			Name:    e.Name(),
			Size:    info.Size(),
			Dir:     e.IsDir(),
			Mode:    info.Mode().String(),
			ModTime: info.ModTime().UnixMilli(),
		})
	}
	fs.sendJSON(map[string]any{
		"type":    "list",
		"seq":     seq,
		"path":    clean,
		"sep":     string(filepath.Separator),
		"entries": out,
	})
}

func (fs *filesSession) cancelActiveDownload() {
	fs.mu.Lock()
	if fs.dlCancel != nil {
		close(fs.dlCancel)
		fs.dlCancel = nil
	}
	fs.dlWindow = nil
	fs.mu.Unlock()
}

func (fs *filesSession) startDownload(seq uint32, path string) {
	fs.cancelActiveDownload()
	f, err := os.Open(filepath.Clean(path))
	if err != nil {
		fs.sendErr(seq, err.Error())
		return
	}
	fi, err := f.Stat()
	if err != nil {
		f.Close()
		fs.sendErr(seq, err.Error())
		return
	}
	if fi.IsDir() {
		f.Close()
		fs.sendErr(seq, "path is a directory")
		return
	}
	cancel := make(chan struct{})
	window := make(chan struct{}, dlWindowDepth)
	fs.mu.Lock()
	fs.dlCancel = cancel
	fs.dlWindow = window
	fs.dlSeq = seq
	fs.mu.Unlock()
	fs.sendJSON(map[string]any{"type": "download-start", "seq": seq, "size": fi.Size()})
	go func() {
		defer f.Close()
		buf := make([]byte, maxFileChunk)
		var off int64
		for {
			n, rerr := f.Read(buf)
			if n > 0 {
				select {
				case window <- struct{}{}:
				case <-cancel:
					return
				case <-fs.closed:
					return
				}
				body := make([]byte, 12+n)
				binary.BigEndian.PutUint32(body[0:4], seq)
				binary.BigEndian.PutUint64(body[4:12], uint64(off))
				copy(body[12:], buf[:n])
				fs.send(filesMsgChunk, body)
				off += int64(n)
			}
			if rerr != nil {
				if rerr == io.EOF {
					fs.sendJSON(map[string]any{"type": "download-end", "seq": seq})
				} else {
					fs.sendErr(seq, rerr.Error())
				}
				return
			}
		}
	}()
}

func (fs *filesSession) dlAck(seq uint32) {
	fs.mu.Lock()
	window := fs.dlWindow
	cur := fs.dlSeq
	fs.mu.Unlock()
	if window == nil || seq != cur {
		return
	}
	select {
	case <-window:
	default:
	}
}

func (fs *filesSession) dropUpload() {
	fs.mu.Lock()
	t := fs.upTemp
	fs.upTemp = nil
	fs.upFinal = ""
	fs.upSeq = 0
	fs.upGot = 0
	fs.mu.Unlock()
	if t != nil {
		t.Close()
		os.Remove(t.Name())
	}
}

func (fs *filesSession) startUpload(seq uint32, path string) {
	fs.dropUpload()
	final := filepath.Clean(path)
	if final == "" {
		fs.sendErr(seq, "empty path")
		return
	}
	tmp, err := os.CreateTemp(filepath.Dir(final), ".vyomupload-*")
	if err != nil {
		fs.sendErr(seq, err.Error())
		return
	}
	fs.mu.Lock()
	fs.upTemp = tmp
	fs.upFinal = final
	fs.upSeq = seq
	fs.upGot = 0
	fs.mu.Unlock()
	fs.sendJSON(map[string]any{"type": "upload-ack", "seq": seq})
}

func (fs *filesSession) uploadData(seq uint32, data string) {
	fs.mu.Lock()
	t := fs.upTemp
	cur := fs.upSeq
	fs.mu.Unlock()
	if t == nil || seq != cur {
		return
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		fs.sendErr(seq, "bad base64: "+err.Error())
		return
	}
	n, err := t.Write(raw)
	if err != nil {
		fs.sendErr(seq, err.Error())
		fs.dropUpload()
		return
	}
	fs.mu.Lock()
	fs.upGot += int64(n)
	got := fs.upGot
	fs.mu.Unlock()
	fs.sendJSON(map[string]any{"type": "upload-progress", "seq": seq, "received": got})
}

func (fs *filesSession) uploadDone(seq uint32) {
	fs.mu.Lock()
	t := fs.upTemp
	final := fs.upFinal
	cur := fs.upSeq
	got := fs.upGot
	fs.upTemp = nil
	fs.upFinal = ""
	fs.upSeq = 0
	fs.upGot = 0
	fs.mu.Unlock()
	if t == nil || seq != cur {
		return
	}
	t.Close()
	if _, err := os.Stat(final); err == nil {
		_ = os.Remove(final) // Windows rename fails when dest exists
	}
	if err := os.Rename(t.Name(), final); err != nil {
		_ = os.Remove(t.Name())
		fs.sendErr(seq, err.Error())
		return
	}
	fs.sendJSON(map[string]any{"type": "upload-ok", "seq": seq, "size": got})
}

func (fs *filesSession) uploadCancel(seq uint32) {
	fs.mu.Lock()
	t := fs.upTemp
	cur := fs.upSeq
	fs.mu.Unlock()
	if t != nil && seq == cur {
		t.Close()
		os.Remove(t.Name())
		fs.mu.Lock()
		fs.upTemp = nil
		fs.upFinal = ""
		fs.upSeq = 0
		fs.upGot = 0
		fs.mu.Unlock()
	}
}

type filesCtrl struct {
	Type string `json:"type"`
	Seq  uint32 `json:"seq"`
	Path string `json:"path"`
	From string `json:"from"`
	To   string `json:"to"`
	Data string `json:"data"`
}

func (fs *filesSession) onInput(raw []byte) {
	var c filesCtrl
	if err := json.Unmarshal(raw, &c); err != nil {
		return
	}
	switch c.Type {
	case "root":
		fs.sendRoot()
	case "list":
		fs.sendList(c.Seq, c.Path)
	case "download":
		fs.startDownload(c.Seq, c.Path)
	case "dl-ack":
		fs.dlAck(c.Seq)
	case "cancel":
		fs.mu.Lock()
		if fs.dlCancel != nil && fs.dlSeq == c.Seq {
			close(fs.dlCancel)
			fs.dlCancel = nil
			fs.dlWindow = nil
		}
		fs.mu.Unlock()
		fs.uploadCancel(c.Seq)
	case "upload":
		fs.startUpload(c.Seq, c.Path)
	case "upload-data":
		fs.uploadData(c.Seq, c.Data)
	case "upload-done":
		fs.uploadDone(c.Seq)
	case "upload-cancel":
		fs.uploadCancel(c.Seq)
	case "mkdir":
		if err := os.MkdirAll(filepath.Clean(c.Path), 0o755); err != nil {
			fs.sendErr(c.Seq, err.Error())
		} else {
			fs.sendJSON(map[string]any{"type": "ok", "op": "mkdir", "seq": c.Seq})
		}
	case "delete":
		p := filepath.Clean(c.Path)
		fi, err := os.Stat(p)
		if err != nil {
			fs.sendErr(c.Seq, err.Error())
			return
		}
		if fi.IsDir() {
			err = os.RemoveAll(p)
		} else {
			err = os.Remove(p)
		}
		if err != nil {
			fs.sendErr(c.Seq, err.Error())
		} else {
			fs.sendJSON(map[string]any{"type": "ok", "op": "delete", "seq": c.Seq})
		}
	case "rename":
		if err := os.Rename(filepath.Clean(c.From), filepath.Clean(c.To)); err != nil {
			fs.sendErr(c.Seq, err.Error())
		} else {
			fs.sendJSON(map[string]any{"type": "ok", "op": "rename", "seq": c.Seq})
		}
	}
}
