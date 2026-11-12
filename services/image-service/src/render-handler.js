/**
 * Logika image-render-worker untuk satu event, terpisah dari koneksi agar
 * mudah diuji. Pola consume-process-publish-ack (worker tanpa outbox):
 *   1. render JPEG 1080 px dari quote_text + template_id
 *   2. unggah ke S3 dengan kunci berversi poems/{poem_id}/v{versi}.jpg
 *   3. terbitkan poem.image.rendered dengan event_id deterministik
 * Diulang karena retry/duplikat aman: kunci S3 sama ditimpa isi yang sama,
 * dan event hasil punya event_id sama sehingga konsumen hilir menyaringnya.
 */
import { eventTurunan, GalatPermanen } from '@puisiapp/events';
import { normalisasiTeks, renderJpeg, UKURAN } from './render.js';

export const kunciGambar = (poemId, versi) => `poems/${poemId}/v${versi}.jpg`;

/**
 * @param {object} d
 * @param {Map<string, object>} d.templates
 * @param {{ unggah: Function, urlPublik: (k: string) => string }} d.s3
 * @param {{ terbitkan: Function }} d.publisher
 * @param {{ render?: any }} [d.metrik]
 * @param {string} [d.merek]
 */
export function buatHandlerRender(d) {
  return async (event, { log }) => {
    const p = event.payload ?? {};
    const poemId = p.poem_id ?? event.aggregate_id;
    const versi = p.version ?? event.aggregate_version;

    const tpl = d.templates.get(p.template_id);
    if (!tpl) throw new GalatPermanen(`Template tidak dikenal: ${p.template_id}`);
    const teks = normalisasiTeks(p.quote_text);
    if (!teks) throw new GalatPermanen('quote_text kosong atau lebih dari 280 karakter');

    const mulai = performance.now();
    const jpeg = await renderJpeg(tpl, teks, UKURAN.final, { kualitas: 88, merek: d.merek });
    d.metrik?.render.observe({ template: tpl.id }, (performance.now() - mulai) / 1000);

    const kunci = kunciGambar(poemId, versi);
    await d.s3.unggah(kunci, jpeg, 'image/jpeg'); // galat S3 = sementara -> retry

    await d.publisher.terbitkan(
      eventTurunan(
        event,
        'poem.image.rendered',
        {
          poem_id: poemId,
          version: versi,
          template_id: tpl.id,
          image_key: kunci,
          image_url: d.s3.urlPublik(kunci),
          width: UKURAN.final,
          height: UKURAN.final,
          rendered_at: new Date().toISOString(),
        },
        { aggregateId: poemId, aggregateVersion: versi },
      ),
    );
    log.info('gambar kutipan dirender', { image_key: kunci, bytes: jpeg.length, ms: Math.round(performance.now() - mulai) });
  };
}
