/**
 * Salinan data milik layanan lain yang dibutuhkan aturan suara:
 *   poem.submitted  -> pemilik puisi, status SUBMITTED
 *   poem.published  -> status PUBLISHED (suara diterima)
 *   poem.hidden     -> status HIDDEN
 *   poem.deleted    -> status DELETED (final)
 *   user.registered -> akun ditandai "baru" sampai berumur 24 jam
 *
 * Semua operasi idempoten (status hanya ditimpa event yang lebih baru), jadi
 * konsumen memakai store tanpa DB: event duplikat aman diproses ulang.
 */
import { GalatPermanen } from '@puisiapp/events';

export const IKATAN = ['poem.submitted', 'poem.published', 'poem.hidden', 'poem.deleted', 'user.registered'];

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS = {
  'poem.submitted': 'SUBMITTED',
  'poem.published': 'PUBLISHED',
  'poem.hidden': 'HIDDEN',
  'poem.deleted': 'DELETED',
};

function poemIdDari(event) {
  const id = String(event.payload?.poem_id ?? event.aggregate_id).toLowerCase();
  if (!POLA_UUID.test(id)) throw new GalatPermanen(`poem_id bukan UUID: ${id}`);
  return id;
}

function waktuMs(event) {
  const ms = Date.parse(event.occurred_at);
  if (Number.isNaN(ms)) throw new GalatPermanen(`occurred_at tidak valid: ${event.occurred_at}`);
  return ms;
}

/**
 * @param {ReturnType<import('./toko.js').buatToko>} toko
 * @param {any} event amplop yang sudah tervalidasi
 */
export async function proyeksikan(toko, event) {
  if (event.event_type === 'user.registered') {
    // aggregate_id = user_id; waktu registrasi = occurred_at.
    return toko.catatAkun(String(event.aggregate_id), waktuMs(event));
  }
  const status = STATUS[event.event_type];
  if (!status) throw new GalatPermanen(`event tidak ditangani: ${event.event_type}`);
  const owner = event.event_type === 'poem.submitted' || event.event_type === 'poem.deleted'
    ? String(event.payload?.author_id ?? '')
    : '';
  return toko.perbaruiMeta(poemIdDari(event), { status, waktuMs: waktuMs(event), owner });
}
