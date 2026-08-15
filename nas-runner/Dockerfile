# Self-hosted GitHub Actions runner for the Synology NAS (DS918+, DSM 7).
#
# Built from the OFFICIAL actions/runner release tarball — deliberately no
# third-party runner image (supply-chain safety: this container executes
# workflow code that can deploy to production).
#
# Includes the Docker CLI + compose plugin so the deploy job can drive the
# host Docker daemon through the mounted socket (/var/run/docker.sock).

FROM debian:bookworm-slim

ARG RUNNER_VERSION=2.336.0

ENV DEBIAN_FRONTEND=noninteractive

# Runner runtime deps (libicu is required by the runner binary)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    libicu72 \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Docker CE CLI + compose plugin (so `docker compose` works inside the runner
# and talks to the NAS daemon via the mounted socket)
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
         > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends \
         docker-ce-cli \
         docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Official runner release — keep the tarball in the image so the entrypoint
# can re-extract it into the persistent volume on first boot.
ARG RUNNER_TARBALL_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
RUN curl -fsSL -o /opt/actions-runner.tar.gz "$RUNNER_TARBALL_URL" \
    && mkdir -p /actions-runner \
    && tar xzf /opt/actions-runner.tar.gz -C /actions-runner \
    && /actions-runner/bin/installdependencies.sh \
    && rm -rf /actions-runner

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /actions-runner

# Runs as root inside this dedicated container so it can use the mounted
# Docker socket (the NAS socket's group is not visible inside the container).
# Acceptable here because the ONLY consumer of this runner is the gated,
# main-branch-only deploy workflow.
ENTRYPOINT ["/entrypoint.sh"]
