# 01 — Competitor Analysis: MeshCentral vs GetScreen.me

> Deep research based on MeshCentral v1.2.5 source code (D:\MeshCentral-master) + GetScreen.me public site.

## 1. MeshCentral (Open Source, Apache 2.0)

### 1.1 Architecture (from source analysis)

```
meshcentral.js (main, 324KB)
 ├── webserver.js (747KB — HTTPS :443, UI + WebSocket API)
 ├── redirserver.js (HTTP :80 — cert generation + agent checkin)
 ├── meshagent.js (140KB — agent connection manager, :443 WSS)
 ├── meshrelay.js (93KB — relay: browser ⇄ agent traffic pipe)
 ├── meshuser.js (597KB — user management, 2FA, sharing)
 ├── apprelays.js (134KB — RDP/VNC/SSH web relays)
 ├── mpsserver.js (94KB — Intel AMT CIRA)
 ├── amtmanager.js (202KB — Intel AMT management)
 ├── db.js (297KB — NeDB/MongoDB/MariaDB/SQLite abstraction)
 └── 20+ more modules
```

**Key design:**
- Agent **outbound** WSS connection to server (NAT-friendly) ✓
- Browser ⇄ Server ⇄ Agent via relay WebSocket
- Optional **WebRTC** P2P direct path (server only for signaling)
- Multi-server (peers) support
- NeDB (default), MongoDB, MariaDB, MySQL, SQLite backends
- Let's Encrypt built-in
- Agent binaries for ~25 platforms (x86, x64, ARM, ARM64, MIPS, RISC-V, FreeBSD, OpenBSD, macOS, Android)

### 1.2 Feature List (verified from config schema + code)

**Remote Access:**
- Remote Desktop (KVM) — tile/JPEG/BMP encoding, WebRTC option
- Remote Terminal (admin/user shell, PowerShell)
- Remote Files (upload/download/manage)
- Wake-on-LAN
- Remote registry edit (Windows)
- Remote processes/services management
- Toast notifications to device
- Web-RDP, Web-SSH, Web-VNC (via apprelays.js — connects to existing RDP/VNC/SSH servers on target)
- Intel AMT (KVM, IDE-R, SOL, provisioning, CIRA) — huge module
- Device Groups (meshes) with fine-grained rights (24+ permission bits)
- User Groups
- Multi-user accounts, user-to-user messaging
- Device notes, tags, guest sharing links (expiry)
- Session recording (.mcrec format, indexed, replayable)
- MeshMessenger (user⇄user, user⇄device chat)
- Device details: hardware inventory, SMBIOS, network interfaces
- Power timeline, IP location, geolocation
- Two-factor auth: TOTP, SMS, Telegram, Discord, ntfy, YubiKey, Duo, email
- SSO: SAML, OIDC, Azure, Google, GitHub, Twitter, JumpCloud, LDAP, SSIP
- Email: SMTP, SendGrid, SendMail
- Self-update, backups (Google Drive, WebDAV, S3)
- Multi-domain support (subdomains with own branding)
- Plugins system
- Translation system (many languages)
- Android agent, Assistant app, MeshCentral Router (port mapping)
- Prometheus metrics export
- CrowdSec integration
- Let's Encrypt automation

### 1.3 Weaknesses
- UI dated (though v2 "modern UI" exists)
- Setup complexity (Node.js, certs, ports)
- Intel AMT code bloat (rarely needed, huge surface)
- No built-in "quick support without install" (GetScreen-style link)
- Mobile web experience basic
- Single maintainer, massive codebase (hard to contribute)

---

## 2. GetScreen.me (Commercial, Closed-Source)

### 2.1 Architecture (from public info)

```
Browser ──HTTPS/WSS──> GetScreen Cloud ──WSS──> Agent (installed on target)
```
- **Cloud-only** (no self-host)
- Agent outbound connection (WAN, NAT-traversal) ✓
- Quick-connect: agent generates **one-time link/ID** — connect instantly without account
- Registered agents for permanent access

### 2.2 Feature List (verified from getscreen.me)

**Remote Session Features:**
- Keyboard & clipboard sync
- Device reboot + auto-reconnect (even Safe Mode)
- Admin privilege elevation (UAC prompt handling)
- Hotkeys (Ctrl+Alt+Del etc.) for Win/Mac/Linux/Android
- Automatic on-screen text translation (real-time OCR translate)
- Mobile gestures support (Android control)
- Built-in file transfer during session
- Pointer Lock API (3D apps)
- Sound on/off toggle
- Multi-monitor support
- Session recording

**Platform:** Windows 7+, Server 2008R2+, macOS 10.10+, Linux, Android 7+

**Business model:** Free tier (limited), paid tiers (more devices/agents)

