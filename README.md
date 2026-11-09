# k5-mood: Emosi dan Mood Feed

Branch: `k5-mood` | Penanggung jawab: Sabila | Task: T5.1 sampai T5.4 | Frontend: Mood Entry, Mood Feed, alur emosi per baris

## Cakupan

Analisis emosi per baris puisi dan feed yang diurutkan menurut emosi pilihan pembaca (mode senada dan menghibur).

## Layanan dan Komponen

| Layanan | Tipe | Data | Task |
| --- | --- | --- | --- |
| emotion-worker (Python) | worker | emotion-db (MongoDB) | T5.1, T5.2 |
| mood-feed-service | API + consumer indeks | mood-index (Redis sorted set) | T5.3 |
| UI Mood Entry, Mood Feed, komponen alur emosi | frontend | `localStorage` | T5.4 |

## Endpoint

| Metode | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/feed/mood/{emosi}?mode=senada\|menghibur&page=` | 200 dari Redis; micro-cache Nginx 3 detik |

## Event

| Event | Peran |
| --- | --- |
| `poem.submitted`, `poem.revised` | consume (emotion-worker, queue `q.emotion`) |
| `poem.emotion.analyzed` | publish (emotion-worker), consume (mood-feed, poem-query, processing-tracker) |
| `poem.published`, `poem.hidden`, `poem.deleted`, `poem.score.updated` | consume (mood-feed) |

## Catatan Teknis

- Lima label emosi mengikuti EmoT/IndoNLU: senang, sedih, cinta, marah, takut. Pilihan pada Mood Entry dipetakan satu-satu ke label ini.
- Hasil per baris berupa distribusi probabilitas lima emosi. Skor emosi puisi adalah rata-rata distribusi per baris yang dibobot panjang baris.
- T5.1 memakai mode leksikon (kamus kata emosi berbobot). T5.2 menambahkan IndoBERT hasil fine-tune EmoT yang dipilih lewat konfigurasi `MODEL=indobert`, dengan antarmuka keluaran yang sama. Memori IndoBERT sekitar 700 MB per replika, sehingga uji akurasi memakai sekitar 200 puisi berlabel manual.
- Worker memakai pola consume, process, publish, ack: hasil ditulis idempoten (`processed_event`), event hasil diterbitkan dengan `event_id` deterministik (UUIDv5), prefetch kecil (sekitar 4), retry eksponensial dengan full jitter, dan DLQ `q.emotion.dlq`.
- Indeks feed `feed:mood:{emosi}` diperbarui oleh event, bukan dihitung saat permintaan. Puisi masuk indeks hanya bila sudah terbit dan sudah memiliki hasil analisis emosi; `ZREM` saat hidden atau deleted.
- Skor urutan: `0,6 · e + 0,3 · W + 0,1 · 0,5^(u/72)` dengan `e` skor emosi terpilih, `W` skor Wilson dari k9, `u` umur puisi dalam jam. Mode menghibur memetakan emosi negatif ke emosi positif.
- Ringkasan kartu disimpan sebagai hash `card:{poem_id}` (TTL 1 jam), ditulis ulang oleh proyeksi.
- Pilihan emosi hanya disimpan di klien (`localStorage`), sehingga tidak ada state sesi di server. Satu kunci per emosi dipakai bersama seluruh pembaca.

## Dependensi

T0.2 (pustaka event Python), T0.6, T2.2 (event terbit), T9.3 (event `poem.score.updated`).

## Alur Git

Kerjakan langsung di `k5-mood`, awali commit dengan kode task (`T5.1: label emosi per baris`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.