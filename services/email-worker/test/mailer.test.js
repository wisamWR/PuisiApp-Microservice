import test from 'node:test';
import assert from 'node:assert/strict';
import { susunPesanEmail } from '../src/mailer.js';

test('susunPesanEmail membuat email verifikasi dan reset password dengan benar', () => {
  const verifyMsg = susunPesanEmail({
    to: 'sabila@example.com',
    template: 'verify_email',
    username: 'sabila',
    token: 'tok-123',
    action_url: 'http://localhost:8080/verify-email?token=tok-123',
  });
  assert.equal(verifyMsg.to, 'sabila@example.com');
  assert.match(verifyMsg.subject, /Verifikasi/i);
  assert.match(verifyMsg.text, /tok-123/);

  const resetMsg = susunPesanEmail({
    to: 'sabila@example.com',
    template: 'reset_password',
    username: 'sabila',
    token: 'rst-456',
    action_url: 'http://localhost:8080/reset-password?token=rst-456',
  });
  assert.match(resetMsg.subject, /Atur Ulang Kata Sandi/i);
  assert.match(resetMsg.text, /rst-456/);
});
