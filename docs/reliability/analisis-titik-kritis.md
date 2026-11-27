# Analisis Titik Kritis RASA (Hands On Reliability dan Failover, Tahap 1)

Draf untuk direview. Cakupan: kode di `main` (commit 148c40b), compose lokal
`infra/docker-compose.yml` + `infra/compose/*.yml`, dan compose deploy
`infra/docker-compose.prod.yml`. Kluster mengikuti empat kluster pada panduan:
Gateway, Jalur Sinkron, Broker/Asinkron, dan Data.

Skala tingkat:

- **Kritis**: seluruh aplikasi atau semua rute yang butuh login berhenti.
- **Tinggi**: satu alur bisnis utama berhenti (menulis/menerbitkan puisi, suara) atau ada data yang bisa hilang.
- **Sedang**: fitur menurun atau lambat, masih bisa pulih sendiri.

## 1. Tabel Analisis Risiko

| No | Kluster | Titik kritis | Risiko kegagalan | Dampak terhadap Availability | Tingkat |
|----|---------|--------------|------------------|------------------------------|---------|
| 1 | Gateway | **API Gateway Nginx satu instans** (`api-gateway`), satu-satunya pintu masuk untuk API dan frontend | Container crash, OOM, salah konfigurasi saat reload, atau `worker_connections 1024` habis karena banyak koneksi SSE dan koneksi lambat | Semua rute (frontend, login, puisi, vote) tidak bisa diakses. Selama container restart, availability 0%. Tidak ada replika atau load balancer di depannya | Kritis |
| 2 | Jalur sinkron | **Rantai verifikasi sesi: Gateway `auth_request` → token-service → Redis**, dipanggil di setiap request ke rute terlindungi | token-service hanya satu replika, tanpa circuit breaker. Bila token-service atau Redis lambat, Nginx menahan koneksi sampai timeout bawaan 60 dtk. Bila mati, `auth_request` membalas 500 | Semua rute yang butuh login gagal (500), termasuk rute milik domain yang sehat. Koneksi yang tertahan menghabiskan `worker_connections` gateway, sehingga rute publik ikut terganggu (cascading failure). Cache 30 dtk hanya menolong token yang baru diverifikasi | Kritis |
| 3 | Data | **Redis satu instans** dipakai bersama oleh token-service (daftar cabut + refresh token), vote-service (sumber kebenaran sementara suara), dan processing-status/SSE | Proses mati, OOM (`maxmemory 512mb`), atau eviction kunci penting oleh `volatile-lru` | Login, logout, refresh, dan verifikasi sesi gagal (lihat No. 2). Suara tidak bisa diberikan. Status pemrosesan langsung (SSE) berhenti. AOF hanya menjaga data setelah restart, bukan availability | Kritis |
| 4 | Data | **PostgreSQL satu klaster untuk semua database layanan** (database-per-service hanya pemisahan logis) | Node primary mati, disk penuh (WAL tertahan slot relay), atau koneksi habis | Semua layanan tulis dan baca yang memakai Postgres berhenti: daftar/login, ajukan/ubah/hapus puisi, daftar puisi, publikasi, notifikasi, profil. Semua outbox-relay Debezium ikut berhenti. Tidak ada replika baca dan tidak ada failover | Kritis |
| 5 | Broker | **RabbitMQ satu node** (quorum queue tanpa klaster, sehingga tidak ada replikasi) | Node mati, alarm memori/disk, atau volume rusak | Semua alur asinkron berhenti: puisi tidak pernah terbit, analisis emosi/kemiripan dan notifikasi berhenti, `vote.cast` gagal sehingga suara ditolak. Setiap layanan Node keluar dengan `process.exit(1)` saat koneksi putus, lalu restart berulang (restart storm) selama broker mati | Kritis |
| 6 | Broker | **Outbox relay Debezium: satu instans per database**, offset di volume lokal | Relay mati lama, atau WAL yang ditahan slot melewati `max_slot_wal_keep_size=1024MB` sehingga slot di-invalidate | Selama relay mati, event tertahan di outbox dan alur hilir berhenti (puisi tidak terbit, notifikasi tidak terkirim). Bila slot di-invalidate, event dalam rentang itu **hilang permanen** karena `snapshot.mode=no_data` tidak membaca ulang isi tabel | Tinggi |
| 7 | Broker | **Rantai publikasi tanpa batas waktu**: `poem.submitted` → fingerprint-worker → similarity-worker → `poem.similarity.scored` → publication-service | Salah satu worker crash atau macet. Satu-satunya jalan ke `PUBLISHED` adalah skor kemiripan, tanpa timeout atau fallback | Puisi baru tertahan di status `PROCESSING` tanpa batas. Pengguna melihat aplikasi "jalan", tetapi fitur inti (menerbitkan puisi) tidak tersedia. `/health` similarity-worker berjalan di thread terpisah dan selalu menjawab `ok`, sehingga Docker tidak mendeteksi konsumen yang macet | Tinggi |
| 8 | Broker | **Konsumen worker yang crash/macet di tengah pemrosesan** (pustaka `libs/node` dan `libs/python`) | Handler tanpa timeout dapat menggantung dan menahan slot prefetch (10), koneksi pool, serta advisory lock agregat. Pesan beracun berakhir di DLQ, tetapi DLQ tidak dipantau | Pesan tidak hilang (sudah ada retry + DLQ + `x-delivery-limit 5` + idempotensi `processed_event`). Risiko yang tersisa: worker berhenti memproses tanpa terlihat, dan event di DLQ tidak pernah diproses ulang, sehingga puisi atau notifikasi tertentu tertinggal diam-diam | Sedang |
| 9 | Jalur sinkron | **Layanan API kritis berjalan satu replika** (poem-create, poem-query, poem-edit, poem-delete, login, register, token). Hanya status-stream yang 2 replika | Container crash atau OOM (batas memori 160–384 MB). `restart: unless-stopped` butuh beberapa detik sampai health check lolos | Fitur yang dilayani layanan itu mati sampai container naik lagi. Tidak ada active-active, jadi tidak ada failover instan | Tinggi |
| 10 | Data | **Pool PostgreSQL tanpa batas tunggu** di login-service, profile-service, dan mood-feed-service | Bila DB lambat atau pool penuh, `pg.Pool` menunggu tanpa batas (`connectionTimeoutMillis` default 0) dan tanpa retry | Request menumpuk sampai timeout gateway (60 dtk). Login macet, dan koneksi gateway ikut tertahan (memperparah No. 1 dan 2). Layanan domain puisi sudah memakai `connectionTimeoutMillis: 2000` dan `statement_timeout: 5000` | Sedang |
| 11 | Infrastruktur | **Satu host EC2 (Learner Lab)** menjalankan semua container | VM mati, sesi Learner Lab berakhir otomatis, atau disk/RAM host penuh | Seluruh sistem down. Semua solusi replika di dalam satu host tidak melindungi dari kegagalan host | Kritis |

