#!/usr/bin/env bash
# Bootstrap shared Docker infrastructure for the Lab F 11+ suite.
#
# Creates the `labf-net` external Docker network that the 4 apps
# (hub, vocab-master, writing-buddy, story-sleuth) attach their
# backends to so they can reach each other by container name.
#
# Safe to re-run: if the network already exists, exits 0 without
# touching it.
#
# Usage:
#   ./bootstrap.sh
#
# Override the network name via env var (rarely needed):
#   LABF_NETWORK=other-net ./bootstrap.sh

set -euo pipefail

NETWORK_NAME="${LABF_NETWORK:-labf-net}"

if ! command -v docker >/dev/null 2>&1; then
  echo "bootstrap: docker not found on PATH" >&2
  exit 1
fi

if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "bootstrap: network '$NETWORK_NAME' already exists, leaving it alone."
  exit 0
fi

echo "bootstrap: creating network '$NETWORK_NAME'..."
docker network create "$NETWORK_NAME" >/dev/null
echo "bootstrap: done."
