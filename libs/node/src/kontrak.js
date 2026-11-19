
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { GalatPermanen } from './galat.js';

const folderIni = path.dirname(fileURLToPath(import.meta.url));

export function folderKontrak() {
  return process.env.CONTRACTS_DIR
    ?? path.resolve(folderIni, '../../../contracts');
}

function bacaJson(nama) {
  const berkas = path.join(folderKontrak(), nama);
  const isi = readFileSync(berkas, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(isi);
}

let ajv;
let validatorEnvelope;

function ambilAjv() {
  if (!ajv) {
    ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      allowUnionTypes: true,
    });
    addFormats(ajv);
  }

  return ajv;
}

function ambilValidatorEnvelope() {
  if (!validatorEnvelope) {
    validatorEnvelope = ambilAjv().compile(
      bacaJson('envelope.v1.json'),
    );
  }

  return validatorEnvelope;
}


function rincianValidasi(errors) {
  return (errors ?? [])
    .map((error) => {
      const lokasi = error.instancePath || '(akar)';
      return `${lokasi} ${error.message}`;
    })
    .join('; ');
}

export function validasiEvent(event) {
  const validasiEnvelope = ambilValidatorEnvelope();

  if (!validasiEnvelope(event)) {
    throw new GalatPermanen(
      `Amplop event tidak valid: ${rincianValidasi(validasiEnvelope.errors)}`,
    );
  }

  return event;
}

let petaRouting;

export function ambilPetaRouting() {
  if (!petaRouting) {
    const { exchanges } = bacaJson('routing.json');
    petaRouting = new Map();

    for (const [exchange, daftarEvent] of Object.entries(exchanges)) {
      for (const eventType of daftarEvent) {
        if (petaRouting.has(eventType)) {
          throw new Error(
            `routing.json: ${eventType} terdaftar di dua exchange`,
          );
        }

        petaRouting.set(eventType, exchange);
      }
    }
  }

  return petaRouting;
}

export function exchangeUntuk(eventType) {
  const exchange = ambilPetaRouting().get(eventType);

  if (!exchange) {
    throw new GalatPermanen(
      `Event ${eventType} tidak terdaftar di routing.json`,
    );
  }

  return exchange;
}

export function _resetCacheKontrak() {
  ajv = undefined;
  validatorEnvelope = undefined;
  petaRouting = undefined;
}
