import { randomUUID } from 'node:crypto';

export const PENULIS = 'u-penulis';
export const PELAPOR = 'u-pelapor';

export function amplop(eventType, aggregateId, aggregateVersion, payload, occurredAt = new Date().toISOString()) {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    schema_version: 1,
    occurred_at: occurredAt,
    producer: 'uji',
    correlation_id: randomUUID(),
    causation_id: null,
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
    payload,
  };
}

const isi = (id, v, judul) => ({
  poem_id: id, version: v, author_id: PENULIS, title: judul, body: 'a\nb', quote_stanza: 0, quote_text: 'a', template_id: 'latar1',
});

export const e = {
  diajukan: (id, judul = 'Jendela yang Basah') => amplop('poem.submitted', id, 1, { ...isi(id, 1, judul), submitted_at: new Date().toISOString() }),
  direvisi: (id, v, judul = 'Jendela yang Basah (revisi)') => amplop('poem.revised', id, v, { ...isi(id, v, judul), revised_at: new Date().toISOString() }),
  terbit: (id, v = 1, t) => amplop('poem.published', id, v, { published_at: t ?? new Date().toISOString() }, t),
  ditahan: (id, v = 1, t) => amplop('poem.held', id, v, { similarity_level: 'suspected_plagiarism', reason: 'Skor kemiripan 0.91 dengan puisi p-lain' }, t),
  disembunyikan: (id, v = 1, t) => amplop('poem.hidden', id, v, { reason: 'Menjiplak karya lain', hidden_at: t ?? new Date().toISOString() }, t),
  dihapus: (id) => amplop('poem.deleted', id, 1, { poem_id: id, author_id: PENULIS, last_version: 1, deleted_at: new Date().toISOString() }),
  selesai: (id, v = 1) => amplop('poem.processing.completed', id, v, { poem_id: id, completed_at: new Date().toISOString(), status: 'COMPLETED' }),
  dilaporkan: (id, reportId = randomUUID(), pelapor = PELAPOR) =>
    amplop('report.created', reportId, 1, { report_id: reportId, poem_id: id, reporter_id: pelapor, reason: 'Dugaan menjiplak', created_at: new Date().toISOString() }),
  kasusDibuka: (id, caseId, reportId) =>
    amplop('case.opened', caseId, 1, { case_id: caseId, report_id: reportId, poem_id: id, status: 'OPEN', opened_at: new Date().toISOString() }),
  diputuskan: (id, caseId, decision) =>
    amplop('case.decided', caseId, 1, { case_id: caseId, poem_id: id, moderator_id: 'mod-1', decision, reason: 'Sudah ditinjau', decided_at: new Date().toISOString() }),
  banding: (caseId, user = PENULIS) =>
    amplop('appeal.filed', randomUUID(), 1, { appeal_id: randomUUID(), case_id: caseId, user_id: user, reason: 'Ini karya asli saya', filed_at: new Date().toISOString() }),
};

export const diam = { debug() {}, info() {}, warn() {}, error() {}, anak() { return diam; } };
