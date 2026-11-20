
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from '../../libs/node/node_modules/ajv/dist/2020.js';
import addFormats from '../../libs/node/node_modules/ajv-formats/dist/index.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function main() {
  const [eventType, payloadFile] = process.argv.slice(2);

  if (!eventType || !payloadFile || !/^[a-z][a-z0-9._-]*$/.test(eventType)) {
    console.error(
      'Penggunaan: node tools/validate-event/index.js <event_type> <payload.json>',
    );
    process.exit(1);
  }

  const schemaPath = path.join(
    ROOT,
    'contracts',
    'events',
    `${eventType}.v1.json`,
  );

  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const payloadPath = path.resolve(process.cwd(), payloadFile);
  const payloadText = readFileSync(payloadPath, 'utf8').replace(/^\uFEFF/, '');
  const payload = JSON.parse(payloadText);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const validate = ajv.compile(schema);

  if (!validate(payload)) {
    console.error(`Payload ${eventType} TIDAK VALID:`);
    console.error(JSON.stringify(validate.errors, null, 2));
    process.exit(1);
  }

  console.log(`Payload ${eventType} VALID.`);
}

try {
  main();
} catch (error) {
  console.error(`Validasi gagal: ${error.message}`);
  process.exit(1);
}
