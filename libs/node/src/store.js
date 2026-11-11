/**
 * Store idempotensi: menjalankan pemrosesan satu event tepat satu kali.
 *
 * Kontrak store:
 *   proses(event, fn) -> 'diproses' | 'duplikat' | 'basi'
 *   fn(ctx) menerima konteks store (untuk PostgreSQL: { tx }) dan
 *   mengembalikan 'diproses' atau 'basi'.
 *
 * Layanan boleh menulis store sendiri (mis. Redis SET NX) selama mengikuti
 * kontrak yang sama.
 */

/**
 * Store PostgreSQL. event_id dicatat di tabel processed_event dalam SATU
 * transaksi dengan perubahan data, sehingga keduanya tersimpan bersama atau
 * tidak sama sekali.
 *
 * INSERT ... ON CONFLICT DO NOTHING dijalankan paling awal: bila dua replika
 * menerima event yang sama bersamaan, replika kedua menunggu kunci baris dan
 * setelah transaksi pertama commit mendapat rowCount 0 (duplikat).
 *
 * Lalu diambil advisory lock transaksi per aggregate_id. Event untuk agregat
 * yang sama (mis. v1 dan v2 satu puisi) diproses berurutan walaupun prefetch
 * > 1 atau ada beberapa replika, sehingga pengecekan versiTersimpan melihat
 * hasil commit event sebelumnya. Agregat berbeda tetap diproses paralel.
 * Tanpa kunci ini, v1 bisa lolos pengecekan versi saat v2 belum commit dan
 * menimpa data menjadi versi lama.
 *
 * @param {import('pg').Pool} pool
 * @param {{ kunciAgregat?: boolean }} [opsi] kunciAgregat default true
 */
export function buatStorePg(pool, opsi = {}) {
  const kunciAgregat = opsi.kunciAgregat ?? true;
  return {
    /**
     * @param {import('./amplop.js').Event} event
     * @param {(ctx: { tx: import('pg').PoolClient }) => Promise<'diproses'|'basi'>} fn
     */
    async proses(event, fn) {
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        const catat = await tx.query(
          'INSERT INTO processed_event (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING',
          [event.event_id],
        );
        if (catat.rowCount === 0) {
          await tx.query('ROLLBACK');
          return 'duplikat';
        }
        if (kunciAgregat) {
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [event.aggregate_id]);
        }
        const hasil = await fn({ tx });
        await tx.query('COMMIT');
        return hasil;
      } catch (err) {
        await tx.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        tx.release();
      }
    },
  };
}

/**
 * Store untuk worker tanpa state (mis. fingerprint-worker). Tidak mencatat
 * apa pun; idempotensi dijamin karena hasil yang sama diterbitkan dengan
 * event_id deterministik (eventTurunan) dan konsumen hilir menyaring duplikat.
 */
export function buatStoreTanpaDb() {
  return {
    async proses(_event, fn) {
      return fn({});
    },
  };
}
