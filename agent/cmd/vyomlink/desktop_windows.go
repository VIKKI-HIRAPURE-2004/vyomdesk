package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"syscall"
	"sync"
	"unicode"
	"unsafe"

	"golang.org/x/sys/windows"
)

// desktop_windows.go - Windows desktop capture and input injection via pure
// syscalls, no cgo. Captures the ENTIRE virtual screen (all monitors), draws
// the remote cursor into the frame (GDI capture misses it), and reports the
// monitor layout. Input uses MOUSEEVENTF_ABSOLUTE|VIRTUALDESK so normalized
// 0..65535 coords map across the whole virtual desktop.
// (Capture approach adapted from MeshCentral Windows agent, Apache-2.0.)

var (
	modGdi32  = windows.NewLazySystemDLL("gdi32.dll")
	modUser32 = windows.NewLazySystemDLL("user32.dll")

	procGetSystemMetrics   = modUser32.NewProc("GetSystemMetrics")
	procGetDC              = modUser32.NewProc("GetDC")
	procReleaseDC          = modUser32.NewProc("ReleaseDC")
	procCreateCompatibleDC = modGdi32.NewProc("CreateCompatibleDC")
	procDeleteDC           = modGdi32.NewProc("DeleteDC")
	procCreateCompatBitmap = modGdi32.NewProc("CreateCompatibleBitmap")
	procCreateDIBSection  = modGdi32.NewProc("CreateDIBSection")
	procSelectObject       = modGdi32.NewProc("SelectObject")
	procDeleteObject       = modGdi32.NewProc("DeleteObject")
	procSetStretchBltMode  = modGdi32.NewProc("SetStretchBltMode")
	procStretchBlt         = modGdi32.NewProc("StretchBlt")
	procGetDIBits          = modGdi32.NewProc("GetDIBits")
	procSendInput          = modUser32.NewProc("SendInput")

	procEnumDisplayMonitors = modUser32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfoW     = modUser32.NewProc("GetMonitorInfoW")

	procGetCursorInfo = modUser32.NewProc("GetCursorInfo")

	modShcore = windows.NewLazySystemDLL("shcore.dll")

	procSetProcessDpiAwareness = modShcore.NewProc("SetProcessDpiAwareness")
	procSetProcessDPIAware     = modUser32.NewProc("SetProcessDPIAware")
	procGetIconInfo   = modUser32.NewProc("GetIconInfo")
	procDrawIconEx    = modUser32.NewProc("DrawIconEx")
)

const (
	srccopy          = 0x00cc0020
	dibRGBColors     = 0
	biRGB            = 0
	halftone         = 4
	inputMouse       = 0
	inputKeyboard    = 1
	mouseMoveF       = 0x0001
	mouseLeftDown    = 0x0002
	mouseLeftUp      = 0x0004
	mouseRightDown   = 0x0008
	mouseRightUp     = 0x0010
	mouseMidDown     = 0x0020
	mouseMidUp       = 0x0040
	mouseWheelF      = 0x0800
	mouseAbsolute    = 0x8000
	mouseVirtualDesk = 0x4000 // MOUSEEVENTF_VIRTUALDESK: 0..65535 spans all monitors
	keyUpF           = 0x0002

	smXVirtualScreen  = 76
	smYVirtualScreen  = 77
	smCXVirtualScreen = 78
	smCYVirtualScreen = 79

	cursorShowing       = 1 // CURSOR_SHOWING flag in CURSORINFO
	diNormal            = 3 // DrawIconEx: draw color+mask
	monitorinfoFPrimary = 1
)

	// initDpiAwareness makes the process per-monitor DPI aware. Without it
	// GetSystemMetrics returns DPI-scaled values on scaled displays (e.g.
	// VMware 133%: physical 1918x878 reported as 1439x659), and the capture
	// source rect then mismatches the driver surface, making GetDIBits
	// intermittently return 0 scan lines. sync.Once guards the call.
	var dpiOnce sync.Once

	func initDpiAwareness() {
		dpiOnce.Do(func() {
			// PROCESS_PER_MONITOR_DPI_AWARE = 2 (shcore.dll, Win 8.1+);
			// fall back to the legacy user32 API on older systems.
			if procSetProcessDpiAwareness.Find() == nil {
				procSetProcessDpiAwareness.Call(2)
			} else {
				procSetProcessDPIAware.Call()
			}
		})
	}

