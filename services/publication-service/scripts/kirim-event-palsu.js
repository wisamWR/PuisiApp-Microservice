/**
 * Penerbit event palsu untuk pengujian selama kelompok 7 (similarity-worker,
 * T7.2) dan kelompok 8 (case-decision-service) belum siap.
 *
 *   node scripts/kirim-event-palsu.js skor <poem_id> <versi> <level> [skor]
 *   node scripts/kirim-event-palsu.js kasus <poem_id> <keputusan> [alasan]
 *
 *   level     : original | inspired | similar | suspected_plagiarism
 *   keputusan : APPROVE | REJECT | HIDE | DELETE | RESTORE
 *
 * Dari dalam container (alamat RabbitMQ dari environment layanan):
 *   docker compose exec publication-service node scripts/kirim-event-palsu.js skor <id> 1 original
 *
 * Bentuk amplop mengikuti asumsi publication-service: skor memakai
 * aggregate_id = poem_id dan aggregate_version = versi puisi yang dinilai;
 * case.decided memakai aggregate_id = case_id.
 */
import { randomUUID } from 'node:crypto';
import { buatEvent, buatPublisher, hubungkan } from '@puisiapp/events';

const [jenis, poemId, a, b, c] = process.argv.slice(2);
const pakai = () => {
  console.error('pakai: kirim-event-palsu.js skor <poem_id> <versi> <level> [skor]');
  console.error('       kirim-event-palsu.js kasus <poem_id> <keputusan> [alasan]');
  process.exit(2);
};
if (!poemId) pakai();

const SKOR_BAWAAN = { original: 0.05, inspired: 0.3, similar: 0.6, suspected_plagiarism: 0.9 };

let event;
if (jenis === 'skor') {
  const versi = Number(a);
  const level = b;
  if (!Number.isInteger(versi) || !(level in SKOR_BAWAAN)) pakai();
  const score = c != null ? Number(c) : SKOR_BAWAAN[level];
  event = buatEvent(
    'poem.similarity.scored',
    poemId,
    versi,
    { poem_id: poemId, score, level, comparisons: score > 0.2 ? [{ compared_poem_id: randomUUID(), score }] : [] },
    { producer: 'similarity-worker-palsu' },
  );
} else if (jenis === 'kasus') {
  const keputusan = a;
  if (!['APPROVE', 'REJECT', 'HIDE', 'DELETE', 'RESTORE'].includes(keputusan)) pakai();
  const caseId = randomUUID();
  event = buatEvent(
    'case.decided',
    caseId,
    1,
    {
      case_id: caseId,
      poem_id: poemId,
      moderator_id: 'moderator-palsu',
      decision: keputusan,
      reason: b ?? `Keputusan ${keputusan} (uji)`,
      decided_at: new Date().toISOString(),
    },
    { producer: 'case-decision-palsu' },
  );
} else {
  pakai();
}

const koneksi = await hubungkan({ keluarSaatPutus: false, log: { info() {}, warn() {}, error: console.error } });
const publisher = await buatPublisher(koneksi);
await publisher.terbitkan(event);
await publisher.tutup();
await koneksi.close();
console.log(JSON.stringify({ terbit: event.event_type, event_id: event.event_id, poem_id: poemId, payload: event.payload }));
