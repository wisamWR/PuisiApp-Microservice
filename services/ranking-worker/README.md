# ranking-worker (T9.3)

Skor peringkat puisi dengan batas bawah interval kepercayaan Wilson (z = 1,96).

| | |
| --- | --- |
| Konsumsi | `vote.cast` (queue `q.ranking`) |
| Terbitkan | `poem.score.updated` (`score`, `vote_count`, `up`, `down`, `wilson_score`) langsung ke RabbitMQ |
| Data | Redis ranking-store `rank:v:{poem}` (kontribusi per pengguna) dan `rank:c:{poem}` (hitungan) |

## Rumus

`W = (p + z²/2n − z·√(p(1−p)/n + z²/4n²)) / (1 + z²/n)`, dengan `p = naik/n`.
Contoh: 2 naik 0 turun = 0,342; 10 naik 1 turun = 0,623; 90 naik 10 turun = 0,826.

Wilson dihitung dari suara **berbobot**: akun berumur kurang dari 24 jam
(`weight` di `vote.cast`, bawaan 0,5) menyumbang lebih sedikit untuk mengurangi
brigading. `score` dan `vote_count` tetap hitungan mentah.

## Kapan poem.score.updated terbit

Hanya bila Wilson berubah lebih dari `WILSON_AMBANG` (bawaan 0,001) dari nilai
terakhir yang diterbitkan, supaya event tidak membanjir saat lonjakan suara.
Pengecualian: selama Wilson masih 0 (belum ada suara positif), setiap
perubahan skor tetap diterbitkan agar skor negatif di poem-query tidak macet.
Skor tampil real-time diambil UI dari `GET /api/poems/{id}/vote` (vote-service).

## Idempotensi dan urutan

Kontribusi tiap pengguna disimpan bersama `sequence`. Suara dengan sequence
lebih kecil atau sama (duplikat, tiba terlambat) diabaikan, dan saat suara
berubah, kontribusi lama dikurangi dengan bobot lamanya. `event_id`
`poem.score.updated` deterministik dari event sumber; bila penerbitan gagal,
klaim dibatalkan dan pesan dicoba ulang sehingga skor tetap terbit.

## Uji

```bash
npm test                                         # Wilson, aturan terbit, tiruan toko
REDIS_URL_UJI=redis://127.0.0.1:6390 npm test    # + skrip Lua di Redis sungguhan
```
