package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// enroll.go - per-user install token persistence (Spec Sec 6-8).
// The token binds this agent install to one user account. It is sent once
// in hello, consumed server-side, and never reused after registration.

const enrollFile = "vyomlink.json"

type enrollConfig struct {
	ServerURL     string `json:"server_url,omitempty"`
	DeviceID      string `json:"device_id,omitempty"`
	InstallToken  string `json:"install_token,omitempty"`
	EmailHint     string `json:"email_hint,omitempty"`
	Enrolled      bool   `json:"enrolled,omitempty"`
}

// loadEnroll reads vyomlink.json next to the binary (if present).
func loadEnroll(dir string) *enrollConfig {
	cfg := &enrollConfig{}
	b, err := os.ReadFile(filepath.Join(dir, enrollFile))
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(b, cfg)
	return cfg
}

func saveEnroll(dir string, cfg *enrollConfig) error {
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, enrollFile), b, 0o600)
}

// markEnrolled clears the one-time token after successful registration.
func markEnrolled(dir string, cfg *enrollConfig) {
	cfg.InstallToken = ""
	cfg.Enrolled = true
	_ = saveEnroll(dir, cfg)
}

func normalizeToken(s string) string {
	return strings.TrimSpace(s)
}
