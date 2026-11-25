import { test } from "node:test";
import assert from "node:assert/strict";
import { buatPembatasLaju } from "./rate-limit.js";

test("rate 10 membatasi publikasi dengan jeda minimal 100 ms", async () => {
  let waktu = 1000;
  const jeda = [];
  const waktuPublikasi = [];

  const limiter = buatPembatasLaju(10, {
    now: () => waktu,
    sleep: async (ms) => {
      jeda.push(ms);
      waktu += ms;
    },
  });

  const publisher = {
    async terbitkan(event) {
      waktuPublikasi.push(waktu);
    },
  };

  await limiter(publisher, { id: 1 });
  await limiter(publisher, { id: 2 });
  await limiter(publisher, { id: 3 });

  assert.equal(waktuPublikasi.length, 3);
  assert.deepEqual(jeda, [100, 100]);
  assert.deepEqual(waktuPublikasi, [1000, 1100, 1200]);
});

test("rate tidak valid ditolak", () => {
  assert.throws(() => buatPembatasLaju(0), /positif/);
  assert.throws(() => buatPembatasLaju(-1), /positif/);
});
