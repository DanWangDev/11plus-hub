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
#   .\bootstrap.ps1
#
# Override the network name via env var (rarely needed):
#   $env:LABF_NETWORK = "other-net"; .\bootstrap.ps1

$ErrorActionPreference = "Stop"

$networkName = if ($env:LABF_NETWORK) { $env:LABF_NETWORK } else { "labf-net" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "bootstrap: docker not found on PATH"
    exit 1
}

# `docker network inspect` writes to stderr when the network is missing;
# swallow both streams and just key off the exit code.
docker network inspect $networkName *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Host "bootstrap: network '$networkName' already exists, leaving it alone."
    exit 0
}

Write-Host "bootstrap: creating network '$networkName'..."
docker network create $networkName | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "bootstrap: failed to create network"
    exit 1
}
Write-Host "bootstrap: done."
