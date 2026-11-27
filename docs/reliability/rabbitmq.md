# Reliability Message Broker (RabbitMQ) dan Consumer

Dokumen ini membahas titik risiko message broker dan consumer worker dalam PuisiApp. Bagian 1 dan 2 menjelaskan risiko dan rancangan perbaikan. Bagian 3 mencatat koreksi terhadap contoh kode dari draf perbaikan sebelumnya, dicocokkan dengan implementasi di `libs/node` dan `libs/python`. Bagian 4 mencatat temuan dari pengujian beserta batas kondisinya. Bagian 5 berisi keterbatasan dan langkah lanjut.

## 1. Risiko

Broker RabbitMQ berjalan sebagai satu node. Jika broker mati, proses asinkron berhenti total. Consumer yang crash di tengah pemrosesan bisa membuat pesan hilang jika acknowledgement dikirim terlalu cepat. Pesan yang selalu gagal bisa di-redeliver terus-menerus (poison message) dan membuat worker crash berulang. Redelivery juga bisa membuat data yang sama tersimpan dua kali jika proses tidak idempoten.

Akibatnya, analisis puisi tertahan dan hasilnya tidak sampai ke layanan lain. Pada kondisi uji, dampak ini terlihat langsung: puisi tidak pernah berstatus PUBLISHED, sehingga pencarian, beranda, dan pengujian beban untuk pembaca biasa tidak bisa dijalankan dengan data nyata.

## 2. Rancangan Perbaikan

### 2.1 Pesan dan consumer

Semua antrean layanan dideklarasikan sebagai quorum queue (`x-queue-type: quorum`), yang selalu durable, dan pesan dikirim persisten. Producer memakai publisher confirms, sehingga pengirim tahu pesan sudah diterima broker. Consumer memakai manual acknowledgement dan hanya mengirim ack setelah transaksi basis data di-commit. Prefetch dibatasi 10 (bisa diubah lewat env `PREFETCH`) agar satu worker tidak menimbun banyak pesan.

Galat sementara dicoba ulang paling banyak tiga kali dengan header penghitung `x-percobaan`. Pesan dijadwalkan ulang melalui exchange `retry.delayed` (plugin delayed message) dengan jeda acak full jitter: paling lama 2, 8, lalu 32 detik. Galat permanen, pesan yang tidak valid, dan pesan yang percobaannya habis langsung di-nack tanpa requeue sehingga masuk ke Dead Letter Queue. Sebagai jaring pengaman, setiap queue juga memakai `x-delivery-limit: 5`, sehingga pesan yang membuat worker crash berulang sebelum sempat di-ack tetap berakhir di DLQ.

Setiap pesan membawa `event_id`. Consumer mencatat `event_id` di tabel `processed_event` dalam transaksi yang sama dengan penyimpanan data, sehingga pesan yang sama tidak diproses dua kali.

Implementasi di repo mengikuti pola yang sudah ada: queue per layanan dengan nama `q.<layanan>`, DLQ `q.<layanan>.dlq`, exchange `retry.delayed`, dan tabel `processed_event`. Semuanya dikelola pustaka `libs/node` (`@puisiapp/events`) untuk layanan Node dan `libs/python` (`event_lib`) untuk worker Python, termasuk similarity-worker. Rancangan ini tidak membuat nama queue atau tabel baru.

### 2.2 Broker satu node

Quorum queue baru memberi ketersediaan tinggi jika broker berjalan sebagai cluster minimal tiga node. Dengan satu node seperti sekarang, quorum queue hanya menjamin pesan tidak hilang saat broker restart. Selama broker mati, tidak ada pesan yang bisa diterbitkan atau dikonsumsi.

Untuk lingkup proyek ini, broker satu node diterima sebagai batasan. Mitigasinya adalah sebagai berikut:

- Container broker memakai `restart: unless-stopped` dan healthcheck, dan data broker disimpan di volume `rabbitmq-data`.
- Pola outbox menahan event di basis data produser selama broker mati. Relay menerbitkannya setelah broker kembali, sehingga event tidak hilang di sisi produser.
- Consumer harus menyambung ulang otomatis setelah koneksi putus. Worker Python sudah melakukannya dengan loop coba ulang 5 detik.

Jika ketersediaan broker menjadi kebutuhan, langkah berikutnya adalah cluster tiga node RabbitMQ. Quorum queue yang sudah dipakai tidak perlu diubah untuk itu.

## 3. Koreksi Contoh Kode

Contoh consumer di draf perbaikan sebelumnya memiliki beberapa masalah dan tidak boleh dijadikan rujukan langsung. Rujukan yang benar adalah implementasi di repo, yaitu `tanganiPesan()` di `libs/node/src/konsumen.js` dan `tangani_pesan()` di `libs/python/event_lib/konsumen.py`. Ringkasan alurnya sebagai berikut.

