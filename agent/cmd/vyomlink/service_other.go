//go:build !windows

package main

import "fmt"

// service_other.go - service management is Windows-only for now.
// (systemd units ship separately in scripts/.)

func isWindowsService() bool { return false }

func runService() error {
	return fmt.Errorf("service mode is only supported on Windows")
}

func installService(serverURL, deviceID string, autostart bool) error {
	return fmt.Errorf("service mode is only supported on Windows; use scripts/vyomlink.service (systemd)")
}

func removeService() error {
	return fmt.Errorf("service mode is only supported on Windows")
}

func startService() error {
	return fmt.Errorf("service mode is only supported on Windows")
}

func stopService() error {
	return fmt.Errorf("service mode is only supported on Windows")
}

func queryService() error {
	return fmt.Errorf("service mode is only supported on Windows")
}
