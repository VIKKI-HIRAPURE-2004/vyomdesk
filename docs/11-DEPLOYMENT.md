# 11 — Deployment Guide

## Modes

1. **Public Cloud** — vyomdesk.online (hum host karte hain, free)
2. **Self-Host Docker** (recommended)
3. **Self-Host Bare Metal** (Node + binaries)
4. **Development** (local, no TLS)

---

## 1. Public Cloud (Users ke liye)

1. vyomdesk.online → Sign up (email verify)
2. Dashboard → Add Device → installer link auto (per-OS)
3. Target machine pe installer run
4. Device online → "Desktop" click → session

**Quick Support (bina account):**
- vyomdesk.online/quick → run one-time agent → 9-digit code
- Helper: vyomdesk.online/help + code → session

---

## 2. Docker Self-Host (5 minutes)

### Requirements
- VPS 2GB RAM, 1 vCPU (sweet: Hetzner CX22 / DO $6)
- Domain DNS → server IP
- Ports 80/443 open

### Steps

```bash
# 1. Get code
git clone https://github.com/vyomdesk/vyomdesk.git
cd vyomdesk

# 2. Configure
cp .env.example .env
nano .env
# Set: VYOM_DOMAIN=desk.example.com
#      VYOM_ACME_EMAIL=you@example.com
#      VYOM_ENCRYPTION_KEY=<openssl rand -hex 32>
#      VYOM_ADMIN_EMAIL=admin@example.com

# 3. Launch
docker compose up -d

# 4. Bootstrap admin (one-time, prints random password)
docker compose exec server node dist/core/bootstrap.js
```

### compose (reference)

```yaml
services:
  server:
    image: vyomdesk/server:1
    restart: unless-stopped
    env_file: .env
    volumes:
      - data:/vyom/data        # db, certs, recordings
    networks: [web]

  caddy:                        # auto-TLS + reverse proxy
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./docker/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    networks: [web]

volumes: { data: {}, caddy_data: {} }
networks: { web: {} }
```

### Caddyfile

```
desk.example.com {
    reverse_proxy server:3000
}
```

### First Login
- https://desk.example.com → admin email + printed password
- Force password change → 2FA setup recommended

---

## 3. Bare Metal

```bash
# Node 20+
git clone … && cd vyomdesk/server
pnpm i && pnpm build
VYOM_DOMAIN=desk.example.com VYOM_DB=sqlite \
VYOM_ENCRYPTION_KEY=… node dist/core/main.js

# systemd unit sample provided: docker/vyomdesk.service
```

---

## 4. Development

```bash
pnpm i
pnpm dev          # server :3000 + web :5173 proxy + hot reload
pnpm dev:agent    # go run with local server, self-signed cert accept flag
```

---

## Env Variables (Server)

| Var | Default | Purpose |
|-----|---------|---------|
| VYOM_DOMAIN | localhost | TLS/ACME domain |
| VYOM_PORT | 3000 | HTTP listen (behind proxy) |
| VYOM_TLS | auto | auto\|on\|off |
| VYOM_ACME_EMAIL | — | Let's Encrypt account |
| VYOM_DB | sqlite | sqlite\|postgres |
| VYOM_PG_URL | — | postgres://user:pass@host/db |
| VYOM_ENCRYPTION_KEY | — REQUIRED prod | 32B hex, at-rest crypto |
| VYOM_SESSION_SECRET | — REQUIRED prod | JWT signing |
| VYOM_ADMIN_EMAIL | — | bootstrap superadmin |
| VYOM_AGENT_PORT | =main | agent WSS path same port |
| VYOM_RECORDINGS_PATH | ./data/recordings | |
| VYOM_MAX_AGENTS | 0 (unlimited) | optional cap |
| VYOM_LOG_LEVEL | info | |
| VYOM_SMTP_* | — | email alerts (host/port/user/pass/from) |

---

## Reverse Proxy Notes (existing nginx)

- WebSocket upgrade headers pass karo (`Upgrade`, `Connection`)
- Timeouts: `proxy_read_timeout 3600s;` (long sessions)
- Client max body: `client_max_body_size 512m;` (file upload via server relay)

---

## Backups

- Volume `data/` = db + certs + recordings
- Daily: `sqlite3 .backup` / `pg_dump` + rsync to object storage
- Restore drill monthly (docs/runbook.md)

## Upgrades

```bash
git pull && docker compose pull && docker compose up -d
# migrations auto-run; agents auto-update staged
```

## Health & Monitoring

- `GET /healthz` (liveness), `GET /readyz` (db check)
- Prometheus: `/metrics` (P2)
- Logs: `docker compose logs -f server` (pino JSON)
