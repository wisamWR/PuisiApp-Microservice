/**
 * HTTP poem-delete-service: DELETE /api/poems/{id}.
 */
import { buatFastify, idPengguna, kirimGalat, konteksEvent, pasangDasar, POLA_UUID } from '@puisiapp/poem-common';

/**
 * @param {object} d
 * @param {(p: object) => Promise<{ jenis: string, hasil?: object }>} d.hapusPuisi
 * @param {() => Promise<void>} d.cekSiap
 * @param {{ info: Function, error: Function }} d.log
 * @param {any} [d.metrik]
 */
export function buatApp(d) {
  const app = buatFastify();
  pasangDasar(app, d);

  app.delete('/api/poems/:id', async (req, reply) => {
    const authorId = idPengguna(req);
    if (!authorId) return kirimGalat(reply, 401, 'unauthorized', 'Wajib login');
    const poemId = /** @type {{ id: string }} */ (req.params).id;
    if (!POLA_UUID.test(poemId)) return kirimGalat(reply, 404, 'tidak_ditemukan', 'Puisi tidak ditemukan');

    const h = await d.hapusPuisi({ poemId, authorId, konteks: konteksEvent(req) });
    d.metrik?.pengajuan.inc({ hasil: h.jenis });

    if (h.jenis === 'tidak_ada') return kirimGalat(reply, 404, 'tidak_ditemukan', 'Puisi tidak ditemukan');
    if (h.jenis === 'bukan_pemilik') return kirimGalat(reply, 403, 'forbidden', 'Hanya pemilik yang dapat menghapus puisi ini');
    if (h.jenis === 'ulang') reply.header('Idempotent-Replayed', 'true');
    return reply.code(202).send(h.hasil);
  });

  return app;
}
