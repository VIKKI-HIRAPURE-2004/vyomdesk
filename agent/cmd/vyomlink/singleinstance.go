package main

// singleinstance.go - one agent per identity dir. A second instance (e.g. a
// stray console copy racing the scheduled-task/service one) exits immediately
// instead of fighting the first for the server connection, which used to
// trigger the server "replaced" kick loop and constant reconnects.
// Platform lock acquisition lives in singleinstance_windows.go/_other.go.

import (
	"log"
	"os"
)

func acquireSingleInstance() {
	if tryLock("VyomLink-SingleInstance-" + sanitizeLockName(defaultIdentityDir())) {
		return
	}
	log.Printf("another vyomlink instance is already running; exiting")
	os.Exit(0)
}

// sanitizeLockName flattens a path into a safe identifier for a mutex name.
func sanitizeLockName(dir string) string {
	s := ""
	for _, r := range dir {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			s += string(r)
			continue
		}
		s += "_"
	}
	if len(s) > 100 {
		s = s[len(s)-100:]
	}
	if s == "" {
		s = "default"
	}
	return s
}