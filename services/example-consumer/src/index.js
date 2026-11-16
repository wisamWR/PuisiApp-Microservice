/**
 * example-consumer: contoh layanan konsumen (T0.2).
 *
 * Mengonsumsi poem.submitted dan poem.revised dari queue q.example lalu
 * menyimpan versi terakhir setiap puisi ke tabel contoh_puisi. Pola ini
 * (migrasi -> koneksi -> konsumen -> /health -> graceful shutdown) bisa
 * disalin untuk layanan Node.js lain.
 *
 * Untuk menguji retry dan DLQ, payload boleh berisi
 *   simulasi_gagal: "sementara" | "permanen"
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  buatLogger,
  buatKonsumen,
  buatStorePg,
  GalatPermanen,
  hubungkan,
  jalankanMigrasi,
} from '@puisiapp/events';

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// outbox: true -> tabel outbox standar + publication outbox_pub (T0.3)
await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: true, log });
const koneksi = await hubungkan({ log });

const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.example',
  ikatan: ['poem.submitted', 'poem.revised'],
  store: buatStorePg(pool),
  jedaDasarMs: Number(process.env.RETRY_DASAR_MS) || undefined,

  // Versi yang sudah tersimpan; event dengan versi lebih lama diabaikan.
  versiTersimpan: async (event, { tx }) => {
    const { rows } = await tx.query('SELECT versi FROM contoh_puisi WHERE poem_id = $1 FOR UPDATE', [
      event.aggregate_id,
    ]);
    return rows[0]?.versi;
  },

  handler: async (event, { tx, log: logEvent, percobaan }) => {
    const simulasi = event.payload.simulasi_gagal;
    if (simulasi === 'permanen') throw new GalatPermanen('simulasi galat permanen');
    if (simulasi === 'sementara') throw new Error(`simulasi galat sementara (percobaan ${percobaan})`);

    await tx.query(
      `INSERT INTO contoh_puisi (poem_id, versi, judul) VALUES ($1, $2, $3)
       ON CONFLICT (poem_id) DO UPDATE
         SET versi = EXCLUDED.versi,
             judul = EXCLUDED.judul,
             jumlah_diproses = contoh_puisi.jumlah_diproses + 1,
             diperbarui_at = now()
       -- Lapis kedua: jangan pernah menimpa dengan versi lebih lama.
       WHERE contoh_puisi.versi <= EXCLUDED.versi`,
      [event.aggregate_id, event.aggregate_version, event.payload.judul ?? null],
    );
    logEvent.info('puisi contoh disimpan');
  },
});

// ------------------------------------------------------------------ /health
const port = Number(process.env.PORT ?? 8080);
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: process.env.SERVICE_NAME }));
    return;
  }
  res.writeHead(404).end();
});
server.listen(port, () => log.info('http siap', { port }));

// ------------------------------------------------------------------ graceful shutdown
let berhenti = false;
async function matikan(sinyal) {
  if (berhenti) return;
  berhenti = true;
  log.info('menerima sinyal, berhenti', { sinyal });
  server.close();
  await konsumen.berhenti().catch((err) => log.error('gagal menghentikan konsumen', { err }));
  await koneksi.close().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => matikan('SIGTERM'));
process.on('SIGINT', () => matikan('SIGINT'));
