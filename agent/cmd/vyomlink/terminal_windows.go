//go:build windows

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// terminal_windows.go - ConPTY-backed shell for the terminal channel
// (Channel.Terminal = 1). CreatePseudoConsole + attribute-list spawn
// (Win10 1809+). Some environments (agent as a no-console background
// process on certain Win11 builds) never engage ConPTY input passthrough,
// so a startup round-trip probe falls back to plain cmd.exe pipes.
// Pure syscalls, no cgo. (Pattern from the Windows EchoCon sample, MIT.)

var (
	modKernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procCreatePseudoConsole = modKernel32.NewProc("CreatePseudoConsole")
	procResizePseudoConsole = modKernel32.NewProc("ResizePseudoConsole")
	procClosePseudoConsole  = modKernel32.NewProc("ClosePseudoConsole")

	procInitializeProcThreadAttributeList = modKernel32.NewProc("InitializeProcThreadAttributeList")
	procUpdateProcThreadAttribute         = modKernel32.NewProc("UpdateProcThreadAttribute")
	procDeleteProcThreadAttributeList     = modKernel32.NewProc("DeleteProcThreadAttributeList")

	procCreateProcessW = modKernel32.NewProc("CreateProcessW")
	procCreatePipe     = modKernel32.NewProc("CreatePipe")
)

const (
	// PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)
	// = 22 | PROC_THREAD_ATTRIBUTE_INPUT(0x00020000)
	procThreadAttributePseudoConsole = 0x00020016
	extendedStartupinfoPresent       = 0x00080000
	defaultConPtyCols                = 120
	defaultConPtyRows                = 30
)

type startupInfoEx struct {
	StartupInfo   windows.StartupInfo
	AttributeList uintptr
}

// startShell spawns cmd.exe inside a ConPTY; on probe failure or API
// absence it falls back to plain cmd.exe pipes.
func startShell() (*shellHandle, error) {
	if procCreatePseudoConsole.Find() != nil {
		log.Printf("terminal: ConPTY API missing, piped fallback")
		return startShellPiped()
	}
	s := &conPtyShell{}
	if err := s.start(); err != nil {
		log.Printf("terminal: ConPTY start failed (%v), piped fallback", err)
		s.cleanup()
		return startShellPiped()
	}
	intro, ok := s.probe()
	if !ok {
		log.Printf("terminal: ConPTY input round-trip failed, piped fallback")
		s.cleanup()
		return startShellPiped()
	}
	log.Printf("terminal: ConPTY shell started (probe ok)")
	return &shellHandle{
		stdin:  s.inFile,  // agent writes shell input here
		stdout: s.outFile, // agent reads shell output here
		resize: s.resize,
		wait:   s.wait,
		close:  s.close,
		intro:  intro, // bytes drained during the probe, replayed to the browser
	}, nil
}

type conPtyShell struct {
	hpc     windows.Handle
	inFile  *os.File // write end: agent -> conpty
	outFile *os.File // read end: conpty -> agent
	proc    windows.Handle
	attr    uintptr
	attrBuf []byte // attribute-list storage; GC anchor (must outlive spawn)
	mu      sync.Mutex
}

// probe verifies the pty actually round-trips input: drain startup output
// (handshake + banner), send a bare enter, and require more output within
// the deadline. Drained bytes are returned so the pump can replay them.
// Goroutine+select based: os.File deadlines may be unsupported on raw
// pipe handles, which would block forever on dead ptys.
func (s *conPtyShell) probe() ([]byte, bool) {
	const (
		respondWin = 5 * time.Second
		idleMax    = 6 * time.Second // no new output for this long = drained
	)
	var drained []byte
	buf := make([]byte, 4096)

	readAsync := func() chan int {
		ch := make(chan int, 1)
		go func() {
			n, _ := s.outFile.Read(buf)
			ch <- n
		}()
		return ch
	}

	// phase 1: drain until idle (handshake + banner); bounded overall
	ch := readAsync()
	idle := time.NewTimer(idleMax)
	defer idle.Stop()
	for {
		select {
		case n := <-ch:
			if n <= 0 {
				return drained, false // read end closed
			}
			drained = append(drained, buf[:n]...)
			idle.Reset(idleMax)
			ch = readAsync()
		case <-idle.C:
			// no new output for a while: consider startup drained
			goto phase2
		}
	}

phase2:
	// phase 2: bare enter must produce output (a prompt line) on a live pty
	if _, err := s.inFile.Write([]byte("\r")); err != nil {
		return drained, false
	}
	select {
	case n := <-ch:
		if n > 0 {
			return append(drained, buf[:n]...), true
		}
		return drained, false
	case <-time.After(respondWin):
		return drained, false // input never round-tripped: dead pty
	}
}

