#!/usr/bin/env bash
# One-time bootstrap for an Amazon Lightsail Ubuntu instance.
# Run as the SSH user (e.g. ubuntu) on a fresh Ubuntu 22.04 / 24.04 VM:
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/lightsail-bootstrap.sh | bash
#
# Or copy this file to the instance and `bash lightsail-bootstrap.sh`.
#
# After this finishes the deploy GitHub Action can SSH in and run
# `docker compose up -d` to bring the app online.

set -euo pipefail

echo "[bootstrap] installing docker engine + compose plugin"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release

if ! command -v docker >/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi

# Allow the current user to run docker without sudo (re-login to take effect).
sudo usermod -aG docker "$USER" || true

# Deploy directory.
mkdir -p ~/options-trader
echo "[bootstrap] deploy dir ready at ~/options-trader"

# Optional: open port 80/443 in the Lightsail firewall (do this in the
# Lightsail console — the Ubuntu image's UFW is usually disabled).

cat <<'EOF'

[bootstrap] done.

Next steps:
  1. (Lightsail console) open port 4000 (or 80/443 if you front with nginx)
     for the public IP.
  2. (GitHub Actions) configure these secrets on the repo:
       LIGHTSAIL_HOST     — public IP or static IP DNS
       LIGHTSAIL_USER     — usually "ubuntu"
       LIGHTSAIL_SSH_KEY  — private key matching the instance's key pair
       LIGHTSAIL_SSH_PORT — optional, defaults to 22
       ANTHROPIC_API_KEY  — optional
       KITE_API_KEY       — optional
       KITE_API_SECRET    — optional
  3. Push to main. The Deploy workflow will build, push to GHCR,
     SSH in, and start the container.
  4. Visit http://<HOST>:4000 (or whatever HOST_PORT you set).

Persistent SQLite data lives in the docker volume `options-trader-data`.
Back it up with:
  docker run --rm -v options-trader-data:/data -v $(pwd):/backup busybox \
    tar czf /backup/options-trader-$(date +%F).tgz /data
EOF
