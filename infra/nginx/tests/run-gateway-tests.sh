#!/bin/bash
# Uji gateway T0.4 tanpa Docker: render template, jalankan nginx dan 5 backend tiruan.
# Pemakaian: bash infra/nginx/tests/run-gateway-tests.sh   (butuh nginx dan envsubst)
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; T=/tmp/gwtest
# Hentikan sisa uji sebelumnya (nginx dan backend), supaya port dan rate limit mulai dari nol
pkill -x nginx 2>/dev/null || true
ps -eo pid,args | grep '[b]ackend.py [0-9]' | awk '{print $1}' | xargs -r kill 2>/dev/null || true
sleep 2
rm -rf $T; mkdir -p $T/etc $T/log $T/cache/auth $T/cache/feed
cp -r "$HERE"/nginx.conf "$HERE"/conf.d "$HERE"/routes "$HERE"/common $T/etc/; cp /etc/nginx/mime.types $T/etc/
export FRONTEND_HOST=127.0.0.1:3005 REGISTER_HOST=127.0.0.1:3001 LOGIN_HOST=127.0.0.1:3002 PROFILE_HOST=127.0.0.1:3003 RECOVERY_HOST=127.0.0.1:3004 AUTH_HOST=127.0.0.1:8099
envsubst '${FRONTEND_HOST} ${REGISTER_HOST} ${LOGIN_HOST} ${PROFILE_HOST} ${RECOVERY_HOST} ${AUTH_HOST}' < "$HERE/templates/vars.conf.template" > $T/etc/vars.conf
find $T/etc -name '*.conf' -exec sed -i -e "s#/etc/nginx/#$T/etc/#g" -e "s#listen 80;#listen 8080;#" {} \;
sed -i -e "s#/etc/nginx/#$T/etc/#g" -e "s#/var/log/nginx/#$T/log/#g" -e "s#/var/cache/nginx/#$T/cache/#g" -e "s#/var/run/nginx.pid#$T/nginx.pid#" -e "/^user /d" -e "s#/etc/nginx/mime.types#$T/etc/mime.types#" $T/etc/nginx.conf
# Rute feed sementara HANYA untuk tes micro-cache. Rute feed asli milik kelompok lain.
cat > $T/etc/routes/zz-feed-test.conf <<FEED
location /api/feed/ {
    proxy_pass http://\$up_profile\$request_uri;
    include $T/etc/common/proxy-headers.conf;
    proxy_cache feed_cache;
    proxy_cache_key "\$scheme\$request_uri";
    proxy_cache_valid 200 3s;
    proxy_cache_lock on;
}
FEED
for pair in 3001:register 3002:login 3003:profile 3004:recovery 3005:frontend; do setsid nohup python3 "$HERE/tests/backend.py" ${pair%%:*} ${pair##*:} >/dev/null 2>&1 </dev/null & done
sleep 2; nginx -t -p $T -c $T/etc/nginx.conf
nginx -p $T -c $T/etc/nginx.conf; sleep 1
echo "Siap. Jalankan: bash infra/nginx/tests/run-tests.sh"
