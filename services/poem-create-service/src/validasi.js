/**
 * Validasi dan pembersihan pengajuan puisi (fungsi murni, tanpa I/O).
 *
 * Aturan (laporan 11.4 dan T2.1):
 *   - judul 1..150 karakter, satu baris
 *   - isi 1..8.000 karakter, minimal satu baris berisi
 *   - bait dipisah satu baris kosong; quote_stanza = indeks bait (berbasis 0)
 *   - bait kutipan maksimal 280 karakter dan harus ada
 *   - template dari daftar yang sah
 *   - semua tag HTML dibuang, isi <script>/<style> ikut dibuang
 *   - kategori dan kata kunci manual (Tugas 1) opsional
 */
import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';

export const BATAS = Object.freeze({
  judul: 150,
  isi: 8000,
  baitKutipan: 280,
  kategori: 60,
  jumlahKataKunci: 10,
  kataKunci: 40,
});

export const POLA_IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

const OPSI_SANITASI = {
  allowedTags: [],
  allowedAttributes: {},
  // Isi elemen ini dibuang seluruhnya, bukan hanya tag-nya.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'template'],
};

/** sanitize-html meng-escape teks; kembalikan ke teks biasa (frontend meng-escape saat render). */
function kembalikanEntitas(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Buang semua HTML. Diulang sampai stabil, supaya teks seperti
 * "&lt;script&gt;" yang berubah menjadi "<script>" setelah dikembalikan
 * ikut dibuang pada putaran berikutnya.
 * @param {string} teks
 */
export function buangHtml(teks) {
  let sekarang = teks;
  for (let i = 0; i < 5; i++) {
    const bersih = kembalikanEntitas(sanitizeHtml(sekarang, OPSI_SANITASI));
    if (bersih === sekarang) break;
    sekarang = bersih;
  }
  return sekarang;
}

/** Normalisasi isi puisi: NFC, newline \n, tanpa spasi di akhir baris, baris kosong berlebih dirapikan. */
export function normalisasiIsi(teks) {
  return teks
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n')
    .map((baris) => baris.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Pecah isi menjadi bait: dipisah minimal satu baris kosong. */
export function pecahBait(isi) {
  return isi
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

const panjang = (s) => [...s].length; // hitung code point, bukan unit UTF-16

/**
 * @param {unknown} masukan body permintaan (hasil JSON.parse)
 * @param {{ templateSah: string[] }} opsi
 * @returns {{ ok: true, data: object } | { ok: false, rincian: { field: string, pesan: string }[] }}
 */
export function validasiPengajuan(masukan, opsi) {
  const rincian = [];
  const galat = (field, pesan) => rincian.push({ field, pesan });

  if (!masukan || typeof masukan !== 'object' || Array.isArray(masukan)) {
    return { ok: false, rincian: [{ field: '(body)', pesan: 'Body harus objek JSON' }] };
  }
  const m = /** @type {Record<string, unknown>} */ (masukan);

  const dikenal = new Set(['title', 'body', 'quote_stanza', 'template_id', 'category', 'keywords']);
  for (const k of Object.keys(m)) if (!dikenal.has(k)) galat(k, 'Field tidak dikenal');

  // ---- judul
  let judul = '';
  if (typeof m.title !== 'string') galat('title', 'Judul wajib diisi');
  else {
    judul = buangHtml(m.title).normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (!judul) galat('title', 'Judul wajib diisi');
    else if (panjang(judul) > BATAS.judul) galat('title', `Judul maksimal ${BATAS.judul} karakter`);
  }

  // ---- isi
  let isi = '';
  let bait = [];
  if (typeof m.body !== 'string') galat('body', 'Isi puisi wajib diisi');
  else {
    isi = normalisasiIsi(buangHtml(m.body));
    bait = pecahBait(isi);
    if (bait.length === 0) galat('body', 'Isi puisi minimal satu baris');
    else if (panjang(isi) > BATAS.isi) galat('body', `Isi puisi maksimal ${BATAS.isi} karakter`);
  }

  // ---- bait kutipan
  let indeksBait = -1;
  let baitKutipan = '';
  if (!Number.isInteger(m.quote_stanza) || /** @type {number} */ (m.quote_stanza) < 0) {
    galat('quote_stanza', 'Bait kutipan wajib dipilih (indeks bait, mulai dari 0)');
  } else if (bait.length > 0) {
    indeksBait = /** @type {number} */ (m.quote_stanza);
    if (indeksBait >= bait.length) {
      galat('quote_stanza', `Bait kutipan tidak ada: puisi hanya punya ${bait.length} bait`);
    } else {
      baitKutipan = bait[indeksBait];
      if (panjang(baitKutipan) > BATAS.baitKutipan) {
        galat('quote_stanza', `Bait kutipan maksimal ${BATAS.baitKutipan} karakter`);
      }
    }
  }

  // ---- template
  if (typeof m.template_id !== 'string' || !opsi.templateSah.includes(m.template_id)) {
    galat('template_id', `Template harus salah satu dari: ${opsi.templateSah.join(', ')}`);
  }

  // ---- kategori (opsional)
  let kategori = null;
  if (m.category !== undefined && m.category !== null) {
    if (typeof m.category !== 'string') galat('category', 'Kategori harus teks');
    else {
      kategori = buangHtml(m.category).replace(/\s+/gu, ' ').trim() || null;
      if (kategori && panjang(kategori) > BATAS.kategori) galat('category', `Kategori maksimal ${BATAS.kategori} karakter`);
    }
  }

  // ---- kata kunci manual (opsional)
  let kataKunci = [];
  if (m.keywords !== undefined && m.keywords !== null) {
    if (!Array.isArray(m.keywords) || m.keywords.some((k) => typeof k !== 'string')) {
      galat('keywords', 'Kata kunci harus daftar teks');
    } else {
      kataKunci = [...new Set(m.keywords.map((k) => buangHtml(k).toLowerCase().replace(/\s+/gu, ' ').trim()).filter(Boolean))];
      if (kataKunci.length > BATAS.jumlahKataKunci) galat('keywords', `Maksimal ${BATAS.jumlahKataKunci} kata kunci`);
      if (kataKunci.some((k) => panjang(k) > BATAS.kataKunci)) galat('keywords', `Setiap kata kunci maksimal ${BATAS.kataKunci} karakter`);
    }
  }

  if (rincian.length) return { ok: false, rincian };
  return {
    ok: true,
    data: {
      judul,
      isi,
      indeksBait,
      baitKutipan,
      template: /** @type {string} */ (m.template_id),
      kategori,
      kataKunci,
    },
  };
}

/**
 * Sidik jari isi pengajuan yang sudah dibersihkan. Dipakai untuk membedakan
 * "kirim ulang yang sama" dari "Idempotency-Key dipakai untuk isi lain".
 * @param {object} data hasil validasiPengajuan().data
 */
export function hashPengajuan(data) {
  const kanonik = JSON.stringify([
    data.judul,
    data.isi,
    data.indeksBait,
    data.template,
    data.kategori,
    data.kataKunci,
  ]);
  return createHash('sha256').update(kanonik).digest('hex');
}
