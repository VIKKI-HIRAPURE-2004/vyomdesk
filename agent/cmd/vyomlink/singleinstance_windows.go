//go:build windows

package main

// singleinstance_windows.go - named-mutex single-instance lock. Global\
// namespace so it is visible across ALL sessions (console + SSH/services),
// which is exactly the duplicate-agent scenario this guards against.

import (
	"golang.org/x/sys/windows"
)

func tryLock(name string) bool {
	ptr, err := windows.UTF16PtrFromString("Global\\" + name)
	if err != nil {
		return true // cannot build the name: prefer to run over being locked out
	}
	handle, err := windows.CreateMutex(nil, true, ptr)
	if err != nil {
		if err == windows.ERROR_ALREADY_EXISTS {
			return false // another instance owns the mutex
		}
		return true // unexpected error: prefer to run over being locked out
	}
	_ = handle // hold the handle for the process lifetime
	return true
}