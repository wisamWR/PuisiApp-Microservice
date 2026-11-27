# Reliability Message Broker (RabbitMQ) dan Consumer

Dokumen ini membahas titik risiko message broker dan consumer worker dalam PuisiApp. Bagian pertama menjelaskan rancangan perbaikan. Bagian kedua mencatat temuan dari pengujian yang sudah dilakukan, termasuk batas kondisi tempat pengujian itu berjalan. Bagian ketiga mencatat koreksi terhadap contoh kode dari draf perbaikan sebelumnya.

## 1. Risiko

Broker RabbitMQ berjalan sebagai satu node. Jika broker mati, proses asinkron berhenti total. Consumer yang crash di tengah pemrosesan bisa membuat pesan hilang jika acknowledgement dikirim terlalu cepat. Pesan yang selalu gagal bisa di-redeliver terus-menerus (poison message) dan membuat worker crash berulang. Redelivery juga bisa membuat data yang sama tersimpan dua kali jika proses tidak idempoten.

Akibatnya, analisis puisi tertahan dan hasilnya tidak sampai ke layanan lain. Pada kondisi uji, dampak ini terlihat langsung: puisi tidak pernah berstatus PUBLISHED, sehingga pencarian, beranda, dan pengujian beban untuk pembaca biasa tidak bisa dijalankan dengan data nyata.

## 2. Rancangan Perbaikan

Queue dideklarasikan sebagai durable dan pesan dikirim dengan status persisten, sehingga pesan tetap ada ketika broker restart. Producer memakai publisher confirms, sehingga pengirim tahu pesan sudah diterima broker. Consumer memakai manual acknowledgement dan hanya mengirim ack setelah data tersimpan. Prefetch dibatasi, misalnya 10, agar satu worker tidak menimbun banyak pesan.

Pesan yang gagal dicoba ulang sampai batas tertentu, misalnya tiga kali, dengan header penghitung. Setelah batas itu, pesan dibuang ke Dead Letter Queue untuk diperiksa. Setiap pesan membawa identitas unik, dan consumer mencatat identitas yang sudah diproses agar pesan yang sama tidak diproses dua kali.

Implementasi di repo mengikuti pola yang sudah ada: queue per layanan dengan nama `q.<layanan>`, DLQ `q.<layanan>.dlq`, antrean retry melalui exchange `retry.delayed` dengan plugin delayed message, dan tabel `processed_event` yang dikelola pustaka `libs/node` (`@puisiapp/events`). Rancangan ini tidak membuat nama queue atau tabel baru.

## 3. Koreksi Contoh Kode

Contoh consumer di draf perbaikan sebelumnya memiliki beberapa masalah dan tidak boleh dijadikan rujukan langsung. Contoh berikut sudah dikoreksi dan bersifat konseptual. Implementasi nyata ada di `libs/node`, dan belum kami verifikasi ulang terhadap kode tersebut.

```js
// Header pesan bisa kosong. Akses langsung akan error.
const retry = msg.properties.headers?.['x-retry'] ?? 0;

try {
  // Pengecekan dan penyimpanan dilakukan dalam satu transaksi.
  // Dua worker tidak bisa sama-sama lolos pengecekan karena kunci utama di basis data.
  await db.transaction(async (tx) => {
    const { rowCount } = await tx.query(
      'INSERT INTO processed_event (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [messageId],
    );
    if (rowCount === 0) return; // sudah pernah diproses
    await savePuisi(tx, payload);
  });
  channel.ack(msg);
} catch (err) {
  if (retry >= 3) return channel.nack(msg, false, false); // masuk DLQ
  // Publish ulang harus dikonfirmasi broker sebelum pesan asli di-ack.
  await confirmChannel.publish('', queue, msg.content, {
    persistent: true,
    headers: { 'x-retry': retry + 1 },
  });
  await confirmChannel.waitForConfirms();
  channel.ack(msg);
}
```

Perbedaan utama dari draf sebelumnya: pengecekan idempotensi dipindah ke dalam transaksi, header dibaca dengan aman, dan publish ulang memakai confirm channel sehingga pesan tidak hilang jika publish gagal.

