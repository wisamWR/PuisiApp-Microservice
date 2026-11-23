/**
 * API suara (contracts/openapi/vote.yaml):
 *   PUT /api/poems/{id}/vote   body { nilai: 1 | -1 | 0 } -> 200 skor tampil terkini
 *   GET /api/poems/{id}/vote   skor tampil + suara saya (rincian naik/turun hanya untuk penulis)
 *
 * Urutan PUT: rate limit -> skrip Lua (cek pemilik/status + simpan suara
 * atomik) -> terbitkan vote.cast -> 200. Bila penerbitan gagal, suara
 * dikembalikan (kompensasi) dan klien menerima 503 supaya mencoba lagi.
 */
import { buatFastify, idPengguna, kirimGalat, konteksEvent, pasangDasar, POLA_UUID } from '@puisiapp/poem-common';
import { bacaNilai, bobotSuara, buatEventVote, tampilanSkor } from './suara.js';

const tidakAda = (reply) => kirimGalat(reply, 404, 'tidak_ditemukan', 'Puisi tidak ditemukan');

/**
 * @param {object} d
 * @param {ReturnType<import('./toko.js').buatToko>} d.toko
 * @param {(event: any) => Promise<void>} d.terbitkan
 * @param {() => Promise<void>} d.cekSiap
 * @param {{ info: Function, warn: Function, error: Function }} d.log
 * @param {{ ratePerMenit?: number, bobotAkunBaru?: number, sekarang?: () => Date }} [d.opsi]
 * @param {any} [d.metrik]
 */
export function buatApp(d) {
  const ratePerMenit = d.opsi?.ratePerMenit ?? 30;
  const bobotAkunBaru = d.opsi?.bobotAkunBaru ?? 0.5;
  const sekarang = d.opsi?.sekarang ?? (() => new Date());

  const catat = (hasil) => d.metrik?.pengajuan.inc({ hasil });

  const app = buatFastify();
  pasangDasar(app, { log: d.log, cekSiap: d.cekSiap, metrik: d.metrik });

  const pembaca = (req, reply) => {
    const userId = idPengguna(req);
    if (!userId) {
      kirimGalat(reply, 401, 'unauthorized', 'Silakan masuk terlebih dahulu');
      return null;
    }
    const poemId = String(req.params.id).toLowerCase();
    if (!POLA_UUID.test(poemId)) {
      tidakAda(reply);
      return null;
    }
    return { userId, poemId };
  };

  app.get('/api/poems/:id/vote', async (req, reply) => {
    const p = pembaca(req, reply);
    if (!p) return reply;
    const s = await d.toko.lihat(p.poemId, p.userId);
    if (!s.status || s.status === 'DELETED') return tidakAda(reply);
    reply.header('cache-control', 'private, no-cache');
    return tampilanSkor({ poemId: p.poemId, up: s.up, down: s.down, nilai: s.nilai, pemilik: s.owner === p.userId });
  });

  app.put('/api/poems/:id/vote', async (req, reply) => {
    const p = pembaca(req, reply);
    if (!p) return reply;
    const nilai = bacaNilai(req.body);
    if (nilai === null) return kirimGalat(reply, 400, 'nilai_tidak_valid', 'nilai harus 1, -1, atau 0');

    const waktu = sekarang();
    const rate = await d.toko.hitungRate(p.userId, waktu.getTime());
    if (rate.jumlah > ratePerMenit) {
      reply.header('retry-after', String(rate.sisaDetik));
      catat('rate_limit');
      return kirimGalat(reply, 429, 'terlalu_sering', `Maksimal ${ratePerMenit} suara per menit`);
    }

    const h = await d.toko.beriSuara(p.poemId, p.userId, nilai);
    switch (h.kode) {
      case 'tidak_ada':
        catat('tidak_ada');
        return tidakAda(reply);
      case 'pemilik':
        catat('pemilik');
        return kirimGalat(reply, 403, 'pemilik_puisi', 'Penulis tidak dapat memberi suara pada puisinya sendiri');
      case 'belum_terbit':
        catat('belum_terbit');
        return h.status === 'DELETED'
          ? tidakAda(reply)
          : kirimGalat(reply, 409, 'belum_terbit', 'Suara hanya diterima untuk puisi yang sudah terbit');
      case 'sama':
        catat('sama');
        return tampilanSkor({ poemId: p.poemId, up: h.up, down: h.down, nilai: h.baru, pemilik: false });
      case 'ok':
        break;
      default:
        throw new Error(`kode skrip tidak dikenal: ${h.kode}`);
    }

    const bobot = bobotSuara(await d.toko.akunBaru(p.userId), bobotAkunBaru);
    const ctx = konteksEvent(req);
    const event = buatEventVote({
      poemId: p.poemId,
      userId: p.userId,
      lama: h.lama,
      baru: h.baru,
      seq: h.seq,
      bobot,
      waktu,
      correlationId: ctx.correlationId,
      traceparent: ctx.traceparent,
    });
    try {
      await d.terbitkan(event);
    } catch (err) {
      const dibatalkan = await d.toko.batalkan(p.poemId, p.userId, h.lama, h.baru, h.seq).catch(() => false);
      d.log.error('vote.cast gagal diterbitkan', { err, poem_id: p.poemId, seq: h.seq, dibatalkan });
      catat('gagal_terbit');
      return kirimGalat(reply, 503, 'tidak_tersedia', 'Suara belum dapat diproses, coba lagi');
    }
    catat('diterima');
    return tampilanSkor({ poemId: p.poemId, up: h.up, down: h.down, nilai: h.baru, pemilik: false });
  });

  return app;
}
