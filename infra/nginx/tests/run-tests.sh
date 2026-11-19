#!/bin/bash
T=/tmp/gwtest; G=localhost:8080; pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "PASS  $1 (=$3)"; pass=$((pass+1)); else echo "FAIL  $1 (dapat=$2, harap=$3)"; fail=$((fail+1)); fi; }
last(){ tail -1 "$T/hits-$1.log" | python3 -c "import json,sys;print(json.load(sys.stdin)['$2'])"; }
rm -f $T/hits-*.log; rm -rf $T/cache/auth/* $T/cache/feed/*

chk "health 200" "$(curl -s -o /dev/null -w '%{http_code}' $G/health)" "200"
chk "GET /_auth dari luar ditolak" "$(curl -s -o /dev/null -w '%{http_code}' $G/_auth)" "404"
chk "logout tanpa token -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $G/api/auth/logout)" "401"
chk "/api/me tanpa token -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $G/api/me)" "401"
chk "/api/profiles/me tanpa token -> 401" "$(curl -s -o /dev/null -w '%{http_code}' $G/api/profiles/me)" "401"

chk "logout dengan token -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -b 'access_token=abc' $G/api/auth/logout)" "200"
chk "X-User-Id sampai ke layanan" "$(last login x_user_id)" "stub-user"
chk "X-User-Role sampai ke layanan" "$(last login x_user_role)" "writer"

curl -s -o /dev/null -X POST -H 'X-User-Id: hacker' -H 'X-User-Role: admin' $G/api/auth/register
chk "register: X-User-Id palsu tidak sampai" "$(last register x_user_id)" "None"
chk "register: X-User-Role palsu tidak sampai" "$(last register x_user_role)" "None"
curl -s -o /dev/null -X POST -H 'X-User-Id: hacker' -b 'access_token=abc' $G/api/auth/logout
chk "logout: X-User-Id palsu ditimpa gateway" "$(last login x_user_id)" "stub-user"
curl -s -o /dev/null -H 'X-User-Id: hacker' -H 'X-User-Role: admin' $G/beranda
chk "frontend: X-User-Id palsu tidak sampai" "$(last frontend x_user_id)" "None"

codes=""; for i in $(seq 1 12); do codes="$codes $(curl -s -o /dev/null -w '%{http_code}' -X POST $G/api/auth/login)"; done
ok=$(echo $codes | tr ' ' '\n' | grep -c '^200$' || true); lim=$(echo $codes | tr ' ' '\n' | grep -c '^429$' || true)
echo "      kode login x12:$codes"
chk "login: 10 lolos lalu 2 kena 429 (12 percobaan beruntun)" "$ok/$lim" "10/2"

chk "GET /api/profiles/abc publik -> 200" "$(curl -s -o /dev/null -w '%{http_code}' $G/api/profiles/abc)" "200"
chk "PUT /api/profiles/abc -> 403" "$(curl -s -o /dev/null -w '%{http_code}' -X PUT $G/api/profiles/abc)" "403"
chk "GET /api/profiles/me dengan token -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -b 'access_token=abc' $G/api/profiles/me)" "200"

rm -rf $T/cache/auth/*
curl -s -o /dev/null -X DELETE -b 'access_token=t1' $G/api/me
curl -s -o /dev/null -X DELETE -b 'access_token=t1' $G/api/me
chk "token sama 2x -> 1 entri cache verifikasi" "$(find $T/cache/auth -type f | wc -l)" "1"

rm -f $T/hits-profile.log
curl -s -o /dev/null $G/api/feed/x; curl -s -o /dev/null $G/api/feed/x
chk "feed 2 request dalam 3 detik -> 1 sampai layanan" "$(grep -c feed $T/hits-profile.log)" "1"
sleep 4; curl -s -o /dev/null $G/api/feed/x
chk "feed setelah 4 detik -> sampai lagi (total 2)" "$(grep -c feed $T/hits-profile.log)" "2"
echo "----- RINGKASAN: lulus=$pass gagal=$fail"