## 4. Pengujian dan Temuan

Pengujian dilakukan di WSL dengan Docker Compose pada branch `k3-search`. Kondisi ini perlu diingat, karena `main` sudah berubah setelah pengujian dilakukan. Temuan berikut terbukti pada kondisi tersebut.

Binding antrean sudah sesuai. Antrean `q.search-service` terikat ke routing key `poem.submitted`, `poem.revised`, `poem.published`, `poem.hidden`, `poem.deleted`, dan `poem.keywords.extracted`, serta ke `retry.delayed`. Pemeriksaan dilakukan lewat API management RabbitMQ, karena `rabbitmqctl list_bindings` tidak menampilkan hasil apa pun pada lingkungan ini.

Antrean `q.similarity-worker.dlq` berisi tujuh pesan dan tidak memiliki konsumen. Pesan-pesan ini menunjukkan bahwa similarity-worker gagal memproses beberapa event dan memindahkannya ke DLQ. Pada saat pengecekan, worker tidak memiliki konsumen aktif.

Basis data `poem_read_db` berisi sembilan puisi, semuanya berstatus PROCESSING dan tidak ada yang PUBLISHED. Di `search_db`, hanya satu puisi yang masuk, dan tabel `processed_event` di sana hanya berisi satu entri. Delapan puisi yang dikirim pada 24 sampai 26 November tidak pernah diterima oleh konsumen pencarian. Dugaan kami adalah antrean pencarian baru dideklarasikan pada 27 November, sehingga event lama tidak tersimpan. Dugaan ini belum dibuktikan.

Log similarity-worker hanya berisi pesan "galat sementara" tanpa exception atau stack trace. Ini menghambat diagnosis, dan menjadi alasan utama mengapa penyebab kegagalan belum diketahui.

Relay outbox pernah mati setelah restart stack. Pemulihan dilakukan dengan `docker compose up -d --force-recreate`. Saat ini belum ada healthcheck yang memulai ulang relay secara otomatis.

## 5. Keterbatasan dan Langkah Lanjut

Penyebab kegagalan similarity-worker belum diketahui. Pemilik layanan (Kelompok 6) perlu memeriksa exception yang sebenarnya, misalnya dengan menambahkan stack trace ke log dan membaca isi pesan di DLQ tanpa menghapusnya.

Setelah `main` berisi perubahan terbaru similarity-worker, pengujian perlu diulang dengan membangun ulang image dari `main`. Hasil di atas tidak otomatis berlaku untuk kode terbaru.

Pesan di DLQ sebaiknya tidak di-requeue atau dihapus sebelum penyebabnya diketahui, karena pesan itu menjadi bukti. Penulisan ulang atau pemulihan harus dilakukan setelah ada perbaikan.

Skenario uji dari draf sebelumnya tetap relevan: consumer crash saat memproses, poison message yang masuk DLQ setelah tiga kali gagal, dan pemulihan relay setelah restart. Skenario ini perlu dijalankan ulang pada kode `main` yang sudah diperbarui sebelum dicantumkan sebagai hasil.

## Lampiran A: Uji Broker (RabbitMQ 4.1.8, lokal)

Uji ini dilakukan dengan antrean sementara `test.rel` dan `test.rel.dlq` yang dibuat khusus untuk pengujian, lalu dihapus setelah selesai. Antrean milik kelompok lain tidak disentuh.

Pada uji pertama, satu pesan dipublikasikan ke `test.rel` dan dibaca dengan mode reject tanpa requeue. Pesan itu kemudian muncul di `test.rel.dlq`, sehingga konfigurasi dead-letter bekerja sebagaimana dirancang.

Pada uji kedua, satu pesan persisten dipublikasikan ke antrean durable, lalu RabbitMQ di-restart dan status healthy-nya diperiksa sebelum membaca ulang. Pesan tetap tersedia setelah restart.

Uji ini hanya memverifikasi perilaku broker. Publisher confirms dan manual ack pada consumer belum diuji dan belum masuk ke pembuktian dokumen ini.
