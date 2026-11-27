// Pengisian read model pencarian dari event. Idempotensi lewat buatStorePg (processed_event).
// Sumber isi puisi: poem.submitted dan poem.revised (title, body, author_id, quote_stanza, quote_text).
// Status: poem.published, poem.held, poem.hidden, poem.deleted. Hanya PUBLISHED yang dicari.
//
// Urutan event tidak dijamin, karena poem.submitted dan event status berasal dari relay berbeda.
// - Event status yang datang lebih dulu membuat baris kosong (upsert), lalu isi menyusul.
// - status_at mencegah event status lama menimpa yang baru. DELETED bersifat final.
// - Revisi puisi yang sedang PUBLISHED disimpan di kolom *_baru dan baru dipakai saat versinya
//   dipublikasikan. Revisi yang belum lolos analisis atau ditahan (poem.held) tidak bisa dicari.
//   Perilaku ini sama dengan versi_tampil di poem-query-service.

const waktu = (event, nilai) => nilai ?? event.occurred_at ?? new Date().toISOString();
const versiEvent = (event, p) => Number(event.aggregate_version ?? p.version ?? 1) || 1;

async function isiPuisi(tx, id, p, versi) {
  const isi = [id, p.title ?? '', p.body ?? '', versi, p.quote_text ?? null, p.quote_stanza ?? null];

  // Baris baru berstatus PROCESSING. Baris yang sudah ada (mis. dibuat event status) hanya
  // dilengkapi author_id; isinya diatur dua UPDATE di bawah.
  await tx.query(
    `INSERT INTO poem_cari (poem_id, author_id, status, judul, isi, versi, bait_kutipan, indeks_bait, diubah_at)
     VALUES ($1, $2, 'PROCESSING', $3, $4, $5, $6, $7, now())
     ON CONFLICT (poem_id) DO UPDATE SET
       author_id = CASE WHEN poem_cari.author_id = '' THEN EXCLUDED.author_id ELSE poem_cari.author_id END,
       diubah_at = now()`,
    [id, p.author_id ?? '', ...isi.slice(1)],
  );

  // Isi utama: dipakai bila puisi belum terbit, atau versi ini sudah dipublikasikan lebih dulu.
  await tx.query(
    `UPDATE poem_cari SET judul = $2, isi = $3, versi = $4, bait_kutipan = $5, indeks_bait = $6, diubah_at = now()
     WHERE poem_id = $1 AND (versi <= $4 OR judul = '')
       AND (status <> 'PUBLISHED' OR coalesce(versi_terbit, 0) >= $4)`,
    isi,
  );

  // Revisi dari puisi yang sedang PUBLISHED: tunggu publikasi versinya.
  await tx.query(
    `UPDATE poem_cari SET judul_baru = $2, isi_baru = $3, versi_baru = $4, bait_baru = $5, indeks_baru = $6,
       diubah_at = now()
     WHERE poem_id = $1 AND status = 'PUBLISHED' AND coalesce(versi_terbit, 0) < $4
       AND versi < $4 AND coalesce(versi_baru, 0) < $4`,
    isi,
  );
}

async function ubahStatus(tx, id, status, statusAt, { versiTerbit = null, publishedAt = null } = {}) {
  await tx.query(
    `INSERT INTO poem_cari (poem_id, status, status_at, versi_terbit, published_at, diubah_at)
     VALUES ($1, $2, $3::timestamptz, $4::int, $5::timestamptz, now())
     ON CONFLICT (poem_id) DO UPDATE SET
       status = EXCLUDED.status,
       status_at = EXCLUDED.status_at,
       versi_terbit = GREATEST(poem_cari.versi_terbit, EXCLUDED.versi_terbit),
       published_at = COALESCE(poem_cari.published_at, EXCLUDED.published_at),
       diubah_at = now()
     WHERE poem_cari.status <> 'DELETED'
       AND (poem_cari.status_at IS NULL OR poem_cari.status_at <= EXCLUDED.status_at)`,
    [id, status, statusAt, versiTerbit, publishedAt],
  );

  // Revisi yang versinya sudah terbit menjadi isi utama.
  await tx.query(
    `UPDATE poem_cari SET judul = judul_baru, isi = isi_baru, versi = versi_baru,
       bait_kutipan = bait_baru, indeks_bait = indeks_baru,
       judul_baru = NULL, isi_baru = NULL, versi_baru = NULL, bait_baru = NULL, indeks_baru = NULL,
       diubah_at = now()
     WHERE poem_id = $1 AND versi_baru IS NOT NULL AND versi_baru <= coalesce(versi_terbit, 0)`,
    [id],
  );
}

