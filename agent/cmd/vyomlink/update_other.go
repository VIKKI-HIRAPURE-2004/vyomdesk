//go:build !windows

package main

import (
	"log"
	"os"
	"os/exec"
	"syscall"
)

// update_other.go - restart after a self-update on Unix.
// systemd Restart=always covers service installs; console agents spawn
// the new binary detached and exit.

func restartSelf() {
	exe, err := os.Executable()
	if err != nil {
		log.Printf("update: relaunch failed: %v", err)
		os.Exit(0)
	}
	cmd := exec.Command(exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		log.Printf("update: relaunch start failed: %v", err)
	}
	log.Print("update: relaunched; exiting old process")
	os.Exit(0)
}
