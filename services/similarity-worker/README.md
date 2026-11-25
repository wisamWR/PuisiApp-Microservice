

\# Similarity Worker



Similarity Worker merupakan layanan pada PuisiApp Microservice yang bertugas mendeteksi kemiripan antarpuisi berdasarkan fingerprint MinHash dan indeks Locality-Sensitive Hashing (LSH).



\## 1. Fitur Utama



\- Menerima event `poem.fingerprint.created` dari RabbitMQ.

\- Membandingkan fingerprint puisi menggunakan estimasi Jaccard.

\- Menggunakan LSH untuk mencari kandidat puisi yang berpotensi mirip.

\- Menghitung containment untuk mendeteksi kemiripan sebagian.

\- Mengklasifikasikan hasil menjadi `original`, `inspired`, `similar`, dan `suspected\_plagiarism`.

\- Menyimpan hasil pemrosesan ke Outbox untuk diterbitkan melalui relay.



\## 2. Teknologi



\- Python 3.11

\- PostgreSQL 16

\- RabbitMQ

\- MinHash

\- Locality-Sensitive Hashing (LSH)

\- Docker



\## 3. Konfigurasi Algoritma



| Parameter | Nilai |

|---|---:|

| MinHash | 128 hashes |

| LSH Bands | 32 |

| LSH Rows | 4 |

| Total bucket | 32 per fingerprint |

| Threshold Inspired | 0.20 |

| Threshold Similar | 0.50 |

| Threshold Plagiarism | 0.80 |



Skor akhir menggunakan nilai maksimum antara estimasi Jaccard dan containment.



Puisi dengan jumlah shingle kurang dari 15 tidak dikategorikan sebagai `suspected\_plagiarism`.



\## 4. First Seen At



Worker menggunakan tabel `poem\_first\_seen` untuk mencatat waktu pertama sebuah puisi ditemukan.



Ketentuan:

\- Waktu pertama puisi dicatat satu kali.

\- Revisi puisi tidak mengubah `first\_seen\_at`.

\- Versi lain dari `poem\_id` yang sama dikecualikan dari kandidat.

\- Kandidat hanya berasal dari puisi yang memiliki waktu pertama lebih awal dibandingkan puisi sumber.



\## 5. Database



Tabel utama yang digunakan:



| Tabel | Fungsi |

|---|---|

| poem\_signatures | Menyimpan fingerprint puisi |

| lsh\_buckets | Menyimpan indeks LSH |

| poem\_first\_seen | Menyimpan waktu pertama puisi ditemukan |

| processed\_event | Mencatat event yang sudah diproses |

| outbox | Menyimpan event hasil pemrosesan |

| schema\_migrasi | Mencatat migrasi database |



Migrasi layanan berada di folder `migrations/`.



\## 6. Pengujian



Unit test dijalankan menggunakan:



```bash

python -m pytest -q services/similarity-worker/tests

```



Hasil pengujian terakhir:



\- Similarity Worker: 22 tests passed.

\- Fingerprint Worker: 18 tests passed.



\### Regression Test



Skenario A v1 → B → A v2 telah diuji menggunakan PostgreSQL.



Hasil:

\- A v2 tidak menemukan A v1 sebagai kandidat.

\- A v2 tidak menemukan B yang ditemukan setelah A.

\- B dapat menemukan A yang ditemukan lebih dahulu.

\- Transaksi pengujian berhasil di-rollback.



Hasil: 4 pemeriksaan berhasil.



\## 7. Benchmark



Benchmark dilakukan menggunakan:



```bash

python services/similarity-worker/scripts/benchmark.py

```



Hasil benchmark dengan 1.000 fingerprint:



| Metrik | Hasil |

|---|---:|

| Total fingerprint | 1.000 |

| Total bucket | 32.000 |

| Candidates found | 1 |

| Best score | 1.0 |

| Seed time | 10.269,548 ms |

| Query + scoring average | 3,128 ms |

| Query + scoring minimum | 2,123 ms |

| Query + scoring maximum | 9,087 ms |



Pengujian query dan scoring dilakukan sebanyak 10 kali.



Transaksi benchmark di-rollback setelah pengujian sehingga data benchmark tidak disimpan secara permanen.



Catatan: hasil query dan scoring tidak merepresentasikan waktu keseluruhan pipeline end-to-end.



\## 8. Menjalankan Service



Similarity Worker dijalankan melalui Docker Compose dari root repository:



```bash

docker compose --env-file .env -f infra/docker-compose.yml up -d similarity-worker

```



Pemeriksaan status container:



```bash

docker ps --filter "name=similarity-worker"

```



Pemeriksaan log:



```bash

docker logs -f puisiapp-similarity-worker-1

```



Health check tersedia pada endpoint:



```text

http://localhost:8080/health

```
