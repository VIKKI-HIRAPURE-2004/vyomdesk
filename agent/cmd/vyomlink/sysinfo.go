package main

import (
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
)

// sysinfo.go - real OS metric collectors via gopsutil.
// (Collector approach follows common RMM agent patterns, incl. MeshCentral, Apache-2.0.)

var lastNet = struct {
	rx uint64
	tx uint64
	at time.Time
}{}

func platformVersion() string {
	info, err := host.Info()
	if err != nil {
		return ""
	}
	return info.PlatformVersion
}

func cpuPercent() float64 {
	pcts, err := cpu.Percent(0, false)
	if err != nil || len(pcts) == 0 {
		return 0
	}
	return round1(pcts[0])
}

func memPercent() float64 {
	vm, err := mem.VirtualMemory()
	if err != nil {
		return 0
	}
	return round1(vm.UsedPercent)
}

func memUsedMB() float64 {
	vm, err := mem.VirtualMemory()
	if err != nil {
		return 0
	}
	return round1(float64(vm.Used) / 1024 / 1000)
}

// netTotals returns aggregate rx/tx bytes across non-loopback interfaces.
func netTotals() (uint64, uint64) {
	counters, err := net.IOCounters(true)
	if err != nil {
		return 0, 0
	}
	var rx, tx uint64
	for _, c := range counters {
		if c.BytesRecv == 0 && c.BytesSent == 0 {
			continue
		}
		if strings.HasPrefix(c.Name, "lo") {
			continue
		}
		rx += c.BytesRecv
		tx += c.BytesSent
	}
	return rx, tx
}

// netRateKbPs computes KB/s rates from counter deltas since the previous call.
func netRateKbPs() (float64, float64) {
	rx, tx := netTotals()
	now := time.Now()
	defer func() { lastNet.rx, lastNet.tx, lastNet.at = rx, tx, now }()
	if lastNet.at.IsZero() || rx < lastNet.rx || tx < lastNet.tx {
		return 0, 0
	}
	dt := now.Sub(lastNet.at).Seconds()
	if dt <= 0 {
		return 0, 0
	}
	rxKb := (float64(rx-lastNet.rx) / 1024) / dt
	txKb := (float64(tx-lastNet.tx) / 1024) / dt
	return round1(rxKb), round1(txKb)
}

func collectMetrics() map[string]any {
	rxKb, txKb := netRateKbPs()
	return map[string]any{
		"ts":        time.Now().UnixMilli(),
		"uptimeS":   int64(time.Since(startTime).Seconds()),
		"cpuPct":    cpuPercent(),
		"memPct":    memPercent(),
		"memUsedMb": memUsedMB(),
		"netRxKb":   rxKb,
		"netTxKb":   txKb,
	}
}

func round1(v float64) float64 {
	if v < 0 {
		return 0
	}
	return float64(int(v*10+0.5)) / 10
}

func platformName() string {
	switch runtime.GOOS {
	case "windows":
		return "windows"
	case "linux":
		return "linux"
	case "darwin":
		return "macos"
	case "android":
		return "android"
	default:
		return runtime.GOOS
	}
}