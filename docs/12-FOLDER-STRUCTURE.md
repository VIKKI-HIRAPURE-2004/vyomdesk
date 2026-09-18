# 12 — Folder Structure (Full Project)

```
vyomdesk/
│
├── docs/                                  # Planning & design (ye files)
│   ├── 00-EXECUTIVE-SUMMARY.md
│   ├── 01-COMPETITOR-ANALYSIS.md
│   ├── 02-ARCHITECTURE.md
│   ├── 03-FEATURES.md
│   ├── 04-TECH-STACK.md
│   ├── 05-DATABASE-SCHEMA.md
│   ├── 06-AGENT-PROTOCOL.md
│   ├── 07-API-SPEC.md
│   ├── 08-SECURITY.md
│   ├── 09-LEGAL-COPYRIGHT.md
│   ├── 10-ROADMAP.md
│   ├── 11-DEPLOYMENT.md
│   └── 12-FOLDER-STRUCTURE.md
│
├── server/                                # VyomDesk Server (Node.js + TS)
│   ├── src/
│   │   ├── core/
│   │   │   ├── main.ts                    # entrypoint
│   │   │   ├── bootstrap.ts               # first-run: certs, admin seed
│   │   │   ├── config.ts                  # env + file config loader (Zod)
│   │   │   ├── certs.ts                   # self-signed + ACME
│   │   │   └── events.ts                  # internal event bus
│   │   ├── api/                           # REST (Fastify)
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── devices.ts
│   │   │   │   ├── groups.ts
│   │   │   │   ├── sessions.ts
│   │   │   │   ├── alerts.ts
│   │   │   │   ├── recordings.ts
│   │   │   │   ├── users.ts
│   │   │   │   ├── quick.ts               # quick-support endpoints
│   │   │   │   └── admin.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts                # JWT/session
│   │   │   │   ├── rights.ts              # group rights bitmask
│   │   │   │   └── rateLimit.ts
│   │   │   └── schemas/                   # Zod DTOs
│   │   ├── ws/
│   │   │   ├── agentHub.ts                # agent control socket manager
│   │   │   ├── browser.ts                 # browser event stream
│   │   │   ├── relay.ts                   # session relay pipe
│   │   │   └── signaling.ts               # WebRTC signaling (P2)
│   │   ├── services/
│   │   │   ├── deviceRegistry.ts
│   │   │   ├── sessionManager.ts
│   │   │   ├── metricsService.ts
│   │   │   ├── alertEngine.ts
│   │   │   ├── recordingService.ts
│   │   │   ├── shareLinks.ts
│   │   │   ├── quickSupport.ts
│   │   │   ├── authService.ts
│   │   │   ├── auditService.ts
│   │   │   ├── updateService.ts           # agent staged rollout
│   │   │   └── mailService.ts
│   │   ├── db/
│   │   │   ├── knexfile.ts
│   │   │   ├── migrations/
│   │   │   ├── seeds/
│   │   │   └── repositories/              # per-table data access
│   │   └── util/
│   │       ├── crypto.ts
│   │       ├── logger.ts
│   │       └── errors.ts
│   ├── test/
│   │   ├── unit/
│   │   └── e2e/                           # supertest
│   └── package.json
│
├── agent/                                 # VyomLink Agent (Go + Rust)
│   ├── cmd/vyomlink/main.go
│   ├── internal/
│   │   ├── client/                        # WSS control client, reconnect
│   │   ├── proto/                         # VyomLink messages (codegen JSON)
│   │   ├── identity/                      # Ed25519 keys, hardware fp
│   │   ├── tunnel/                        # relay session pipes
│   │   ├── desktop/                       # capture + encode + input
│   │   ├── files/                         # file manager ops
│   │   ├── shell/                         # terminal backend
│   │   ├── sysinfo/                       # metrics + inventory
│   │   ├── procsvc/                       # processes/services
│   │   ├── update/                        # signed self-update
│   │   ├── consent/                       # native dialogs
│   │   └── service/                       # win-svc/systemd/launchd
│   ├── capture-rs/                        # Rust static lib (cgo)
│   │   ├── src/{win_dda.rs,linux_pipewire.rs,mac_cgdisplay.rs}
│   │   └── Cargo.toml
│   ├── platforms/                         # installers & packaging
│   │   ├── windows/                       # .iss (Inno), service wrapper
│   │   ├── linux/                         # .deb/.rpm/.sh, systemd units
│   │   ├── macos/                         # .pkg (pkgproj), launchd
│   │   └── android/                       # P2 APK project
│   ├── build.sh                           # cross-compile matrix
│   └── go.mod
│
├── web/                                   # Web client (React + Vite PWA)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── auth/                      # login, register, forgot
│   │   │   ├── dashboard/                 # devices, groups, monitoring
│   │   │   ├── device/                    # detail, tabs
│   │   │   ├── session/                   # desktop/terminal/files views
│   │   │   ├── quick/                     # quick-support pages
│   │   │   ├── admin/                     # users, settings, audit
│   │   │   └── share/                     # guest link landing
│   │   ├── viewer/
│   │   │   ├── DesktopViewer.tsx          # canvas engine
│   │   │   ├── decoder/                   # WebCodecs VP9/AV1/JPEG
│   │   │   ├── input/
│   │   │   ├── clipboard/
│   │   │   └── protocol/                  # binary frame parser
│   │   ├── components/                    # UI kit compositions
│   │   ├── stores/
│   │   ├── api/                           # typed client (from 07 spec)
│   │   ├── i18n/
│   │   └── App.tsx / main.tsx
│   ├── public/ (icons, manifest)
│   └── package.json
│
├── shared/                                # TS types shared server+web
│   └── src/{api.ts,protocol.ts,rights.ts,models.ts}
│
├── docker/
│   ├── Dockerfile.server
│   ├── Dockerfile.web
│   ├── Caddyfile
│   ├── docker-compose.yml
│   └── vyomdesk.service                   # bare-metal systemd
│
├── scripts/
│   ├── build-agents.sh                    # GOOS/GOARCH matrix + sign
│   ├── release.ts                         # version, changelog, artifacts
│   ├── license-check.ts                   # CI gate
│   └── dev-setup.sh
│
├── .github/workflows/
│   ├── ci.yml                             # lint+test+build
│   ├── agents.yml                         # agent matrix build+sign
│   └── release.yml
│
├── .env.example
├── docker-compose.yml                     # root convenience
├── pnpm-workspace.yaml
├── package.json
├── LICENSE                                # Apache 2.0
├── NOTICE                                 # attributions
└── README.md
```

## Build Order (Dependencies)

```
shared → server ↔ web
agent (independent; talks protocol v1 spec)
```

## Conventions

- Commits: conventional (feat/fix/docs/chore)
- Branches: main (stable) + dev; release tags vX.Y.Z
- Code owners per folder; PR review required
- Every protocol change → docs/06 version bump