// desktopSize returns the full virtual-screen size (all monitors combined).
func desktopSize() (int, int, error) {
	initDpiAwareness()
	w, _, _ := procGetSystemMetrics.Call(smCXVirtualScreen)
	h, _, _ := procGetSystemMetrics.Call(smCYVirtualScreen)
	if w == 0 || h == 0 {
		return 0, 0, errors.New("no display detected")
	}
	return int(int32(w)), int(int32(h)), nil
}

// desktopOrigin returns the virtual-screen top-left (negative when monitors
// extend left/above the primary).
func desktopOrigin() (int, int) {
	x, _, _ := procGetSystemMetrics.Call(smXVirtualScreen)
	y, _, _ := procGetSystemMetrics.Call(smYVirtualScreen)
	return int(int32(x)), int(int32(y))
}

// listMonitors returns the monitor layout relative to the virtual-screen
// origin (matches the captured image coordinates).
func listMonitors() []monitorEntry {
	out := []monitorEntry{}
	vx, vy := desktopOrigin()
	cb := syscall.NewCallback(func(hMonitor, hdc, clip, lParam uintptr) uintptr {
		var mi [40]byte // MONITORINFO: cbSize, rcMonitor, rcWork, dwFlags
		le.PutUint32(mi[0:], 40)
		r, _, _ := procGetMonitorInfoW.Call(hMonitor, uintptr(unsafe.Pointer(&mi[0])))
		if r == 0 {
			return 1 // keep enumerating
		}
		left := int(int32(le.Uint32(mi[4:])))
		top := int(int32(le.Uint32(mi[8:])))
		right := int(int32(le.Uint32(mi[12:])))
		bottom := int(int32(le.Uint32(mi[16:])))
		primary := le.Uint32(mi[36:]) == monitorinfoFPrimary
		out = append(out, monitorEntry{
			X:       left - vx,
			Y:       top - vy,
			W:       right - left,
			H:       bottom - top,
			Primary: primary,
		})
		return 1
	})
	procEnumDisplayMonitors.Call(0, 0, cb, 0)
	return out
}

type bitmapInfoHeader struct {
	BiSize          uint32
	BiWidth         int32
	BiHeight        int32
	BiPlanes        uint16
	BiBitCount      uint16
	BiCompression   uint32
	BiSizeImage     uint32
	BiXPelsPerMeter int32
	BiYPelsPerMeter int32
	BiClrUsed       uint32
	BiClrImportant  uint32
}