func (s *conPtyShell) start() error {
	// two pipes: input into the pty, output out of the pty
	var inR, inW, outR, outW windows.Handle
	r1, _, e1 := procCreatePipe.Call(
		uintptr(unsafe.Pointer(&inR)), uintptr(unsafe.Pointer(&inW)), 0, 0)
	if r1 == 0 {
		return fmt.Errorf("CreatePipe(in): %w", e1)
	}
	r1, _, e1 = procCreatePipe.Call(
		uintptr(unsafe.Pointer(&outR)), uintptr(unsafe.Pointer(&outW)), 0, 0)
	if r1 == 0 {
		windows.CloseHandle(inR)
		windows.CloseHandle(inW)
		return fmt.Errorf("CreatePipe(out): %w", e1)
	}

	// CreatePseudoConsole(COORD{cols,rows}, hIn, hOut, 0, &hpc)
	var hpc windows.Handle
	r2, _, e2 := procCreatePseudoConsole.Call(
		uintptr(defaultConPtyCols|(defaultConPtyRows<<16)),
		uintptr(inR), uintptr(outW), 0, uintptr(unsafe.Pointer(&hpc)),
	)
	if r2 != 0 { // S_OK == 0
		windows.CloseHandle(inR)
		windows.CloseHandle(inW)
		windows.CloseHandle(outR)
		windows.CloseHandle(outW)
		return fmt.Errorf("CreatePseudoConsole: %w", e2)
	}
	s.hpc = hpc
	// ConHost dup'ed the pty-side ends; close ours like the EchoCon sample
	windows.CloseHandle(inR)
	windows.CloseHandle(outW)

	cmdPath, _ := exec.LookPath("cmd.exe")
	if cmdPath == "" {
		cmdPath = `C:\Windows\System32\cmd.exe`
	}
	cmdLine, _ := windows.UTF16PtrFromString(`"` + cmdPath + `"`)

	// attribute list carrying the HPCON (EchoCon: lpValue = hPC itself)
	var attrSize uintptr
	procInitializeProcThreadAttributeList.Call(0, 1, 0, uintptr(unsafe.Pointer(&attrSize)))
	s.attrBuf = make([]byte, attrSize)
	s.attr = uintptr(unsafe.Pointer(&s.attrBuf[0]))
	r3, _, e3 := procInitializeProcThreadAttributeList.Call(s.attr, 1, 0, uintptr(unsafe.Pointer(&attrSize)))
	if r3 == 0 {
		return fmt.Errorf("InitializeProcThreadAttributeList: %w", e3)
	}
	r4, _, e4 := procUpdateProcThreadAttribute.Call(
		s.attr, 0,
		uintptr(procThreadAttributePseudoConsole),
		uintptr(hpc), unsafe.Sizeof(hpc),
		0, 0,
	)
	if r4 == 0 {
		return fmt.Errorf("UpdateProcThreadAttribute: %w", e4)
	}

	si := &startupInfoEx{}
	si.StartupInfo.Cb = uint32(unsafe.Sizeof(*si))
	si.AttributeList = s.attr

	var pi windows.ProcessInformation
	r5, _, e5 := procCreateProcessW.Call(
		0, uintptr(unsafe.Pointer(cmdLine)), 0, 0, 0,
		uintptr(extendedStartupinfoPresent),
		0, 0,
		uintptr(unsafe.Pointer(&si.StartupInfo)),
		uintptr(unsafe.Pointer(&pi)),
	)
	if r5 == 0 {
		return fmt.Errorf("CreateProcessW: %w", e5)
	}
	// attribute list must stay valid through the spawn; s owns the buffer
	runtime.KeepAlive(si)
	runtime.KeepAlive(s)

	windows.CloseHandle(pi.Thread)
	s.proc = pi.Process

	// agent-side ends of the pty pipes
	s.inFile = os.NewFile(uintptr(inW), "conpty-in")
	s.outFile = os.NewFile(uintptr(outR), "conpty-out")
	return nil
}

func (s *conPtyShell) resize(cols, rows int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.hpc == 0 {
		return
	}
	if cols < 1 || cols > 500 {
		cols = defaultConPtyCols
	}
	if rows < 1 || rows > 200 {
		rows = defaultConPtyRows
	}
	procResizePseudoConsole.Call(uintptr(s.hpc), uintptr(cols|(rows<<16)))
}

func (s *conPtyShell) wait() error {
	s.mu.Lock()
	proc := s.proc
	s.mu.Unlock()
	if proc == 0 {
		return nil
	}
	windows.WaitForSingleObject(proc, windows.INFINITE)
	return nil
}

func (s *conPtyShell) close() {
	s.cleanup()
}

func (s *conPtyShell) cleanup() {
	s.mu.Lock()
	hpc, proc, attr := s.hpc, s.proc, s.attr
	s.hpc, s.proc, s.attr = 0, 0, 0
	s.mu.Unlock()
	if hpc != 0 {
		procClosePseudoConsole.Call(uintptr(hpc))
	}
	if proc != 0 {
		windows.TerminateProcess(proc, 1)
		windows.CloseHandle(proc)
	}
	if attr != 0 {
		procDeleteProcThreadAttributeList.Call(attr)
	}
}

// --- piped fallback (pre-1809 Windows or environments where ConPTY
// input passthrough never engages, e.g. some no-console service hosts) ---

func startShellPiped() (*shellHandle, error) {
	cmd := exec.Command(`cmd.exe`)
	cmd.Env = os.Environ()
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &shellHandle{
		stdin:  in,
		stdout: out,
		resize: nil, // pipes cannot resize
		wait:   cmd.Wait,
		close:  func() { _ = cmd.Process.Kill() },
	}, nil
}