```js
// Disederhanakan dari libs/node/src/konsumen.js
const percobaan = Number(pesan.properties?.headers?.['x-percobaan'] ?? 0) || 0;

try {
  // store.proses(): INSERT INTO processed_event ... ON CONFLICT (event_id) DO NOTHING
  // lalu handler, semuanya dalam SATU transaksi. Duplikat dilewati.
  await store.proses(event, (ctx) => handler(event, ctx));
  ack();
} catch (err) {
  if (apakahPermanen(err) || percobaan >= 3) return keDlq(); // nack tanpa requeue
  const jedaMs = Math.floor(Math.random() * 2000 * 4 ** percobaan); // full jitter
  try {
    // Publish ke exchange retry.delayed dengan header x-percobaan dan x-delay,
    // menunggu publisher confirm sebelum pesan asli di-ack.
    await jadwalkanUlang(percobaan + 1, jedaMs);
    ack();
  } catch {
    kembalikan(); // nack dengan requeue bila retry gagal diterbitkan
  }
}
```

Perbedaan dari draf sebelumnya:

- **Idempotensi.** Pengecekan dipindah ke dalam transaksi melalui `INSERT ... ON CONFLICT DO NOTHING`, sehingga dua worker tidak bisa sama-sama lolos pengecekan.
- **Header.** Header dibaca dengan aman, karena `headers` bisa kosong. Namanya `x-percobaan`, bukan `x-retry`.
- **Jalur retry.** Retry tidak diterbitkan ulang ke default exchange `''` tanpa jeda. Pesan dikirim ke `retry.delayed` dengan `x-delay`, dan publish-nya dikonfirmasi broker sebelum pesan asli di-ack.
- **Gagal publish retry.** Jika publish retry gagal, pesan di-nack dengan requeue, bukan hilang.
- **Pembedaan galat.** Galat permanen (`GalatPermanen`) langsung ke DLQ tanpa menghabiskan percobaan.

## 4. Pengujian dan Temuan

