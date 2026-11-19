
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

const POEM_ID = "0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10";

const payloadPuisi = {
  poem_id: POEM_ID,
  version: 1,
  author_id: "u-0042",
  title: "Jendela yang Basah",
  body: "sore turun tanpa permisi\nhujan mengetuk kaca",
  quote_stanza: 0,
  quote_text: "sore turun tanpa permisi\nhujan mengetuk kaca",
  template_id: "latar2",
  category: "lirik",
  keywords: ["hujan", "rindu"],
  submitted_at: "2026-11-17T03:00:00.120Z",
};

const payloadEmosi = {
  poem_id: POEM_ID,
  emotions: [
    {
      line_number: 1,
      label: "sedih",
      score: 0.85,
    },
  ],
};

const payloadKataKunci = {
  poem_id: POEM_ID,
  keywords: ["hujan", "jendela"],
};

test("buatEvent mengisi semua field wajib dan lolos envelope.v1.json", () => {
  const e = buatEvent(
    "poem.submitted",
    POEM_ID,
    1,
    payloadPuisi,
    {
      traceparent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  );

  assert.match(e.event_id, RE_UUID);
  assert.equal(e.event_type, "poem.submitted");
  assert.equal(e.schema_version, 1);
  assert.equal(e.producer, "uji-layanan");
  assert.match(e.correlation_id, RE_UUID);
  assert.equal(e.causation_id, null);
  assert.equal(e.aggregate_id, POEM_ID);
  assert.equal(e.aggregate_version, 1);
  assert.ok(!Number.isNaN(Date.parse(e.occurred_at)));
  assert.doesNotThrow(() => validasiEvent(e));
});

test("amplop dengan field tambahan ditolak (additionalProperties false)", () => {
  const e = buatEvent("poem.submitted", POEM_ID, 1, payloadPuisi);

  assert.throws(
    () => validasiEvent({ ...e, tambahan: 1 }),
    GalatPermanen,
  );
});

test("amplop tanpa field wajib atau versi < 1 ditolak", () => {
  const e = buatEvent("poem.submitted", POEM_ID, 1, payloadPuisi);

  const tanpaPayload = { ...e };
  delete tanpaPayload.payload;

  assert.throws(() => validasiEvent(tanpaPayload), /payload/);
  assert.throws(
    () => buatEvent("poem.submitted", POEM_ID, 0, payloadPuisi),
    GalatPermanen,
  );
  assert.throws(
    () => buatEvent("Poem-Submitted", POEM_ID, 1, payloadPuisi),
    GalatPermanen,
  );
});

test("uuidv5 sesuai vektor uji RFC (sama dengan uuid.uuid5 di Python)", () => {
  assert.equal(
    uuidv5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
    "886313e1-3b8a-5372-9b90-0c9aee199e5d",
  );
});

test("eventTurunan: id deterministik, mewarisi correlation dan traceparent", () => {
  const sumber = buatEvent(
    "poem.submitted",
    POEM_ID,
    1,
    payloadPuisi,
    {
      traceparent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  );

  const a = eventTurunan(
    sumber,
    "poem.emotion.analyzed",
    payloadEmosi,
    { producer: "emotion-worker" },
  );

  const b = eventTurunan(
    sumber,
    "poem.emotion.analyzed",
    payloadEmosi,
    { producer: "emotion-worker" },
  );

  const lain = eventTurunan(
    sumber,
    "poem.keywords.extracted",
    payloadKataKunci,
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
  assert.equal(a.aggregate_id, POEM_ID);
  assert.equal(a.aggregate_version, 1);
});
