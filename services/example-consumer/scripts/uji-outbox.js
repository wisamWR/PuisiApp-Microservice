/**
 * Uji outbox-relay (T0.3) dari dalam container example-consumer.
 *
 *   node scripts/uji-outbox.js
 *     Tulis satu event per jenis ke outbox example_db lewat simpanDenganOutbox,
 *     lalu ukur waktu sampai event tiba di exchange domain yang benar.
 *     Juga menulis satu event yang tidak terdaftar di routing.json langsung
 *     dengan SQL dan memastikan event itu tertampung di q.outbox.unrouted.
 *
 *   node scripts/uji-outbox.js --tulis-saja 5
 *     Hanya menulis 5 poem.submitted ke outbox (dipakai saat RabbitMQ dimatikan).
 *
 * Kode keluar 1 bila ada event yang tidak tiba, salah exchange, atau > 2 detik.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  ANTREAN_TAK_TERUTE,
  buatEvent,
  exchangeUntuk,
  hubungkan,
  simpanDenganOutbox,
} from '@puisiapp/events';

const BATAS_MS = 2000;
const opsiEvent = { producer: 'uji-outbox' };
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

// ------------------------------------------------------------------ mode tulis saja
const idx = process.argv.indexOf('--tulis-saja');
if (idx !== -1) {
  const n = Number(process.argv[idx + 1] ?? 5);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `outbox-${randomUUID().slice(0, 8)}`;
    await simpanDenganOutbox(pool, async () => buatEvent('poem.submitted', id, 1, { judul: `uji ${i + 1}` }, opsiEvent));
    ids.push(id);
  }
  console.log(JSON.stringify({ ditulis: ids }));
  await pool.end();
  process.exit(0);
}

// ------------------------------------------------------------------ mode uji penuh
const jenis = ['poem.submitted', 'report.created', 'case.decided', 'appeal.filed', 'user.registered'];
const koneksi = await hubungkan({ keluarSaatPutus: false });
const ch = await koneksi.createChannel();

const tiba = new Map(); // event_id -> { exchange, ms }
const mulai = new Map(); // event_id -> performance.now() sebelum commit

// Satu queue sementara per exchange domain, hanya terikat ke event jenis uji.
const perExchange = new Map();
for (const t of jenis) perExchange.set(exchangeUntuk(t), [...(perExchange.get(exchangeUntuk(t)) ?? []), t]);
for (const [exchange, daftar] of perExchange) {
  const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
  for (const t of daftar) await ch.bindQueue(queue, exchange, t);
  await ch.consume(queue, (pesan) => {
    const event = JSON.parse(pesan.content.toString());
    if (mulai.has(event.event_id)) {
      tiba.set(event.event_id, { exchange, ms: Math.round(performance.now() - mulai.get(event.event_id)) });
    }
    ch.ack(pesan);
  });
}

const sebelumTakTerute = (await ch.checkQueue(ANTREAN_TAK_TERUTE)).messageCount;

const dikirim = [];
for (const t of jenis) {
  const event = buatEvent(t, `uji-${randomUUID().slice(0, 8)}`, 1, { uji: true }, opsiEvent);
  mulai.set(event.event_id, performance.now());
  await simpanDenganOutbox(pool, async () => event);
  dikirim.push(event);
}

// Event tidak terdaftar: pustaka menolaknya, jadi ditulis langsung dengan SQL
// untuk mensimulasikan penulisan outbox yang salah.
const takTerdaftar = { ...buatEvent('poem.submitted', 'uji-tak-terdaftar', 1, {}, opsiEvent), event_type: 'uji.tidak_terdaftar' };
await pool.query(
  `INSERT INTO outbox (event_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, 'uji', $2, $3, $4)`,
  [takTerdaftar.event_id, takTerdaftar.aggregate_id, takTerdaftar.event_type, takTerdaftar],
);

const batasWaktu = Date.now() + 10_000;
while (tiba.size < dikirim.length && Date.now() < batasWaktu) await new Promise((r) => setTimeout(r, 50));
await new Promise((r) => setTimeout(r, 1000));
const sesudahTakTerute = (await ch.checkQueue(ANTREAN_TAK_TERUTE)).messageCount;

let gagal = false;
const hasil = dikirim.map((e) => {
  const t = tiba.get(e.event_id);
  const harapan = exchangeUntuk(e.event_type);
  const ok = Boolean(t) && t.exchange === harapan && t.ms < BATAS_MS;
  if (!ok) gagal = true;
  return { event_type: e.event_type, exchange_harapan: harapan, exchange_tiba: t?.exchange ?? '-', latensi_ms: t?.ms ?? '-', ok };
});
console.table(hasil);

const takTeruteOk = sesudahTakTerute === sebelumTakTerute + 1;
if (!takTeruteOk) gagal = true;
console.log(`q.outbox.unrouted: ${sebelumTakTerute} -> ${sesudahTakTerute} (${takTeruteOk ? 'ok' : 'GAGAL'})`);

await ch.close();
await koneksi.close();
await pool.end();
process.exit(gagal ? 1 : 0);