Pengujian dilakukan di WSL dengan Docker Compose pada branch `k3-search`. Kondisi ini perlu diingat, karena `main` sudah berubah setelah pengujian dilakukan, termasuk merge k3-search (PR #28). Temuan berikut terbukti pada kondisi tersebut, kecuali bagian yang ditandai sebagai pemeriksaan kode. Validasi envelope dan handler untuk pesan fingerprint yang sebelumnya ditolak lolos dengan kode similarity-worker dan libs/python yang identik dengan main (basis 8ed9286). Pemrosesan penuh sampai puisi berstatus PUBLISHED belum diuji. Validasi envelope dan handler untuk pesan fingerprint yang sama lolos dengan kode `main`, tetapi pemrosesan penuh sampai puisi berstatus PUBLISHED belum diuji.

Binding antrean sudah sesuai. Antrean `q.search-service` terikat ke routing key `poem.submitted`, `poem.revised`, `poem.published`, `poem.hidden`, `poem.deleted`, dan `poem.keywords.extracted`, serta ke `retry.delayed`. Pemeriksaan dilakukan lewat API management RabbitMQ, karena `rabbitmqctl list_bindings` tidak menampilkan hasil apa pun pada lingkungan ini.

Antrean `q.similarity-worker.dlq` berisi tujuh pesan dan tidak memiliki konsumen. Ini wajar, karena DLQ memang tidak dikonsumsi otomatis. Pesan-pesan ini menunjukkan bahwa similarity-worker gagal memproses beberapa event `poem.fingerprint.created`. Pada saat pengecekan, antrean utama `q.similarity-worker` juga tidak memiliki konsumen aktif.

Basis data `poem_read_db` berisi sembilan puisi, semuanya berstatus PROCESSING dan tidak ada yang PUBLISHED. Di `search_db`, hanya satu puisi yang masuk, dan tabel `processed_event` di sana hanya berisi satu entri. Delapan puisi yang dikirim pada 24 sampai 26 November tidak pernah diterima oleh konsumen pencarian. Dugaan kami adalah antrean pencarian baru dideklarasikan pada 27 November. Event yang diterbitkan sebelum ada queue yang terikat tidak disimpan oleh broker. Dugaan ini belum dibuktikan, tetapi bisa diperiksa dengan dua cara:

- Periksa tabel outbox di basis data produser. Jika event 24 sampai 26 November tercatat sudah dikirim, berarti event keluar dari produser tetapi tidak ada queue yang menampungnya.
- Periksa `q.outbox.unrouted`. Antrean ini hanya menampung event yang `event_type`-nya tidak punya binding di `outbox.relay`, sehingga kemungkinan besar kosong untuk kasus ini.

Log similarity-worker hanya berisi pesan "galat sementara" tanpa exception atau stack trace. Pemeriksaan kode menunjukkan penyebabnya ada di pustaka bersama, bukan di similarity-worker. Di `libs/python/event_lib/konsumen.py`, blok pesan tidak valid sudah mengirim `str(exc)` ke logger sebagai field `err`. Di blok kedua, exception tidak dikirim ke logger pada empat jalur: galat permanen, percobaan habis, galat sementara yang dijadwalkan ulang, dan kegagalan menjadwalkan ulang. Formatter di `libs/python/event_lib/log.py` hanya menulis stack trace jika record membawa `exc_info`. Dengan begitu, pada empat jalur tersebut detail galat tidak muncul di log worker Python (similarity, emotion, fingerprint). Versi Node menyertakan `err` di semua jalur itu (`libs/node/src/konsumen.js`, baris 62 sampai 112).

Pemeriksaan kode `services/similarity-worker/src/app/main.py` juga menemukan dua hal lain:

- Endpoint `/health` selalu membalas `ok` walaupun thread konsumen mati atau terus gagal, sehingga healthcheck tidak bisa mendeteksi worker yang berhenti mengonsumsi.
- Galat koneksi atau migrasi hanya dicetak dengan `print` tanpa stack trace, lalu dicoba ulang setiap 5 detik.

Relay outbox pernah mati setelah restart stack. Pemulihan dilakukan dengan `docker compose up -d --force-recreate`. Di `infra/compose/*.yml` pada `main` belum ada healthcheck untuk relay, sehingga relay tidak dimulai ulang otomatis.

## 5. Keterbatasan dan Langkah Lanjut

Penyebab kegagalan similarity-worker belum diketahui. Langkah pertama adalah memperbaiki log di `libs/python/event_lib/konsumen.py` dengan menambahkan `exc_info=exc` pada empat pemanggilan logger di blok `except` kedua. Pada kegagalan menjadwalkan ulang, `except Exception:` perlu diubah menjadi `except Exception as exc:` terlebih dahulu. Perubahan ini ada di pustaka bersama, jadi perlu disepakati dengan pemilik `libs/python`. Setelah itu, pemilik layanan (Kelompok 7, Raffa) dapat membaca exception yang sebenarnya, ditambah isi pesan di DLQ yang dibaca tanpa dihapus.

Healthcheck similarity-worker sebaiknya ikut memeriksa status thread konsumen, bukan hanya proses HTTP. Relay outbox juga perlu healthcheck agar dimulai ulang otomatis.

Setelah `main` berisi perubahan terbaru similarity-worker, pengujian perlu diulang dengan membangun ulang image dari `main`. Hasil di atas tidak otomatis berlaku untuk kode terbaru.

Pesan di DLQ sebaiknya tidak di-requeue atau dihapus sebelum penyebabnya diketahui, karena pesan itu menjadi bukti. Penulisan ulang atau pemulihan harus dilakukan setelah ada perbaikan.

Skenario uji dari draf sebelumnya tetap relevan: consumer crash saat memproses, poison message yang masuk DLQ setelah tiga kali gagal, dan pemulihan relay setelah restart. Skenario ini perlu dijalankan ulang pada kode `main` yang sudah diperbarui sebelum dicantumkan sebagai hasil.

## Lampiran A: Uji Broker (RabbitMQ 4.1.8, lokal)

Uji ini dilakukan dengan antrean sementara `test.rel` dan `test.rel.dlq` yang dibuat khusus untuk pengujian, lalu dihapus setelah selesai. Antrean milik kelompok lain tidak disentuh.

Pada uji pertama, satu pesan dipublikasikan ke `test.rel` dan dibaca dengan mode reject tanpa requeue. Pesan itu kemudian muncul di `test.rel.dlq`, sehingga konfigurasi dead-letter bekerja sebagaimana dirancang.

Pada uji kedua, satu pesan persisten dipublikasikan ke antrean durable, lalu RabbitMQ di-restart dan status healthy-nya diperiksa sebelum membaca ulang. Pesan tetap tersedia setelah restart.

Uji ini hanya memverifikasi perilaku broker. Antrean `test.rel` yang dipakai di lampiran ini adalah antrean klasik, bukan quorum, sehingga durability quorum belum diuji dengan cara ini. Uji batas pengiriman quorum ada di Lampiran B. Publisher confirms dan manual ack pada consumer belum diuji dan belum masuk ke pembuktian dokumen ini.

## Lampiran B: Uji batas pengiriman (x-delivery-limit)

Uji dilakukan dengan antrean sementara `test.q` (quorum, `x-delivery-limit: 5`, DLQ `test.q.dlq`) dan dihapus setelah selesai. Satu pesan dipublikasikan, lalu diambil ulang enam kali dengan mode `ack_requeue_true`. Setelah itu, `test.q` kosong dan `test.q.dlq` berisi pesan tersebut.

Uji ini memakai HTTP API untuk mengambil pesan, bukan consumer sungguhan. Hasilnya membuktikan bahwa pesan yang melewati batas pengiriman dipindah ke DLQ pada quorum queue. Perilaku worker yang crash sebelum ack belum diuji dengan cara ini.
