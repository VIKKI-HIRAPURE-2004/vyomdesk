package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"log"
	"os"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// client.go - VyomLink control-channel client.
// Handshake: hello -> challenge -> auth (Ed25519 signature) -> authOk.
// Then: ping keepalive, metrics.push every interval.
// (Reconnect pattern adapted from MeshCentral agent, Apache-2.0.)

type Client struct {
	serverURL string
	deviceID  string
	identity  *Identity
	hostname  string
	conn      *websocket.Conn
	mu        sync.Mutex
	closed    bool
	nextID    int64
}

func NewClient(serverURL, deviceID string, id *Identity) *Client {
	host, _ := os.Hostname()
	if host == "" {
		host = "unknown"
	}
	return &Client{serverURL: serverURL, deviceID: deviceID, identity: id, hostname: host}
}

type envelope struct {
	V    int             `json:"v"`
	ID   string          `json:"id"`
	Cmd  string          `json:"cmd"`
	TS   int64           `json:"ts"`
	Data json.RawMessage `json:"data,omitempty"`
}

func (c *Client) Run() {
	backoff := time.Second
	for {
		if c.closed {
			return
		}
		err := c.connectOnce()
		if err != nil {
			log.Printf("connection error: %v", err)
		}
		time.Sleep(backoff + jitter())
		if backoff < 30*time.Second {
			backoff = backoff * 2
		}
	}
}

func jitter() time.Duration {
	return time.Duration(randInt63n(int64(500*time.Millisecond))) * time.Nanosecond
}

func randInt63n(n int64) int64 {
	if n <= 0 {
		return 0
	}
	x := time.Now().UnixNano()
	return x % n
}

func (c *Client) connectOnce() error {
	d := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	if tlsCfg := dialTLSConfig(); tlsCfg != nil {
		d.TLSClientConfig = tlsCfg
	}
	conn, _, err := d.Dial(c.serverURL, nil)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	defer conn.Close()

	// hello with public key (TOFU registration on first contact; server may challenge)
	hello := envelope{V: 1, ID: c.newID(), Cmd: "hello", TS: time.Now().UnixMilli()}
	helloData, _ := json.Marshal(map[string]any{
		"deviceId":        c.deviceID,
		"hostname":        c.hostname,
		"version":         Version,
		"platform":        platformName(),
		"platformVersion": platformVersion(),
		"arch":            runtime.GOARCH,
		"publicKey":       c.identity.PublicHex,
	})
	hello.Data = helloData
	if err := conn.WriteJSON(hello); err != nil {
		return err
	}

	var metricsStop = make(chan struct{})
	defer close(metricsStop)

	for {
		var env envelope
		if err := conn.ReadJSON(&env); err != nil {
			return err
		}
		switch env.Cmd {
		case "authOk":
			log.Printf("authenticated with server")
			go c.metricsLoop(conn, metricsStop)
		case "challenge":
			var d struct {
				Nonce string `json:"nonce"`
			}
			if err := json.Unmarshal(env.Data, &d); err != nil {
				return err
			}
			nonce, err := base64.StdEncoding.DecodeString(d.Nonce)
			if err != nil || len(nonce) == 0 {
				return err
			}
			sig := ed25519.Sign(c.identity.PrivateKey, nonce)
			resp := envelope{V: 1, ID: c.newID(), Cmd: "auth", TS: time.Now().UnixMilli()}
			rd, _ := json.Marshal(map[string]any{"sig": base64.StdEncoding.EncodeToString(sig)})
			resp.Data = rd
			if err := conn.WriteJSON(resp); err != nil {
				return err
			}
		case "ping":
			c.reply(conn, env.ID, "pong", nil)
		case "pong":
		case "metrics.poll":
			m := collectMetrics()
			c.reply(conn, env.ID, "metrics.push", m)
		case "relay.open":
			relays.handleOpen(env, conn, c)
		case "relay.data":
			relays.handleData(env)
		case "relay.close":
			relays.handleClose(env)
		case "agent.update":
			handleUpdate(env, conn, c)
		case "metrics.push":
			// server echoed our push (should not happen) - ignore
		default:
			log.Printf("unknown cmd from server: %s", env.Cmd)
		}
	}
}

func (c *Client) metricsLoop(conn *websocket.Conn, stop chan struct{}) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	m := collectMetrics()
	c.reply(conn, c.newID(), "metrics.push", m)
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			m := collectMetrics()
			c.reply(conn, c.newID(), "metrics.push", m)
		}
	}
}

func (c *Client) reply(conn *websocket.Conn, id, cmd string, data any) {
	env := envelope{V: 1, ID: id, Cmd: cmd, TS: time.Now().UnixMilli()}
	if data != nil {
		b, _ := json.Marshal(data)
		env.Data = b
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		conn.WriteJSON(env)
	}
}

func (c *Client) newID() string {
	c.nextID++
	return strconv.FormatInt(c.nextID, 10)
}

func (c *Client) Close() {
	c.closed = true
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close()
	}
}
