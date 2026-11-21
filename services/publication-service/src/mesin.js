/**
 * Mesin status publikasi puisi (diagram 4.2 All Specifications).
 *
 *   [*]          -> PROCESSING    poem.submitted
 *   PROCESSING   -> PUBLISHED     poem.similarity.scored level original/inspired/similar
 *   PROCESSING   -> HELD          poem.similarity.scored level suspected_plagiarism
 *   PUBLISHED    -> REPROCESSING  poem.revised (versi lama tetap tampil)
 *   REPROCESSING -> PUBLISHED     skor versi baru di bawah dugaan jiplakan
 *   REPROCESSING -> HELD          skor versi baru dugaan jiplakan
 *   HELD         -> PUBLISHED     case.decided APPROVE / REJECT / RESTORE
 *   HELD         -> HIDDEN        case.decided HIDE / DELETE
 *   PUBLISHED    -> HIDDEN        case.decided HIDE / DELETE (laporan)
 *   HIDDEN       -> PUBLISHED     case.decided RESTORE (banding dikabulkan)
 *   apa pun      -> DELETED       poem.deleted (final)
 *
 * Fungsi di sini murni: tidak menyentuh database atau broker, sehingga setiap
 * transisi bisa diuji langsung. Penyimpanan dan outbox ada di handler.js.
 *
 * Satu-satunya jalan ke PUBLISHED adalah skor kemiripan atau keputusan
 * moderator atas puisi yang sudah pernah dinilai (HELD / HIDDEN), sehingga
 * puisi tidak pernah terbit sebelum skor kemiripan ada.
 */

export const STATUS = Object.freeze({
  PROCESSING: 'PROCESSING',
  REPROCESSING: 'REPROCESSING',
  PUBLISHED: 'PUBLISHED',
  HELD: 'HELD',
  HIDDEN: 'HIDDEN',
  DELETED: 'DELETED',
});

export const LEVEL_DITAHAN = 'suspected_plagiarism';
const LEVEL_TERBIT = new Set(['original', 'inspired', 'similar']);

/** Keputusan moderator (case.decided.decision) yang menerbitkan / menyembunyikan. */
const KEPUTUSAN_TERBIT = new Set(['APPROVE', 'REJECT', 'RESTORE']);
const KEPUTUSAN_SEMBUNYI = new Set(['HIDE', 'DELETE']);

/**
 * @typedef {object} Keadaan  satu baris tabel publication
 * @property {string} poem_id
 * @property {string|null} author_id
 * @property {string} status
 * @property {number} versi              versi terbaru yang diterima
 * @property {number|null} versi_tampil  versi yang sedang / terakhir tampil publik
 * @property {string|null} level_kemiripan
 * @property {number|null} skor_kemiripan
 * @property {string|null} case_id
 * @property {string|null} keputusan_at  ISO, case.decided terakhir
 * @property {number} [row_version]
 */

/**
 * @typedef {object} Keluaran  event yang harus diterbitkan lewat outbox
 * @property {'poem.published'|'poem.held'|'poem.hidden'} jenis
 * @property {number} versi            aggregate_version event keluar
 * @property {Record<string, unknown>} payload
 */

/**
 * @typedef {object} Putusan
 * @property {'ubah'|'abaikan'|'basi'|'tolak'|'tunda'} aksi
 *   ubah    : simpan keadaan baru (dan terbitkan keluaran bila ada)
 *   abaikan : tidak ada yang berubah, bukan galat (mis. puisi sudah dihapus)
 *   basi    : event lebih lama dari keadaan tersimpan
 *   tolak   : transisi tidak sah menurut diagram 4.2, dicatat di log
 *   tunda   : event datang lebih cepat dari event pendahulunya (mis. skor
 *             sebelum poem.submitted); dilempar ulang supaya di-retry
 * @property {string} alasan
 * @property {Keadaan} [keadaan]       keadaan baru bila aksi = 'ubah'
 * @property {Keluaran[]} [keluaran]
 */

const putus = (aksi, alasan, tambahan = {}) => ({ aksi, alasan, ...tambahan });

/**
 * Versi puisi yang dibawa event. poem.similarity.scored tidak punya field
 * versi di payload, jadi memakai aggregate_version amplop (aggregate_id =
 * poem_id, aggregate_version = versi puisi yang dinilai).
 */
