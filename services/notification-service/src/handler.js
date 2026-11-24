/**
 * Handler q.notification: salin data yang diperlukan untuk menentukan
 * penerima, lalu tulis notifikasi. Semua di dalam transaksi store
 * (processed_event), dan notifikasi memakai id deterministik + UNIQUE
 * (event_id, penerima_id), sehingga event yang dikirim ulang tidak pernah
 * menghasilkan notifikasi ganda.
 *
 * Penerima:
 *   poem.published / held / hidden, poem.processing.completed -> penulis
 *   report.created  -> penulis terlapor dan pelapor
 *   case.decided    -> pelapor; penulis hanya bila status puisi tidak berubah
 *                      (laporan ditolak). Perubahan status dikabarkan lewat
 *                      poem.published / poem.hidden yang menyusul, supaya penulis
 *                      tidak menerima dua notifikasi untuk satu keputusan.
 *   appeal.filed    -> pengaju banding
 */
import { GalatPermanen, uuidv5 } from '@puisiapp/events';
import * as kalimat from './pesan.js';

export const IKATAN = [
  'poem.submitted', 'poem.revised', 'poem.deleted',
  'poem.published', 'poem.held', 'poem.hidden', 'poem.processing.completed',
  'report.created', 'case.opened', 'case.decided', 'appeal.filed',
];

/** Namespace UUIDv5 id notifikasi. */
export const NAMESPACE_NOTIFIKASI = '9b2f4c1e-3d7a-5e8b-a6c4-1f0d2e3b4a59';

export class GalatTunda extends Error {
  constructor(alasan) {
    super(`event ditunda: ${alasan}`);
    this.name = 'GalatTunda';
  }
}

const STATUS = { 'poem.published': 'PUBLISHED', 'poem.held': 'HELD', 'poem.hidden': 'HIDDEN' };
const KEPUTUSAN_TETAP = new Set(['APPROVE', 'REJECT']);

async function ambilPuisi(tx, poemId) {
  const { rows } = await tx.query('SELECT * FROM puisi WHERE poem_id = $1', [poemId]);
  return rows[0] ?? null;
}

/** Puisi yang sudah diketahui pemiliknya; bila belum (poem.submitted belum tiba), event di-retry. */
async function wajibPuisi(tx, poemId) {
  const puisi = await ambilPuisi(tx, poemId);
  if (!puisi?.author_id) throw new GalatTunda(`puisi ${poemId} belum tercatat`);
  return puisi;
}

/** @param {{ penerima: string, poemId?: string|null, jenis: string, judul: string, pesan: string }} n */
async function kirim(tx, event, n) {
  if (!n.penerima) return;
  const { rowCount } = await tx.query(
    `INSERT INTO notifikasi (id, event_id, penerima_id, jenis, judul, pesan, poem_id, tautan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (event_id, penerima_id) DO NOTHING`,
    [
      uuidv5(`${event.event_id}:${n.penerima}`, NAMESPACE_NOTIFIKASI),
      event.event_id,
      n.penerima,
      n.jenis,
      n.judul,
      n.pesan,
      n.poemId ?? null,
      n.poemId ? `/poems/${n.poemId}` : null,
    ],
  );
  return rowCount;
}

