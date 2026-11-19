import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { putuskan, STATUS } from '../src/mesin.js';
import { WAKTU, sekarang, diajukan, direvisi, dinilai, diputuskan, dihapus, keadaan } from './bantu.js';

const { PROCESSING, REPROCESSING, PUBLISHED, HELD, HIDDEN, DELETED } = STATUS;
const jalan = (k, e) => putuskan(k, e, { sekarang });

/** Terapkan rangkaian event dari awal; kembalikan keadaan akhir dan semua keluaran. */
function rangkai(events, awal = null) {
  let k = awal;
  const keluar = [];
  const aksi = [];
  for (const e of events) {
    const p = jalan(k, e);
    aksi.push(p.aksi);
    if (p.aksi === 'ubah') {
      k = { ...p.keadaan, row_version: (k?.row_version ?? 0) + 1 };
      keluar.push(...(p.keluaran ?? []));
    }
  }
  return { k, keluar, aksi };
}

describe('diagram 4.2: setiap transisi', () => {
  test('[*] -> PROCESSING: poem.submitted', () => {
    const p = jalan(null, diajukan());
    assert.equal(p.aksi, 'ubah');
    assert.equal(p.keadaan.status, PROCESSING);
    assert.equal(p.keadaan.versi, 1);
    assert.equal(p.keadaan.versi_tampil, null);
    assert.equal(p.keadaan.author_id, 'u-0042');
    assert.deepEqual(p.keluaran, undefined);
  });

  for (const level of ['original', 'inspired', 'similar']) {
    test(`PROCESSING -> PUBLISHED: level ${level}`, () => {
      const p = jalan(keadaan(PROCESSING), dinilai(1, level, 0.3));
      assert.equal(p.aksi, 'ubah');
      assert.equal(p.keadaan.status, PUBLISHED);
      assert.equal(p.keadaan.versi_tampil, 1);
      assert.equal(p.keadaan.level_kemiripan, level);
      assert.deepEqual(p.keluaran, [{ jenis: 'poem.published', versi: 1, payload: { published_at: WAKTU.toISOString() } }]);
    });
  }

  test('PROCESSING -> HELD: level suspected_plagiarism', () => {
    const p = jalan(keadaan(PROCESSING), dinilai(1, 'suspected_plagiarism', 0.91));
    assert.equal(p.keadaan.status, HELD);
    assert.equal(p.keadaan.versi_tampil, null, 'puisi yang ditahan tidak pernah tampil');
    assert.equal(p.keluaran[0].jenis, 'poem.held');
    assert.equal(p.keluaran[0].payload.similarity_level, 'suspected_plagiarism');
    assert.match(p.keluaran[0].payload.reason, /0\.91.*p-lain/);
  });

  test('PUBLISHED -> REPROCESSING: poem.revised, versi lama tetap tampil', () => {
    const p = jalan(keadaan(PUBLISHED, { versi_tampil: 1, level_kemiripan: 'original' }), direvisi(2));
    assert.equal(p.keadaan.status, REPROCESSING);
    assert.equal(p.keadaan.versi, 2);
    assert.equal(p.keadaan.versi_tampil, 1);
    assert.equal(p.keadaan.level_kemiripan, null, 'skor versi lama tidak dipakai untuk versi baru');
    assert.equal(p.keluaran, undefined);
  });

  test('REPROCESSING -> PUBLISHED: skor versi baru di bawah dugaan', () => {
    const p = jalan(keadaan(REPROCESSING, { versi: 2, versi_tampil: 1 }), dinilai(2, 'inspired', 0.3));
    assert.equal(p.keadaan.status, PUBLISHED);
    assert.equal(p.keadaan.versi_tampil, 2);
    assert.deepEqual(p.keluaran.map((k) => [k.jenis, k.versi]), [['poem.published', 2]]);
  });

  test('REPROCESSING -> HELD: skor versi baru dugaan jiplakan', () => {
    const p = jalan(keadaan(REPROCESSING, { versi: 2, versi_tampil: 1 }), dinilai(2, 'suspected_plagiarism', 0.85));
    assert.equal(p.keadaan.status, HELD);
    assert.deepEqual(p.keluaran.map((k) => [k.jenis, k.versi]), [['poem.held', 2]]);
  });

  for (const decision of ['APPROVE', 'REJECT', 'RESTORE']) {
    test(`HELD -> PUBLISHED: case.decided ${decision}`, () => {
      const p = jalan(keadaan(HELD, { level_kemiripan: 'suspected_plagiarism' }), diputuskan(decision));
      assert.equal(p.keadaan.status, PUBLISHED);
      assert.equal(p.keadaan.versi_tampil, 1);
      assert.equal(p.keadaan.case_id, '550e8400-e29b-41d4-a716-446655440001');
      assert.equal(p.keluaran[0].jenis, 'poem.published');
    });
  }

  for (const decision of ['HIDE', 'DELETE']) {
    test(`HELD -> HIDDEN: case.decided ${decision}`, () => {
      const p = jalan(keadaan(HELD), diputuskan(decision));
      assert.equal(p.keadaan.status, HIDDEN);
      assert.deepEqual(p.keluaran, [
        { jenis: 'poem.hidden', versi: 1, payload: { reason: 'Keputusan moderator', hidden_at: '2026-11-20T09:00:00.000Z' } },
      ]);
    });

    test(`PUBLISHED -> HIDDEN: case.decided ${decision} dari laporan`, () => {
      const p = jalan(keadaan(PUBLISHED, { versi: 2, versi_tampil: 2 }), diputuskan(decision));
      assert.equal(p.keadaan.status, HIDDEN);
      assert.equal(p.keluaran[0].jenis, 'poem.hidden');
      assert.equal(p.keluaran[0].versi, 2);
    });
  }

  test('HIDDEN -> PUBLISHED: banding dikabulkan (RESTORE)', () => {
    const p = jalan(keadaan(HIDDEN, { versi_tampil: 1, keputusan_at: '2026-11-20T09:00:00.000Z' }),
      diputuskan('RESTORE', '2026-11-21T09:00:00.000Z'));
    assert.equal(p.keadaan.status, PUBLISHED);
    assert.equal(p.keadaan.versi_tampil, 1);
    assert.deepEqual(p.keluaran.map((k) => [k.jenis, k.versi]), [['poem.published', 1]]);
  });

  for (const status of [PROCESSING, REPROCESSING, PUBLISHED, HELD, HIDDEN]) {
    test(`${status} -> DELETED: poem.deleted`, () => {
      const p = jalan(keadaan(status, { versi: 2, versi_tampil: 1 }), dihapus(2));
      assert.equal(p.aksi, 'ubah');
      assert.equal(p.keadaan.status, DELETED);
      assert.equal(p.keluaran, undefined, 'poem.deleted sudah diterbitkan poem-delete-service');
    });
  }
});

