//go:build !windows

package main

// singleinstance_other.go - single-instance lock is a no-op off Windows;
// the console/service race this guards against is a Windows deployment
// pattern (scheduled task + manual console copy). POSIX process groups
// do not reproduce it in practice.

func tryLock(name string) bool { return true }