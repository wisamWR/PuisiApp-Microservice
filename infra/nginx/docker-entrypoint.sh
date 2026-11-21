#!/bin/sh
# Entrypoint api-gateway: render alamat layanan dari variabel lingkungan, lalu jalankan nginx.
#
# Setiap domain punya berkas sendiri di templates/vars.d/<domain>.conf.template
# (seperti routes/<domain>.conf). Daftar variabel untuk envsubst diambil
# otomatis dari berkas-berkas itu: hanya pola ${NAMA_HOST}, sehingga variabel
# nginx ($up_*, $request_uri, ...) tidak tersentuh. Kelompok yang menambah
# layanan cukup menambah berkasnya sendiri, tanpa mengubah berkas ini.
set -eu
DIR=/etc/nginx/templates/vars.d
VARIABEL=$(cat "$DIR"/*.conf.template | grep -o '\${[A-Z0-9_]*_HOST}' | sort -u | tr '\n' ' ')
: > /etc/nginx/vars.conf
for t in "$DIR"/*.conf.template; do
  envsubst "$VARIABEL" < "$t" >> /etc/nginx/vars.conf
done
exec nginx -g 'daemon off;'
