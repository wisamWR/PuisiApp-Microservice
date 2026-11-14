#!/usr/bin/env bash
# Pasang Docker Engine, Docker Compose v2, dan Git di instans EC2 baru (T0.9/T10.4).
# Mendukung Amazon Linux 2023 (bawaan AWS Academy Learner Lab) dan Ubuntu.
#
#   curl -fsSL https://raw.githubusercontent.com/wisamWR/PuisiApp-Microservice/main/infra/setup.sh | bash
#
# Setelah selesai, keluar lalu SSH ulang (atau `newgrp docker`) agar grup docker aktif.
set -euo pipefail

COMPOSE_VERSION="${COMPOSE_VERSION:-v2.39.2}"
mulai=$(date +%s)
log() { printf '\n[setup %ss] %s\n' "$(( $(date +%s) - mulai ))" "$*"; }

if command -v dnf >/dev/null 2>&1; then
  log "Amazon Linux / Fedora: memasang docker dan git"
  sudo dnf install -y docker git
elif command -v apt-get >/dev/null 2>&1; then
  log "Ubuntu / Debian: memasang docker.io dan git"
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io git curl
else
  echo "Distribusi tidak dikenali; pasang Docker secara manual." >&2
  exit 1
fi

log "Menyalakan layanan docker"
sudo systemctl enable --now docker
sudo usermod -aG docker "${USER:-$(id -un)}"

# Paket docker di Amazon Linux 2023 tidak membawa plugin Compose v2.
if ! sudo docker compose version >/dev/null 2>&1; then
  log "Memasang Docker Compose ${COMPOSE_VERSION}"
  arch="$(uname -m)"
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${arch}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

log "Versi terpasang"
sudo docker --version
sudo docker compose version
git --version

log "Selesai. Keluar lalu SSH ulang (atau jalankan: newgrp docker) sebelum memakai docker tanpa sudo."
