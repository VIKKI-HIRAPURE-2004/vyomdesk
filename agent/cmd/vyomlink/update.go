package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gorilla/websocket"
)

// update.go - agent self-update driven by the server (cmd "agent.update").
// The server sends {url, sha256, version}; the agent downloads the binary,
// verifies the hash, swaps itself (rename dance: exe -> .old, new -> exe),
// acks, then restarts:
//   - console mode: spawns the new binary detached and exits
//   - service mode: exits uncleanly so SCM failure-recovery restarts it
// (Update flow concept adapted from MeshCentral agent update, Apache-2.0.)

const updateDownloadTimeout = 10 * time.Minute
const maxAgentBinary = 64 * 1024 * 1024 // 64MB safety cap

type updateSpec struct {
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Version string `json:"version"`
}

func handleUpdate(env envelope, conn *websocket.Conn, c *Client) {
	var spec updateSpec
	if err := json.Unmarshal(env.Data, &spec); err != nil || spec.URL == "" {
		log.Printf("update: bad spec: %v", err)
		return
	}
	log.Printf("update: server offers version %s", spec.Version)

	if err := applyUpdate(spec); err != nil {
		log.Printf("update: failed: %v", err)
		c.reply(conn, env.ID, "update.failed", map[string]any{
			"error":  err.Error(),
			"from":   Version,
			"wanted": spec.Version,
		})
		return
	}
	// ack before restarting; the server sees the reconnect as confirmation
	c.reply(conn, env.ID, "update.ack", map[string]any{
		"from":   Version,
		"to":     spec.Version,
		"nowUTC": time.Now().Unix(),
	})
	log.Printf("update: applied %s (was %s); restarting", spec.Version, Version)
	go func() {
		time.Sleep(500 * time.Millisecond) // let the ack flush
		restartSelf()
	}()
}

// applyUpdate downloads, verifies and stages the new binary, then performs
// the rename dance. Returns nil when the running binary has been replaced.
func applyUpdate(spec updateSpec) error {
	if spec.SHA256 != "" && len(spec.SHA256) != 64 {
		return fmt.Errorf("bad sha256 length")
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	dir := filepath.Dir(exe)
	newPath := filepath.Join(dir, filepath.Base(exe)+".new")

	// 1. download to .new
	if err := downloadVerified(spec, newPath); err != nil {
		os.Remove(newPath)
		return err
	}

	// 2. swap: rename running exe -> .old (allowed on Windows/Linux even
	// while the process runs), then .new -> exe
	oldPath := filepath.Join(dir, filepath.Base(exe)+".old")
	_ = os.Remove(oldPath) // stale from a previous update
	if err := os.Rename(exe, oldPath); err != nil {
		os.Remove(newPath)
		return fmt.Errorf("rename old: %w", err)
	}
	if err := os.Rename(newPath, exe); err != nil {
		// put the old binary back; keep the agent alive
		_ = os.Rename(oldPath, exe)
		os.Remove(newPath)
		return fmt.Errorf("rename new: %w", err)
	}
	return nil
}

// downloadVerified fetches the binary and checks the sha256 before writing
// it to disk in one pass (stream + hash, then rename-free write is fine).
func downloadVerified(spec updateSpec, dest string) error {
	client := &http.Client{Timeout: updateDownloadTimeout}
	res, err := client.Get(spec.URL)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download: status %d", res.StatusCode)
	}

	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), res.Body)
	closeErr := f.Close()
	if err != nil {
		os.Remove(dest)
		return fmt.Errorf("copy: %w", err)
	}
	if closeErr != nil {
		os.Remove(dest)
		return closeErr
	}
	if n <= 0 || n > maxAgentBinary {
		os.Remove(dest)
		return fmt.Errorf("bad size %d", n)
	}
	if spec.SHA256 != "" {
		got := hex.EncodeToString(h.Sum(nil))
		if got != spec.SHA256 {
			os.Remove(dest)
			return fmt.Errorf("sha256 mismatch: got %s want %s", got, spec.SHA256)
		}
	}
	return nil
}

// cleanupStaged removes leftovers from a previous update (called at boot).
func cleanupStaged() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	dir := filepath.Dir(exe)
	base := filepath.Base(exe)
	for _, suffix := range []string{".old", ".new"} {
		p := filepath.Join(dir, base+suffix)
		for i := 0; i < 10; i++ { // old binary may still be exiting
			if err := os.Remove(p); err == nil || os.IsNotExist(err) {
				break
			}
			time.Sleep(300 * time.Millisecond)
		}
	}
}
