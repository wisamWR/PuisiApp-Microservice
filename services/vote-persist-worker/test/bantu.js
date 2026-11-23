import { buatEvent, uuidv5 } from '@puisiapp/events';

process.env.SERVICE_NAME ??= 'vote-persist-uji';

export const POEM = '0193b1a8-7f4e-4c2a-9d3e-5a6b7c8d9e0f';
const NS = '5b0c2f4e-8a1d-4f7b-9e3c-2d6a9b1c7e40';

/** Amplop vote.cast seperti terbitan vote-service. */
export function vote({ poem = POEM, user = 'u1', nilai = 1, lama = 0, seq = 1, bobot = 1 } = {}) {
  const id = uuidv5(`vote.cast:${poem}:${seq}`, NS);
  return buatEvent(
    'vote.cast',
    poem,
    seq,
    {
      vote_id: id,
      poem_id: poem,
      user_id: user,
      vote_value: nilai,
      previous_value: lama,
      weight: bobot,
      sequence: seq,
      cast_at: new Date(Date.UTC(2026, 10, 23, 10, 0, 0, seq)).toISOString(),
    },
    { eventId: id, producer: 'vote-service' },
  );
}

/** Pesan AMQP tiruan. */
export const pesan = (isi) => ({ content: Buffer.from(typeof isi === 'string' ? isi : JSON.stringify(isi)) });

export const logSenyap = { info() {}, warn() {}, error() {}, debug() {} };

/** Jam manual untuk menguji jeda batch tanpa menunggu. */
export function buatJam() {
  let id = 0;
  const timer = new Map();
  return {
    setTimeout(fn, ms) {
      timer.set(++id, { fn, ms });
      return id;
    },
    clearTimeout(t) {
      timer.delete(t);
    },
    /** Jalankan semua timer yang tertunda. */
    async majukan() {
      const semua = [...timer.entries()];
      timer.clear();
      for (const [, t] of semua) await t.fn();
    },
    jumlah: () => timer.size,
  };
}