## 2. Bukti di kode

| No | Lokasi | Temuan |
|----|--------|--------|
| 1 | `infra/docker-compose.yml:211`, `infra/docker-compose.prod.yml` (`api-gateway`), `infra/nginx/nginx.conf:8` | Satu service tanpa `replicas`, port host langsung ke container. `worker_connections 1024`. Tidak ada `proxy_connect_timeout`/`proxy_read_timeout` umum |
| 2 | `infra/nginx/conf.d/gateway.conf:13-24`, `services/token-service/src/index.js:109-112`, `infra/compose/identity.yml:69` | `/_auth` memanggil token-service lalu Redis (`sudahDicabut`). Komentar compose meminta `--scale token-service=2`, tetapi file tidak mengaturnya. Tidak ada `proxy_cache_use_stale`. `login-service` memanggil token-service secara sinkron (`fetch`, timeout 3 dtk, tanpa retry/breaker) |
| 3 | `infra/docker-compose.yml:146-160` | `redis` satu instans, `maxmemory 512mb`, `volatile-lru`, tanpa replika/Sentinel |
| 4 | `infra/docker-compose.yml:92-130` | Satu service `postgres` dengan semua DB layanan. `wal_level=logical`, tanpa standby |
| 5 | `infra/docker-compose.yml:48`, `libs/node/src/koneksi.js:58`, `libs/node/src/topologi.js:56-64` | Satu node. Quorum queue dideklarasikan, tetapi tidak ada node lain untuk replikasi. Node keluar saat koneksi putus |
| 6 | `infra/debezium/relay.yml`, `infra/debezium/application.properties:43`, `infra/docker-compose.yml:106` | Satu Debezium Server per DB, `snapshot.mode=no_data`, `max_slot_wal_keep_size=1024MB` |
| 7 | `services/publication-service/src/mesin.js:5-21`, `services/similarity-worker/src/app/main.py:19-25` dan `main()` | Transisi ke `PUBLISHED` hanya dari skor. Health handler tidak memeriksa thread konsumen |
| 8 | `libs/node/src/konsumen.js`, `libs/python/event_lib/konsumen.py`, `libs/node/src/store.js` | Mitigasi yang sudah ada: retry full-jitter (3x), DLQ, delivery-limit 5, idempotensi `processed_event`, advisory lock per agregat. Yang belum: timeout handler, konsumen/alert DLQ, redrive |
| 9 | `infra/compose/poem.yml`, `infra/compose/identity.yml` | Hanya `status-stream-service` yang punya `replicas: 2` |
| 10 | `services/login-service/src/index.js:24`, `services/profile-service/src/index.js:23`, `services/mood-feed-service/src/index.js:14` | `new pg.Pool({ connectionString, max: 10 })` tanpa timeout |

