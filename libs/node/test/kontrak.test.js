import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exchangeUntuk, ambilPetaRouting, GalatPermanen } from '../src/index.js';

test('exchangeUntuk memetakan event ke exchange domain', () => {
  assert.equal(exchangeUntuk('poem.submitted'), 'poem.events');
  assert.equal(exchangeUntuk('poem.emotion.analyzed'), 'analysis.events');
  assert.equal(exchangeUntuk('poem.processing.completed'), 'processing.events');
  assert.equal(exchangeUntuk('vote.cast'), 'vote.events');
  assert.equal(exchangeUntuk('user.registered'), 'identity.events');
});

test('event report.*, case.*, appeal.* masuk moderation.events', () => {
  for (const e of ['report.created', 'report.evidence.ready', 'case.opened', 'case.claimed', 'case.decided', 'appeal.filed']) {
    assert.equal(exchangeUntuk(e), 'moderation.events', e);
  }
});

test('event yang tidak terdaftar ditolak', () => {
  assert.throws(() => exchangeUntuk('poem.tidak.ada'), GalatPermanen);
});

test('semua event di routing.json cocok dengan pola event_type amplop', () => {
  const pola = /^[a-z]+(\.[a-z_]+)+$/;
  const peta = ambilPetaRouting();
  assert.ok(peta.size >= 25, `jumlah event ${peta.size}`);
  for (const eventType of peta.keys()) assert.match(eventType, pola);
});