// captureScreen captures the whole virtual screen scaled by factor (0.25..1),
// draws the remote cursor into the frame, and returns an RGBA image plus the
// unscaled pixel size. Uses CreateDIBSection so StretchBlt renders straight
// into a DIB: no GetDIBits read-back needed, which some display drivers
// (e.g. VMware SVGA 3D) intermittently return 0 scan lines for.
func captureScreen(scale float64) (*image.RGBA, int, int, error) {
	rw, rh, err := desktopSize()
	if err != nil {
		return nil, 0, 0, err
	}
	vx, vy := desktopOrigin()
	capW := int(float64(rw)*scale + 0.5)
	capH := int(float64(rh)*scale + 0.5)
	if capW < 1 {
		capW = 1
	}
	if capH < 1 {
		capH = 1
	}

	screenDC, _, _ := procGetDC.Call(0)
	if screenDC == 0 {
		return nil, 0, 0, errors.New("GetDC failed")
	}
	defer procReleaseDC.Call(0, screenDC)

	memDC, _, _ := procCreateCompatibleDC.Call(screenDC)
	if memDC == 0 {
		return nil, 0, 0, errors.New("CreateCompatibleDC failed")
	}
	defer procDeleteDC.Call(memDC)

	// DIB section: positive BiHeight gives bottom-up rows, which the pixel
	// loop below flips while swizzling BGRA -> RGBA.
	stride := capW * 4
	var bmi bitmapInfoHeader
	bmi.BiSize = uint32(unsafe.Sizeof(bmi))
	bmi.BiWidth = int32(capW)
	bmi.BiHeight = int32(capH)
	bmi.BiPlanes = 1
	bmi.BiBitCount = 32
	bmi.BiCompression = biRGB

	var bits unsafe.Pointer
	bmp, _, _ := procCreateDIBSection.Call(memDC, uintptr(unsafe.Pointer(&bmi)), dibRGBColors,
		uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bmp == 0 {
		return nil, 0, 0, errors.New("CreateDIBSection failed")
	}
	defer procDeleteObject.Call(bmp)

	old, _, _ := procSelectObject.Call(memDC, bmp)
	if old == 0 {
		return nil, 0, 0, errors.New("SelectObject failed")
	}
	defer procSelectObject.Call(memDC, old)

	procSetStretchBltMode.Call(memDC, halftone)
	ret, _, _ := procStretchBlt.Call(
		memDC, 0, 0, uintptr(capW), uintptr(capH),
		screenDC, uintptr(vx), uintptr(vy), uintptr(rw), uintptr(rh),
		srccopy,
	)
	if ret == 0 {
		return nil, 0, 0, errors.New("StretchBlt failed")
	}

	// draw the real remote cursor into the frame (GDI capture misses it)
	drawCursor(memDC, scale, vx, vy)

	raw := unsafe.Slice((*byte)(bits), stride*capH)

	img := image.NewRGBA(image.Rect(0, 0, capW, capH))
	for y := 0; y < capH; y++ {
		src := (capH - 1 - y) * stride // bottom-up -> top-down row flip
		dst := y * stride
		for x := 0; x < capW; x++ {
			img.Pix[dst+x*4+0] = raw[src+x*4+2] // R <- BGRA
			img.Pix[dst+x*4+1] = raw[src+x*4+1] // G
			img.Pix[dst+x*4+2] = raw[src+x*4+0] // B
			img.Pix[dst+x*4+3] = 0xff
		}
	}
	return img, rw, rh, nil
}
// drawCursor renders the system cursor at its real position into the capture.
// CURSORINFO (x64, 24B): cbSize@0, flags@4, hCursor@8, ptScreenPos@16(x)/@20(y).
// ICONINFO (x64, 32B): fIcon@0, xHotspot@4, yHotspot@8, hbmMask@16, hbmColor@24.
func drawCursor(memDC uintptr, scale float64, vx, vy int) {
	var ci [24]byte
	le.PutUint32(ci[0:], 24)
	r, _, _ := procGetCursorInfo.Call(uintptr(unsafe.Pointer(&ci[0])))
	if r == 0 {
		return
	}
	if le.Uint32(ci[4:]) != cursorShowing {
		return // hidden cursor (e.g. fullscreen video, locked station)
	}
	hCursor := le.Uint64(ci[8:])
	if hCursor == 0 {
		return
	}
	px := int(int32(le.Uint32(ci[16:])))
	py := int(int32(le.Uint32(ci[20:])))

	hx, hy := 0, 0
	var ii [32]byte
	r2, _, _ := procGetIconInfo.Call(uintptr(hCursor), uintptr(unsafe.Pointer(&ii[0])))
	if r2 != 0 {
		hx = int(le.Uint32(ii[4:]))
		hy = int(le.Uint32(ii[8:]))
		if m := le.Uint64(ii[16:]); m != 0 {
			procDeleteObject.Call(uintptr(m))
		}
		if c := le.Uint64(ii[24:]); c != 0 {
			procDeleteObject.Call(uintptr(c))
		}
	}

	sx := int(float64(px-vx)*scale + 0.5)
	sy := int(float64(py-vy)*scale + 0.5)
	dx := sx - int(float64(hx)*scale+0.5)
	dy := sy - int(float64(hy)*scale+0.5)
	procDrawIconEx.Call(memDC, uintptr(dx), uintptr(dy), uintptr(hCursor), 0, 0, 0, 0, diNormal)
}

// winInput is a fixed 40-byte INPUT struct (x64 layout); fields are written
// little-endian to dodge union/alignment pitfalls.
type winInput [40]byte

var le = binary.LittleEndian

func (in *winInput) setMouse(dx, dy int32, data, flags uint32) {
	le.PutUint32(in[0:], inputMouse)
	le.PutUint32(in[8:], uint32(dx))
	le.PutUint32(in[12:], uint32(dy))
	le.PutUint32(in[16:], data)
	le.PutUint32(in[20:], flags)
}

func (in *winInput) setKey(vk, scan uint16, flags uint32) {
	le.PutUint32(in[0:], inputKeyboard)
	le.PutUint16(in[8:], vk)
	le.PutUint16(in[10:], scan)
	le.PutUint32(in[12:], flags)
}

func sendInput(in *winInput) error {
	ret, _, err := procSendInput.Call(1, uintptr(unsafe.Pointer(in)), 40)
	if ret == 0 {
		return fmt.Errorf("SendInput blocked: %w", err)
	}
	return nil
}

func injectMouse(x, y float64, action, button string) error {
	// ABSOLUTE+VIRTUALDESK: normalized 0..65535 spans the whole virtual
	// desktop, matching the captured multi-monitor image
	nx := int32(x*65535.0 + 0.5)
	ny := int32(y*65535.0 + 0.5)
	base := uint32(mouseMoveF | mouseAbsolute | mouseVirtualDesk)
	switch action {
	case "move":
		var in winInput
		in.setMouse(nx, ny, 0, base)
		return sendInput(&in)
	case "down":
		switch button {
		case "right":
			base |= mouseRightDown
		case "middle":
			base |= mouseMidDown
		case "left":
			base |= mouseLeftDown
		}
	case "up":
		switch button {
		case "right":
			base |= mouseRightUp
		case "middle":
			base |= mouseMidUp
		case "left":
			base |= mouseLeftUp
		}
	case "dblclick":
		seq := []uint32{mouseLeftDown, mouseLeftUp, mouseLeftDown, mouseLeftUp}
		for _, f := range seq {
			var in winInput
			in.setMouse(nx, ny, 0, base|f)
			if err := sendInput(&in); err != nil {
				return err
			}
		}
		return nil
	default:
		return nil
	}
	var in winInput
	in.setMouse(nx, ny, 0, base)
	return sendInput(&in)
}

func injectWheel(deltaY float64) error {
	d := int32(deltaY)
	if d > 120 {
		d = 120
	}
	if d < -120 {
		d = -120
	}
	var in winInput
	in.setMouse(0, 0, uint32(d), mouseWheelF)
	return sendInput(&in)
}

// vkTable maps browser KeyboardEvent.key names to Windows virtual-key codes.
var vkTable = map[string]uint16{
	"enter": 0x0d, "backspace": 0x08, "tab": 0x09, "escape": 0x1b,
	"space": 0x20, "delete": 0x2e, "insert": 0x2d, "home": 0x24, "end": 0x23,
	"pageup": 0x21, "pagedown": 0x22, "shift": 0x10, "control": 0x11,
	"alt": 0x12, "meta": 0x5b, "capslock": 0x14, "numlock": 0x90,
	"arrowleft": 0x25, "arrowup": 0x26, "arrowright": 0x27, "arrowdown": 0x28,
	"minus": 0xbd, "equal": 0xbb, "bracketleft": 0xdb, "bracketright": 0xdd,
	"backslash": 0xdc, "semicolon": 0xba, "quote": 0xde, "backquote": 0xc0,
	"comma": 0xbc, "period": 0xbe, "slash": 0xbf,
}

func vkFromKey(key string) uint16 {
	if vk, ok := vkTable[key]; ok {
		return vk
	}
	r := []rune(key)
	if len(r) == 1 {
		c := unicode.ToLower(r[0])
		if c >= 'a' && c <= 'z' {
			return uint16(c - 'a' + 0x41)
		}
		if c >= '0' && c <= '9' {
			return uint16(c)
		}
	}
	// F1..F12 (browser sends lowercase "f1".."f12")
	if len(key) >= 2 && key[0] == 'f' {
		n := 0
		for _, c := range key[1:] {
			if c < '0' || c > '9' {
				n = 0
				break
			}
			n = n*10 + int(c-'0')
		}
		if n >= 1 && n <= 12 {
			return uint16(0x6f + n) // VK_F1 = 0x70
		}
	}
	return 0
}

func injectKey(action, key string) error {
	vk := vkFromKey(key)
	if vk == 0 {
		return nil // unmapped key, ignore
	}
	var in winInput
	if action == "up" {
		in.setKey(vk, 0, keyUpF)
	} else {
		in.setKey(vk, 0, 0)
	}
	return sendInput(&in)
}
