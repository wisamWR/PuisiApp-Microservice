/**
 * Tiruan toko Redis (semantik sama dengan skrip Lua di src/skrip.js) untuk
 * uji app dan proyeksi tanpa Redis. Kebenaran skrip Lua sendiri diuji di
 * test/redis.test.js terhadap Redis sungguhan.
 */
process.env.SERVICE_NAME ??= 'vote-service-uji';

export const POEM = '0193b1a8-7f4e-4c2a-9d3e-5a6b7c8d9e0f';
export const PENULIS = 'penulis-1';

export function buatTokoTiruan() {
  const suara = new Map(); // poem -> Map(user -> nilai)
  const hitung = new Map(); // poem -> {up, down, seq}
  const meta = new Map(); // poem -> {owner, status, status_ms}
  const akunBaru = new Set();
  const rate = new Map();

  const h = (p) => hitung.get(p) ?? { up: 0, down: 0, seq: 0 };
  const s = (p) => suara.get(p) ?? new Map();

  return {
    _meta: meta,
    _hitung: hitung,
    siap: () => true,
    async beriSuara(poemId, userId, baru) {
      const m = meta.get(poemId);
      if (!m?.status || !m?.owner) return { kode: 'tidak_ada', lama: 0, baru: 0, up: 0, down: 0, seq: 0, status: m?.status ?? '' };
      if (m.owner === userId) return { kode: 'pemilik', lama: 0, baru: 0, up: 0, down: 0, seq: 0, status: m.status };
      if (m.status !== 'PUBLISHED') return { kode: 'belum_terbit', lama: 0, baru: 0, up: 0, down: 0, seq: 0, status: m.status };
      const v = s(poemId);
      const c = { ...h(poemId) };
      const lama = v.get(userId) ?? 0;
      if (lama === baru) return { kode: 'sama', lama, baru, ...c, status: m.status };
      if (baru === 0) v.delete(userId);
      else v.set(userId, baru);
      if (lama === 1) c.up--;
      else if (lama === -1) c.down--;
      if (baru === 1) c.up++;
      else if (baru === -1) c.down++;
      c.seq++;
      suara.set(poemId, v);
      hitung.set(poemId, c);
      return { kode: 'ok', lama, baru, ...c, status: m.status };
    },
    async batalkan(poemId, userId, lama, baru, seq) {
      const c = { ...h(poemId) };
      if (c.seq !== seq) return false;
      const v = s(poemId);
      if (lama === 0) v.delete(userId);
      else v.set(userId, lama);
      if (baru === 1) c.up--;
      else if (baru === -1) c.down--;
      if (lama === 1) c.up++;
      else if (lama === -1) c.down++;
      c.seq--;
      hitung.set(poemId, c);
      return true;
    },
    async lihat(poemId, userId) {
      const m = meta.get(poemId);
      const c = h(poemId);
      return { owner: m?.owner ?? null, status: m?.status ?? null, up: c.up, down: c.down, nilai: s(poemId).get(userId) ?? 0 };
    },
    async perbaruiMeta(poemId, { status, waktuMs, owner = '' }) {
      const m = meta.get(poemId) ?? {};
      if (owner) m.owner = owner;
      meta.set(poemId, m);
      if (m.status === 'DELETED') return false;
      if (status === 'DELETED' || waktuMs >= (m.status_ms ?? -1)) {
        m.status = status;
        m.status_ms = waktuMs;
        return true;
      }
      return false;
    },
    async catatAkun(userId, dibuatMs, sekarangMs = Date.now()) {
      if (dibuatMs + 86_400_000 - sekarangMs <= 0) return false;
      akunBaru.add(userId);
      return true;
    },
    async akunBaru(userId) {
      return akunBaru.has(userId);
    },
    async hitungRate(userId, sekarangMs = Date.now()) {
      const k = `${userId}:${Math.floor(sekarangMs / 60_000)}`;
      rate.set(k, (rate.get(k) ?? 0) + 1);
      return { jumlah: rate.get(k), sisaDetik: 30 };
    },
  };
}

export const logSenyap = { info() {}, warn() {}, error() {}, debug() {}, anak() { return logSenyap; } };

/** Puisi terbit milik PENULIS. */
export async function siapkanPuisiTerbit(toko, poemId = POEM) {
  await toko.perbaruiMeta(poemId, { status: 'SUBMITTED', waktuMs: 1, owner: PENULIS });
  await toko.perbaruiMeta(poemId, { status: 'PUBLISHED', waktuMs: 2 });
}
