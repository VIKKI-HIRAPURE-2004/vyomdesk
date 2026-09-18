#!/usr/bin/env pwsh
# Publish a vyomlink build into server/downloads/agent for self-update.
# Usage: .\scripts\publish-agent.ps1 [-Version 0.2.0]
# Expects the agent binary already built at agent/vyomlink.exe (Windows)
# or agent/vyomlink (Linux); pass -Binary to override the path.

param(
  [string]$Version = "0.2.0",
  [string]$Binary = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $Binary) {
  if ($IsWindows -or $env:OS -eq "Windows_NT") {
    $Binary = Join-Path $root "agent\vyomlink.exe"
    $plat = "windows-amd64"
  } else {
    $Binary = Join-Path $root "agent\vyomlink"
    $plat = "linux-amd64"
  }
}

if (-not (Test-Path $Binary)) { Write-Error "binary not found: $Binary" }

$dir = Join-Path $root "server\downloads\agent\$plat"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item $Binary (Join-Path $dir (Split-Path -Leaf $Binary)) -Force

$hash = (Get-FileHash $Binary -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $Binary).Length

# merge into latest.json
$latest = Join-Path $root "server\downloads\agent\latest.json"
$obj = if (Test-Path $latest) { Get-Content $latest -Raw | ConvertFrom-Json } else { $null }
if (-not $obj) { $obj = [pscustomobject]@{ version = $Version; platforms = @{} } }
if (-not $obj.platforms) {
  $obj | Add-Member -NotePropertyName platforms -NotePropertyValue @{} -Force
}
$entry = [pscustomobject]@{ file = (Split-Path -Leaf $Binary); sha256 = $hash; size = $size }
$obj.platforms | Add-Member -NotePropertyName $plat -NotePropertyValue $entry -Force
$obj.version = $Version
$obj | ConvertTo-Json -Depth 5 | Set-Content -Path $latest -Encoding utf8

Write-Host "published $plat $Version"
Write-Host "  sha256: $hash"
Write-Host "  size:   $size"