export function buatHandler() {
  return async function tangani(event, { tx }) {
    const p = event.payload ?? {};
    const poemId = p.poem_id ?? (event.event_type.startsWith('poem.') ? event.aggregate_id : null);

    switch (event.event_type) {
      case 'poem.submitted':
      case 'poem.revised': {
        const versi = Number.isInteger(p.version) ? p.version : event.aggregate_version;
        // status_at hanya diisi event keputusan publikasi (published / held / hidden /
        // deleted). Waktu submit bukan keputusan, jadi tidak dipakai untuk menilai
        // event status yang tertunda sebagai basi.
        await tx.query(
          `INSERT INTO puisi (poem_id, author_id, judul, versi, status)
           VALUES ($1, $2, $3, $4, 'PROCESSING')
           ON CONFLICT (poem_id) DO UPDATE
             SET author_id = COALESCE(puisi.author_id, EXCLUDED.author_id),
                 judul = CASE WHEN EXCLUDED.versi >= puisi.versi THEN EXCLUDED.judul ELSE puisi.judul END,
                 versi = GREATEST(puisi.versi, EXCLUDED.versi),
                 status = COALESCE(puisi.status, EXCLUDED.status)`,
          [poemId, p.author_id, p.title, versi],
        );
        return;
      }

      case 'poem.deleted':
        await tx.query(
          `INSERT INTO puisi (poem_id, author_id, status, status_at) VALUES ($1, $2, 'DELETED', $3)
           ON CONFLICT (poem_id) DO UPDATE SET status = 'DELETED', status_at = EXCLUDED.status_at`,
          [poemId, p.author_id ?? null, event.occurred_at],
        );
        return;

      case 'poem.published':
      case 'poem.held':
      case 'poem.hidden': {
        const puisi = await wajibPuisi(tx, poemId);
        if (puisi.status === 'DELETED') return;
        if (puisi.status_at && new Date(puisi.status_at) > new Date(event.occurred_at)) return; // event basi
        await tx.query('UPDATE puisi SET status = $2, status_at = $3 WHERE poem_id = $1', [poemId, STATUS[event.event_type], event.occurred_at]);
        const n =
          event.event_type === 'poem.published'
            ? kalimat.terbit({ judul: puisi.judul, versi: event.aggregate_version, statusSebelum: puisi.status })
            : event.event_type === 'poem.held'
              ? kalimat.ditahan({ judul: puisi.judul, alasan: p.reason })
              : kalimat.disembunyikan({ judul: puisi.judul, alasan: p.reason });
        await kirim(tx, event, { ...n, penerima: puisi.author_id, poemId });
        return;
      }

      case 'poem.processing.completed': {
        const puisi = await wajibPuisi(tx, poemId);
        if (puisi.status === 'DELETED' || event.aggregate_version < puisi.versi) return; // versi lama
        await kirim(tx, event, { ...kalimat.prosesSelesai({ judul: puisi.judul }), penerima: puisi.author_id, poemId });
        return;
      }

      case 'report.created': {
        const puisi = await wajibPuisi(tx, poemId);
        await tx.query(
          `INSERT INTO laporan (report_id, poem_id, reporter_id) VALUES ($1, $2, $3) ON CONFLICT (report_id) DO NOTHING`,
          [p.report_id, poemId, p.reporter_id],
        );
        if (p.reporter_id !== puisi.author_id) {
          await kirim(tx, event, { ...kalimat.dilaporkan({ judul: puisi.judul, alasan: p.reason }), penerima: puisi.author_id, poemId });
        }
        await kirim(tx, event, { ...kalimat.laporanDiterima({ judul: puisi.judul }), penerima: p.reporter_id, poemId });
        return;
      }

      case 'case.opened':
        await tx.query(
          `INSERT INTO kasus (case_id, report_id, poem_id) VALUES ($1, $2, $3)
           ON CONFLICT (case_id) DO UPDATE SET report_id = COALESCE(kasus.report_id, EXCLUDED.report_id)`,
          [p.case_id, p.report_id ?? null, poemId],
        );
        return;

      case 'case.decided': {
        await tx.query(
          `INSERT INTO kasus (case_id, poem_id) VALUES ($1, $2) ON CONFLICT (case_id) DO NOTHING`,
          [p.case_id, poemId],
        );
        const puisi = await ambilPuisi(tx, poemId);
        const { rows: pelapor } = await tx.query(
          `SELECT DISTINCT l.reporter_id FROM kasus k JOIN laporan l ON l.report_id = k.report_id WHERE k.case_id = $1`,
          [p.case_id],
        );
        for (const { reporter_id: penerima } of pelapor) {
          await kirim(tx, event, {
            ...kalimat.keputusanUntukPelapor({ judul: puisi?.judul, keputusan: p.decision, alasan: p.reason }),
            penerima,
            poemId,
          });
        }
        if (puisi?.author_id && puisi.status === 'PUBLISHED' && KEPUTUSAN_TETAP.has(p.decision)) {
          await kirim(tx, event, {
            ...kalimat.laporanDitolakUntukPenulis({ judul: puisi.judul, alasan: p.reason }),
            penerima: puisi.author_id,
            poemId,
          });
        }
        return;
      }

      case 'appeal.filed': {
        const { rows } = await tx.query(
          `SELECT k.poem_id, pu.judul FROM kasus k LEFT JOIN puisi pu ON pu.poem_id = k.poem_id WHERE k.case_id = $1`,
          [p.case_id],
        );
        if (!p.user_id) throw new GalatPermanen('appeal.filed tanpa user_id');
        await kirim(tx, event, {
          ...kalimat.bandingDiterima({ judul: rows[0]?.judul }),
          penerima: p.user_id,
          poemId: rows[0]?.poem_id ?? null,
        });
        return;
      }

      default:
        return;
    }
  };
}
