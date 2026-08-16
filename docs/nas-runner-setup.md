# NAS Runner Setup — GitHub Actions Self-Hosted Runner on Synology

Step-by-step guide for running the CD pipeline's self-hosted runner on the
Synology NAS (DS918+, DSM 7.x — works on DSM 6.x too).

## 0. How it fits together

```
GitHub (CI success on main)
        │  workflow_run
        ▼
actions-runner container on the NAS  ← polls GitHub for jobs (outbound HTTPS only)
        │  docker CLI via mounted /var/run/docker.sock
        ▼
NAS Docker daemon
        │  docker compose -f docker-compose.prod.yml pull && down && up -d
        ▼
hub-backend / hub-frontend containers
```

The runner is **dedicated to the 11plus-hub repository**:
- It registers at **repo level** (https://github.com/DanWangDev/11plus-hub), so
  only this repo's workflows can dispatch jobs to it.
- It mounts **only** `/volume1/docker/11plus-hub` — not the wider
  `/volume1/docker` tree where the other apps' repos and data live.
- It needs **outbound HTTPS** to github.com (polling) — nothing inbound, no
  ports opened.
- It mounts **the Docker socket** of the NAS daemon (it deploys the hub stack).
  The socket still reaches every container on the daemon — that's inherent to
  deploying via Docker; repo-level registration is what limits *who* can use it.

Everything needed to build the runner lives in [`nas-runner/`](../nas-runner):
`Dockerfile` (official `actions/runner` release tarball — no third-party runner
images), `entrypoint.sh`, and `docker-compose.yml`.

## 1. Prerequisites on the NAS

- **DSM 7.x** with the **Container Manager** package installed (DSM 6: the
  "Docker" package — identical for our purposes).
- **SSH enabled**: Control Panel → *Terminal & SNMP* → enable SSH (port 22).
- Your SSH user must be in the **administrators** group.
- **Accurate time**: Control Panel → *Regional Options* → *Time* → enable
  NTP sync. (The runner refuses to work with a skewed clock.)
- **Firewall**: the default DSM firewall already allows all outbound traffic —
  that's all the runner needs. No inbound rule required.
- ~1 GB free disk on `/volume1` and ~500 MB RAM headroom (DS918+ has 4 GB —
  the runner uses a few hundred MB at most).
- **Docker Compose CLI is NOT needed on the NAS** — the runner container
  carries its own `docker compose` plugin and talks to the daemon via the
  socket. This sidesteps the Synology `docker compose` vs `docker-compose`
  version split entirely.

## 2. One-time: put the repo on the NAS (the deploy target)

The deploy workflow runs `docker compose` **in `/volume1/docker/11plus-hub`**,
so that checkout (with its production `.env`) must exist on the NAS:

```bash
ssh admin@<nas-ip>
mkdir -p /volume1/docker
cd /volume1/docker
git clone https://github.com/DanWangDev/11plus-hub.git
cd 11plus-hub
# Place the production .env here (it is gitignored):
#   cp /path/to/your/.env.production .env
# Required keys (the app fails closed without them):
#   DB_PASSWORD, HUB_SESSION_SECRET, OIDC_COOKIE_KEYS, OIDC_SIGNING_KEY,
#   HUB_CLIENT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL,
#   ADMIN_DISPLAY_NAME, plus optional GOOGLE_CLIENT_ID / TURNSTILE_* / STRIPE_*
```

> The runner never checks out code itself; it only re-pulls images and
> restarts containers from this pre-existing checkout. Update it manually
> (`git pull`) when the compose files change.

## 3. One-time: create the runner registration token on GitHub

1. Open the **11plus-hub repository** → **Settings → Actions → Runners**
   (repo-level, NOT org-level — that's what keeps the runner dedicated to
   this repo).
2. **New self-hosted runner** → Linux → x64.
3. Copy the **registration token** from the `./config.sh --token ...` line
   (it expires after ~1 hour — you must complete step 4 within that window).

## 4. Build and start the runner container on the NAS

```bash
ssh admin@<nas-ip>
mkdir -p /volume1/docker/actions-runner
cd /volume1/docker/actions-runner

# Copy the runner definition from the repo (you already cloned it in step 2):
cp -r /volume1/docker/11plus-hub/nas-runner/* .

# Create the local .env with the token from step 3 (gitignored in the repo):
echo 'RUNNER_TOKEN=<paste-the-token>' > .env
echo 'RUNNER_ORG_URL=https://github.com/DanWangDev/11plus-hub' >> .env
echo 'RUNNER_NAME=nas-01' >> .env
# RUNNER_LABELS defaults to "nas,deploy" — matches the deploy workflow's runs-on: nas

docker compose build
docker compose up -d
docker logs -f actions-runner
```

You should see `Runner listener exited with 0`-style polling output and:

```
√ Connected to GitHub
Listening for Jobs
```

Verify on GitHub: **Settings → Actions → Runners** now shows
`nas-01` as **Idle** with labels `nas, deploy`.

## 5. Enable deploys

GitHub → repo **Settings → Secrets and variables → Actions → Variables**:

- New variable `ENABLE_NAS_DEPLOY` = `true`

The deploy workflow (`workflow_run` on CI success for `main`) is now live.
Until this variable is set, the deploy job intentionally **skips** (a missing
runner can never queue jobs forever).

## 6. Test the pipeline end to end

1. GitHub → repo → **Actions → CI → Run workflow** (branch: `main`).
   A manual `workflow_dispatch` on `main` also triggers the deploy workflow.
2. Watch the **Deploy to NAS** run: it should pick up the `nas` label,
   run `docker compose pull && down && up -d`, then poll
   `docker exec hub-backend wget -qO- http://127.0.0.1:3009/api/health`
   until `"healthy"` appears.
3. Confirm on the NAS: `docker ps` shows fresh `hub-backend`/`hub-frontend`
   containers, and `https://hub.labf.app` responds.

If the health check fails, the job prints `docker compose logs --tail 50` —
start there.

## 7. Day-2 operations

| Task | How |
|------|-----|
| Runner status | GitHub → Settings → Actions → Runners; or `docker logs -f actions-runner` |
| Restart after NAS reboot | automatic — `restart: unless-stopped` |
| Rebuild after repo changes | `cd /volume1/docker/actions-runner && docker compose build && docker compose up -d` |
| Upgrade runner version | set `RUNNER_VERSION` in `docker compose build` args (bump the ARG default in the Dockerfile), rebuild. The runner also self-updates in its volume between releases |
| Remove/re-register | delete the runner in GitHub Settings, then `docker compose up -d --force-recreate` with a fresh token (the `--replace` flag in entrypoint.sh re-registers the same name) |
| Disable deploys | set `ENABLE_NAS_DEPLOY=false` (or delete the variable) |
| Update the hub checkout | `cd /volume1/docker/11plus-hub && git pull` (only needed when compose/env templates change) |

## 8. Security notes (read before going further)

- **This runner can deploy to production.** It is gated by
  `ENABLE_NAS_DEPLOY` + `branches: [main]`, and only the deploy workflow uses
  the `nas` label — keep it that way. Don't reuse the label for other
  workflows without review.
- **Fork PRs cannot reach it.** The deploy job fires on
  `workflow_run` of CI on `main` only; fork PR CI runs are never on `main`.
- **Dedicated to this repo.** The runner registers at repo level, so only
  `DanWangDev/11plus-hub` workflows can dispatch jobs to it — other repos
  cannot, and the only workflow using the `nas` label is the gated deploy job.
- **Docker socket = root on the NAS.** The runner container mounts
  `/var/run/docker.sock` and runs as root *inside the container*; anyone who
  can push to `main` (or compromise the runner) effectively controls the NAS
  Docker daemon. Keep collaborators to a minimum and enable branch protection
  on `main` if the repo gains more contributors.
- **The runner image is built from the official GitHub runner tarball** —
  do not swap it for third-party runner images without a supply-chain review.
- **No inbound ports.** The runner only polls out over HTTPS; nothing on your
  LAN can reach it.

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `RUNNER_TOKEN: must be set` | The token is in `.env` next to the compose file — re-copy it; tokens expire after ~1h |
| Runner shows offline on GitHub | `docker logs -f actions-runner`; check NTP time sync on the NAS (a skewed clock breaks GitHub polling) |
| Deploy job stays skipped | Set the `ENABLE_NAS_DEPLOY=true` variable (step 5) |
| Deploy job queued forever | A runner with the `nas` label must be Idle; check labels with `docker exec actions-runner ./config.sh --help` or re-register |
| Health check fails after deploy | `docker logs hub-backend --tail 50` on the NAS; the job also prints compose logs |
| `docker compose` not found inside runner | The image installs the compose plugin — rebuild the runner image if it's an old build |
