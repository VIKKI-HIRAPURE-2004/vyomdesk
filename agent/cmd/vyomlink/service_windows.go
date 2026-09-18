//go:build windows

package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

// service_windows.go - Windows service integration for the VyomLink agent.
// The same binary runs in console mode (default) or as a service
// ("vyomlink service run"), plus install/remove/start/stop helpers via SCM.
// Pure x/sys, no cgo.

const svcName = "VyomLink"
const svcDisplayName = "VyomDesk VyomLink Agent"
const svcDesc = "VyomDesk remote management agent (metrics, terminal, desktop, files)."

type vyomService struct{}

func (s *vyomService) Execute(args []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown
	status <- svc.Status{State: svc.StartPending}

	serverURL := os.Getenv("VYOM_SERVER")
	deviceID := os.Getenv("VYOM_DEVICE_ID")
	installToken := os.Getenv("VYOM_INSTALL_TOKEN")

	// vyomlink.json next to the binary (written by `install`) survives
	// reboots; env is fallback. Auto-start after Windows restart reuses it.
	dir := defaultIdentityDir()
	enroll := loadEnroll(dir)
	if enroll.ServerURL != "" && serverURL == "" {
		serverURL = enroll.ServerURL
	}
	if enroll.DeviceID != "" && deviceID == "" {
		deviceID = enroll.DeviceID
	}
	if enroll.InstallToken != "" && installToken == "" {
		installToken = enroll.InstallToken
	}

	id, err := LoadOrCreateIdentity(dir)
	if err != nil {
		logToBoth("service: identity: %v", err)
		return false, 1
	}
	if deviceID == "" {
		deviceID = deriveDeviceID(id)
	}

	c := NewClientWithEnroll(serverURL, deviceID, id, installToken, enroll.EmailHint, func() {
		markEnrolled(dir, enroll)
	})
	go c.Run()

	status <- svc.Status{State: svc.Running, Accepts: accepted}
	logToBoth("service: VyomLink %s running (device %s)", Version, deviceID)

	for {
		select {
		case cr := <-r:
			switch cr.Cmd {
			case svc.Interrogate:
				status <- cr.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				logToBoth("service: stopping")
				c.Close()
				return false, 0
			default:
				// Pause/Continue unhandled; ignore
			}
		}
	}
}

var eventLog *eventlog.Log

// logToBoth writes to the Windows event log when running as a service
// (stdout is invisible there) and to the console otherwise.
func logToBoth(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if eventLog != nil {
		if strings.Contains(msg, "error") || strings.Contains(msg, "failed") {
			eventLog.Error(3, msg)
		} else {
			eventLog.Info(1, msg)
		}
	}
	log.Print(msg)
}

func isWindowsService() bool {
	is, err := svc.IsWindowsService()
	return err == nil && is
}

func runService() error {
	elog, err := eventlog.Open(svcName)
	if err == nil {
		eventLog = elog
		defer eventLog.Close()
	}
	logToBoth("service: starting VyomLink %s", Version)
	return svc.Run(svcName, &vyomService{})
}

func installService(serverURL, deviceID string, autostart bool) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exePath, err := filepath.Abs(exe)
	if err != nil {
		return err
	}

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("SCM connect (run as administrator): %w", err)
	}
	defer m.Disconnect()

	// remove any previous instance silently
	if s, err := m.OpenService(svcName); err == nil {
		_ = s.Delete()
		s.Close()
	}

	cfg := mgr.Config{
		DisplayName:  svcDisplayName,
		Description:  svcDesc,
		StartType:    mgr.StartAutomatic,
		Dependencies: []string{"Tcpip"},
	}
	s, err := m.CreateService(svcName, exePath, cfg, "service", "run")
	if err != nil {
		return fmt.Errorf("CreateService: %w", err)
	}
	defer s.Close()

	// persist env via the per-service Environment registry value
	// (SCM service env lives at HKLM\SYSTEM\CurrentControlSet\Services\<name>\Environment)
	if err := setServiceEnvRegistry(svcName, serverURL, deviceID); err != nil {
		log.Printf("service: env registry write failed: %v", err)
	}

	// event log source registration (best effort)
	_ = eventlog.InstallAsEventCreate(svcName, eventlog.Error|eventlog.Warning|eventlog.Info)

	log.Printf("service installed: %s", exePath)
	log.Printf("  server: %s", serverURL)
	if deviceID != "" {
		log.Printf("  deviceId: %s", deviceID)
	}
	if autostart {
		if err := s.Start(); err != nil {
			return fmt.Errorf("Start: %w", err)
		}
		log.Printf("service started")
	}
	return nil
}

func removeService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("SCM connect (run as administrator): %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(svcName)
	if err != nil {
		return fmt.Errorf("service not installed: %w", err)
	}
	defer s.Close()

	// stop if running
	status, err := s.Query()
	if err == nil && status.State != svc.Stopped {
		_, _ = s.Control(svc.Stop)
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			status, err = s.Query()
			if err != nil || status.State == svc.Stopped {
				break
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
	_ = eventlog.Remove(svcName)
	if err := s.Delete(); err != nil {
		return fmt.Errorf("Delete: %w", err)
	}
	log.Printf("service removed")
	return nil
}

func startService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("SCM connect (run as administrator): %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(svcName)
	if err != nil {
		return fmt.Errorf("service not installed: %w", err)
	}
	defer s.Close()
	return s.Start()
}

func stopService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("SCM connect (run as administrator): %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(svcName)
	if err != nil {
		return fmt.Errorf("service not installed: %w", err)
	}
	defer s.Close()
	_, err = s.Control(svc.Stop)
	return err
}

func queryService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("SCM connect (run as administrator): %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(svcName)
	if err != nil {
		return fmt.Errorf("service not installed: %w", err)
	}
	defer s.Close()
	st, err := s.Query()
	if err != nil {
		return err
	}
	state := map[svc.State]string{
		1: "stopped", 2: "start-pending", 3: "stop-pending",
		4: "running", 5: "continue-pending", 6: "pause-pending", 7: "paused",
	}[st.State]
	if state == "" {
		state = fmt.Sprintf("unknown(%d)", st.State)
	}
	log.Printf("service: %s", state)
	return nil
}

// setServiceEnvRegistry writes the per-service environment block
// (HKLM\SYSTEM\CurrentControlSet\Services\<name>\Environment, REG_MULTI_SZ).
// SCM merges these into the service process environment at start.
func setServiceEnvRegistry(name, serverURL, deviceID string) error {
	if serverURL == "" {
		return nil
	}
	keyPath := `SYSTEM\CurrentControlSet\Services\` + name
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, keyPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open %s: %w", keyPath, err)
	}
	defer k.Close()
	var values []string
	if serverURL != "" {
		values = append(values, "VYOM_SERVER="+serverURL)
	}
	if deviceID != "" {
		values = append(values, "VYOM_DEVICE_ID="+deviceID)
	}
	return k.SetStringsValue("Environment", values)
}
