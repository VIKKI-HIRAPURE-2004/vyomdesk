//go:build !windows

package main

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

// terminal_unix.go - PTY-backed shell for the terminal channel on Unix.
// creack/pty Start + Setsize for resize support.

func startShell() (*shellHandle, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell)
	cmd.Env = os.Environ()
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &shellHandle{
		stdin:  ptmx,
		stdout: ptmx,
		resize: func(cols, rows int) {
			_ = pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
		},
		wait:  cmd.Wait,
		close: func() { _ = ptmx.Close() },
	}, nil
}