export async function tanganiPuisi(event, { tx }) {
  const p = event.payload || {};
  const id = p.poem_id || event.aggregate_id;
  if (!id) return;

  switch (event.event_type) {
    case 'poem.submitted':
    case 'poem.revised':
      return isiPuisi(tx, id, p, versiEvent(event, p));

    case 'poem.published':
      return ubahStatus(tx, id, 'PUBLISHED', waktu(event, p.published_at), {
        versiTerbit: versiEvent(event, p),
        publishedAt: waktu(event, p.published_at),
      });

    case 'poem.held':
      return ubahStatus(tx, id, 'HELD', waktu(event));

    case 'poem.hidden':
      return ubahStatus(tx, id, 'HIDDEN', waktu(event, p.hidden_at));

    case 'poem.deleted':
      // Final: menimpa status apa pun tanpa membandingkan waktu.
      await tx.query(
        `INSERT INTO poem_cari (poem_id, status, status_at, diubah_at) VALUES ($1, 'DELETED', now(), now())
         ON CONFLICT (poem_id) DO UPDATE SET status = 'DELETED', status_at = now(), diubah_at = now()`,
        [id],
      );
      return;

    case 'poem.keywords.extracted': {
      const kata = (p.keywords || []).map((k) => k.term ?? k).join(' ');
      await tx.query(
        `INSERT INTO poem_cari (poem_id, status, kata_kunci, diubah_at) VALUES ($1, 'PROCESSING', $2, now())
         ON CONFLICT (poem_id) DO UPDATE SET kata_kunci = EXCLUDED.kata_kunci, diubah_at = now()`,
        [id, kata],
      );
      return;
    }

    default:
  }
}

// Nama dari user.profile.updated menimpa nama yang ada. Nama kosong dilewati,
// sehingga nama dari user.registered tidak tertimpa string kosong.
export async function tanganiProfil(event, { tx }) {
  const p = event.payload || {};
  const userId = event.aggregate_id ?? p.user_id ?? p.id;
  if (!userId || !p.display_name) return;
  await tx.query(
    `INSERT INTO penulis_cari (user_id, display_name, diubah_at)
     VALUES ($1, left($2, 50), now())
     ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, diubah_at = now()`,
    [userId, p.display_name],
  );
}

// Dari user.registered: nama awal adalah username. DO NOTHING agar nama dari profil yang lebih dulu datang tidak tertimpa.
export async function tanganiPendaftaran(event, { tx }) {
  const p = event.payload || {};
  const userId = event.aggregate_id ?? p.id;
  if (!userId || !p.username) return;
  await tx.query(
    `INSERT INTO penulis_cari (user_id, display_name, diubah_at)
     VALUES ($1, left($2, 50), now())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, p.display_name || p.username],
  );
}

// Akun dihapus: penulis tidak bisa dicari lagi. Nasib puisinya mengikuti event poem.*
// (keputusan T1.7), jadi poem_cari tidak diubah di sini.
export async function tanganiHapusAkun(event, { tx }) {
  const userId = event.aggregate_id ?? event.payload?.id;
  if (!userId) return;
  await tx.query('DELETE FROM penulis_cari WHERE user_id = $1', [userId]);
}

export async function tanganiPengguna(event, ctx) {
  if (event.event_type === 'user.registered') return tanganiPendaftaran(event, ctx);
  if (event.event_type === 'user.deleted') return tanganiHapusAkun(event, ctx);
  return tanganiProfil(event, ctx);
}
