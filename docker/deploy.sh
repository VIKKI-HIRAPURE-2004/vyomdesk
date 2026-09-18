#!/usr/bin/env bash
# VyomDesk one-shot deploy: Docker + compose + secrets + Caddy HTTPS.
# Run ON THE UBUNTU SERVER as root (or sudo):
#   curl -fsSL <script-url> | bash     (after pushing the repo to GitHub)
# Or: git clone <your-repo> /opt/vyomdesk && cd /opt/vyomdesk && bash docker/deploy.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/vyomdesk/vyomdesk.git}"
INSTALL_DIR="/opt/vyomdesk"
DOMAIN="vyomdesk.online"

echo "=== VyomDesk deploy: $DOMAIN ==="

# 1. Docker (official convenience script, idempotent)
if ! command -v docker >/dev/null 2>&1; then
  echo "--- installing docker"
  curl -fsSL https://get.docker.com | bash
fi

# 2. Repo
if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "--- cloning repo"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# 3. Secrets (generate once, keep in .env; .gitignore'd)
if [ ! -f .env ]; then
  echo "--- generating secrets"
  JWT=$(openssl rand -hex 32)
  ENC=$(openssl rand -hex 32)
  cat > .env <<EOF
VYOM_JWT_SECRET=$JWT
VYOM_ENCRYPTION_KEY=$ENC
VYOM_PUBLIC_URL=https://$DOMAIN
EOF
  chmod 600 .env
  echo "    secrets written to $INSTALL_DIR/.env (BACK THESE UP)"
fi

# 4. Build + start (server + Caddy)
echo "--- starting containers"
docker compose -f docker/docker-compose.prod.yml up -d --build

# 5. Firewall
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp  || true
  ufw allow 443/tcp || true
fi

# 6. Verify
echo "--- waiting for server..."
sleep 10
if curl -fsS "http://localhost:4430/api/v1/health" >/dev/null; then
  echo "    server container: OK"
else
  echo "    WARNING: health check failed - see: docker compose -f docker/docker-compose.prod.yml logs"
fi

cat <<EOF

=== DONE ===
Site (HTTPS within ~1 min of DNS propagation):  https://$DOMAIN
Server internal port: 4430 (Caddy terminates TLS on 80/443)

Next steps:
  1. Open https://$DOMAIN and REGISTER - the FIRST account becomes ADMIN.
  2. Add devices: download the agent binary from the Devices page.
  3. Agent install on any Linux box:
       VYOM_SERVER=wss://$DOMAIN/agent.ashx ./vyomlink-linux-amd64
  4. Windows machines: vyomlink.exe (from repo / server downloads).
EOF