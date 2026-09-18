# 04 — Tech Stack

## Server

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 20 LTS | Proven for WS-heavy servers (MeshCentral pattern), huge ecosystem |
| Language | TypeScript (strict) | Type safety across API/agent protocol |
| HTTP | Fastify | 2x faster than Express, schema validation built-in |
| WebSocket | ws | Standard, performant, permessage-deflate |
| ORM | Knex.js (query builder) | SQL control without heavy ORM lock-in, SQLite+PG support |
| DB default | better-sqlite3 | Zero-config, single-file, embedded |
| DB scale | PostgreSQL 16 | Production scale, JSONB for flexible fields |
| Cache/PubSub (v2) | Redis | Multi-node presence & events |
| Auth | argon2, otpauth, @simplewebauthn/server | Modern password + 2FA |
| Crypto | node:crypto (Ed25519, AES-GCM, XChaCha20) | No external deps |
| Certs | acme-client | Let's Encrypt automation |
| Validation | Zod | Runtime schema validation |
| Logging | pino | Fast structured JSON logs |
| Testing | Vitest + Supertest | Unit + API tests |
| Lint | ESLint + Prettier | Consistency |

## Agent (VyomLink)

| Layer | Technology | Why |
|-------|-----------|-----|
| Core | Go 1.22 | Single static binary, easy cross-compile (GOOS matrix), great WS libs |
| Screen capture | Rust FFI module | Windows DDA, Linux X11/Wayland pipe, macOS CGDisplay |
| Video encode | libvpx (VP9), libaom (AV1 opt), fallback JPEG (libjpeg-turbo) | Royalty-free |
| Input synth | Windows SendInput, Linux uinput/xdotool, macOS CGEvent | Standard OS APIs |
| Service | Windows service via golang.org/x/sys, systemd, launchd | Native persistence |
| Config | JSON + ed25519 keypair in OS keychain/file | |
| Update | Self-update: signed binary diff (bsdiff) + full fallback | |
| Auto-start | Registry Run key / systemd / launchd | |
| Logging | zerolog → rotating file | |

**Binary targets (P1):** windows/amd64, windows/386, windows/arm64, linux/amd64, linux/arm64, linux/arm, darwin/amd64, darwin/arm64 (+ android P2 via separate APK)

## Web Client

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | React 18 + Vite | Fast, huge ecosystem, PWA easy |
| Language | TypeScript | Shared types with server |
| Styling | TailwindCSS + shadcn/ui | Modern, fast dev, consistent |
| State | TanStack Query + Zustand | Server state + light client state |
| Desktop viewer | Canvas 2D + WebCodecs (VP9/AV1 hw decode) | Browser-native, low latency |
| Terminal | xterm.js + xterm-addon-fit | Industry standard |
| Charts | uPlot | Tiny, fast time-series |
| File manager | Virtualized tree (react-arborist) | Large dirs |
| PWA | vite-plugin-pwa (Workbox) | Installable, offline shell |
| i18n | i18next | Multi-language |
| E2E tests | Playwright | Cross-browser |

## Infrastructure

| Purpose | Tech |
|---------|------|
| Public cloud | 2-4GB VPS (Hetzner/DO) + Docker Compose + Caddy (TLS) |
| CI/CD | GitHub Actions (test → build agents matrix → docker push) |
| Agent signing | Ed25519 cosign + (optional) Windows EV cert P3 |
| Monitoring | Self-hosted Prometheus + Grafana + Loki |
| Error tracking | GlitchTip (open Sentry) |
| Email | Postal (self-hosted) or SES free tier |
| DNS/CDN | Cloudflare free |

## Repo Layout (monorepo — pnpm workspaces)

```
vyomdesk/
├── docs/                     # ye planning docs
├── server/                   # Node.js TS server
│   ├── src/
│   │   ├── core/             # bootstrap, config, certs
│   │   ├── api/              # REST routes
│   │   ├── ws/               # agent-hub, relay, signaling
│   │   ├── services/         # auth, devices, alerts, recording
│   │   ├── db/               # knex migrations + models
│   │   └── util/
│   └── package.json
├── agent/                    # Go + Rust agent
│   ├── cmd/vyomlink/
│   ├── internal/             # connection, tunnel, capture, input, files
│   ├── capture-rs/           # Rust screen capture lib
│   └── go.mod
├── web/                      # React client
│   ├── src/
│   │   ├── pages/            # login, dashboard, device, session
│   │   ├── components/
│   │   ├── viewer/           # desktop viewer engine
│   │   └── stores/
│   └── package.json
├── docker/                   # Dockerfiles, compose
├── scripts/                  # build, release, sign
└── pnpm-workspace.yaml
```

## Why Not X?

| Alternative | Rejected Because |
|-------------|------------------|
| Rust server | Slower dev velocity for WS-heavy app; Node proven (MeshCentral 750KB webserver.js) |
| Go server | Fewer mature WS-relay patterns; team familiarity |
| Electron desktop app | Browser-only is our differentiator; Electron adds weight |
| MongoDB default | SQLite zero-config better fit for self-host beginners; PG for scale |
| H.264 | Patent licensing risk; VP9/AV1 royalty-free & WebCodecs native |
| Electron agent | Resource heavy; Go/Rust tiny & fast |
