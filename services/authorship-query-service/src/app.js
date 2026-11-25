import PDFDocument from 'pdfkit';

import {
  buatFastify,
  idPengguna,
  kirimGalat,
  pasangDasar,
  POLA_UUID,
} from '@puisiapp/poem-common';

function escapePdfText(val) {
  return String(val ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLines(text, maxChars = 76) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    if ((cur + " " + words[i]).length <= maxChars) {
      cur += " " + words[i];
    } else {
      lines.push(cur);
      cur = words[i];
    }
  }
  lines.push(cur);
  return lines;
}

async function buatSertifikat(poemId, records) {
  const lines = [
    { text: "SERTIFIKAT RIWAYAT AUTHORSHIP", size: 16, dy: 0 },
    { text: "", size: 10, dy: -22 },
    { text: "ID Puisi: " + poemId, size: 10, dy: -16 },
    { text: "Jumlah versi tercatat: " + records.length, size: 10, dy: -15 },
    { text: "", size: 10, dy: -18 },
  ];

  for (const record of records) {
    lines.push({ text: "Versi " + record.version, size: 12, dy: -18 });
    for (const l of wrapLines("Content hash: " + record.content_hash, 78)) {
      lines.push({ text: l, size: 9, dy: -13 });
    }
    for (const l of wrapLines("Previous hash: " + record.previous_hash, 78)) {
      lines.push({ text: l, size: 9, dy: -13 });
    }
    for (const l of wrapLines("Chain hash: " + record.chain_hash, 78)) {
      lines.push({ text: l, size: 9, dy: -13 });
    }
    lines.push({
      text: "Waktu pencatatan: " + new Date(record.recorded_at).toISOString(),
      size: 9,
      dy: -13,
    });
    lines.push({ text: "Algoritma: " + record.algorithm, size: 9, dy: -13 });
    lines.push({ text: "", size: 9, dy: -14 });
  }

  lines.push({ text: "Cara verifikasi:", size: 11, dy: -16 });
  for (const l of wrapLines(
    "Hitung ulang SHA-256 setiap catatan menggunakan index versi, poem_id, version, content_hash, recorded_at, dan previous_hash. Pastikan previous_hash setiap versi sama dengan chain_hash versi sebelumnya.",
    78
  )) {
    lines.push({ text: l, size: 9, dy: -13 });
  }
  lines.push({ text: "", size: 9, dy: -14 });
  for (const l of wrapLines(
    "Disclaimer: Sertifikat ini merupakan catatan waktu dan integritas data dalam sistem. Sertifikat ini bukan bukti hukum kepemilikan atau penetapan hak cipta atas puisi.",
    78
  )) {
    lines.push({ text: l, size: 9, dy: -13 });
  }

  const streamOps = ["BT", "50 790 Td"];
  let curSize = 0;
  for (const item of lines) {
    if (item.dy !== 0) {
      streamOps.push("0 " + item.dy + " Td");
    }
    if (item.text) {
      if (curSize !== item.size) {
        streamOps.push("/F1 " + item.size + " Tf");
        curSize = item.size;
      }
      streamOps.push("(" + escapePdfText(item.text) + ") Tj");
    }
  }
  streamOps.push("ET");
  const contentStream = streamOps.join("\n") + "\n";

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    "5 0 obj\n<< /Length " + Buffer.byteLength(contentStream, "latin1") + " >>\nstream\n" + contentStream + "endstream\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + (objects.length + 1) + "\n";
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n";
  return Buffer.from(pdf, "latin1");
}

export function buatApp(d) {
  const app = buatFastify();

  pasangDasar(app, {
    log: d.log,
    cekSiap: d.cekSiap,
  });

  app.get('/api/poems/:id/authorship', async (req, reply) => {
    const userId = idPengguna(req);

    if (!userId) {
      return kirimGalat(
        reply, 401, 'unauthorized',
        'Silakan masuk terlebih dahulu',
      );
    }

    const poemId = String(req.params.id).toLowerCase();

    if (!POLA_UUID.test(poemId)) {
      return kirimGalat(
        reply, 400, 'parameter_tidak_valid',
        'ID puisi tidak valid',
      );
    }

    const pemilik = await d.cekPemilik(poemId, userId);

    if (!pemilik) {
      return kirimGalat(
        reply, 404, 'tidak_ditemukan',
        'Riwayat authorship tidak ditemukan',
      );
    }

    const records = await d.ambilRiwayat(poemId);

    if (records.length === 0) {
      return kirimGalat(
        reply, 404, 'tidak_ditemukan',
        'Riwayat authorship tidak ditemukan',
      );
    }

    reply.header('cache-control', 'private, no-store');

    return {
      poem_id: poemId,
      total_versions: records.length,
      records,
    };
  });

  app.get('/api/poems/:id/certificate', async (req, reply) => {
    const userId = idPengguna(req);

    if (!userId) {
      return kirimGalat(
        reply, 401, 'unauthorized',
        'Silakan masuk terlebih dahulu',
      );
    }

    const poemId = String(req.params.id).toLowerCase();

    if (!POLA_UUID.test(poemId)) {
      return kirimGalat(
        reply, 400, 'parameter_tidak_valid',
        'ID puisi tidak valid',
      );
    }

    const pemilik = await d.cekPemilik(poemId, userId);

    if (!pemilik) {
      return kirimGalat(
        reply, 404, 'tidak_ditemukan',
        'Sertifikat authorship tidak ditemukan',
      );
    }

    const records = await d.ambilRiwayat(poemId);

    if (records.length === 0) {
      return kirimGalat(
        reply, 404, 'tidak_ditemukan',
        'Sertifikat authorship tidak ditemukan',
      );
    }

    const pdf = await buatSertifikat(poemId, records);

    reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `attachment; filename="authorship-${poemId}.pdf"`,
      )
      .header('cache-control', 'private, no-store');

    return reply.send(pdf);
  });

  return app;
}