export function versiDariEvent(event) {
  const p = event.payload ?? {};
  if (event.event_type === 'poem.deleted') return p.last_version ?? event.aggregate_version;
  if (Number.isInteger(p.version)) return p.version;
  return event.aggregate_version;
}

/** poem_id dari event; case.decided memakai aggregate_id = case_id, jadi ambil dari payload. */
export function poemIdDariEvent(event) {
  return event.payload?.poem_id ?? event.aggregate_id;
}

/**
 * Tentukan langkah berikutnya untuk satu event.
 *
 * @param {Keadaan|null} k   keadaan tersimpan (null bila puisi belum dikenal)
 * @param {import('@puisiapp/events').Event} event
 * @param {{ sekarang?: () => Date }} [opsi]
 * @returns {Putusan}
 */
export function putuskan(k, event, opsi = {}) {
  const sekarang = opsi.sekarang ?? (() => new Date());
  switch (event.event_type) {
    case 'poem.submitted':
      return diajukan(k, event);
    case 'poem.revised':
      return direvisi(k, event);
    case 'poem.similarity.scored':
      return dinilai(k, event, sekarang);
    case 'case.decided':
      return diputuskan(k, event, sekarang);
    case 'poem.deleted':
      return dihapus(k, event);
    default:
      return putus('abaikan', `event ${event.event_type} tidak ditangani`);
  }
}

function diajukan(k, event) {
  const p = event.payload;
  if (k?.status === STATUS.DELETED) return putus('abaikan', 'puisi sudah dihapus');
  if (k) return putus('abaikan', 'puisi sudah tercatat');
  return putus('ubah', 'puisi baru diproses', {
    keadaan: {
      poem_id: p.poem_id,
      author_id: p.author_id,
      status: STATUS.PROCESSING,
      versi: versiDariEvent(event),
      versi_tampil: null,
      level_kemiripan: null,
      skor_kemiripan: null,
      case_id: null,
      keputusan_at: null,
    },
  });
}

function direvisi(k, event) {
  const versi = versiDariEvent(event);
  if (!k) return putus('tunda', 'poem.revised tiba sebelum poem.submitted');
  if (k.status === STATUS.DELETED) return putus('abaikan', 'puisi sudah dihapus');
  if (versi <= k.versi) return putus('basi', `versi ${versi} tidak lebih baru dari ${k.versi}`);

  switch (k.status) {
    case STATUS.PUBLISHED:
      // Versi lama (versi_tampil) tetap tampil sampai versi baru dinilai.
      return putus('ubah', 'revisi puisi terbit diproses ulang', {
        keadaan: { ...k, status: STATUS.REPROCESSING, versi, level_kemiripan: null, skor_kemiripan: null },
      });
    case STATUS.PROCESSING:
    case STATUS.REPROCESSING:
      // Revisi sebelum versi sebelumnya selesai dinilai: tetap menunggu skor,
      // sekarang untuk versi terbaru. Skor versi lama nanti dianggap basi.
      return putus('ubah', 'revisi saat masih diproses', { keadaan: { ...k, versi } });
    default:
      // HELD / HIDDEN: status ditentukan moderator, bukan revisi penulis.
      return putus('tolak', `poem.revised tidak berlaku pada status ${k.status}`);
  }
}

