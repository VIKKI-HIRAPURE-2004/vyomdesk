# Reverse tunnel: exposes the host server (localhost:4430) to the VM as
# localhost:4430 - workaround for the host firewall blocking inbound TCP 4430
# on the VMnet8 (NAT) adapter. Re-run after a host or VM reboot.
# Target is the local sandbox VM (TEST@192.168.121.134, throwaway creds).
$ErrorActionPreference = 'Stop'
$plink = 'C:\Program Files\PuTTY\plink.exe'
$existing = Get-Process plink -ErrorAction SilentlyContinue
if ($existing) { Write-Output "plink already running (PID $($existing.Id -join ', ')) - exiting"; exit 0 }
Start-Process $plink -ArgumentList '-ssh -batch -pw 123 -N -R 4430:localhost:4430 TEST@192.168.121.134' -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\vyom-tunnel.out.log" -RedirectStandardError "$env:TEMP\vyom-tunnel.err.log"
Start-Sleep -Seconds 2
Get-Process plink -ErrorAction SilentlyContinue | Format-Table Id,ProcessName -AutoSize
