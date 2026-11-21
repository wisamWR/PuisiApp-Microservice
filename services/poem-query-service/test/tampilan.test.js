import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { emosiDominan, lihatDetail, ringkasan } from '../src/tampilan.js';
import { bundel, PEMILIK, ORANG_LAIN, MODERATOR } from './bantu.js';

describe('visibilitas detail', () => {
  test('PUBLISHED terlihat semua pembaca', () => {
    for (const p of [PEMILIK, ORANG_LAIN, MODERATOR]) {
      const d = lihatDetail(bundel(), p);
      assert.equal(d.status, 'PUBLISHED');
      assert.equal(d.is_owner, p === PEMILIK);
    }
  });

  for (const status of ['PROCESSING', 'HELD', 'HIDDEN']) {
    test(`${status}: hanya penulis dan moderator, orang lain 404`, () => {
      const b = bundel({ status, versi_tampil: status === 'HIDDEN' ? 1 : null, published_at: null });
      assert.equal(lihatDetail(b, PEMILIK).status, status);
      assert.equal(lihatDetail(b, MODERATOR).status, status);
      assert.equal(lihatDetail(b, ORANG_LAIN), null);
    });
  }

  test('DELETED tidak terlihat siapa pun, termasuk penulis', () => {
    const b = bundel({ status: 'DELETED' });
    for (const p of [PEMILIK, ORANG_LAIN, MODERATOR]) assert.equal(lihatDetail(b, p), null);
  });

  test('baris tanpa status (event analisis tiba sebelum poem.submitted) dianggap belum ada', () => {
    assert.equal(lihatDetail(bundel({ status: null }), PEMILIK), null);
    assert.equal(lihatDetail(null, PEMILIK), null);
  });

  test('revisi sedang dinilai: penulis melihat versi baru REPROCESSING, orang lain tetap versi terbit', () => {
    const b = bundel({ versi_terbaru: 2, versi_tampil: 1 }, [{}, {}]);
    const milik = lihatDetail(b, PEMILIK);
    assert.equal(milik.status, 'REPROCESSING');
    assert.equal(milik.version, 2);
    assert.equal(milik.title, 'Judul v2');
    const lain = lihatDetail(b, ORANG_LAIN);
    assert.equal(lain.status, 'PUBLISHED');
    assert.equal(lain.version, 1);
    assert.equal(lain.title, 'Judul v1');
    assert.equal(lain.latest_version, 2);
  });

  test('teks versi terbaru belum tiba: pakai versi sebelumnya yang sudah punya teks', () => {
    const b = bundel({ versi_terbaru: 2, versi_tampil: 2 }, [{}, { judul: null, isi: null }]);
    assert.equal(lihatDetail(b, ORANG_LAIN).version, 1);
  });

  test('belum ada teks sama sekali: 404', () => {
    assert.equal(lihatDetail(bundel({ status: 'PROCESSING' }, [{ judul: null }]), PEMILIK), null);
  });
});

describe('isi detail', () => {
  test('analisis kosong sampai worker selesai', () => {
    const d = lihatDetail(bundel(), ORANG_LAIN);
    assert.deepEqual(d.analysis, { keywords: [], themes: [], emotion: null, originality: null });
    assert.equal(d.image, null);
  });

  test('semua hasil analisis tampil setelah worker selesai', () => {
    const d = lihatDetail(
      bundel({}, [{
        gambar_url: 'http://x/v1.jpg', gambar_lebar: 1080, gambar_tinggi: 1080,
        kata_kunci: ['hujan'], tema: ['rindu'],
        emosi: [{ line_number: 1, label: 'sedih', score: 0.7 }],
        level_kemiripan: 'inspired', skor_kemiripan: 0.3,
      }]),
      ORANG_LAIN,
    );
    assert.deepEqual(d.image, { url: 'http://x/v1.jpg', width: 1080, height: 1080 });
    assert.deepEqual(d.analysis.keywords, ['hujan']);
    assert.deepEqual(d.analysis.themes, ['rindu']);
    assert.equal(d.analysis.emotion.dominant, 'sedih');
    assert.deepEqual(d.analysis.originality, { level: 'inspired', score: 0.3 });
    assert.deepEqual(d.score, { value: 5, vote_count: 7 });
  });

  test('emosi dominan = total skor tertinggi', () => {
    assert.equal(
      emosiDominan([
        { label: 'sedih', score: 0.5 },
        { label: 'sedih', score: 0.5 },
        { label: 'cinta', score: 0.9 },
      ]),
      'sedih',
    );
    assert.equal(emosiDominan([]), null);
  });
});

test('ringkasan daftar: penulis melihat REPROCESSING, orang lain PUBLISHED', () => {
  const r = { poem_id: 'p', status: 'PUBLISHED', versi_terbaru: 2, versi_tampil: 1, versi: 2, judul: 'J', bait_kutipan: 'k', tema: [], skor: 0, jumlah_suara: 0, dikirim_at: '2026-11-20T08:00:00.000Z', published_at: null };
  assert.equal(ringkasan(r, true).status, 'REPROCESSING');
  assert.equal(ringkasan(r, false).status, 'PUBLISHED');
});
