# k5-mood: Emosi dan Mood Feed

- **Branch:** `k5-mood`
- **Penanggung jawab:** Sabila
- **Task:** T5.1, T5.2, T5.3, T5.4

## Layanan dan Komponen

| Layanan | Tipe | Penyimpanan | Task |
| --- | --- | --- | --- |
| `services/emotion-worker` (Python) | Worker RabbitMQ | `emotion-db` (MongoDB) | T5.1, T5.2 |
| `services/mood-feed-service` (Node.js) | REST API + Consumer | `mood-index` (Redis Sorted Set & Hash) | T5.3 |
| `frontend` (React + Vite) | UI Web | `localStorage` | T5.4 |
| `infra/nginx/routes/mood.conf` | API Gateway | Micro-cache Nginx (3 detik) | T5.3 |

## Hasil Evaluasi Model Emosi (T5.1 & T5.2)

Evaluasi dilakukan pada 60 baris puisi berlabel manual (5 label EmoT/IndoNLU: `senang`, `sedih`, `cinta`, `marah`, `takut`):

| Mode Model | Akurasi | F1 Makro | Waktu / Puisi | Memori Python |
| --- | :---: | :---: | :---: | :---: |
| `lexicon (lexicon-v1)` | **85,00%** | **85,14%** | **0,076 ms** | **0,01 MB** |
| `indobert (indobert-v1)` | 73,33% | 74,41% | 64,954 ms | 218,09 MB |

- **Verifikasi 10 Puisi Contoh (T5.1):** `10/10` sesuai label ekspektasi; format payload `poem.emotion.analyzed` identik untuk kedua mode (`MODEL=lexicon|indobert`); event duplikat diabaikan secara idempoten (`processed_event`).
- **Keputusan Mode Bawaan Demo:** `MODEL=lexicon` ditetapkan sebagai *default* pada deployment EC2 demo karena latensi ~850x lebih cepat, kebutuhan memori minimal (`0,01 MB` vs `218,09 MB` + overhead PyTorch), serta akurasi lebih tinggi pada diksi puitis. `MODEL=indobert` tersedia sebagai opsi konfigurasi tanpa mengubah skema event.

## Verifikasi Mood Feed & Gateway (T5.3)

- **Indeks Redis:** Sorted set `feed:mood:<emosi>` + hash `card:<poem_id>` dengan rumus skor `0,6 * skor_emosi + 0,3 * skor_wilson + 0,1 * 0,5^(umur_jam / 72)`.
- **Mode Menghibur:** Pemetaan (`sedih`, `takut`, `marah` -> `senang`, `cinta`; `senang` -> `senang`; `cinta` -> `cinta`) disimpan di berkas konfigurasi `services/mood-feed-service/config/peta-menghibur.json`.
- **Micro-cache Nginx (Diagram 4.4):** Terverifikasi pada `GET /api/feed/mood/{emosi}?mode=&page=` dengan `Cache-Control: public, max-age=3` dan header `X-Cache-Status: MISS` -> `HIT`.
- **Uji Beban k6:** `50 VU`, durasi `60 detik`, **6.904.911 iterasi selesai (0 gagal)** dengan `p95 < 300 ms`.
- **Rebuild Indeks:** Tersedia lewat `services/mood-feed-service/scripts/rebuild-index.js`.

## Verifikasi Antarmuka Pengguna (T5.4)

- **Mood Entry (`/mood-entry`):** 5 pilihan emosi dengan emoji dan label, tersimpan di `localStorage`, muncul otomatis saat kunjungan pertama, dan dapat diganti melalui indikator mood di header.
- **Mood Feed (`/mood-feed`):** Tab **Senada** dan **Menghibur**, kartu puisi, *infinite scroll*, dan tampilan keadaan kosong (*empty state*).
- **Alur Emosi per Baris & Penjelasan:** Komponen `EmotionFlowPanel` terpasang pada halaman detail puisi (`/poems/:id`) beserta keterangan bahwa label merepresentasikan suasana karya puisi, bukan penilaian psikologis.
