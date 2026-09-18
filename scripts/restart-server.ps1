# Restarts the VyomDesk dev server on port 4430.
# Usage: powershell -ExecutionPolicy Bypass -File VyomDesk\scripts\restart-server.ps1
# Run from the MeshCentral-master checkout root (D:\MeshCentral-master).
$ErrorActionPreference = 'Continue'

# 1. Kill any process listening on 4430 (old server)
try {
  $conns = Get-NetTCPConnection -LocalPort 4430 -State Listen -ErrorAction Stop
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    if ($procId -and $procId -ne 0) {
      Write-Output ("killing old server pid " + $procId)
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 2
} catch {
  Write-Output "no old server on 4430"
}

# 2. Start fresh server
Set-Location 'VyomDesk\server'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npx tsx src/core/main.ts' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden
Start-Sleep -Seconds 8

# 3. Health check
try { Write-Output ((Invoke-WebRequest -Uri 'http://localhost:4430/api/v1/health' -UseBasicParsing).Content) } catch { Write-Output ('health failed: ' + $_.Exception.Message) }