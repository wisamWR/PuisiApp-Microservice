/**
 * Pemeriksaan awal untuk skrip uji integrasi yang mengirim event palsu
 * (bukan untuk kode layanan).
 *
 * Skrip uji T2.2 dan T2.8 mengirim poem.similarity.scored palsu supaya hasilnya
 * bisa diatur (original atau dugaan jiplakan). Sejak T7.2 masuk main,
 * similarity-worker asli juga mengirim skor untuk setiap puisi, dan skor asli
 * itu biasanya tiba lebih dulu sehingga skenario uji tidak lagi terkendali.
 * Skrip berhenti dengan pesan jelas alih-alih gagal tanpa alasan.
 *
 * @param {string} antrean  nama antrean, mis. q.similarity-worker
 * @param {{ apiUrl?: string, user?: string, pass?: string, vhost?: string, saran?: string }} [opsi]
 */
export async function pastikanTanpaKonsumen(antrean, opsi = {}) {
  const apiUrl = opsi.apiUrl ?? process.env.RABBITMQ_API_URL ?? 'http://localhost:15672';
  const user = opsi.user ?? process.env.RABBITMQ_USER ?? 'puisiApp';
  const pass = opsi.pass ?? process.env.RABBITMQ_PASS ?? 'puisiApp_dev_only';
  const vhost = encodeURIComponent(opsi.vhost ?? process.env.RABBITMQ_VHOST ?? 'puisiApp');
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  // Statistik management API diperbarui tiap ~5 detik, jadi tepat setelah
  // `docker compose stop` jumlah konsumen bisa masih lama: periksa ulang dulu.
  let konsumen = 0;
  for (let coba = 0; coba < 5; coba++) {
    try {
      const r = await fetch(`${apiUrl}/api/queues/${vhost}/${encodeURIComponent(antrean)}`, {
        headers: { authorization: `Basic ${auth}` },
      });
      if (r.status === 404) return; // antrean belum ada: layanannya tidak berjalan
      if (!r.ok) throw new Error(`status ${r.status}`);
      konsumen = (await r.json()).consumers ?? 0;
    } catch (err) {
      console.warn(`(peringatan) tidak bisa memeriksa ${antrean} lewat ${apiUrl}: ${err.message}`);
      return;
    }
    if (konsumen === 0) return;
    await new Promise((selesai) => setTimeout(selesai, 2000));
  }

  if (konsumen > 0) {
    console.error(
      `${antrean} sedang dikonsumsi (${konsumen} konsumen). Skrip ini mengirim skor palsu, ` +
        'jadi matikan layanan aslinya dulu lalu nyalakan lagi setelah selesai:\n' +
        `  ${opsi.saran ?? 'docker compose stop similarity-worker'}\n` +
        '  node scripts/uji-integrasi.js\n' +
        '  docker compose start similarity-worker',
    );
    process.exit(2);
  }
}