function dinilai(k, event, sekarang) {
  const p = event.payload;
  const versi = versiDariEvent(event);
  if (!k) return putus('tunda', 'skor kemiripan tiba sebelum poem.submitted');
  if (k.status === STATUS.DELETED) return putus('abaikan', 'puisi sudah dihapus');
  if (versi < k.versi) return putus('basi', `skor untuk versi ${versi}, versi terbaru ${k.versi}`);
  if (versi > k.versi) return putus('tunda', `skor versi ${versi} tiba sebelum poem.revised`);
  if (k.status !== STATUS.PROCESSING && k.status !== STATUS.REPROCESSING) {
    // Skor ulang untuk versi yang sudah diputuskan (mis. worker dijalankan ulang).
    return putus('abaikan', `versi ${versi} sudah dinilai, status ${k.status}`);
  }

  const dasar = { ...k, level_kemiripan: p.level, skor_kemiripan: p.score };
  if (p.level === LEVEL_DITAHAN) {
    const pembanding = [...(p.comparisons ?? [])].sort((a, b) => b.score - a.score)[0];
    const reason = pembanding
      ? `Skor kemiripan ${p.score} dengan puisi ${pembanding.compared_poem_id}`
      : `Skor kemiripan ${p.score}`;
    return putus('ubah', 'dugaan jiplakan, puisi ditahan', {
      keadaan: { ...dasar, status: STATUS.HELD },
      keluaran: [{ jenis: 'poem.held', versi, payload: { similarity_level: LEVEL_DITAHAN, reason } }],
    });
  }
  if (LEVEL_TERBIT.has(p.level)) {
    return putus('ubah', `level ${p.level}, puisi terbit`, {
      keadaan: { ...dasar, status: STATUS.PUBLISHED, versi_tampil: versi },
      keluaran: [{ jenis: 'poem.published', versi, payload: { published_at: sekarang().toISOString() } }],
    });
  }
  return putus('tolak', `level kemiripan tidak dikenal: ${p.level}`);
}

function diputuskan(k, event, sekarang) {
  const p = event.payload;
  if (!k) return putus('tunda', 'case.decided untuk puisi yang belum tercatat');
  if (k.status === STATUS.DELETED) return putus('abaikan', 'puisi sudah dihapus');
  if (k.keputusan_at && new Date(p.decided_at) <= new Date(k.keputusan_at)) {
    return putus('basi', `keputusan ${p.decided_at} tidak lebih baru dari ${k.keputusan_at}`);
  }

  const catatan = { ...k, case_id: p.case_id, keputusan_at: p.decided_at };
  const terbit = KEPUTUSAN_TERBIT.has(p.decision);
  const sembunyi = KEPUTUSAN_SEMBUNYI.has(p.decision);

  const keHidden = () => {
    const versi = k.versi_tampil ?? k.versi;
    return putus('ubah', `keputusan ${p.decision}, puisi disembunyikan`, {
      keadaan: { ...catatan, status: STATUS.HIDDEN },
      keluaran: [{ jenis: 'poem.hidden', versi, payload: { reason: p.reason, hidden_at: p.decided_at } }],
    });
  };
  const kePublished = (versi) =>
    putus('ubah', `keputusan ${p.decision}, puisi terbit`, {
      keadaan: { ...catatan, status: STATUS.PUBLISHED, versi_tampil: versi },
      keluaran: [{ jenis: 'poem.published', versi, payload: { published_at: sekarang().toISOString() } }],
    });
  const tetap = () => putus('ubah', `keputusan ${p.decision} tidak mengubah status ${k.status}`, { keadaan: catatan });

  switch (k.status) {
    case STATUS.HELD:
      if (terbit) return kePublished(k.versi);
      if (sembunyi) return keHidden();
      break;
    case STATUS.PUBLISHED:
    case STATUS.REPROCESSING:
      if (sembunyi) return keHidden();
      if (terbit) return tetap();
      break;
    case STATUS.HIDDEN:
      if (p.decision === 'RESTORE') return kePublished(k.versi_tampil ?? k.versi);
      if (terbit || sembunyi) return tetap();
      break;
    default:
      // PROCESSING: belum ada skor, keputusan moderator belum berlaku.
      return putus('tolak', `case.decided tidak berlaku pada status ${k.status}`);
  }
  return putus('tolak', `keputusan tidak dikenal: ${p.decision}`);
}

function dihapus(k, event) {
  const p = event.payload;
  if (k?.status === STATUS.DELETED) return putus('abaikan', 'puisi sudah dihapus');
  // poem.deleted final: berlaku dari status apa pun, tanpa membandingkan versi.
  // Bila puisi belum tercatat, simpan tombstone supaya poem.submitted yang
  // terlambat tidak menghidupkannya lagi.
  const dasar = k ?? {
    poem_id: p.poem_id,
    author_id: p.author_id,
    versi: versiDariEvent(event),
    versi_tampil: null,
    level_kemiripan: null,
    skor_kemiripan: null,
    case_id: null,
    keputusan_at: null,
  };
  return putus('ubah', 'puisi dihapus', { keadaan: { ...dasar, status: STATUS.DELETED } });
}
