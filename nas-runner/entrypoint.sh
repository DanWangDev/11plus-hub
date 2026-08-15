#!/usr/bin/env bash
# GitHub Actions runner entrypoint.
#
# - Re-extracts the runner binaries into the persistent volume on first boot
#   (config/credentials survive container recreation).
# - Registers with --replace so recreating the container re-registers the
#   same runner name instead of leaving a zombie registration behind.
set -euo pipefail

: "${RUNNER_TOKEN:?RUNNER_TOKEN must be set}"
: "${RUNNER_ORG_URL:?RUNNER_ORG_URL must be set (e.g. https://github.com/DanWangDev)}"

RUNNER_NAME="${RUNNER_NAME:-nas-01}"
RUNNER_LABELS="${RUNNER_LABELS:-nas,deploy}"
RUNNER_WORKDIR="${RUNNER_WORKDIR:-/volume1/docker/actions-runner-work}"

# First boot (or wiped volume): restore binaries from the image copy.
if [ ! -f /actions-runner/run.sh ]; then
  echo "entrypoint: extracting runner binaries into the persistent volume..."
  tar xzf /opt/actions-runner.tar.gz -C /actions-runner
  /actions-runner/bin/installdependencies.sh || true
fi

mkdir -p "$RUNNER_WORKDIR"

# Unattended registration; --replace makes recreations idempotent.
./config.sh \
  --url "$RUNNER_ORG_URL" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "$RUNNER_WORKDIR" \
  --unattended \
  --replace

exec ./run.sh
