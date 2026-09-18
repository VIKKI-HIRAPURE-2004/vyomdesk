# 02 — VyomDesk Architecture

## 1. High-Level Diagram

```
                        ┌──────────────────────────────────────────────┐
                        │              VYOMDESK SERVER                 │
                        │                                              │
  ┌──────────┐  HTTPS   │  ┌────────────┐    ┌──────────────────────┐ │   WSS (outbound)
  │ Browser  │◄────────►│  │  API Gate  │───►│   VyomLink Agent     │◄┼──────────────┐
  │ (Web UI/ │  WSS     │  │ (REST+WS)  │    │   Connection Manager │ │              │
  │  PWA)    │          │  └────────────┘    └──────────────────────┘ │              │
  └──────────┘          │         │                   ▲               │       ┌──────┴──────┐
                        │  ┌──────▼──────┐   ┌────────┴────────┐     │       │ VyomLink    │
  ┌──────────┐          │  │ Auth & User │   │  Relay Hub       │◄────┼──────►│ Agent       │
  │ Guest    │  HTTPS   │  │ (2FA/SSO)   │   │ (session pipe)   │ WSS │       │ (Win/Mac/   │
  │ (link)   │◄────────►│  └─────────────┘   └─────────────────┘     │       │  Linux/Andr)│
  └──────────┘          │         │                   ▲               │       └─────────────┘
                        │  ┌──────▼──────┐            │               │
                        │  │ Monitoring  │   ┌────────┴────────┐      │
                        │  │ & Alerts    │   │ WebRTC Signaling│      │
                        │  └─────────────┘   └─────────────────┘      │
                        │         │                                    │
                        │  ┌──────▼─────────────────────────────┐    │
                        │  │  Database Layer (SQLite/PostgreSQL) │    │
                        │  └────────────────────────────────────┘    │
                        └──────────────────────────────────────────────┘
```

## 2. Components

### 2.1 VyomDesk Server (Node.js + TypeScript)

Monorepo, 4 services (ek hi process mein v1, alag scalable v2):

| Service | Responsibility | Port |
|---------|---------------|------|
| **api** | REST API + browser WebSocket | 443 (TLS) |
| **agent-hub** | Agent WSS connections, registry, command routing | 443 (same TLS, `/agent.ashx` style path) |
| **relay** | Desktop/terminal/file session pipes | 443 path-based |
| **monitor** | Metrics ingestion, alert evaluation | internal + cron |

**v1 deployment:** single Node process, path-based routing (MeshCentral pattern), so sirf **1 port (443)** chahiye — public hosting easy.

### 2.2 VyomLink Agent (Go + Rust core)

- Go main (service, WSS client, reconnect backoff, self-update)
- Rust screen-capture module (DDA on Windows, X11/Wayland on Linux, CGDisplay on macOS, MediaProjection on Android)
- Single static binary per platform (~15-25MB)
- Service install (Windows service / systemd / launchd)
- **Outbound-only** connections (NAT safe)

### 2.3 Web Client (React + TypeScript PWA)

- Dashboard (devices, groups, monitoring)
- Remote desktop viewer (canvas + WebTransport/WebSocket)
- Terminal (xterm.js)
- File manager
- Admin console
- Works on mobile browsers (PWA installable)

## 3. Connection Flows

### 3.1 Agent Registration
```
Agent ──(1)──► GET /agent/download?token=X        (install, embedded server cert hash)
Agent ──(2)──► WSS /agent.ashx                    (TLS + server cert pinning)
        ◄─(3)── { "cmd":"auth", "nonce":... }     (challenge-response, Ed25519 signed)
Agent ──(4)──► { "cmd":"authResp", sig, hardwareId }
Server verifies, registers agent, sends config
```

### 3.2 Remote Desktop Session (relay mode)
```
Browser ──► POST /api/sessions {deviceId, type:"desktop"}  → {sessionId, wsToken}
Browser ──► WSS /relay.ashx?sid=...&token=...
Server  ──► Agent: {cmd:"tunnel", protocol:2, sessionId, consent:true}
Agent   ──► WSS /relay.ashx?sid=...&agentSig=...
Server pipes both sockets. Screen stream: tiled VP9/AV1 (fallback JPEG for compat).
```

### 3.3 Quick-Connect (GetScreen-style, no account)
```
Target user opens vyomdesk.online/quick
  → downloads one-time agent (expires in X min, auto-uninstall)
  → agent shows 9-digit code
Helper enters code at vyomdesk.online/help + optional password
  → relay session starts (with visible tray icon + consent)
```

### 3.4 WebRTC P2P (optional, low server load)
```
Browser & Agent exchange SDP offers via server signaling
Direct DTLS media path (VP9) — server sirf signaling karta hai
Fallback: relay mode always available
```

## 4. Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Language (server) | Node.js + TS | MeshCentral pattern proven, huge ecosystem, WS-first |
| Language (agent) | Go + Rust | Small binary, cross-compile 25+ platforms, memory safe |
| DB | SQLite default, PostgreSQL for scale | Zero-config start, upgrade path |
| Single port | 443 only | Public hosting & NAT friendly |
| Protocol | JSON control + binary frames | Debuggable + efficient |
| Video codec | VP9 default, AV1 opt, JPEG fallback | Royalty-free, browser-native decode |
| Auth (agent) | Ed25519 challenge-response | No passwords on wire |
| Auth (user) | Argon2id + optional TOTP/WebAuthn | Modern standard |
| Relay vs P2P | Relay default, P2P opt-in | Simplicity + performance option |

## 5. Scalability Path

- **v1:** single server → 5-10k agents (sufficient for most)
- **v1.5:** sticky agent-hub + separate relay workers (Redis presence)
- **v2:** horizontal multi-node (agent sharding by deviceId, Redis pub/sub events) — MeshCentral "peers" model but simpler

## 6. Failure Modes & Resilience

| Failure | Behavior |
|---------|----------|
| Agent disconnect | Auto-reconnect exponential backoff (1s→60s), session resume |
| Server restart | Agents reconnect, browser sessions token-valid → rejoin |
| Relay crash | Session drops, auto-retry, agent keeps running |
| DB down | Server read-only mode, new sessions rejected gracefully |
| Cert expiry | ACME auto-renew, agent cert-pin update window |
