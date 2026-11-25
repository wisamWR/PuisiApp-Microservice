# Skenario demo PuisiApp (fitur yang sudah di main)

Demo sederhana sekitar 10 menit untuk fitur yang sudah masuk `main` dan sudah diuji lokal:
akun (k1), penulisan dan status (k2), mood (k5), keaslian (k7), dan suara (k9).

## 1. Persiapan (sekitar 30 menit sebelum demo)

Ikuti [jalankan-lokal.md](jalankan-lokal.md) sampai `.env` siap, lalu jalankan dengan profil
`lengkap` supaya notifikasi ikut menyala:

```powershell
git pull
docker compose --profile lengkap up -d --build
docker compose ps
```

Semua container harus `healthy` (sekitar 37), kecuali `rabbitmq-topologi` yang `Exited (0)`.

Isi data demo (5 akun `penyair01` sampai `penyair05`, 50 puisi, 10 per emosi). Nama jaringan
`<COMPOSE_PROJECT_NAME>_app`, bawaan `puisiapp_app`:

```powershell
docker run --rm --network puisiapp_app -v ${PWD}:/app -w /app node:22-alpine node tools/seed/index.js
```

Tunggu sekitar 1 menit sampai semua puisi diproses. Kata sandi akun seed ada di
`tools/seed-data/accounts.json` (contoh `penyair01` / `SeedPuisi2026_01`).

Siapkan dua jendela browser:
- Jendela biasa: masuk sebagai `penyair01`
- Jendela private/incognito: untuk akun baru (pembaca)

Buka juga RabbitMQ UI http://localhost:15672 di tab lain (opsional, untuk menunjukkan event).

## 2. Skenario

| No | Langkah | Yang ditunjukkan | Fitur |
| --- | --- | --- | --- |
| 1 | Jendela private: buka http://localhost:8080, **Daftar** akun baru, lalu **Masuk** | Registrasi dan login (JWT di cookie httpOnly); reload halaman, sesi tetap ada | k1 |
| 2 | Pilih suasana hati **Sedih**, mode **Senada**, buka **Mood Feed** | Feed berisi puisi bernuansa sedih, diurutkan menurut skor emosi; dibaca dari Redis | k5 |
| 3 | Ganti mode ke **Menghibur** | Puisi senang/cinta muncul untuk menghibur pembaca yang sedih | k5 |
| 4 | Pada salah satu kartu, tekan **naik** (upvote), lalu ubah menjadi turun | Skor berubah langsung; satu suara per pengguna per puisi | k9 |
| 5 | Jendela `penyair01`: **Tulis Puisi**, isi judul dan isi, pilih bait kutipan dan template | Pratinjau gambar kutipan berubah saat bait/template diganti; draf tersimpan otomatis | k2 |
| 6 | **Kirim puisi** | Langsung diterima (202) lalu status pemrosesan bergerak sendiri (SSE): analisis emosi, gambar kutipan, pemeriksaan keaslian selesai, puisi terbit | k2, k5, k7 |
| 7 | Gulir ke bawah di halaman puisi | Analisis emosi per larik dan nuansa utama | k5 |
| 8 | Klik ikon lonceng / **Notifikasi**, lalu **Puisi Saya** | Notifikasi "sudah terbit"; daftar puisi sendiri per status | k2 |
| 9 | Jendela private (pembaca): **Tulis Puisi**, salin puisi milik `penyair01` (teks di bawah), kirim | Pemeriksaan keaslian menemukan kemiripan 100%: puisi **ditahan**, tidak terbit | k7, k2 |
| 10 | Masih di akun pembaca: buka **Notifikasi** dan **Puisi Saya** (filter Ditahan) | Notifikasi "ditahan" beserta alasan skor kemiripan | k2 |
| 11 | Jendela `penyair01`: coba vote puisi sendiri | Ditolak: tidak boleh memberi suara pada karya sendiri | k9 |

Teks untuk langkah 9 (puisi seed "Langkah yang Gemilang" milik `penyair01`):

```
Semangat tumbuh bersama harapan
Aku bangga melihat kemenangan

Wajah ceria menyambut cahaya
Perjuangan terasa indah dan gemilang
```

## 3. Poin penjelasan arsitektur (sambil menunggu langkah 6)

- Pengajuan puisi hanya menulis ke database dan outbox dalam satu transaksi, lalu membalas 202.
  Debezium membaca outbox dan menerbitkan event ke RabbitMQ (transactional outbox).
- Worker berjalan terpisah dan paralel: emotion-worker, image-render-worker, fingerprint-worker,
  similarity-worker. publication-service menunggu skor kemiripan sebelum menerbitkan.
- Status di layar dikirim lewat SSE dari processing-tracker (Redis pub/sub), tanpa polling.
- Di RabbitMQ UI tab **Queues**, terlihat antrean per layanan (`q.publication`, `q.similarity-worker`, ...).

## 4. Hal yang perlu diketahui saat demo

- Sesi yang tetap ada setelah reload (langkah 1) dan nama penulis di kartu feed butuh perbaikan
  dari branch `perbaikan-uji-lokal`. Pastikan PR-nya sudah di-merge sebelum demo.

- Status pemrosesan berhenti di **50%** dan label "Sedang diproses" tetap tampil walau puisi sudah
  terbit. Tiga langkah (Tema, Kata kunci, Jejak keaslian) milik k6 dan T7.4 belum masuk main.
  Jelaskan sebagai fitur tahap berikutnya.
- Bagian bawah halaman puisi menampilkan "Larik ke-1" dan seterusnya, bukan teks lariknya.
- Menu Beranda, Jelajah Tema, Pencarian, dan Moderasi masih halaman sementara; jangan dibuka.
- Puisi yang ditahan belum bisa diputuskan dari UI (moderasi k8 belum ada).
- Verifikasi email dan lupa kata sandi (T1.6) belum masuk main.

## 5. Mengulang demo dari awal

```powershell
docker compose --profile lengkap down -v
docker compose --profile lengkap up -d
docker run --rm --network puisiapp_app -v ${PWD}:/app -w /app node:22-alpine node tools/seed/index.js
```

`tools/seed-data/state.json` boleh dihapus setelah `down -v` karena isinya ID puisi lama.
