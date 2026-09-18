# 10 — Roadmap & Milestones

## Timeline Overview

```
P0  Foundation        ▓▓▓▓▓▓░░░░░░░░░░░░  Weeks 1-6
P1  MVP               ░░▓▓▓▓▓▓▓▓░░░░░░░  Weeks 5-16
P2  Polish + Scale    ░░░░░░░▓▓▓▓▓▓░░░░  Weeks 17-28
P3  Advanced          ░░░░░░░░░░░▓▓▓▓▓▓  Weeks 29-40+
Launch: Public beta after P1 (week ~16)
```

## P0 — Foundation (Week 1-6)

| # | Task | Output |
|---|------|--------|
| 0.1 | Monorepo setup (pnpm, tsconfig, CI) | Green pipeline |
| 0.2 | Server bootstrap: config, TLS, ACME | HTTPS serving |
| 0.3 | DB migrations (SQLite+PG), seed | Schema live |
| 0.4 | Auth: register/login/Argon2id/JWT/sessions | Working login |
| 0.5 | Agent-hub skeleton: WSS, Ed25519 handshake | Agent connects |
| 0.6 | VyomLink protocol v1 spec freeze | docs/06 final |
| 0.7 | Agent skeleton (Go): connect, ping, metrics | Heartbeat visible |
| 0.8 | Web shell: Vite+React+Tailwind+Router | Login+dashboard skeleton |
| 0.9 | Docker compose (server+web+proxy) | 1-command run |

## P1 — MVP (Week 5-16) 🚀 Public Beta Target

| # | Task |
|---|------|
| 1.1 | Device registry: approve, list, groups, rights |
| 1.2 | Remote Desktop (relay): tiled VP9+JPEG fallback, input, clipboard, multi-monitor, view-only |
| 1.3 | Consent prompts + privacy bar |
| 1.4 | File manager + transfer |
| 1.5 | Terminal (admin) xterm.js |
| 1.6 | Processes + services mgmt |
| 1.7 | Quick-support one-time agent + 9-digit code |
| 1.8 | Guest share links (expiry/rights/password) |
| 1.9 | Metrics ingestion + dashboard graphs + basic alerts (email) |
| 1.10 | Session recording (.vyomrec) + player |
| 1.11 | Audit log + session history |
| 1.12 | Agent installers: Win (svc), Linux (systemd), macOS (launchd + pkg) |
| 1.13 | Agent self-update (signed) |
| 1.14 | Public cloud deploy (vyomdesk.online) + signup + ToS |
| 1.15 | Docs site (Docusaurus) + quickstart |

**P1 Exit Criteria:** 2 concurrent desktop sessions @300ms LAN latency; 1k agents stable 24h; Docker deploy &lt;5min; signup to first session &lt;10 min human time.

## P2 (Week 17-28)

| # | Area | Tasks |
|---|------|-------|
| 2.1 | Android agent | MediaProjection capture, input injection, APK + F-Droid |
| 2.2 | WebRTC P2P | Signaling, ICE/STUN/TURN (coturn), fallback relay |
| 2.3 | Audio | Opus remote sound, toggle |
| 2.4 | Security+ | WebAuthn, email OTP, IP lists, uninstall password, E2E design |
| 2.5 | Mgmt+ | Registry editor, user-shell, script runner, address book, user groups |
| 2.6 | Alerts+ | Telegram/Discord/webhook, rollups, heartbeat alert |
| 2.7 | UX+ | i18n (hi/en), mobile PWA polish, dark mode, branding |
| 2.8 | API+ | Webhooks, API keys UI, CLI (vyomctl) |
| 2.9 | Scale | Redis presence, sticky relay workers, Prometheus |

## P3 (Week 29-40+)

- Software deployment (MSI push), scheduled tasks
- OIDC/SAML/LDAP SSO
- Multi-server federation (agent sharding)
- Plugin system (sandboxed)
- Remote printing, screen translation (browser API)
- Marketplace/community scripts

## Team & Effort (Suggested)

| Role | Count | Focus |
|------|-------|-------|
| Lead/Backend | 1 | Server, protocol |
| Agent engineer | 1 | Go/Rust, capture/input |
| Frontend | 1 | React, viewer engine |
| DevOps/Part-time | 0.5 | Cloud, CI, monitoring |

Solo bhi possible — timeline x2.5 kar do.

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Wayland capture restrictions | Linux agents limited | PipeWire screen cast portal (xdg-desktop-portal) |
| macOS Screen Recording permission | Onboarding friction | Guided grant flow + detection |
| Windows EV signing cost | SmartScreen warnings | Initially self-signed + docs; EV cert P3 budget |
| WebRTC NAT failures | P2P unreliable | TURN fallback, relay default |
| Public cloud abuse | Legal/infra | AUP, rate limits, abuse contact, bans |
| Single dev bus-factor | Continuity | Docs, tests, modular code, community building |

## Definition of Done (per feature)

- Code + tests (unit/e2e where applicable)
- Docs updated
- Security review (authZ paths)
- Feature flag (gradual rollout)
- Telemetry counters (opt-in)
