// GET /p/{poem_id}: halaman kecil berisi meta Open Graph untuk crawler media sosial
// (tidak menjalankan JavaScript), lalu mengalihkan browser ke halaman SPA /poems/{poem_id}.
// Data dari poem-query-service, di-cache di Redis.

const TTL_CACHE = 300; // detik; dihapus lebih awal oleh event poem.*

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const kunciCache = (poemId) => `bookmark:og:${poemId}`;

/**
 * Ringkasan puisi untuk pratinjau, atau null bila tidak bisa dibaca publik.
 * poem-query mewajibkan X-User-Id; panggilan internal memakai identitas pembaca tetap
 * tanpa hak pemilik, sehingga hanya puisi PUBLISHED yang dikembalikan.
 */
async function ambilDariPoemQuery(poemQueryHost, poemId, log) {
  try {
    const res = await fetch(`http://${poemQueryHost}/api/poems/${poemId}`, {
      headers: { 'X-User-Id': 'og-preview', 'X-User-Role': 'reader', Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`poem-query membalas ${res.status}`);
    const d = await res.json();
    if (d.status !== 'PUBLISHED') return null;
    return {
      title: d.title,
      quote: d.quote?.text ?? '',
      author: d.author?.display_name || d.author?.username || null,
      image: d.image?.url ?? null,
    };
  } catch (err) {
    log.warn('gagal mengambil puisi untuk pratinjau', { poem_id: poemId, err: err.message });
    throw err;
  }
}

export async function ambilPratinjau({ redis, poemQueryHost, log }, poemId) {
  const kunci = kunciCache(poemId);
  if (redis?.isReady) {
    const tersimpan = await redis.get(kunci).catch(() => null);
    if (tersimpan) return JSON.parse(tersimpan);
  }
  const data = await ambilDariPoemQuery(poemQueryHost, poemId, log);
  // Hasil "tidak ada" juga di-cache, supaya crawler tidak membebani poem-query.
  if (redis?.isReady) {
    await redis.set(kunci, JSON.stringify(data), { EX: TTL_CACHE }).catch(() => {});
  }
  return data;
}

export function htmlPratinjau({ appBaseUrl, poemId, data }) {
  const tujuan = `${appBaseUrl}/poems/${poemId}`;
  const judul = data ? `${data.title}${data.author ? ` · ${data.author}` : ''}` : 'PuisiApp';
  const deskripsi = data
    ? data.quote.replace(/\s*\n\s*/g, ' / ').slice(0, 200)
    : 'Puisi ini tidak tersedia.';
  const meta = [
    ['og:type', 'article'],
    ['og:site_name', 'PuisiApp'],
    ['og:title', judul],
    ['og:description', deskripsi],
    ['og:url', `${appBaseUrl}/p/${poemId}`],
    ...(data?.image ? [['og:image', data.image]] : []),
  ];
  const twitter = [
    ['twitter:card', data?.image ? 'summary_large_image' : 'summary'],
    ['twitter:title', judul],
    ['twitter:description', deskripsi],
    ...(data?.image ? [['twitter:image', data.image]] : []),
  ];
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>${escapeHtml(judul)}</title>
<meta name="description" content="${escapeHtml(deskripsi)}">
${meta.map(([k, v]) => `<meta property="${k}" content="${escapeHtml(v)}">`).join('\n')}
${twitter.map(([k, v]) => `<meta name="${k}" content="${escapeHtml(v)}">`).join('\n')}
<link rel="canonical" href="${escapeHtml(tujuan)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(tujuan)}">
</head>
<body>
<p><a href="${escapeHtml(tujuan)}">Buka puisi di PuisiApp</a></p>
<script>location.replace(${JSON.stringify(tujuan).replace(/</g, '\\u003c')})</script>
</body>
</html>`;
}
