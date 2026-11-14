#!/bin/sh
# Entrypoint api-gateway: render alamat layanan dari variabel lingkungan, lalu jalankan nginx.
set -eu
envsubst '${FRONTEND_HOST} ${REGISTER_HOST} ${LOGIN_HOST} ${PROFILE_HOST} ${RECOVERY_HOST} ${AUTH_HOST} ${CONTOH_HOST}' \
  < /etc/nginx/templates/vars.conf.template > /etc/nginx/vars.conf
exec nginx -g 'daemon off;'
