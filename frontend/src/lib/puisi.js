/**
 * Logika halaman Tulis Puisi tanpa React (T2.6): pemecahan bait, validasi
 * klien, Idempotency-Key, dan draf lokal. Aturan validasi SAMA dengan server
 * (services/poem-common/src/validasi.js) supaya pesan galat muncul sebelum
 * dikirim; server tetap memvalidasi ulang dan membersihkan HTML.
 */

export const BATAS = Object.freeze({
  judul: 150,
  isi: 8000,
  baitKutipan: 280,
  kategori: 60,
  jumlahKataKunci: 10,
  kataKunci: 40,
})

export const TEMPLATE_BAWAAN = [
  { id: 'latar1', nama: 'Malam Hujan' },
  { id: 'latar2', nama: 'Kertas Senja' },
  { id: 'latar3', nama: 'Daun Pagi' },
]

/** Panjang per karakter (code point), sama dengan server; emoji dihitung 1. */
export const panjang = (s) => [...(s ?? '')].length

/** Normalisasi isi seperti server: NFC, newline \n, spasi akhir baris, baris kosong berlebih. */
export function normalisasiIsi(teks) {
  return (teks ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n')
    .map((b) => b.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}

/** Bait dipisah minimal satu baris kosong (indeks berbasis 0, sama dengan quote_stanza). */
export function pecahBait(isi) {
  return normalisasiIsi(isi)
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
}

/** Ubah teks "hujan, rindu" menjadi daftar kata kunci unik huruf kecil. */
export function uraiKataKunci(teks) {
  return [
    ...new Set(
      (teks ?? '')
        .split(',')
        .map((k) => k.toLowerCase().replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    ),
  ]
}

/**
 * Validasi form. Mengembalikan objek galat per field ({} bila sah) dan body
 * permintaan yang siap dikirim.
 * @param {{ judul: string, isi: string, indeksBait: number|null, template: string, kategori: string, kataKunci: string }} f
 * @param {string[]} templateSah
 */
export function validasiForm(f, templateSah) {
  const galat = {}
  const judul = (f.judul ?? '').replace(/\s+/gu, ' ').trim()
  const isi = normalisasiIsi(f.isi)
  const bait = pecahBait(isi)

  if (!judul) galat.title = 'Judul wajib diisi'
  else if (panjang(judul) > BATAS.judul) galat.title = `Judul maksimal ${BATAS.judul} karakter`

  if (bait.length === 0) galat.body = 'Isi puisi minimal satu baris'
  else if (panjang(isi) > BATAS.isi) galat.body = `Isi puisi maksimal ${BATAS.isi} karakter`

  if (!Number.isInteger(f.indeksBait) || f.indeksBait < 0 || f.indeksBait >= bait.length) {
    galat.quote_stanza = 'Pilih satu bait sebagai kutipan'
  } else if (panjang(bait[f.indeksBait]) > BATAS.baitKutipan) {
    galat.quote_stanza = `Bait kutipan maksimal ${BATAS.baitKutipan} karakter`
  }

  if (!templateSah.includes(f.template)) galat.template_id = 'Pilih template gambar'

  const kategori = (f.kategori ?? '').replace(/\s+/gu, ' ').trim()
  if (panjang(kategori) > BATAS.kategori) galat.category = `Kategori maksimal ${BATAS.kategori} karakter`

  const kataKunci = uraiKataKunci(f.kataKunci)
  if (kataKunci.length > BATAS.jumlahKataKunci) galat.keywords = `Maksimal ${BATAS.jumlahKataKunci} kata kunci`
  else if (kataKunci.some((k) => panjang(k) > BATAS.kataKunci)) {
    galat.keywords = `Setiap kata kunci maksimal ${BATAS.kataKunci} karakter`
  }

  const body = {
    title: judul,
    body: isi,
    quote_stanza: f.indeksBait,
    template_id: f.template,
    ...(kategori && { category: kategori }),
    ...(kataKunci.length && { keywords: kataKunci }),
  }
  return { galat, body, bait }
}

/** Gabungkan rincian galat dari server (400) ke bentuk { field: pesan }. */
export function galatServer(data) {
  const hasil = {}
  for (const r of data?.rincian ?? []) {
    if (r?.field && !hasil[r.field]) hasil[r.field] = r.pesan
  }
  return hasil
}

/** Idempotency-Key: dibuat sekali per draf dan ikut tersimpan bersama draf. */
export function buatIdempotencyKey() {
  return `draf-${globalThis.crypto.randomUUID()}`
}

/** URL pratinjau gambar kutipan (image-preview-service, T2.5). */
export function urlPratinjau(template, teks) {
  if (!template || !teks) return null
  const q = new URLSearchParams({ template, text: teks })
  return `/api/images/preview?${q}`
}

// ------------------------------------------------------------------ draf lokal

const AWALAN_DRAF = 'puisiapp:draf'
export const kunciDraf = (poemId) => (poemId ? `${AWALAN_DRAF}:edit:${poemId}` : `${AWALAN_DRAF}:baru`)

/**
 * Draf disimpan di localStorage (fitur [BARU] Penulisan: "Draf disimpan di klien").
 * Penyimpanan bisa disuntikkan untuk pengujian.
 */
export function buatPenyimpanDraf(storage = globalThis.localStorage) {
  return {
    muat(kunci) {
      try {
        const nilai = storage?.getItem(kunci)
        if (!nilai) return null
        const draf = JSON.parse(nilai)
        return draf && typeof draf === 'object' ? draf : null
      } catch {
        return null // draf rusak atau storage tidak tersedia: mulai dari kosong
      }
    },
    simpan(kunci, draf) {
      try {
        storage?.setItem(kunci, JSON.stringify({ ...draf, disimpanPada: new Date().toISOString() }))
        return true
      } catch {
        return false // mode privat atau kuota penuh: halaman tetap berfungsi
      }
    },
    hapus(kunci) {
      try {
        storage?.removeItem(kunci)
      } catch {
        /* abaikan */
      }
    },
  }
}

/** Draf dianggap kosong bila belum ada isian berarti (tidak perlu disimpan). */
export const drafKosong = (f) => !f.judul?.trim() && !f.isi?.trim() && !f.kategori?.trim() && !f.kataKunci?.trim()
