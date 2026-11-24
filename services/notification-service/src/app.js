/**
 * API notifikasi (contracts/openapi/poem-notification.yaml). Identitas dari
 * X-User-Id gateway; setiap pengguna hanya melihat notifikasinya sendiri.
 */
import { buatFastify, idPengguna, kirimGalat, pasangDasar, POLA_UUID } from '@puisiapp/poem-common';

function bilanganBulat(nilai, bawaan, min, maks) {
  if (nilai === undefined || nilai === '') return bawaan;
  const n = Number(nilai);
  return Number.isInteger(n) && n >= min && n <= maks ? n : null;
}

/**
 * @param {object} d
 * @param {object} d.repo  { daftar, jumlahBelumDibaca, tandaiDibaca, tandaiSemua } dengan pool terikat
 * @param {() => Promise<void>} d.cekSiap
 * @param {{ info: Function, error: Function }} d.log
 * @param {object} [d.metrik]
 */
export function buatApp(d) {
  const app = buatFastify();
  pasangDasar(app, { log: d.log, cekSiap: d.cekSiap, metrik: d.metrik });

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/notifications')) return;
    req.userId = idPengguna(req);
    if (!req.userId) return kirimGalat(reply, 401, 'unauthorized', 'Silakan masuk terlebih dahulu');
    reply.header('cache-control', 'private, no-store');
  });

  app.get('/api/notifications', async (req, reply) => {
    const page = bilanganBulat(req.query.page, 1, 1, 10_000);
    const size = bilanganBulat(req.query.size, 20, 1, 50);
    if (page == null || size == null) return kirimGalat(reply, 400, 'parameter_tidak_valid', 'page minimal 1, size 1 sampai 50');
    const belumDibaca = req.query.unread === 'true' || req.query.unread === '1';
    const hasil = await d.repo.daftar({ userId: req.userId, page, size, belumDibaca });
    return { ...hasil, page, size };
  });

  app.get('/api/notifications/unread-count', async (req) => ({ unread: await d.repo.jumlahBelumDibaca(req.userId) }));

  app.post('/api/notifications/read-all', async (req) => ({ marked: await d.repo.tandaiSemua(req.userId), unread: 0 }));

  app.post('/api/notifications/:id/read', async (req, reply) => {
    const id = String(req.params.id).toLowerCase();
    const n = POLA_UUID.test(id) ? await d.repo.tandaiDibaca({ userId: req.userId, id }) : null;
    if (!n) return kirimGalat(reply, 404, 'tidak_ditemukan', 'Notifikasi tidak ditemukan');
    return { notification: n, unread: await d.repo.jumlahBelumDibaca(req.userId) };
  });

  return app;
}
