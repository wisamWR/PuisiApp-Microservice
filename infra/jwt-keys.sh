#!/usr/bin/env bash
# Buat pasangan kunci RS256 untuk token-service dan tulis ke .env (satu baris, \n sebagai pemisah).
# Kunci privat tidak pernah masuk git (.env dan *.pem ada di .gitignore).
# Pemakaian (dari root repositori): bash infra/jwt-keys.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env dibuat dari .env.example"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
openssl genrsa -out "$tmp/priv.pem" 2048 2>/dev/null
openssl rsa -in "$tmp/priv.pem" -pubout -out "$tmp/pub.pem" 2>/dev/null

satu_baris() { awk 'NF {printf "%s\\n", $0}' "$1"; }
PRIV="$(satu_baris "$tmp/priv.pem")"
PUB="$(satu_baris "$tmp/pub.pem")"

sed -i -e '/^JWT_PRIVATE_KEY_PEM=/d' -e '/^JWT_PUBLIC_KEY_PEM=/d' .env
printf 'JWT_PRIVATE_KEY_PEM="%s"\nJWT_PUBLIC_KEY_PEM="%s"\n' "$PRIV" "$PUB" >> .env
echo "Kunci RS256 ditulis ke .env. Jalankan ulang token-service: docker compose up -d --force-recreate token-service"
