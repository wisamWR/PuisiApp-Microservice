/**
 * Proyeksi event ke read model poem_read_db.
 *
 * Aturan umum:
 *   - setiap event hanya menulis kolomnya sendiri (upsert), sehingga event
 *     dari layanan berbeda boleh tiba dalam urutan apa pun;
 *   - data per versi (teks, gambar, analisis) disimpan di poem_versi dengan
 *     kunci (poem_id, versi), jadi hasil worker untuk versi lama tidak
 *     menimpa versi baru;
 *   - status hanya maju: event status yang lebih lama dari status_at
 *     diabaikan, dan DELETED final;
 *   - skor suara dan profil penulis memakai cap waktu masing-masing.
 *
 * Event analisis (gambar, kata kunci, tema, emosi, kemiripan) yang tidak
 * membawa versi di payload memakai aggregate_version amplop sebagai versi
 * puisi (aggregate_id = poem_id).
 */
import { GalatPermanen } from '@puisiapp/events';

export const IKATAN = [
  'user.registered',
  'user.profile.updated',
  'poem.submitted',
  'poem.revised',
  'poem.deleted',
  'poem.published',
  'poem.held',
  'poem.hidden',
  'poem.image.rendered',
  'poem.keywords.extracted',
  'poem.themes.extracted',
  'poem.emotion.analyzed',
  'poem.similarity.scored',
  'poem.score.updated',
];

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const teks = (nilai, maks) => (typeof nilai === 'string' && nilai.length > 0 ? nilai.slice(0, maks) : null);

function poemIdDari(event) {
  const id = event.payload?.poem_id ?? event.aggregate_id;
  if (typeof id !== 'string' || !POLA_UUID.test(id)) throw new GalatPermanen(`poem_id bukan UUID: ${id}`);
  return id;
}

/** Versi puisi yang dibawa event: payload.version bila ada, selain itu aggregate_version. */
export function versiDari(event) {
  const v = event.payload?.version;
  return Number.isInteger(v) ? v : event.aggregate_version;
}

async function upsertIsiVersi(tx, poemId, versi, p, dikirimAt) {
  await tx.query(
    `INSERT INTO poem_versi (poem_id, versi, judul, isi, indeks_bait, bait_kutipan, template, kategori, tag, dikirim_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (poem_id, versi) DO UPDATE
       SET judul = EXCLUDED.judul, isi = EXCLUDED.isi, indeks_bait = EXCLUDED.indeks_bait,
           bait_kutipan = EXCLUDED.bait_kutipan, template = EXCLUDED.template, kategori = EXCLUDED.kategori,
           tag = EXCLUDED.tag, dikirim_at = EXCLUDED.dikirim_at, diubah_at = now()`,
    [poemId, versi, p.title, p.body, p.quote_stanza, p.quote_text, p.template_id, p.category ?? null,
      p.keywords ?? [], dikirimAt],
  );
}

/** Upsert satu kelompok kolom analisis pada baris versi. */
async function upsertKolomVersi(tx, poemId, versi, kolom) {
  const nama = Object.keys(kolom);
  const nilai = Object.values(kolom);
  const daftar = nama.join(', ');
  const tempat = nama.map((_, i) => `$${i + 3}`).join(', ');
  const set = nama.map((n) => `${n} = EXCLUDED.${n}`).join(', ');
  await tx.query(
    `INSERT INTO poem_versi (poem_id, versi, ${daftar}) VALUES ($1, $2, ${tempat})
     ON CONFLICT (poem_id, versi) DO UPDATE SET ${set}, diubah_at = now()`,
    [poemId, versi, ...nilai],
  );
}

/** Ubah status bila event lebih baru dari status tersimpan dan puisi belum dihapus. */
async function ubahStatus(tx, poemId, status, occurredAt, { versiTampil = null, publishedAt = null } = {}) {
  await tx.query(
    `INSERT INTO poem (poem_id, status, status_at, versi_tampil, published_at, versi_terbaru)
     VALUES ($1, $2, $3, $4, $5, COALESCE($4, 1))
     ON CONFLICT (poem_id) DO UPDATE
       SET status = EXCLUDED.status,
           status_at = EXCLUDED.status_at,
           versi_tampil = COALESCE(EXCLUDED.versi_tampil, poem.versi_tampil),
           versi_terbaru = GREATEST(poem.versi_terbaru, COALESCE(EXCLUDED.versi_tampil, 1)),
           published_at = COALESCE(poem.published_at, EXCLUDED.published_at),
           diubah_at = now()
     WHERE poem.status IS DISTINCT FROM 'DELETED'
       AND (poem.status_at IS NULL OR poem.status_at <= EXCLUDED.status_at)`,
    [poemId, status, occurredAt, versiTampil, publishedAt],
  );
}

/** Target invalidasi cache sebuah event: { poemId } untuk poem.*, { userId } untuk user.*. */
export function targetDari(event) {
  if (event.event_type.startsWith('user.')) {
    return { userId: String(event.payload?.id ?? event.aggregate_id).slice(0, 64) };
  }
  return { poemId: poemIdDari(event) };
}

/**
 * Terapkan satu event ke read model di dalam transaksi tx.
 * @returns {Promise<{ poemId?: string, userId?: string } | null>} target invalidasi cache
 */