### 2.3 Weaknesses
- Closed source — no self-host
- Cloud only — data through their servers
- Free tier limits
- No full RMM (no inventory, monitoring, alerts, terminal)

---

## 3. Head-to-Head Comparison

| Feature | MeshCentral | GetScreen.me | **VyomDesk (Planned)** |
|---------|------------|--------------|------------------------|
| License | Apache 2.0 ✅ | Closed ❌ | **Apache 2.0 ✅** |
| Self-host | ✅ | ❌ | **✅ (Docker 1-line)** |
| Public free cloud | ❌ (self-host only) | ✅ (limited) | **✅ unlimited** |
| Agent NAT-traversal (WAN) | ✅ | ✅ | **✅** |
| Quick-connect (no install) | ❌ | ✅ | **✅ (one-time link)** |
| Remote Desktop | ✅ | ✅ | **✅** |
| Multi-monitor | ✅ | ✅ | **✅** |
| Clipboard sync | ✅ | ✅ | **✅+ (text+files)** |
| Sound transfer | ⚠️ (AMT only) | ✅ | **✅** |
| File transfer | ✅ | ✅ | **✅** |
| File manager (full) | ✅ | ⚠️ basic | **✅** |
| Terminal | ✅ | ❌ | **✅** |
| Registry edit | ✅ | ❌ | **✅** |
| Process/service mgmt | ✅ | ❌ | **✅** |
| Wake-on-LAN | ✅ | ❌ | **✅** |
| Reboot+reconnect | ✅ | ✅ | **✅ (Safe Mode too)** |
| UAC elevation | ✅ | ✅ | **✅** |
| Device inventory | ✅ deep | ❌ | **✅** |
| Monitoring/alerts | ⚠️ basic | ❌ | **✅ (CPU/RAM/disk/net + alerting)** |
| Session recording | ✅ | ✅ | **✅** |
| Chat during session | ✅ | ❌ | **✅** |
| Guest sharing links | ✅ | ⚠️ | **✅ (expiry+rights)** |
| 2FA | ✅ many | ⚠️ | **✅ (TOTP+WebAuthn+Email)** |
| SSO/SAML/OIDC | ✅ | ❌ | **✅ OIDC+SAML** |
| Multi-user teams | ✅ | ✅ | **✅ (roles: admin/tech/viewer)** |
| WebRTC P2P | ✅ | ❌ relay only | **✅ optional** |
| Web-RDP/VNC/SSH | ✅ | ❌ | **✅ v2** |
| Intel AMT | ✅ | ❌ | ❌ (skip — niche) |
| Android agent | ✅ | ✅ | **✅ v1.1** |
| Mobile browser client | ⚠️ | ✅ | **✅ PWA** |
| Screen translation | ❌ | ✅ | 🔜 v2 (browser translate API) |
| Multi-domain branding | ✅ | ❌ | **✅ v2** |
| Plugins | ✅ | ❌ | 🔜 v2 |
| Self-update | ✅ | ❌ | **✅** |
| DB options | NeDB/Mongo/Maria/MySQL/SQLite | proprietary | **SQLite/PostgreSQL (+Mongo v2)** |
| Modern UI | ⚠️ | ✅ | **✅ React+Tailwind** |
| Deployment ease | ⚠️ (Node manual) | ✅ (nothing) | **✅ Docker 1-line + public cloud** |

---

## 4. What VyomDesk Takes as Inspiration (NOT Copy)

| From MeshCentral | From GetScreen |
|------------------|----------------|
| Agent⇄Server⇄Browser relay model | Quick-connect one-time link UX |
| Device groups + rights system | Zero-config agent install UX |
| Multi-DB backend design | Modern clean session UI |
| Self-host philosophy | Guest connect without account |
| Recording format idea | Reconnect after reboot UX |
| 2FA breadth | Sound toggle, pointer lock UX |

**All code, protocol, UI, branding 100% original.** Sirf *concepts* (ideas) ka exchange — jo copyright-safe hai.

---

## 5. Legal Safety Analysis

See [09-LEGAL-COPYRIGHT.md](./09-LEGAL-COPYRIGHT.md) for full details. Summary:

1. **Apache 2.0 code (MeshCentral)** — license verified; legally permitted to use/port with attribution (NOTICE + LICENSE + per-file change headers). Strategy: port proven code, original branding.
2. **GetScreen** — closed source; ideas/features not copyrightable; hum unka koi code/artwork/name use nahi karte.
3. **VyomDesk ka apna:** protocol name (VyomLink), agent name (VyomLink), file formats (.vyomrec), UI design, logo, branding.
4. **Avoid:** MeshCentral/GetScreen names, logos, screenshots; GPL code mixing; proprietary codecs (H.264 via openh264 carefully, prefer VP9/AV1).
