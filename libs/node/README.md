# @puisiapp/events (libs/node)

Pustaka event bersama untuk layanan Node.js PuisiApp. Semua layanan wajib memakai pustaka ini, bukan menulis koneksi RabbitMQ sendiri, supaya aturan amplop, idempotensi, retry, DLQ, dan tracing sama di semua layanan.

Versi Python ada di `libs/python` (T0.2, Sabila) dengan nama fungsi dan perilaku yang sama. Tabel [Kontrak lintas bahasa](#kontrak-lintas-bahasa) adalah acuannya.

## Pemasangan di layanan

```json
"dependencies": {
  "@puisiapp/events": "file:../../libs/node",
  "pg": "8.23.1"
}
```

Image Docker dibangun dari root repositori karena membutuhkan `contracts/` dan `libs/node/`. Contoh lengkap ada di `services/example-consumer` (Dockerfile, migrasi, konsumen, `/health`, graceful shutdown); salin folder itu sebagai titik awal.

## Variabel lingkungan

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `SERVICE_NAME` | ya | Nama layanan; mengisi `producer` dan nama koneksi RabbitMQ |
| `AMQP_URL` atau `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_USER`, `RABBITMQ_PASS`, `RABBITMQ_VHOST` | ya | Alamat RabbitMQ |
| `PREFETCH` | tidak | Jumlah pesan yang diambil sekaligus, default 10 |
| `LOG_LEVEL` | tidak | `debug`, `info` (default), `warn`, `error` |
| `CONTRACTS_DIR` | tidak | Lokasi folder `contracts`, default `<root-repo>/contracts` |

## Menerbitkan event

Layanan yang menulis data bisnis memakai Transactional Outbox (`simpanDenganOutbox`, T0.3), bukan publisher langsung. Publisher langsung dipakai worker tanpa outbox dan skrip.

```js
import { hubungkan, buatPublisher, buatEvent } from '@puisiapp/events';

const koneksi = await hubungkan();
const publisher = await buatPublisher(koneksi);

const event = buatEvent('poem.submitted', poemId, 1, { judul, isi }, {
  correlationId: req.headers['x-request-id'],   // dari gateway
  traceparent: req.headers.traceparent,
});
await publisher.terbitkan(event);  // selesai setelah publisher confirm dari broker
```

- Exchange dipilih dari `contracts/routing.json`; routing key = `event_type`. Event yang tidak terdaftar ditolak.
- Setiap event divalidasi terhadap `contracts/envelope.v1.json` sebelum diterbitkan.
- `correlation_id` dan `traceparent` ikut di header AMQP.

Worker yang menerbitkan hasil dari event masukan memakai `eventTurunan` supaya `event_id` deterministik (diterbitkan ulang = id sama = dikenali sebagai duplikat di hilir):

```js
const hasil = eventTurunan(eventMasuk, 'poem.emotion.analyzed', { baris, skor });
await publisher.terbitkan(hasil);
```

## Menerbitkan event dari layanan yang menulis data (Transactional Outbox)

Data bisnis dan event ditulis dalam satu transaksi; outbox-relay (Debezium) yang menerbitkannya ke RabbitMQ.

```js
import { jalankanMigrasi, simpanDenganOutbox, buatEvent } from '@puisiapp/events';

await jalankanMigrasi(pool, { folder: './migrations', outbox: true });

const { poemId } = await simpanDenganOutbox(pool, async (tx) => {
  await tx.query('INSERT INTO submission (poem_id, ...) VALUES ($1, ...)', [poemId, ...]);
  return {
    hasil: { poemId },
    event: buatEvent('poem.submitted', poemId, 1, { ... }, { correlationId: req.headers['x-request-id'] }),
  };
});
// balas 202 Accepted
```

- Event divalidasi dan dicek di `routing.json` sebelum commit; bila gagal, data bisnis ikut di-rollback.
- Database perlu tabel outbox, publication, dan slot dari skrip init (`infra/postgres/init/_outbox.psql`) serta container relay. Lihat [docs/adr/outbox-relay.md](../../docs/adr/outbox-relay.md).
- Mode Debezium tidak menghapus baris outbox. Jalankan `bersihkanOutbox(pool)` secara berkala.

## Mengonsumsi event

```js
import pg from 'pg';
import { hubungkan, buatKonsumen, buatStorePg, jalankanMigrasi, GalatPermanen } from '@puisiapp/events';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await jalankanMigrasi(pool, { folder: './migrations' }); // + tabel standar processed_event

await buatKonsumen({
  koneksi: await hubungkan(),
  antrean: 'q.poem-query',
  ikatan: ['poem.submitted', 'poem.published'],
  store: buatStorePg(pool),
  versiTersimpan: async (event, { tx }) =>
    (await tx.query('SELECT versi FROM puisi WHERE poem_id = $1', [event.aggregate_id])).rows[0]?.versi,
  handler: async (event, { tx, log }) => {
    if (!event.payload.judul) throw new GalatPermanen('judul kosong'); // langsung DLQ
    await tx.query('INSERT ... WHERE puisi.versi <= EXCLUDED.versi', [...]);
  },
});
```

Yang dijamin pustaka:

| Aturan | Cara |
| --- | --- |
| Event yang sama hanya diproses sekali | `event_id` dicatat di `processed_event` dalam transaksi yang sama dengan `handler` |
| Event basi diabaikan | bila `versiTersimpan > aggregate_version`, `handler` tidak dipanggil dan log `warn` "event basi diabaikan" ditulis |
| Event satu agregat tidak saling balap | `pg_advisory_xact_lock` per `aggregate_id`; agregat lain tetap paralel |
| Galat sementara dicoba ulang | exchange `retry.delayed`, jeda acak sampai 2, 8, lalu 32 detik (full jitter) |
| Gagal permanen atau percobaan habis masuk DLQ | `q.<layanan>.dlq`; `GalatPermanen` dan amplop tidak valid tidak dicoba ulang |
| Worker crash berulang tetap berakhir di DLQ | quorum queue `x-delivery-limit: 5` |
| Backpressure | `prefetch` kecil, dapat diatur lewat `PREFETCH` |

Topologi (`q.<layanan>`, `q.<layanan>.dlq`, `dlx`, `retry.delayed`, exchange domain, dan binding) dibuat otomatis saat konsumen start.

Tetap tulis penjaga versi di kueri (`WHERE versi <= EXCLUDED.versi`) sebagai lapis kedua.

Layanan yang state-nya di Redis atau MongoDB boleh memberikan `store` sendiri dengan kontrak `proses(event, fn) -> 'diproses' | 'duplikat' | 'basi'`. Worker tanpa state memakai `buatStoreTanpaDb()`.

## API

| Fungsi | Keterangan |
| --- | --- |
| `buatEvent(eventType, aggregateId, aggregateVersion, payload, opsi?)` | Amplop baru; `opsi`: `correlationId`, `causationId`, `traceparent`, `eventId`, `schemaVersion`, `producer`, `occurredAt` |
| `eventTurunan(sumber, eventType, payload, opsi?)` | Amplop hasil dengan id deterministik, mewarisi correlation dan traceparent |
| `validasiEvent(event)` | Lempar `GalatPermanen` bila tidak sesuai `envelope.v1.json` |
| `exchangeUntuk(eventType)` | Nama exchange dari `routing.json` |
| `hubungkan(opsi?)` | Koneksi RabbitMQ; proses keluar (kode 1) bila koneksi putus agar Docker menyalakan ulang |
| `buatPublisher(koneksi)` | `{ terbitkan(event), tutup() }` dengan publisher confirm |
| `buatKonsumen(opsi)` | Mulai konsumsi; mengembalikan `{ berhenti() }` untuk graceful shutdown |
| `buatStorePg(pool)`, `buatStoreTanpaDb()` | Store idempotensi |
| `jalankanMigrasi(pool, { folder, outbox? })` | Migrasi SQL berurutan dengan advisory lock; `outbox: true` menambah tabel outbox standar |
| `simpanDenganOutbox(pool, fn)`, `tulisOutbox(tx, event)` | Transactional Outbox |
| `jalankanRelayPolling({ pool, koneksi })`, `bersihkanOutbox(pool)` | Relay cadangan dan pembersihan outbox |
| `pasangTopologiBersama(ch)` | Exchange domain, `outbox.relay`, binding dari `routing.json` (dipakai `bin/pasang-topologi.js`) |
| `buatLogger(service?, konteks?)` | Logger JSON (`ts`, `level`, `service`, `msg`, `correlation_id`, `event_id`, `trace_id`) |
| `GalatPermanen` | Galat yang langsung dikirim ke DLQ |

## Kontrak lintas bahasa

Pustaka Python wajib menghasilkan perilaku yang sama:

| Hal | Nilai |
| --- | --- |
| Nama fungsi | `buat_event`, `event_turunan`, `validasi_event`, `exchange_untuk`, `buat_publisher`, `buat_konsumen`, `GalatPermanen` |
| Amplop | `contracts/envelope.v1.json`, `additionalProperties: false`, `causation_id` `null` bila tidak ada |
| `event_id` turunan | `uuid5(namespace=UUID(event_id_sumber), name=f"{producer}:{event_type}")` |
| Header AMQP | `correlation_id`, `traceparent`, `x-percobaan` (jumlah retry), `x-delay` (ms); `message_id = event_id`, `content_type = application/json` |
| Retry | `x-percobaan` 0, 1, 2 dijadwalkan ulang dengan jeda `random() * 2000 * 4^n` ms; percobaan ke-3 yang gagal masuk DLQ |
| Queue | quorum, `x-dead-letter-exchange: dlx`, `x-dead-letter-routing-key: q.<layanan>.dlq`, `x-delivery-limit: 5`, binding `retry.delayed` dengan routing key = nama queue |
| Event basi | diabaikan bila versi tersimpan **lebih besar** dari `aggregate_version` (versi sama tetap diproses) |

## Pengujian

```bash
npm test
```

Uji integrasi dengan RabbitMQ dan PostgreSQL asli memakai `services/example-consumer`:

```bash
docker compose --profile contoh up -d --build
```

```bash
docker compose exec example-consumer node scripts/kirim-contoh.js
```

Skrip menerbitkan skenario normal, duplikat, basi, gagal sementara (3 kali retry lalu DLQ), dan gagal permanen (langsung DLQ). Hasilnya terlihat di log `example-consumer`, tabel `contoh_puisi` di `example_db`, dan queue `q.example.dlq` di RabbitMQ UI.
