/**
 * Render gambar kutipan: latar template (SVG -> raster, disimpan di memori
 * sekali saat start) + lapisan teks SVG transparan -> JPEG.
 *
 * Dipakai bersama oleh image-preview-service (540 px, sinkron) dan
 * image-render-worker (1080 px, final ke S3), sehingga pratinjau dan gambar
 * final selalu sama persis kecuali resolusinya.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const UKURAN = Object.freeze({ final: 1080, pratinjau: 540 });
export const BATAS_TEKS = 280;
const RUANG = 1080; // semua koordinat template dalam ruang 1080 x 1080
const TINGGI_BARIS = 1.45;

// Batasi cache dan thread libvips agar container kecil tetap stabil.
sharp.cache({ memory: 64, items: 20 });

const panjang = (s) => [...s].length;

export function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validasi dan normalisasi teks bait. Mengembalikan teks bersih atau null.
 * Karakter kontrol (selain newline) dibuang, baris kosong di awal dan akhir dirapikan.
 * @param {unknown} teks
 */
export function normalisasiTeks(teks) {
  if (typeof teks !== 'string') return null;
  const bersih = teks
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .split('\n')
    .map((b) => b.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
  if (!bersih || panjang(bersih) > BATAS_TEKS) return null;
  return bersih;
}

/** Bungkus satu baris per kata; kata yang lebih panjang dari batas dipotong paksa. */
export function bungkusBaris(baris, maksKarakter) {
  if (baris === '') return [''];
  const hasil = [];
  let sekarang = '';
  for (const kata of baris.split(/\s+/)) {
    let sisa = kata;
    while (panjang(sisa) > maksKarakter) {
      if (sekarang) {
        hasil.push(sekarang);
        sekarang = '';
      }
      const huruf = [...sisa];
      hasil.push(huruf.slice(0, maksKarakter).join(''));
      sisa = huruf.slice(maksKarakter).join('');
    }
    if (!sisa) continue;
    const calon = sekarang ? `${sekarang} ${sisa}` : sisa;
    if (panjang(calon) <= maksKarakter) sekarang = calon;
    else {
      hasil.push(sekarang);
      sekarang = sisa;
    }
  }
  if (sekarang) hasil.push(sekarang);
  return hasil;
}

/** Perkiraan lebar rata-rata satu karakter relatif terhadap ukuran huruf. */
function faktorLebar(cfg) {
  const sans = /sans/i.test(cfg.font);
  if (sans) return cfg.bobot === 'bold' ? 0.6 : 0.55;
  return cfg.gaya === 'italic' ? 0.5 : 0.53;
}

/**
 * Pilih ukuran huruf terbesar yang membuat semua baris muat di kotak teks.
 * @returns {{ ukuran: number, baris: string[], terpotong: boolean }}
 */
export function tataLetak(teks, cfg) {
  const asli = teks.split('\n');
  for (let u = cfg.ukuranMaks; u >= cfg.ukuranMin; u -= 2) {
    const maks = Math.max(4, Math.floor(cfg.kotak.w / (u * faktorLebar(cfg))));
    const baris = asli.flatMap((b) => bungkusBaris(b, maks));
    if (baris.length * u * TINGGI_BARIS <= cfg.kotak.h) return { ukuran: u, baris, terpotong: false };
  }
  // Tidak muat pada ukuran minimum: potong dan beri elipsis.
  const u = cfg.ukuranMin;
  const maks = Math.max(4, Math.floor(cfg.kotak.w / (u * faktorLebar(cfg))));
  const muat = Math.max(1, Math.floor(cfg.kotak.h / (u * TINGGI_BARIS)));
  const baris = asli.flatMap((b) => bungkusBaris(b, maks)).slice(0, muat);
  baris[baris.length - 1] = `${[...baris[baris.length - 1]].slice(0, maks - 1).join('')}…`;
  return { ukuran: u, baris, terpotong: true };
}

/**
 * Lapisan teks SVG transparan seukuran keluaran.
 * @param {object} tpl definisi template
 * @param {string} teks teks yang sudah dinormalisasi
 * @param {number} ukuranPx
 * @param {string} merek
 */
export function svgTeks(tpl, teks, ukuranPx, merek) {
  const cfg = tpl.teks;
  const { ukuran, baris } = tataLetak(teks, cfg);
  const tinggiBaris = ukuran * TINGGI_BARIS;
  const atas = cfg.kotak.y + (cfg.kotak.h - baris.length * tinggiBaris) / 2;
  const x = cfg.kotak.x + cfg.kotak.w / 2;
  const font = `'${cfg.font}', ${/sans/i.test(cfg.font) ? 'sans-serif' : 'serif'}`;

  const elemen = baris
    .map((b, i) => {
      if (!b) return '';
      const y = (atas + i * tinggiBaris + tinggiBaris / 2 + ukuran * 0.35).toFixed(1);
      return `<text x="${x}" y="${y}">${escapeXml(b)}</text>`;
    })
    .join('');

  const m = tpl.merek;
  const teksMerek = merek
    ? `<text x="540" y="${m.y}" font-family="'DejaVu Sans', sans-serif" font-size="24" letter-spacing="8"
        fill="${m.warna}" fill-opacity="${m.opasitas}" text-anchor="middle">${escapeXml(merek.toUpperCase())}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ukuranPx}" height="${ukuranPx}" viewBox="0 0 ${RUANG} ${RUANG}">
<g font-family="${font}" font-size="${ukuran}" font-style="${cfg.gaya}" font-weight="${cfg.bobot}" fill="${cfg.warna}" text-anchor="middle">${elemen}</g>
${teksMerek}
</svg>`;
}

/**
 * Muat semua template dan rasterkan latarnya ke memori untuk setiap ukuran.
 * @param {string} folder folder assets/templates
 * @returns {Promise<Map<string, object>>}
 */
export async function muatTemplate(folder) {
  const { templates } = JSON.parse(readFileSync(path.join(folder, 'templates.json'), 'utf8'));
  const peta = new Map();
  for (const t of templates) {
    const svg = readFileSync(path.join(folder, t.latar));
    const latar = new Map();
    for (const ukuran of Object.values(UKURAN)) {
      latar.set(ukuran, await sharp(svg).resize(ukuran, ukuran).png().toBuffer());
    }
    peta.set(t.id, { ...t, latarRaster: latar });
  }
  // Pemanasan: render teks pertama memicu fontconfig membangun cache font
  // (bisa beberapa detik). Dilakukan saat start, bukan pada permintaan pengguna.
  for (const tpl of peta.values()) await renderJpeg(tpl, 'pemanasan', UKURAN.pratinjau);
  return peta;
}

/**
 * Render JPEG.
 * @param {object} tpl hasil muatTemplate().get(id)
 * @param {string} teks teks bait yang sudah dinormalisasi
 * @param {number} ukuranPx UKURAN.final atau UKURAN.pratinjau
 * @param {{ kualitas?: number, merek?: string }} [opsi]
 */
export async function renderJpeg(tpl, teks, ukuranPx, opsi = {}) {
  const latar = tpl.latarRaster.get(ukuranPx);
  if (!latar) throw new Error(`Ukuran ${ukuranPx} tidak didukung`);
  const lapisan = Buffer.from(svgTeks(tpl, teks, ukuranPx, opsi.merek ?? 'RASA'));
  return sharp(latar)
    .composite([{ input: lapisan, top: 0, left: 0 }])
    .jpeg({ quality: opsi.kualitas ?? 85, progressive: ukuranPx >= UKURAN.final, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
