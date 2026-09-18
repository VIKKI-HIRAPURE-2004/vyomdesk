//go:build windows

package main

import (
	"log"
	"os"
	"os/exec"
	"syscall"
)

// update_windows.go - restart after a self-update.
// Service mode: exit without reporting SERVICE_STOPPED so SCM failure
// recovery restarts the NEW binary. Console mode: spawn the new exe
// detached, then exit.

func restartSelf() {
	if isWindowsService() {
		// SCM recovery (restart-on-fail) brings the new binary up.
		// Deliberately skip svc.SetServiceStatus(STOPPED) by hard-exiting.
		log.Print("update: exiting for service restart")
		os.Exit(0)
	}
	// console mode: relaunch detached
	exe, err := os.Executable()
	if err != nil {
		log.Printf("update: relaunch failed: %v", err)
		os.Exit(0)
	}
	cmd := exec.Command(exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000208} // CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		log.Printf("update: relaunch start failed: %v", err)
	}
	log.Print("update: relaunched; exiting old process")
	os.Exit(0)
}