describe('transisi tidak sah ditolak', () => {
  test('case.decided saat PROCESSING (belum ada skor)', () => {
    assert.equal(jalan(keadaan(PROCESSING), diputuskan('APPROVE')).aksi, 'tolak');
  });

  test('poem.revised saat HELD dan HIDDEN', () => {
    assert.equal(jalan(keadaan(HELD), direvisi(2)).aksi, 'tolak');
    assert.equal(jalan(keadaan(HIDDEN, { versi_tampil: 1 }), direvisi(2)).aksi, 'tolak');
  });

  test('keputusan tidak dikenal', () => {
    assert.equal(jalan(keadaan(HELD), diputuskan('LABEL')).aksi, 'tolak');
  });

  test('level kemiripan tidak dikenal', () => {
    assert.equal(jalan(keadaan(PROCESSING), dinilai(1, 'aneh')).aksi, 'tolak');
  });

  test('keputusan menerbitkan pada puisi terbit tidak mengubah status, hanya mencatat kasus', () => {
    const p = jalan(keadaan(PUBLISHED, { versi_tampil: 1 }), diputuskan('REJECT'));
    assert.equal(p.aksi, 'ubah');
    assert.equal(p.keadaan.status, PUBLISHED);
    assert.equal(p.keadaan.keputusan_at, '2026-11-20T09:00:00.000Z');
    assert.equal(p.keluaran, undefined);
  });

  test('banding ditolak (REJECT) pada puisi tersembunyi: tetap HIDDEN', () => {
    const p = jalan(keadaan(HIDDEN, { versi_tampil: 1 }), diputuskan('REJECT'));
    assert.equal(p.keadaan.status, HIDDEN);
    assert.equal(p.keluaran, undefined);
  });
});

