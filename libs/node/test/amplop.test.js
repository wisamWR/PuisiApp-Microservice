import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buatEvent,
  eventTurunan,
  uuidv5,
  validasiEvent,
  GalatPermanen,
} from "../src/index.js";

process.env.SERVICE_NAME = "uji-layanan";

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("buatEvent mengisi semua field wajib dan lolos envelope.v1.json", () => {
  const e = buatEvent(
    "poem.submitted",
    "p-0193",
    1,
    { judul: "Jendela yang Basah" },
    {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  );
  assert.match(e.event_id, RE_UUID);
  assert.equal(e.event_type, "poem.submitted");
  assert.equal(e.schema_version, 1);
  assert.equal(e.producer, "uji-layanan");
  assert.match(e.correlation_id, RE_UUID);
  assert.equal(e.causation_id, null);
  assert.equal(e.aggregate_id, "p-0193");
  assert.equal(e.aggregate_version, 1);
  assert.ok(!Number.isNaN(Date.parse(e.occurred_at)));
  assert.doesNotThrow(() => validasiEvent(e));
});

test("amplop dengan field tambahan ditolak (additionalProperties false)", () => {
  const e = buatEvent("poem.submitted", "p-1", 1, {});
  assert.throws(() => validasiEvent({ ...e, tambahan: 1 }), GalatPermanen);
});

test("amplop tanpa field wajib atau versi < 1 ditolak", () => {
  const e = buatEvent("poem.submitted", "p-1", 1, {});
  const tanpaPayload = { ...e };
  delete tanpaPayload.payload;
  assert.throws(() => validasiEvent(tanpaPayload), /payload/);
  assert.throws(() => buatEvent("poem.submitted", "p-1", 0, {}), GalatPermanen);
  assert.throws(() => buatEvent("Poem-Submitted", "p-1", 1, {}), GalatPermanen);
});

test("uuidv5 sesuai vektor uji RFC (sama dengan uuid.uuid5 di Python)", () => {
  // uuid.uuid5(uuid.NAMESPACE_DNS, "python.org")
  assert.equal(
    uuidv5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
    "886313e1-3b8a-5372-9b90-0c9aee199e5d",
  );
});

test("eventTurunan: id deterministik, mewarisi correlation dan traceparent", () => {
  const sumber = buatEvent(
    "poem.submitted",
    "p-7",
    2,
    {},
    {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  );
  const a = eventTurunan(
    sumber,
    "poem.emotion.analyzed",
    { skor: {} },
    { producer: "emotion-worker" },
  );
  const b = eventTurunan(
    sumber,
    "poem.emotion.analyzed",
    { skor: {} },
    { producer: "emotion-worker" },
  );
  const lain = eventTurunan(
    sumber,
    "poem.keywords.extracted",
    {},
    { producer: "emotion-worker" },
  );

  assert.equal(a.event_id, b.event_id);
  assert.notEqual(a.event_id, lain.event_id);
  assert.equal(
    a.event_id,
    uuidv5("emotion-worker:poem.emotion.analyzed", sumber.event_id),
  );
  assert.equal(a.causation_id, sumber.event_id);
  assert.equal(a.correlation_id, sumber.correlation_id);
  assert.equal(a.traceparent, sumber.traceparent);
  assert.equal(a.aggregate_id, "p-7");
  assert.equal(a.aggregate_version, 2);
});