## 3. Rekomendasi pilihan minimal 3 titik (satu per kluster)

Panduan meminta minimal 3 titik. Usulan yang mewakili keempat kluster dan
paling mudah didemokan saat uji failover:

1. **No. 1 Gateway**: 2 replika Nginx di belakang load balancer dengan health check (active-active).
2. **No. 2 Jalur sinkron auth**: circuit breaker + timeout pendek di `auth_request`, token-service 2 replika, fallback verifikasi JWT lokal di gateway/layanan saat Redis tidak tersedia.
3. **No. 5/8 Broker**: klaster RabbitMQ 3 node (quorum queue benar-benar tereplikasi), konsumen DLQ + alert + redrive, timeout handler.
4. **No. 4 Data**: replika streaming PostgreSQL (read replica untuk poem-query) + failover (mis. Patroni/repmgr) dan retry koneksi DB.

Pemetaan kandidat pola Tahap 2 untuk titik lain:

| No | Kandidat pola |
|----|---------------|
| 3 | Redis replika + Sentinel. Pisahkan Redis sesi dari Redis suara. Kebijakan `noeviction` untuk kunci sesi |
| 6 | Pantau lag slot dan alert. Relay polling (`relay-polling.js`, SKIP LOCKED, bisa multi-replika) sebagai cadangan. `snapshot.mode` yang bisa membaca ulang outbox |
| 7 | Batas waktu `PROCESSING` + fallback (mis. tahan ke moderasi setelah N menit). Health check yang memeriksa thread konsumen |
| 9 | Minimal 2 replika untuk poem-create, poem-query, token-service |
| 10 | `connectionTimeoutMillis`, `statement_timeout`, dan retry dengan backoff pada pool |
| 11 | Di luar cakupan Learner Lab. Cukup dicatat sebagai batasan (bisa disebut di laporan sebagai risiko yang diterima) |
