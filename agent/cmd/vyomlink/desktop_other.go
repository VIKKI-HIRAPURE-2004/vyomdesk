//go:build !windows

package main

import (
	"errors"
	"image"
)

// desktop_other.go - placeholder for non-Windows desktop capture.
// v1 ships Windows GDI capture only; Linux/macOS (X11/Wayland/CGDisplay)
// can be added later behind the same captureScreen/inject* interface.

func desktopSize() (int, int, error) {
	return 0, 0, errors.New("desktop capture not supported on this platform yet")
}

func captureScreen(scale float64) (*image.RGBA, int, int, error) {
	return nil, 0, 0, errors.New("desktop capture not supported on this platform yet")
}

func injectMouse(x, y float64, action, button string) error {
	return errors.New("input injection not supported on this platform yet")
}

func injectWheel(deltaY float64) error {
	return errors.New("input injection not supported on this platform yet")
}

func injectKey(action, key string) error {
	return errors.New("input injection not supported on this platform yet")
}

func listMonitors() []monitorEntry {
	return nil // single-screen assumption; platform capture TODO
}
