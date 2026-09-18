// Package main is the VyomLink agent entrypoint.
//
// VyomLink is part of VyomDesk. Server concepts adapted from MeshCentral
// (Apache-2.0, Copyright Intel Corp). See NOTICE in repo root.
package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	log.SetPrefix("[vyomlink] ")

	// service/install subcommands (Windows service lifecycle + first-time enroll)
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "install":
			if len(os.Args) < 3 {
				log.Fatal("usage: vyomlink install [-server URL] [-token VD-XXXX] [-device ID] [-start]")
			}
			var serverURL = envOr("VYOM_SERVER", "ws://localhost:4430/agent.ashx")
			var deviceID = envOr("VYOM_DEVICE_ID", "")
			var installToken = envOr("VYOM_INSTALL_TOKEN", "")
			autostart := false
			for i := 2; i < len(os.Args); i++ {
				arg := os.Args[i]
				switch {
				case arg == "-server" && i+1 < len(os.Args):
					i++
					serverURL = os.Args[i]
				case arg == "-token" && i+1 < len(os.Args):
					i++
					installToken = os.Args[i]
				case arg == "-device" && i+1 < len(os.Args):
					i++
					deviceID = os.Args[i]
				case arg == "-start":
					autostart = true
				}
			}
			// Persist enroll config so auto-start after reboot reuses identity + enrollment.
			dir := defaultIdentityDir()
			enroll := loadEnroll(dir)
			if serverURL != "" {
				enroll.ServerURL = serverURL
			}
			if deviceID != "" {
				enroll.DeviceID = deviceID
			}
			if installToken != "" {
				enroll.InstallToken = normalizeToken(installToken)
				enroll.Enrolled = false
			}
			if err := saveEnroll(dir, enroll); err != nil {
				log.Fatalf("save enroll config: %v", err)
			}
			installToken = enroll.InstallToken

			id, err := LoadOrCreateIdentity(dir)
			if err != nil {
				log.Fatalf("identity: %v", err)
			}
			if deviceID == "" {
				deviceID = deriveDeviceID(id)
				log.Printf("derived deviceId %s", deviceID)
			}
			enroll.DeviceID = deviceID
			_ = saveEnroll(dir, enroll)

			// Register now (foreground) so token errors surface immediately,
			// then install the Windows service for auto-start after reboot.
			c := NewClientWithEnroll(serverURL, deviceID, id, installToken, enroll.EmailHint, func() {
				markEnrolled(dir, enroll)
			})
			if err := c.connectOnce(); err != nil {
				log.Fatalf("registration failed: %v", err)
			}
			log.Println("registered with server; installing service for auto-start")
			if err := installService(serverURL, deviceID, autostart); err != nil {
				log.Fatal(err)
			}
			return
		case "service":
			if len(os.Args) < 3 {
				log.Fatal("usage: vyomlink service [install|remove|start|stop|status|run] [-server URL] [-device ID] [-start]")
			}
			var serverURL = envOr("VYOM_SERVER", "ws://localhost:4430/agent.ashx")
			var deviceID = envOr("VYOM_DEVICE_ID", "")
			autostart := false
			for i := 3; i < len(os.Args); i++ {
				arg := os.Args[i]
				switch {
				case arg == "-server" && i+1 < len(os.Args):
					i++
					serverURL = os.Args[i]
				case arg == "-device" && i+1 < len(os.Args):
					i++
					deviceID = os.Args[i]
				case arg == "-start":
					autostart = true
				}
			}
			var err error
			switch os.Args[2] {
			case "install":
				err = installService(serverURL, deviceID, autostart)
			case "remove":
				err = removeService()
			case "start":
				err = startService()
			case "stop":
				err = stopService()
			case "status":
				err = queryService()
			case "run":
				err = runService()
			default:
				log.Fatalf("unknown service subcommand: %s", os.Args[2])
			}
			if err != nil {
				log.Fatal(err)
			}
			return
		case "version":
			log.Printf("VyomLink agent %s", Version)
			return
		}
	}

	// acquireSingleInstance exits when another vyomlink with the same
	// identity dir is already running (e.g. a leftover console copy racing
	// the scheduled-task one); it prevents the server "replaced" kick loop.
	acquireSingleInstance()

	// running as a Windows service? SCM starts us with "service run"
	if isWindowsService() {
		if err := runService(); err != nil {
			log.Fatal(err)
		}
		return
	}

	log.Printf("VyomLink agent %s starting", Version)
	cleanupStaged() // remove .old/.new leftovers from a previous self-update

	serverURL := envOr("VYOM_SERVER", "ws://localhost:4430/agent.ashx")
	deviceID := envOr("VYOM_DEVICE_ID", "")
	installToken := envOr("VYOM_INSTALL_TOKEN", "")

	// vyomlink.json next to the binary overrides env (installer writes it).
	dir := defaultIdentityDir()
	enroll := loadEnroll(dir)
	if enroll.ServerURL != "" {
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
		log.Fatalf("identity: %v", err)
	}
	if deviceID == "" {
		deviceID = deriveDeviceID(id)
		log.Printf("derived deviceId %s", deviceID)
	}

	c := NewClientWithEnroll(serverURL, deviceID, id, installToken, enroll.EmailHint, func() {
		markEnrolled(dir, enroll)
		log.Println("enrolled: install token consumed")
	})
	go c.Run()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutting down")
	c.Close()
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

var startTime = time.Now()

// defaultIdentityDir keeps the agent identity next to the binary.
func defaultIdentityDir() string {
	exe, err := os.Executable()
	if err == nil {
		return filepath.Dir(exe)
	}
	wd, _ := os.Getwd()
	return wd
}