export async function proyeksikan(tx, event) {
  const p = event.payload ?? {};
  switch (event.event_type) {
    case 'poem.submitted': {
      const poemId = poemIdDari(event);
      await tx.query(
        `INSERT INTO poem (poem_id, author_id, status, status_at, versi_terbaru, dikirim_at)
         VALUES ($1, $2, 'PROCESSING', $3, 1, $4)
         ON CONFLICT (poem_id) DO UPDATE
           SET author_id = COALESCE(poem.author_id, EXCLUDED.author_id),
               dikirim_at = COALESCE(poem.dikirim_at, EXCLUDED.dikirim_at),
               status = COALESCE(poem.status, EXCLUDED.status),
               status_at = COALESCE(poem.status_at, EXCLUDED.status_at),
               diubah_at = now()`,
        [poemId, p.author_id, event.occurred_at, p.submitted_at],
      );
      await upsertIsiVersi(tx, poemId, versiDari(event), p, p.submitted_at);
      return { poemId };
    }

    case 'poem.revised': {
      const poemId = poemIdDari(event);
      const versi = versiDari(event);
      await tx.query(
        `INSERT INTO poem (poem_id, author_id, versi_terbaru) VALUES ($1, $2, $3)
         ON CONFLICT (poem_id) DO UPDATE
           SET author_id = COALESCE(poem.author_id, EXCLUDED.author_id),
               versi_terbaru = GREATEST(poem.versi_terbaru, EXCLUDED.versi_terbaru),
               diubah_at = now()`,
        [poemId, p.author_id, versi],
      );
      await upsertIsiVersi(tx, poemId, versi, p, p.revised_at);
      return { poemId };
    }

    case 'poem.published': {
      const poemId = poemIdDari(event);
      await ubahStatus(tx, poemId, 'PUBLISHED', event.occurred_at, {
        versiTampil: event.aggregate_version,
        publishedAt: p.published_at ?? event.occurred_at,
      });
      return { poemId };
    }

    case 'poem.held':
    case 'poem.hidden': {
      const poemId = poemIdDari(event);
      await ubahStatus(tx, poemId, event.event_type === 'poem.held' ? 'HELD' : 'HIDDEN', event.occurred_at);
      return { poemId };
    }

    case 'poem.deleted': {
      // Final: tidak membandingkan waktu, tidak bisa dibatalkan event lain.
      const poemId = poemIdDari(event);
      await tx.query(
        `INSERT INTO poem (poem_id, author_id, status, status_at, versi_terbaru)
         VALUES ($1, $2, 'DELETED', $3, $4)
         ON CONFLICT (poem_id) DO UPDATE
           SET status = 'DELETED', status_at = EXCLUDED.status_at,
               author_id = COALESCE(poem.author_id, EXCLUDED.author_id), diubah_at = now()`,
        [poemId, p.author_id ?? null, p.deleted_at ?? event.occurred_at, p.last_version ?? event.aggregate_version],
      );
      return { poemId };
    }

    case 'poem.image.rendered': {
      const poemId = poemIdDari(event);
      await upsertKolomVersi(tx, poemId, versiDari(event), {
        gambar_url: p.image_url,
        gambar_lebar: p.width,
        gambar_tinggi: p.height,
      });
      return { poemId };
    }

    case 'poem.keywords.extracted': {
      const poemId = poemIdDari(event);
      await upsertKolomVersi(tx, poemId, versiDari(event), { kata_kunci: p.keywords ?? [] });
      return { poemId };
    }

    case 'poem.themes.extracted': {
      const poemId = poemIdDari(event);
      await upsertKolomVersi(tx, poemId, versiDari(event), { tema: p.themes ?? [] });
      return { poemId };
    }

    case 'poem.emotion.analyzed': {
      const poemId = poemIdDari(event);
      await upsertKolomVersi(tx, poemId, versiDari(event), { emosi: JSON.stringify(p.emotions ?? []) });
      return { poemId };
    }

    case 'poem.similarity.scored': {
      const poemId = poemIdDari(event);
      await upsertKolomVersi(tx, poemId, versiDari(event), { level_kemiripan: p.level, skor_kemiripan: p.score });
      return { poemId };
    }

    case 'poem.score.updated': {
      const poemId = poemIdDari(event);
      await tx.query(
        `INSERT INTO poem (poem_id, skor, jumlah_suara, skor_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (poem_id) DO UPDATE
           SET skor = EXCLUDED.skor, jumlah_suara = EXCLUDED.jumlah_suara, skor_at = EXCLUDED.skor_at,
               diubah_at = now()
         WHERE poem.skor_at IS NULL OR poem.skor_at <= EXCLUDED.skor_at`,
        [poemId, p.score, p.vote_count, p.updated_at ?? event.occurred_at],
      );
      return { poemId };
    }

    case 'user.registered': {
      // Kontrak T0.6: username, email. register-service (k1) saat ini juga
      // mengirim id dan display_name; dibaca bila ada, selain itu aggregate_id.
      const userId = String(p.id ?? event.aggregate_id).slice(0, 64);
      await tx.query(
        `INSERT INTO penulis (user_id, username, display_name) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET username = COALESCE(EXCLUDED.username, penulis.username),
               display_name = CASE WHEN penulis.profil_at IS NULL
                                   THEN COALESCE(EXCLUDED.display_name, penulis.display_name)
                                   ELSE penulis.display_name END,
               diubah_at = now()`,
        [userId, teks(p.username, 50), teks(p.display_name, 100)],
      );
      return { userId };
    }

    case 'user.profile.updated': {
      const userId = String(p.id ?? event.aggregate_id).slice(0, 64);
      await tx.query(
        `INSERT INTO penulis (user_id, display_name, bio, profil_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, profil_at = EXCLUDED.profil_at,
               diubah_at = now()
         WHERE penulis.profil_at IS NULL OR penulis.profil_at <= EXCLUDED.profil_at`,
        [userId, teks(p.display_name, 100), typeof p.bio === 'string' ? p.bio.slice(0, 500) : null, event.occurred_at],
      );
      return { userId };
    }

    default:
      return null;
  }
}
