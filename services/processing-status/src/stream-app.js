/**
 * status-stream-service (T2.7): GET /api/poems/{id}/status/stream (SSE).
 *
 *   - hanya pemilik puisi (serta moderator / admin); selain itu 404
 *   - kirim snapshot terkini saat tersambung, lalu setiap perubahan dari
 *     Redis pub/sub (semua replika menerima pesan yang sama)
 *   - koneksi yang terputus tersambung ulang otomatis oleh EventSource
 *     (retry 3 dtk) dan langsung mendapat snapshot terkini
 *   - komentar ": ping" tiap 15 dtk menjaga koneksi melewati proxy
 */
import { buatFastify, idPengguna, kirimGalat, pasangDasar, POLA_UUID } from '@puisiapp/poem-common';

const PERAN_ISTIMEWA = new Set(['moderator', 'admin']);
const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} d
 * @param {{ snapshot: (poemId: string) => Promise<{ author_id: string|null, snapshot: object }|null> }} d.keadaan
 * @param {{ ikuti: (poemId: string, kirim: Function) => Promise<() => Promise<void>> }} d.pelanggan
 * @param {() => Promise<void>} d.cekSiap
 * @param {{ info: Function, error: Function, warn: Function }} d.log
 * @param {number} [d.tungguPemilikMs]  tunggu poem.submitted diproses tracker (bawaan 5000)
 * @param {number} [d.detakMs]          bawaan 15000
 * @param {number} [d.umurMaksMs]       koneksi ditutup server setelah ini; klien menyambung ulang (bawaan 10 menit)
 * @param {{ registry: any, durasi: any, pengajuan: any }} [d.metrik]
 */
export function buatAppStream(d) {
  const tungguPemilikMs = d.tungguPemilikMs ?? 5000;
  const detakMs = d.detakMs ?? 15_000;
  const umurMaksMs = d.umurMaksMs ?? 10 * 60_000;
  /** @type {Set<import('node:http').ServerResponse>} */
  const terbuka = new Set();

  const app = buatFastify();
  pasangDasar(app, { log: d.log, cekSiap: d.cekSiap, metrik: d.metrik });

  async function ambilDenganTunggu(poemId) {
    const akhir = Date.now() + tungguPemilikMs;
    for (;;) {
      const st = await d.keadaan.snapshot(poemId);
      if (st?.author_id || Date.now() >= akhir) return st;
      await jeda(250);
    }
  }

  app.get('/api/poems/:id/status/stream', async (req, reply) => {
    const userId = idPengguna(req);
    if (!userId) return kirimGalat(reply, 401, 'unauthorized', 'Silakan masuk terlebih dahulu');
    const poemId = String(req.params.id).toLowerCase();
    if (!POLA_UUID.test(poemId)) return kirimGalat(reply, 404, 'tidak_ditemukan', 'Puisi tidak ditemukan');

    // Tepat setelah POST 202, tracker mungkin belum memproses poem.submitted.
    const awal = await ambilDenganTunggu(poemId);
    const istimewa = PERAN_ISTIMEWA.has(String(req.headers['x-user-role'] ?? ''));
    if (!awal?.author_id || (awal.author_id !== userId && !istimewa)) {
      return kirimGalat(reply, 404, 'tidak_ditemukan', 'Status pemrosesan tidak ditemukan');
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // nginx tidak mem-buffer
    });
    terbuka.add(res);
    d.metrik?.pengajuan.inc({ hasil: 'tersambung' });

    let nomor = 0;
    let terakhir = '';
    const kirim = (snapshot) => {
      // Pesan pub/sub bisa tiba sebelum snapshot awal ditulis: jangan mundur.
      const t = snapshot.updated_at ?? '';
      if (t && terakhir && t < terakhir) return;
      terakhir = t || terakhir;
      res.write(`id: ${++nomor}\nevent: status\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };

    // Listener close dipasang sebelum await apa pun: klien bisa memutus koneksi
    // kapan saja, dan event close yang terlewat membuat langganan bocor.
    let ditutup = false;
    let berhenti = null;
    let detak;
    let batas;
    const tutup = () => {
      if (ditutup) return;
      ditutup = true;
      clearInterval(detak);
      clearTimeout(batas);
      terbuka.delete(res);
      berhenti?.().catch(() => {});
    };
    res.on('close', tutup);
    req.raw.on('close', tutup);

    res.write('retry: 3000\n\n');
    // Berlangganan dulu, baru baca snapshot, supaya tidak ada perubahan yang terlewat.
    berhenti = await d.pelanggan.ikuti(poemId, kirim);
    if (ditutup) {
      await berhenti();
      return;
    }
    const terbaru = await d.keadaan.snapshot(poemId);
    if (ditutup) return;
    kirim((terbaru ?? awal).snapshot);

    detak = setInterval(() => res.write(': ping\n\n'), detakMs);
    batas = setTimeout(() => res.end(), umurMaksMs);
  });

  return {
    app,
    jumlahTerbuka: () => terbuka.size,
    /** Graceful shutdown: tutup semua stream; EventSource menyambung ulang ke replika lain. */
    tutupSemua() {
      for (const res of terbuka) res.end();
    },
  };
}
