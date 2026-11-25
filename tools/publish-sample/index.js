#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import {
  buatEvent,
  buatPublisher,
  hubungkan,
} from '@puisiapp/events';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const EVENTS_DIR = path.join(ROOT, 'contracts', 'events');
const ROUTING_FILE = path.join(ROOT, 'contracts', 'routing.json');

function parseArgs() {
  const args = process.argv.slice(2);

  let count = 1;
  let rate = 1;
  let eventType;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help') {
      console.log(
        'Penggunaan: node --env-file=.env tools/publish-sample/index.js [event_type] --count 5 --rate 2',
      );
      process.exit(0);
    }

    if (arg === '--count' || arg === '--rate') {
      const rawValue = args[++i];

      if (rawValue === undefined || rawValue.startsWith('--')) {
        throw new Error(`Nilai untuk ${arg} wajib diisi.`);
      }

      const value = Number(rawValue);

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Nilai ${arg} harus berupa angka positif.`);
      }

      if (arg === '--count') {
        if (!Number.isInteger(value)) {
          throw new Error('--count harus berupa bilangan bulat.');
        }

        count = value;
      } else {
        rate = value;
      }

      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Opsi tidak dikenal: ${arg}`);
    }

    if (eventType) {
      throw new Error('Hanya satu event_type yang boleh diberikan.');
    }

    eventType = arg;
  }

  return { count, rate, eventType };
}

function loadSchemas() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  addFormats(ajv);

  const schemas = new Map();

  const files = readdirSync(EVENTS_DIR)
    .filter((name) => /^[a-z][a-z0-9._-]*\.v1\.json$/.test(name))
    .sort();

  for (const file of files) {
    const schema = JSON.parse(
      readFileSync(path.join(EVENTS_DIR, file), 'utf8'),
    );

    const eventType = file.replace(/\.v1\.json$/, '');

    schemas.set(eventType, {
      validate: ajv.compile(schema),
      examples: schema.examples,
    });
  }

  return schemas;
}

function samplePayload(eventType, schemaData) {
  const { examples } = schemaData;

  if (!Array.isArray(examples) || examples.length === 0) {
    throw new Error(
      `Payload contoh untuk ${eventType} belum tersedia.`,
    );
  }

  return structuredClone(examples[0]);
}

async function main() {
  const { count, rate, eventType } = parseArgs();

  const routing = JSON.parse(
    readFileSync(ROUTING_FILE, 'utf8'),
  );

  const registered = new Set(
    Object.values(routing.exchanges).flat(),
  );

  const schemas = loadSchemas();

  const targets = eventType
    ? [eventType]
    : [...schemas.keys()];

  for (const type of targets) {
    if (!registered.has(type)) {
      throw new Error(
        `Event ${type} tidak terdaftar di contracts/routing.json.`,
      );
    }

    if (!schemas.has(type)) {
      throw new Error(
        `Skema payload ${type} belum tersedia di contracts/events.`,
      );
    }

    if (
      !Array.isArray(schemas.get(type).examples) ||
      schemas.get(type).examples.length === 0
    ) {
      throw new Error(
        `Payload contoh untuk ${type} belum tersedia.`,
      );
    }
  }

  const connection = await hubungkan({
    keluarSaatPutus: false,
  });

  let publisher;

  try {
    publisher = await buatPublisher(connection);

    let published = 0;
    const total = targets.length * count;
    const interval = 1000 / rate;

    let lastPublishedAt = 0;

    for (const type of targets) {
      const schemaData = schemas.get(type);

      for (let i = 0; i < count; i++) {
        if (lastPublishedAt > 0) {
          const elapsed = Date.now() - lastPublishedAt;
          const delay = interval - elapsed;

          if (delay > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, delay),
            );
          }
        }

        const payload = samplePayload(type, schemaData);

        if (!schemaData.validate(payload)) {
          throw new Error(
            `Payload ${type} tidak valid: ${
              JSON.stringify(schemaData.validate.errors)
            }`,
          );
        }

        const event = buatEvent(
          type,
          `sample-${type.replaceAll('.', '-')}-${randomUUID()}`,
          i + 1,
          payload,
          { producer: 'publish-sample' },
        );

        await publisher.terbitkan(event);

        lastPublishedAt = Date.now();
        published++;

        console.log(
          `Published ${type} (${published}/${total})`,
        );
      }
    }

    console.log(
      `Selesai. Total event diterbitkan: ${published}`,
    );
  } finally {
    if (publisher) {
      await publisher.tutup();
    }

    await connection.close();
  }
}

main().catch((error) => {
  console.error('publish-sample gagal:', error.message);
  process.exitCode = 1;
});
