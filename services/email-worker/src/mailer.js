import nodemailer from 'nodemailer';

export function susunPesanEmail(payload = {}, fromAddress = 'no-reply@puisiapp.local') {
  const to = payload.to;
  if (!to) {
    throw new Error('alamat email tujuan (to) wajib diisi');
  }

  const template = payload.template || 'verify_email';
  const username = payload.username || 'Penulis';
  const actionUrl = payload.action_url || '';
  const expiresAt = payload.expires_at || '';

  if (template === 'reset_password') {
    return {
      from: fromAddress,
      to,
      subject: 'Atur Ulang Kata Sandi Akun PuisiApp',
      text: [
        `Halo ${username},`,
        '',
        'Kami menerima permintaan untuk mengatur ulang kata sandi akun PuisiApp Anda.',
        actionUrl ? `Gunakan tautan berikut (berlaku 30 menit): ${actionUrl}` : '',
        payload.token ? `Token reset: ${payload.token}` : '',
        expiresAt ? `Kedaluwarsa pada: ${expiresAt}` : '',
        '',
        'Jika Anda tidak meminta reset kata sandi, abaikan email ini.',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  return {
    from: fromAddress,
    to,
    subject: 'Verifikasi Alamat Email Akun PuisiApp',
    text: [
      `Halo ${username},`,
      '',
      'Terima kasih telah mendaftar di PuisiApp. Silakan verifikasi alamat email Anda.',
      actionUrl ? `Tautan verifikasi (berlaku 30 menit): ${actionUrl}` : '',
      payload.token ? `Token verifikasi: ${payload.token}` : '',
      expiresAt ? `Kedaluwarsa pada: ${expiresAt}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function buatTransportSmtp(opts = {}) {
  const host = opts.host || process.env.SMTP_HOST || 'mailpit';
  const port = Number(opts.port || process.env.SMTP_PORT || 1025);
  const secure = opts.secure ?? process.env.SMTP_SECURE === 'true';
  const user = opts.user || process.env.SMTP_USER;
  const pass = opts.pass || process.env.SMTP_PASS;

  const config = {
    host,
    port,
    secure,
  };

  if (user && pass) {
    config.auth = { user, pass };
  }

  return nodemailer.createTransport(config);
}
