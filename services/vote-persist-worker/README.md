# vote-persist-worker (T9.2)

Penyimpanan suara permanen secara write-behind. Suara diterima `vote-service`
di Redis; worker ini menyimpannya ke `vote_db` dari event `vote.cast`.

| | |
| --- | --- |
| Konsumsi | `vote.cast` (queue `q.vote-persist`, DLQ `q.vote-persist.dlq`) |
| Data | `vote_db` (PostgreSQL), tabel `votes(poem_id, user_id, value, weight, sequence, updated_at)`, kunci unik `(poem_id, user_id)` |
| Terbitkan | tidak ada |

## Cara kerja

1. Pesan ditampung sampai `BATCH_MAKS` (200) pesan atau `BATCH_JEDA_MS` (1 detik) sejak pesan pertama. Prefetch = `BATCH_MAKS`.
2. Suara digabung per `(poem_id, user_id)`: hanya `sequence` terbesar yang ditulis.
3. Satu pernyataan `INSERT ... ON CONFLICT DO UPDATE ... WHERE votes.sequence < EXCLUDED.sequence` dalam satu transaksi.
4. Ack semua pesan batch **hanya setelah commit**. Bila gagal, semua pesan di-nack dengan requeue setelah jeda mundur (1 s, 2 s, ... maks 30 s). Setelah 5 kali pengiriman (`x-delivery-limit`) pesan pindah ke DLQ.

Suara yang ditarik disimpan sebagai `value = 0` (tombstone) supaya suara lama
yang tiba terlambat tidak menghidupkannya kembali. Karena baris ditimpa
menurut `sequence` (bukan dijumlahkan), pesan duplikat dan urutan acak tidak
menggandakan suara. Mematikan worker di tengah batch aman: pesan yang belum
di-ack dikirim ulang broker. SIGTERM menyimpan batch terakhir sebelum keluar.

## Rekonsiliasi

```bash
docker compose exec vote-persist-worker node scripts/rekonsiliasi.js            # laporan
docker compose exec vote-persist-worker node scripts/rekonsiliasi.js --perbaiki # + bangun ulang Redis
```

Status per puisi: `cocok`, `belum_persist` (Redis lebih maju, suara masih di
queue; normal), `kosong` (Redis hilang) dan `selisih`. Dengan `--perbaiki`,
`vote:v:{poem}` dan `vote:c:{poem}` dibangun ulang dari `vote_db` untuk status
`kosong`/`selisih`. Jalankan saat sepi: Redis tidak dikunci selama pembangunan
ulang. Salinan pemilik/status puisi (`vote:meta:*`) tidak ada di `vote_db`;
Redis berjalan dengan AOF sehingga kunci ini bertahan saat restart.

## Uji

```bash
npm test   # logika batch (tanpa infrastruktur)
DATABASE_URL_UJI=postgres://postgres:uji@127.0.0.1:55433/postgres REDIS_URL_UJI=redis://127.0.0.1:6390 npm test
```
