# VyomLink agent install (Windows)

Run from an **elevated** (administrator) prompt:

```powershell
# install + start now, pointing at your server
.\vyomlink.exe service install -server "ws://your-server:4430/agent.ashx" -start

# optional: pin the device id (else derived from the identity key)
.\vyomlink.exe service install -server "ws://your-server:4430/agent.ashx" -device "<id>" -start
```

The service name is `VyomLink` (auto-start on boot). Env vars
(`VYOM_SERVER`, `VYOM_DEVICE_ID`) are written to the SCM service
`Environment` value so they survive reboots.

Other commands:

```powershell
.\vyomlink.exe service status   # running/stopped
.\vyomlink.exe service stop
.\vyomlink.exe service start
.\vyomlink.exe service remove   # stop + uninstall
```

## Unattended install from the server (scripted rollout)

```powershell
# download + install in one line (PowerShell)
$server = "ws://your-server:4430"
Invoke-WebRequest "$($server -replace '^ws','http')/downloads/vyomlink.exe" -OutFile vyomlink.exe
.\vyomlink.exe service install -server $server/agent.ashx -start
```

## Linux (systemd)

```bash
sudo cp vyomlink /usr/local/bin/
sudo cp scripts/vyomlink.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vyomlink
```
