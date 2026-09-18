# Production Deploy Guide (Ubuntu + Docker + Caddy)

> **Target:** `https://vyomdesk.online` — public free cloud instance (P1.14)
> **Stack:** VyomDesk server (Fastify) + Caddy reverse proxy (auto-HTTPS) + SQLite volume

---

## 0. Prerequisites

| Item | Status |
|---|---|
| Domain | `vyomdesk.online` (secured) |
| Ubuntu server | ready (user-provided, any 1GB+ VPS) |
| DNS A record | **You must add:** `@ → <server public IP>` and `www → <server public IP>` |

---

## 1. DNS (registrar panel)

```
Type   Host   Value                TTL
A      @      <UBUNTU_PUBLIC_IP>   default
A      www    <UBUNTU_PUBLIC_IP>   default
```

Verify (any machine): `nslookup vyomdesk.online` → server IP aana chahiye.

---

## 2. Deploy (Ubuntu pe, ek command)

```bash
# repo push ke baad GitHub se:
git clone https://github.com/<org>/vyomdesk.git /opt/vyomdesk
cd /opt/vyomdesk
bash docker/deploy.sh
```

`deploy.sh` kya karta hai:
1. Docker install (agar nahi hai) — official `get.docker.com`
2. Repo clone — `/opt/vyomdesk`
3. Secrets generate — `.env` (VYOM_JWT_SECRET + VYOM_ENCRYPTION_KEY, random 64-hex, `chmod 600`, **backup karo**)
4. `docker compose -f docker/docker-compose.prod.yml up -d --build` — server + Caddy
5. UFW: 80/443 open
6. Health verify — `http://localhost:4430/api/v1/health`

Pehli baar Docker image build me **5–10 min** lagenge (pnpm install + tsc + vite build inside Docker).

---

## 3. Verify Live

```bash
# 1. server container
docker compose -f docker/docker-compose.prod.yml ps

# 2. HTTPS (Caddy Let's Encrypt ~1 min after DNS propagates)
curl -s https://vyomdesk.online/api/v1/health
# → {"status":"ok","agents":0,"version":"0.1.0"}

# 3. web UI
open https://vyomdesk.online
```

---

## 4. First Account = ADMIN (important)

Fresh DB pe **pehla signup admin banta hai** (session 19 bootstrap fix). Pehla account turant banao aur password strong rakho:

```
https://vyomdesk.online → Register → (ye user admin hoga)
```

Iske baad ke sab users role `tech` me aayenge (admin promote kar sakta hai DB se ya future UI se).

---

## 4a. Roles (reference)

| Role | Kab |
|---|---|
| `admin` | Pehla signup (bootstrap) — full access |
| `tech` | Sab baad ke signups (devices manage, sessions) |
| `viewer` | Read-only (DB-level; web UI me promote UI P2 me aayega) |

Roles are stored in `users.role`; change: `UPDATE users SET role='admin' WHERE email='...'` (sqlite3 in the data volume) — ya aapke admin panel se jab role-management UI ready ho.

---

## 5. Agent Install (target machines pe)

### Linux
```bash
# server se download
wget https://vyomdesk.online/downloads/agent/linux-amd64/vyomlink-linux-amd64
chmod +x vyomlink-linux-amd64
VYOM_SERVER=wss://vyomdesk.online/agent.ashx ./vyomlink-linux-amd64
```

### Windows
```powershell
# Device page pe download link milega, ya manual:
VYOM_SERVER=wss://vyomdesk.online/agent.ashx .\vyomlink.exe
```

### Service install (persistent)
```bash
# Linux systemd
sudo VYOM_SERVER=wss://vyomdesk.online/agent.ashx ./vyomlink-linux-amd64 service install
```

---

## 6. Ops

### Logs
```bash
cd /opt/vyomdesk
docker compose -f docker/docker-compose.prod.yml logs -f server   # app logs (pino)
docker compose -f docker/docker-compose.prod.yml logs -f caddy    # TLS/acme
```

### Update (naya release)
```bash
cd /opt/vyomdesk
git pull
docker compose -f docker/docker-compose.prod.yml up -d --build
# data volume (sqlite + recordings) preserved automatically
```

### Backup
```bash
# sqlite + recordings
docker run --rm -v vyomdesk_server-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/vyomdesk-data-$(date +%F).tar.gz -C /data .
```

### Secrets .env backup
`.env` file ko safe jagah rakhna — JWT secret change hone pe sab logged-in users logout + agents re-auth needed (expected).

---

## 7. Caddy container se TLS problem ho to

```bash
docker compose -f docker/docker-compose.prod.yml logs caddy | grep -i acme
# Let's Encrypt rate limits: 5 attempts/hour/domain — DNS correct hone ke baad hi up -d karne ka dhyan rakho.
```

---

## 8. Self-Host Alternative (bina Docker)

```bash
# Node 20+ + pnpm required
git clone https://github.com/<org>/vyomdesk.git
cd vyomdesk
pnpm install
pnpm --filter @vyomdesk/shared build
pnpm --filter @vyomdesk/server build
pnpm --filter @vyomdesk/web build
VYOM_JWT_SECRET=$(openssl rand -hex 32) \
VYOM_ENCRYPTION_KEY=$(openssl rand -hex 32) \
VYOM_PUBLIC_URL=https://vyomdesk.online \
node server/dist/core/main.js
```

---

## 9. Docs Site (GitHub Pages suggestion)

`docs-site/build/` ready hai — `https://vyomdesk.online/docs` ya GitHub Pages `vyomdesk.github.io` pe host karo:

```bash
# docusaurus.config.ts me url: 'https://vyomdesk.online', baseUrl: '/docs/' set karo
pnpm --filter docs-site build   # ya docs-site me: pnpm build
# build/ ko web server pe /docs path pe rakho (ya Pages pe deploy karo)
```

---

## 10. Post-Deploy Checklist (P1.14 exit)

- [ ] DNS resolve: `nslookup vyomdesk.online` → server IP
- [ ] `https://vyomdesk.online` loads (padlock, valid cert)
- [ ] Register first account → role **admin** (verify in DB or UI)
- [ ] Agent connect test (Linux ya Windows) → `agents: 1` in health
- [ ] Terminal session works over WSS through Caddy
- [ ] Desktop stream works over WSS through Caddy
- [ ] Quick-support code flow works
- [ ] Recording start/stop/play works
- [ ] Alert rule triggers email/webhook
- [ ] Backup: `.env` + data volume snapshot
- [ ] ToS/Privacy pages live (copy in docs/09-LEGAL-COPYRIGHT.md)