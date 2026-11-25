/**
 * API baca puisi (contracts/openapi/poem-query.yaml):
 *   GET /api/poems/{id}              detail, cache-aside Redis
 *   GET /api/poems?author=&page=&size=  daftar puisi penulis
 */
import { buatFastify, idPengguna, kirimGalat, pasangDasar, POLA_UUID } from '@puisiapp/poem-common';
import { lihatDetail, puisiSaya, ringkasan } from './tampilan.js';

const STATUS_SAYA = new Set(['PROCESSING', 'REPROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN']);

const tidakAda = (reply) => kirimGalat(reply, 404, 'tidak_ditemukan', 'Puisi tidak ditemukan');

function bilanganBulat(nilai, bawaan, min, maks) {
  if (nilai === undefined || nilai === '') return bawaan;
  const n = Number(nilai);
  return Number.isInteger(n) && n >= min && n <= maks ? n : null;
}

/**
 * @param {object} d
 * @param {(poemId: string) => Promise<object|null>} d.ambilBundel
 * @param {(q: object) => Promise<{ total: number, baris: object[] }>} d.daftarPenulis
 * @param {(q: object) => Promise<{ total: number, counts: object, baris: object[] }>} [d.daftarMilik]  GET /api/me/poems (T2.8)
 * @param {{ ambil: Function, simpan: Function }} d.cache
 * @param {() => Promise<void>} d.cekSiap
 * @param {{ info: Function, error: Function }} d.log
 * @param {{ registry: any, durasi: any, pengajuan: any }} [d.metrik]  pengajuan{hasil}: hit / miss / tanpa_cache
 */
export function buatApp(d) {
  const app = buatFastify();
  pasangDasar(app, { log: d.log, cekSiap: d.cekSiap, metrik: d.metrik });

  app.get('/api/poems/:id', async (req, reply) => {
    const pembaca = { userId: idPengguna(req), role: req.headers['x-user-role'] ?? null };
    if (!pembaca.userId) return kirimGalat(reply, 401, 'unauthorized', 'Silakan masuk terlebih dahulu');
    const poemId = String(req.params.id).toLowerCase();
    if (!POLA_UUID.test(poemId)) return tidakAda(reply);

    let bundel = await d.cache.ambil(poemId);
    let asal = 'HIT';
    if (bundel === undefined) {
      asal = 'MISS';
      bundel = await d.ambilBundel(poemId);
      if (bundel) await d.cache.simpan(poemId, bundel);
    }
    d.metrik?.pengajuan.inc({ hasil: asal === 'HIT' ? 'hit' : 'miss' });

    const detail = lihatDetail(bundel, pembaca);
    reply.header('x-cache', asal).header('cache-control', 'private, no-cache');
    if (!detail) return tidakAda(reply);
    return detail;
  });

  app.get('/api/poems', async (req, reply) => {
    const userId = idPengguna(req);
    if (!userId) return kirimGalat(reply, 401, 'unauthorized', 'Silakan masuk terlebih dahulu');
    const author = typeof req.query.author === 'string' ? req.query.author.trim() : '';
    const page = bilanganBulat(req.query.page, 1, 1, 10_000);
    const size = bilanganBulat(req.query.size, 20, 1, 50);
    if (!author || author.length > 64) {
      return kirimGalat(reply, 400, 'parameter_tidak_valid', 'Parameter author wajib diisi (maksimal 64 karakter)');
    }
    if (page == null || size == null) {
      return kirimGalat(reply, 400, 'parameter_tidak_valid', 'page minimal 1, size 1 sampai 50');
    }
    const semua = author === userId;
    const { total, baris } = await d.daftarPenulis({ authorId: author, semua, page, size });
    reply.header('cache-control', 'private, no-cache');
    return { items: baris.map((r) => ringkasan(r, semua)), page, size, total };
  });


  // T2.8: Puisi Saya. Semua puisi milik sendiri termasuk PROCESSING, HELD, HIDDEN.
  app.get('/api/me/poems', async (req, reply) => {
    const userId = idPengguna(req);
    if (!userId) return kirimGalat(reply, 401, 'unauthorized', 'Silakan masuk terlebih dahulu');
    const page = bilanganBulat(req.query.page, 1, 1, 10_000);
    const size = bilanganBulat(req.query.size, 20, 1, 50);
    const status = typeof req.query.status === 'string' && req.query.status !== '' ? req.query.status.toUpperCase() : null;
    if (page == null || size == null || (status && !STATUS_SAYA.has(status))) {
      return kirimGalat(reply, 400, 'parameter_tidak_valid', 'status tidak dikenal, page minimal 1, size 1 sampai 50');
    }
    const { total, counts, baris } = await d.daftarMilik({ authorId: userId, status, page, size });
    reply.header('cache-control', 'private, no-cache');
    return { items: baris.map(puisiSaya), page, size, total, counts };
  });

  return app;
}
