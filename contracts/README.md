# Event Contracts

Dokumentasi kontrak event untuk komunikasi asynchronous antar-service PuisiApp.

## 1. Struktur

- `envelope.v1.json`: kontrak amplop event bersama.
- `events/`: JSON Schema untuk payload setiap event.
- `routing.json`: pemetaan event_type ke topic exchange RabbitMQ.

## 2. Format Event

Setiap event menggunakan envelope bersama yang didefinisikan dalam `envelope.v1.json`.

Validasi payload dilakukan menggunakan schema berdasarkan nama event:
`contracts/events/{event_type}.v1.json`.

Contoh:
- `poem.submitted` → `events/poem.submitted.v1.json`
- `comment.created` → `events/comment.created.v1.json`

## 3. Routing

`routing.json` merupakan sumber pemetaan event ke domain exchange.

Routing key menggunakan nilai `event_type`. Event yang tidak terdaftar tidak boleh diterbitkan melalui outbox relay.

Domain exchange yang digunakan:
- `identity.events`
- `poem.events`
- `analysis.events`
- `processing.events`
- `vote.events`
- `moderation.events`
- `community.events`

## 4. Validasi

Jalankan dari root repository:

```powershell
node .\tools\validate-event\index.js poem.submitted .\poem-submitted-test.json
```

Ganti `poem.submitted` dan file JSON sesuai event yang ingin diuji.

Payload harus sesuai dengan schema event. Properti tambahan yang tidak didefinisikan akan ditolak.

## 5. Mock Server

Mock server menggunakan Prism dan OpenAPI.

Jalankan dari root repository:

```powershell
cd .\libs\node
npx prism mock ..\..\contracts\openapi\comment-service.yaml --host 127.0.0.1 --port 4010
```

Mock server tersedia di `http://127.0.0.1:4010`.

## 6. Aturan Perubahan Kontrak

1. Perubahan kompatibel dapat dilakukan pada versi kontrak yang sama.
2. Perubahan breaking wajib menggunakan versi baru, misalnya v2.
3. Perubahan breaking harus mendapat persetujuan pemilik kelompok consumer terkait.
4. Schema event dan dokumentasi harus diperbarui bersama.
5. Contoh payload harus diuji menggunakan validator sebelum perubahan digabungkan.

## 7. Kepemilikan

Kontrak event dan routing dikelola melalui proses koordinasi producer dan consumer. Setiap producer bertanggung jawab menjaga payload tetap sesuai schema yang disepakati.
