# vote-service (T9.1)

Upvote/downvote puisi. Suara diterima di Redis secara atomik (skrip Lua), lalu
`vote.cast` diterbitkan langsung ke RabbitMQ untuk disimpan permanen oleh
`vote-persist-worker` (T9.2) dan dihitung peringkatnya oleh `ranking-worker` (T9.3).

| | |
| --- | --- |
| API | `PUT /api/poems/{id}/vote` body `{"nilai": 1 \| -1 \| 0}`, `GET /api/poems/{id}/vote` (kontrak: `contracts/openapi/vote.yaml`) |
| Terbitkan | `vote.cast` (`vote_value`, `previous_value`, `weight`, `sequence`) |
| Konsumsi | `poem.submitted`, `poem.published`, `poem.hidden`, `poem.deleted`, `user.registered` (queue `q.vote-service`) |
| Data | Redis (vote-live), tanpa basis data |

## Aturan

- Satu pengguna satu suara per puisi. Mengirim nilai yang sama tidak mengubah apa pun dan tidak menerbitkan event.
- Penulis tidak dapat memberi suara pada puisinya sendiri (403 `pemilik_puisi`).
- Suara hanya diterima untuk puisi berstatus PUBLISHED (409 `belum_terbit`); puisi terhapus atau tak dikenal 404.
- Rate limit `VOTE_RATE_PER_MENIT` (bawaan 30) suara per menit per pengguna, selain zona `auth_user` di gateway (429 + `Retry-After`).
- Akun berumur kurang dari 24 jam (dari `user.registered`) mendapat bobot `VOTE_BOBOT_AKUN_BARU` (bawaan 0,5) di peringkat. Hitungan skor tampil tidak dibobot.
- Publik hanya melihat skor gabungan (`skor` = naik − turun); rincian `naik`/`turun` hanya untuk penulis.

## Kunci Redis

| Kunci | Isi |
| --- | --- |
| `vote:v:{poem_id}` | HASH `user_id -> 1 \| -1` (suara aktif) |
| `vote:c:{poem_id}` | HASH `up`, `down`, `seq` |
| `vote:meta:{poem_id}` | HASH `owner`, `status`, `status_ms` (salinan event puisi) |
| `vote:baru:{user_id}` | penanda akun baru, kedaluwarsa saat akun berumur 24 jam |
| `vote:rl:{user_id}:{menit}` | counter rate limit |

`seq` naik satu setiap suara berubah dan menjadi `aggregate_version` serta
`sequence` di `vote.cast`. `event_id` = UUIDv5(`vote.cast:{poem_id}:{seq}`),
sehingga konsumen mengenali duplikat dan mengabaikan suara yang tiba tidak
berurutan (sequence lebih kecil dari yang tersimpan).

## Bila penerbitan vote.cast gagal

Suara dikembalikan (skrip kompensasi) bila belum ada suara lain sesudahnya, dan
klien menerima 503 untuk mencoba lagi. Bila sudah ada suara lain, suara
dibiarkan di Redis dan selisih dengan `vote_db` dibereskan skrip rekonsiliasi
`services/vote-persist-worker/scripts/rekonsiliasi.js`.

## Uji

```bash
npm test                                            # unit + kontrak (tanpa Redis)
REDIS_URL_UJI=redis://127.0.0.1:6390 npm test       # + skrip Lua di Redis sungguhan
node scripts/uji-beban.js                           # 200 suara/detik ke layanan yang berjalan
```
