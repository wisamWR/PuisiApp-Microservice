/**
 * Membaca kontrak bersama dari folder /contracts:
 *   - envelope.v1.json : skema amplop event (satu-satunya sumber)
 *   - routing.json     : peta event_type -> topic exchange
 *
 * Lokasi folder: variabel CONTRACTS_DIR, atau <root-repo>/contracts
 * (struktur folder yang sama dipakai di dalam image Docker).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { GalatPermanen } from './galat.js';

const folderIni = path.dirname(fileURLToPath(import.meta.url));

export function folderKontrak() {
  return process.env.CONTRACTS_DIR ?? path.resolve(folderIni, '../../../contracts');
}

function bacaJson(nama) {
  const berkas = path.join(folderKontrak(), nama);
  return JSON.parse(readFileSync(berkas, 'utf8'));
}

let validator;
function ambilValidator() {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    validator = ajv.compile(bacaJson('envelope.v1.json'));
  }
  return validator;
}

/**
 * Lempar GalatPermanen bila event tidak sesuai envelope.v1.json.
 * @param {unknown} event
 */
export function validasiEvent(event) {
  const validasi = ambilValidator();
  if (!validasi(event)) {
    const rincian = (validasi.errors ?? [])
      .map((e) => `${e.instancePath || '(akar)'} ${e.message}`)
      .join('; ');
    throw new GalatPermanen(`Amplop event tidak valid: ${rincian}`);
  }
  return /** @type {import('./amplop.js').Event} */ (event);
}

let petaRouting;
/** @returns {Map<string, string>} event_type -> exchange */
export function ambilPetaRouting() {
  if (!petaRouting) {
    const { exchanges } = bacaJson('routing.json');
    petaRouting = new Map();
    for (const [exchange, daftarEvent] of Object.entries(exchanges)) {
      for (const eventType of daftarEvent) {
        if (petaRouting.has(eventType)) {
          throw new Error(`routing.json: ${eventType} terdaftar di dua exchange`);
        }
        petaRouting.set(eventType, exchange);
      }
    }
  }
  return petaRouting;
}

/**
 * Nama topic exchange untuk satu event_type. Event yang tidak terdaftar di
 * routing.json ditolak, sesuai aturan kontrak.
 * @param {string} eventType
 */
export function exchangeUntuk(eventType) {
  const exchange = ambilPetaRouting().get(eventType);
  if (!exchange) {
    throw new GalatPermanen(`Event ${eventType} tidak terdaftar di contracts/routing.json`);
  }
  return exchange;
}

/** Hanya untuk pengujian: paksa kontrak dibaca ulang. */
export function _resetCacheKontrak() {
  validator = undefined;
  petaRouting = undefined;
}
