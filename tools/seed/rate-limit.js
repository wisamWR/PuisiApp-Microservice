export function buatPembatasLaju(rate, {
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Rate harus berupa angka positif.");
  }

  let lastPublishAt = 0;

  return async function terbitkanDenganRate(publisher, event) {
    if (lastPublishAt > 0) {
      const jeda = 1000 / rate - (now() - lastPublishAt);
      if (jeda > 0) await sleep(jeda);
    }

    await publisher.terbitkan(event);
    lastPublishAt = now();
  };
}
