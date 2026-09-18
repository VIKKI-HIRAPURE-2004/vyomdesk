# VyomDesk 🖥️🌐

**Free & Open-Source Remote Monitoring, Management & Remote Desktop Software**

> Vyom = Sanskrit word for "Sky/Space" — Desk = Your Desktop. **"Your desktop, anywhere in the sky."**

VyomDesk is a self-hostable, publicly hostable, **100% free** remote access & RMM (Remote Monitoring & Management) platform that combines:

- 🔄 **MeshCentral-style** architecture (agent-based, self-hosted server, full device management, terminal, files, monitoring)
- 🚀 **GetScreen.me-style** UX (cloud simplicity, connect from browser instantly, no port-forwarding, quick-support links)

**Legally compliant:** MeshCentral is open-source **Apache 2.0** (verified) - VyomDesk may legally use/port its proven code **with attribution** (LICENSE + NOTICE + change headers). GetScreen.me is never copied (closed-source; feature ideas only). VyomDesk has its own original branding, protocol name and UI.

---

## 📁 Documentation Index

All planning & design documents live in [`/docs`](./docs):

| # | Document | Purpose |
|---|----------|---------|
| 00 | [Executive Summary](./docs/00-EXECUTIVE-SUMMARY.md) | Vision, goals, positioning |
| 01 | [Competitor Analysis](./docs/01-COMPETITOR-ANALYSIS.md) | MeshCentral vs GetScreen deep dive |
| 02 | [Architecture](./docs/02-ARCHITECTURE.md) | Full system architecture |
| 03 | [Features](./docs/03-FEATURES.md) | Complete feature matrix (100+ features) |
| 04 | [Tech Stack](./docs/04-TECH-STACK.md) | Technologies chosen & why |
| 05 | [Database Schema](./docs/05-DATABASE-SCHEMA.md) | All DB collections/tables |
| 06 | [Agent Protocol](./docs/06-AGENT-PROTOCOL.md) | VyomLink wire protocol spec |
| 07 | [API Specification](./docs/07-API-SPEC.md) | REST + WebSocket API |
| 08 | [Security Plan](./docs/08-SECURITY.md) | Threat model, crypto, hardening |
| 09 | [Legal & Copyright](./docs/09-LEGAL-COPYRIGHT.md) | How we avoid copyright issues |
| 10 | [Roadmap](./docs/10-ROADMAP.md) | Phases, milestones, timeline |
| 11 | [Deployment Guide](./docs/11-DEPLOYMENT.md) | Public hosting, Docker, VPS |
| 12 | [Folder Structure](./docs/12-FOLDER-STRUCTURE.md) | Repo layout |

---

## ⚡ Quick Summary

```
┌─────────────┐     WSS/TLS      ┌──────────────┐     WSS/TLS     ┌──────────────┐
│   Browser   │ ◄──────────────► │   VyomDesk   │ ◄─────────────► │  VyomLink    │
│  (Web UI)   │    Relay/WS      │    Server    │   Agent Tunnel  │  Agent       │
└─────────────┘                  └──────────────┘                 └──────────────┘
                                        │
                                 ┌──────┴──────┐
                                 │  Database   │  SQLite / PostgreSQL / MariaDB
                                 └─────────────┘
```

- **Agent connects OUT** to server (works behind NAT/firewall — WAN ready like GetScreen)
- **Browser never touches agent directly** — all traffic relays through server (or optional P2P WebRTC)
- **Self-host or use our public cloud** — both free

## 🚀 Quick Start (Dev)

```bash
# 1. Install deps
pnpm install

# 2. Run server (SQLite auto-migrates, no config needed for dev)
pnpm dev:server            # → http://localhost:4430

# 3. Run web app
pnpm dev:web               # → http://localhost:5173 (proxies /api + /agent.ashx)

# 4. E2E sanity check (server must be running)
node server/test/e2e/full-flow.mjs

# 5. Tests
pnpm test
```

**Agent (Go):** requires Go 1.22+ — `cd agent && go build -o vyomlink.exe ./cmd/vyomlink`, then:
```powershell
$env:VYOM_SERVER = "ws://localhost:4430/agent.ashx"
.\vyomlink.exe    # auto-generates Ed25519 identity + deviceId, connects, pushes metrics
```

## 📊 Current Status

See [docs/13-IMPLEMENTATION-STATUS.md](./docs/13-IMPLEMENTATION-STATUS.md) — foundation (P0) complete + device registry/metrics/live events; relay sessions (desktop/terminal/files) are the next milestone.

## 📜 License

Apache 2.0 — free for personal & commercial use, forever.
