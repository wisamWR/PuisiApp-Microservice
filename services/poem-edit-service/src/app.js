/**
 * HTTP poem-edit-service: PUT /api/poems/{id}.
 */
import {
  buatFastify,
  hashPengajuan,
  idPengguna,
  kirimGalat,
  konteksEvent,
  pasangDasar,
  POLA_IDEMPOTENCY_KEY,
  POLA_UUID,
  validasiPengajuan,
} from '@puisiapp/poem-common';

/**
 * @param {object} d
 * @param {(p: object) => Promise<{ jenis: string, puisi?: object }>} d.simpanRevisi
 * @param {() => Promise<void>} d.cekSiap
 * @param {string[]} d.templateSah
 * @param {{ info: Function, error: Function }} d.log
 * @param {any} [d.metrik]
 */
export function buatApp(d) {
  const app = buatFastify();
  pasangDasar(app, d);

  app.put('/api/poems/:id', async (req, reply) => {
    const authorId = idPengguna(req);
    if (!authorId) return kirimGalat(reply, 401, 'unauthorized', 'Wajib login');

    const poemId = /** @type {{ id: string }} */ (req.params).id;
    if (!POLA_UUID.test(poemId)) return kirimGalat(reply, 404, 'tidak_ditemukan', 'Puisi tidak ditemukan');

    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !POLA_IDEMPOTENCY_KEY.test(key)) {
      d.metrik?.pengajuan.inc({ hasil: 'tidak_valid' });
      return kirimGalat(reply, 400, 'validasi', 'Header Idempotency-Key wajib (8-64 karakter A-Z a-z 0-9 _ -)', {
        rincian: [{ field: 'Idempotency-Key', pesan: 'Wajib diisi, dibuat sekali per draf revisi' }],
      });
    }

    const v = validasiPengajuan(req.body, { templateSah: d.templateSah });
    if (!v.ok) {
      d.metrik?.pengajuan.inc({ hasil: 'tidak_valid' });
      return kirimGalat(reply, 400, 'validasi', 'Isi puisi tidak valid', { rincian: v.rincian });
    }

    const hasil = await d.simpanRevisi({
      poemId,
      authorId,
      idempotencyKey: key,
      hash: hashPengajuan(v.data),
      data: v.data,
      konteks: konteksEvent(req),
    });
    d.metrik?.pengajuan.inc({ hasil: hasil.jenis });

    switch (hasil.jenis) {
      case 'tidak_ada':
        return kirimGalat(reply, 404, 'tidak_ditemukan',
          'Puisi tidak ditemukan. Bila baru saja diajukan, coba lagi beberapa detik.');
      case 'terhapus':
        return kirimGalat(reply, 404, 'tidak_ditemukan', 'Puisi sudah dihapus');
      case 'bukan_pemilik':
        return kirimGalat(reply, 403, 'forbidden', 'Hanya pemilik yang dapat merevisi puisi ini');
      case 'konflik':
        return kirimGalat(reply, 409, 'idempotency_key_bentrok', 'Idempotency-Key sudah dipakai untuk isi revisi yang berbeda');
      default:
        if (hasil.jenis === 'ulang') reply.header('Idempotent-Replayed', 'true');
        reply.header('Location', `/api/poems/${poemId}`);
        return reply.code(202).send(hasil.puisi);
    }
  });

  return app;
}
