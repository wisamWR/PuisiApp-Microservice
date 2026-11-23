# Seed Data Puisi App (T0.10)

Seed membuat akun dan puisi demo lewat API layanan (register, login, poem-create),
sehingga akun seed bisa dipakai login dan puisinya diproses seperti puisi biasa.

## Data bawaan
- `tools/seed-data/accounts.json`: 5 akun demo (`penyair01` sampai `penyair05`)
- `tools/seed-data/poems.json`: 50 puisi, 10 per emosi (senang, sedih, cinta, marah, takut)
- `tools/seed-data/validate_emotions.py`: cek emosi dominan tiap puisi dengan leksikon emotion-worker

## Cara menjalankan
Seed memanggil layanan langsung lewat nama host di jaringan Docker
(`register-service`, `login-service`, `poem-create-service`, `poem-delete-service`),
jadi jalankan di dalam jaringan compose. Dari root repository:

```powershell
docker run --rm --network puisiapp_app -v ${PWD}:/app -w /app node:22-alpine node tools/seed/index.js
```

Nama jaringan = `<COMPOSE_PROJECT_NAME>_app`. URL layanan bisa diganti dengan
`--register-url`, `--login-url`, `--poem-create-url`, dan `--poem-delete-url`.

### Opsi
| Opsi | Keterangan |
|---|---|
| `--count <n>` | Jumlah puisi (default 50, maksimal sebanyak isi `poems.json`) |
| `--rate <n>` | Request per detik (default 10) |
| `--dry-run` | Validasi data lokal tanpa request API |
| `--reset` | Hapus puisi yang tercatat di `state.json` |
| `--help` | Tampilkan bantuan |

### Mengulang seed
- Setiap puisi memakai `Idempotency-Key` tetap (`seed-t010-001` dan seterusnya),
  jadi menjalankan seed dua kali tidak membuat puisi ganda.
- Kalau isi `poems.json` diubah setelah seed dijalankan, poem-create menolak dengan 409.
  Jalankan `--reset` lebih dulu.
- ID puisi yang dibuat dicatat di `tools/seed-data/state.json` (tidak di-commit).
  `--reset` menghapus puisi tersebut lewat `DELETE /api/poems/{id}`.

## Pengujian
```powershell
node --test tools/seed/rate-limit.test.js
node tools/seed/index.js --dry-run
python tools/seed-data/validate_emotions.py
```

# publish-sample

Menerbitkan contoh event ke RabbitMQ dari `examples` di `contracts/events/`.

```powershell
cd tools; npm ci; cd ..
$env:RABBITMQ_HOST = '127.0.0.1'
node --env-file=.env tools/publish-sample/index.js poem.submitted --count 20 --rate 5
```

Dari host, `RABBITMQ_HOST` harus diarahkan ke `127.0.0.1` (dan `RABBITMQ_PORT` ke
`RABBITMQ_HOST_PORT` kalau diubah), karena nilai di `.env` adalah nama host di jaringan Docker.

Tanpa `event_type`, semua event di katalog diterbitkan. Event yang skemanya belum
punya `examples` membuat perintah berhenti dengan pesan galat.
