
#!/bin/bash
# Uji gateway T0.4 tanpa Docker: render template, jalankan nginx dan 5 backend tiruan.
# Pemakaian: bash infra/nginx/tests/run-gateway-tests.sh (butuh nginx dan envsubst)
set -e

HERE="$(cd "$(dirname "$0")/.." && pwd)"
T=/tmp/gwtest

# Hentikan sisa uji sebelumnya
pkill -x nginx 2>/dev/null || true
ps -eo pid,args | grep '[b]ackend.py [0-9]' | awk '{print $1}' | xargs -r kill 2>/dev/null || true
sleep 2

rm -rf "$T"
mkdir -p "$T/etc" "$T/log" "$T/cache/auth" "$T/cache/feed"

cp -r "$HERE"/nginx.conf "$HERE"/conf.d "$HERE"/routes "$HERE"/common "$T/etc/"
cp /etc/nginx/mime.types "$T/etc/"

# Alamat backend tiruan
export FRONTEND_HOST=127.0.0.1:3005
export REGISTER_HOST=127.0.0.1:3001
export LOGIN_HOST=127.0.0.1:3002
export PROFILE_HOST=127.0.0.1:3003
export RECOVERY_HOST=127.0.0.1:3004
export AUTH_HOST=127.0.0.1:8099
export COMMENT_HOST=127.0.0.1:3006

# Render variabel Nginx
envsubst '${FRONTEND_HOST} ${REGISTER_HOST} ${LOGIN_HOST} ${PROFILE_HOST} ${RECOVERY_HOST} ${AUTH_HOST} ${COMMENT_HOST}' \
  < "$HERE/templates/vars.conf.template" > "$T/etc/vars.conf"

# Sesuaikan path konfigurasi untuk lingkungan pengujian
find "$T/etc" -name '*.conf' -exec sed -i \
  -e "s#/etc/nginx/#$T/etc/#g" \
  -e "s#listen 80;#listen 8080;#" {} \;

sed -i \
  -e "s#/etc/nginx/#$T/etc/#g" \
  -e "s#/var/log/nginx/#$T/log/#g" \
  -e "s#/var/cache/nginx/#$T/cache/#g" \
  -e "s#/var/run/nginx.pid#$T/nginx.pid#" \
  -e "/^user /d" \
  -e "s#/etc/nginx/mime.types#$T/etc/mime.types#" \
  "$T/etc/nginx.conf"

# Rute feed sementara hanya untuk tes micro-cache
cat > "$T/etc/routes/zz-feed-test.conf" <<FEED
location /api/feed/ {
    proxy_pass http://\$up_profile\$request_uri;
    include $T/etc/common/proxy-headers.conf;
    proxy_cache feed_cache;
    proxy_cache_key "\$scheme\$request_uri";
    proxy_cache_valid 200 3s;
    proxy_cache_lock on;
}
FEED

# Jalankan backend tiruan
for pair in 3001:register 3002:login 3003:profile 3004:recovery 3005:frontend; do
  setsid nohup python3 "$HERE/tests/backend.py" \
    "${pair%%:*}" "${pair##*:}" >/dev/null 2>&1 </dev/null &
done

sleep 2

# Validasi dan jalankan Nginx
nginx -t -p "$T" -c "$T/etc/nginx.conf"
nginx -p "$T" -c "$T/etc/nginx.conf"

sleep 1

echo "Gateway test siap."
echo "Lanjutkan dengan: bash infra/nginx/tests/run-tests.sh"