describe('event basi, terlambat, dan berulang', () => {
  test('skor untuk versi lama setelah revisi: basi', () => {
    assert.equal(jalan(keadaan(REPROCESSING, { versi: 2, versi_tampil: 1 }), dinilai(1, 'original')).aksi, 'basi');
  });

  test('revisi versi lama atau sama: basi', () => {
    assert.equal(jalan(keadaan(REPROCESSING, { versi: 3 }), direvisi(2)).aksi, 'basi');
    assert.equal(jalan(keadaan(PUBLISHED, { versi: 2, versi_tampil: 2 }), direvisi(2)).aksi, 'basi');
  });

  test('keputusan yang lebih lama dari keputusan tersimpan: basi', () => {
    const k = keadaan(HIDDEN, { versi_tampil: 1, keputusan_at: '2026-11-21T00:00:00.000Z' });
    assert.equal(jalan(k, diputuskan('RESTORE', '2026-11-20T00:00:00.000Z')).aksi, 'basi');
  });

  test('skor sebelum poem.submitted: tunda (di-retry)', () => {
    assert.equal(jalan(null, dinilai(1, 'original')).aksi, 'tunda');
  });

  test('skor versi baru sebelum poem.revised: tunda', () => {
    assert.equal(jalan(keadaan(PUBLISHED, { versi_tampil: 1 }), dinilai(2, 'original')).aksi, 'tunda');
  });

  test('poem.revised dan case.decided sebelum poem.submitted: tunda', () => {
    assert.equal(jalan(null, direvisi(2)).aksi, 'tunda');
    assert.equal(jalan(null, diputuskan('HIDE')).aksi, 'tunda');
  });

  test('skor ulang untuk versi yang sudah diputuskan: diabaikan, tidak terbit dua kali', () => {
    assert.equal(jalan(keadaan(PUBLISHED, { versi_tampil: 1 }), dinilai(1, 'original')).aksi, 'abaikan');
    assert.equal(jalan(keadaan(HELD), dinilai(1, 'original')).aksi, 'abaikan');
  });

  test('poem.submitted kedua untuk puisi yang sama: diabaikan', () => {
    assert.equal(jalan(keadaan(PUBLISHED, { versi_tampil: 1 }), diajukan()).aksi, 'abaikan');
  });

  test('revisi saat masih PROCESSING: tetap PROCESSING untuk versi baru, skor versi lama basi', () => {
    const { k, keluar, aksi } = rangkai([diajukan(), direvisi(2), dinilai(1, 'original'), dinilai(2, 'original')]);
    assert.deepEqual(aksi, ['ubah', 'ubah', 'basi', 'ubah']);
    assert.equal(k.status, PUBLISHED);
    assert.equal(k.versi_tampil, 2);
    assert.deepEqual(keluar.map((x) => [x.jenis, x.versi]), [['poem.published', 2]]);
  });

  test('DELETED final: semua event sesudahnya diabaikan', () => {
    const k = keadaan(DELETED);
    for (const e of [diajukan(), direvisi(2), dinilai(1, 'original'), diputuskan('RESTORE'), dihapus()]) {
      assert.equal(jalan(k, e).aksi, 'abaikan', e.event_type);
    }
  });

  test('poem.deleted sebelum poem.submitted: tombstone, submitted terlambat tidak menghidupkan', () => {
    const { k, aksi } = rangkai([dihapus(1), diajukan(), dinilai(1, 'original')]);
    assert.deepEqual(aksi, ['ubah', 'abaikan', 'abaikan']);
    assert.equal(k.status, DELETED);
  });
});

describe('alur lengkap', () => {
  test('terbit, revisi, ditahan, diloloskan moderator, dilaporkan, disembunyikan, banding, dihapus', () => {
    const { k, keluar } = rangkai([
      diajukan(),
      dinilai(1, 'original', 0.05),
      direvisi(2),
      dinilai(2, 'suspected_plagiarism', 0.9),
      diputuskan('APPROVE', '2026-11-20T09:00:00.000Z'),
      diputuskan('HIDE', '2026-11-21T09:00:00.000Z'),
      diputuskan('RESTORE', '2026-11-22T09:00:00.000Z'),
      dihapus(2),
    ]);
    assert.equal(k.status, DELETED);
    assert.deepEqual(keluar.map((x) => [x.jenis, x.versi]), [
      ['poem.published', 1],
      ['poem.held', 2],
      ['poem.published', 2],
      ['poem.hidden', 2],
      ['poem.published', 2],
    ]);
  });
});

describe('invarian: tidak pernah PUBLISHED sebelum skor kemiripan ada', () => {
  // Acak 2000 rangkaian event tanpa poem.similarity.scored. Apa pun urutannya,
  // puisi tidak boleh pernah berstatus PUBLISHED atau menerbitkan poem.published.
  const tanpaSkor = [
    () => diajukan(),
    () => direvisi(2),
    () => direvisi(3),
    () => dihapus(1),
    ...['APPROVE', 'REJECT', 'HIDE', 'DELETE', 'RESTORE'].map(
      (d) => () => diputuskan(d, new Date(Date.UTC(2026, 10, 20, Math.floor(Math.random() * 24))).toISOString()),
    ),
  ];

  test('2000 rangkaian acak', () => {
    for (let i = 0; i < 2000; i++) {
      const panjang = 1 + Math.floor(Math.random() * 8);
      let k = null;
      for (let j = 0; j < panjang; j++) {
        const e = tanpaSkor[Math.floor(Math.random() * tanpaSkor.length)]();
        const p = jalan(k, e);
        if (p.aksi !== 'ubah') continue;
        assert.notEqual(p.keadaan.status, PUBLISHED, `terbit tanpa skor setelah ${e.event_type}`);
        assert.ok(!(p.keluaran ?? []).some((x) => x.jenis === 'poem.published'));
        k = { ...p.keadaan, row_version: 1 };
      }
    }
  });
});
