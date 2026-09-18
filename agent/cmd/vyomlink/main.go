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

	// service subcommands (Windows service lifecycle helpers)
	if len(os.Args) > 1 {
		switch os.Args[1] {
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

	id, err := LoadOrCreateIdentity(defaultIdentityDir())
	if err != nil {
		log.Fatalf("identity: %v", err)
	}
	if deviceID == "" {
		deviceID = deriveDeviceID(id)
		log.Printf("derived deviceId %s", deviceID)
	}

	c := NewClient(serverURL, deviceID, id)
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
