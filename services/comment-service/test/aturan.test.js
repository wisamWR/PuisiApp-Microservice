import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uuidValid,
  bolehHapusKomentar,
} from '../src/aturan.js';

test('UUID valid diterima', () => {
  assert.equal(
    uuidValid('550e8400-e29b-41d4-a716-446655440000'),
    true,
  );
});

test('UUID tidak valid ditolak', () => {
  assert.equal(uuidValid('bukan-uuid'), false);
  assert.equal(uuidValid(''), false);
  assert.equal(uuidValid(null), false);
});

test('pemilik komentar boleh menghapus komentarnya sendiri', () => {
  assert.equal(
    bolehHapusKomentar('user-1', 'user-1', 'user'),
    true,
  );
});

test('moderator boleh menghapus komentar orang lain', () => {
  assert.equal(
    bolehHapusKomentar('mod-1', 'user-1', 'moderator'),
    true,
  );
});

test('admin boleh menghapus komentar orang lain', () => {
  assert.equal(
    bolehHapusKomentar('admin-1', 'user-1', 'admin'),
    true,
  );
});

test('pengguna biasa tidak boleh menghapus komentar orang lain', () => {
  assert.equal(
    bolehHapusKomentar('user-2', 'user-1', 'user'),
    false,
  );
});
