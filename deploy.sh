#!/bin/bash
set -e

# ─────────────────────────────────────────
#  11plus Hub — One-Command Redeploy
#  Usage: ./deploy.sh          (local build)
#         ./deploy.sh --ghcr   (pull from GitHub Container Registry)
# ─────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${BOLD}[deploy]${NC} $1"; }
ok()   { echo -e "${GREEN}[✔]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[✘]${NC} $1"; exit 1; }

USE_GHCR=false
if [ "$1" = "--ghcr" ]; then
  USE_GHCR=true
fi

ENV_FILE=".env.production"
if [ ! -f "$ENV_FILE" ]; then
  warn ".env.production not found, falling back to .env"
  ENV_FILE=".env"
fi

if [ ! -f "$ENV_FILE" ]; then
  fail "No .env file found. Copy .env.example to .env and fill in secrets."
fi

log "Starting redeployment..."

# 1. Pull latest code
log "Pulling latest changes from git..."
git pull || fail "git pull failed"
ok "Git pull complete"

if [ "$USE_GHCR" = true ]; then
  COMPOSE_FILE="docker-compose.prod.yml"
  log "Mode: pull from GitHub Container Registry"

  # Log in to GHCR
  log "Logging in to ghcr.io..."
  echo "${GHCR_TOKEN:-}" | docker login ghcr.io -u "${GITHUB_USER:-DanWangDev}" --password-stdin 2>/dev/null \
    || warn "GHCR login skipped (set GHCR_TOKEN env var for private images)"

  # Pull latest images
  log "Pulling latest images..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull || fail "docker compose pull failed"
  ok "Images pulled"
else
  COMPOSE_FILE="docker-compose.yml"
  log "Mode: local build"
fi

# 2. Bring containers down
log "Stopping containers..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down || fail "docker compose down failed"
ok "Containers stopped"

# 3. Start (build if local, just up if GHCR)
if [ "$USE_GHCR" = true ]; then
  log "Starting containers (backend runs migrate + seed on boot)..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d || fail "docker compose up failed"
else
  log "Building and starting containers..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build || fail "docker compose up failed"
fi
ok "Containers started"

# 4. Show running containers
echo ""
log "Running services:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
ok "Redeployment complete! Hub is live."
