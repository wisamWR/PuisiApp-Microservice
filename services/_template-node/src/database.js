import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "./config.js";

const { Pool } = pg;
const ADVISORY_LOCK_KEY = "734215001";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, "../migrations");

export function createPool() {
  const config = loadConfig();

  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL belum dikonfigurasi");
  }

  return new Pool({
    connectionString: config.databaseUrl,
  });
}

export async function runMigrations({ createPublication = false } = {}) {
  const pool = createPool();
  const client = await pool.connect();
  const executed = [];
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      ADVISORY_LOCK_KEY,
    ]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrasi (
        nama TEXT PRIMARY KEY,
        dijalankan_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const result = await client.query("SELECT nama FROM schema_migrasi");

    const applied = new Set(result.rows.map((row) => row.nama));

    const migrationFiles = ["001_processed_event.sql", "002_outbox.sql"];

    for (const name of migrationFiles) {
      if (applied.has(name)) {
        continue;
      }

      const sql = (
        await readFile(path.join(migrationDir, name), "utf8")
      ).replace(/^\uFEFF/, "");

      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrasi (nama) VALUES ($1)", [
          name,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      executed.push(name);
    }

    if (createPublication) {
      const table = await client.query(
        "SELECT to_regclass('public.outbox') AS table_name",
      );

      if (!table.rows[0].table_name) {
        throw new Error("Tabel public.outbox belum tersedia");
      }

      const publication = await client.query(
        "SELECT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = $1) AS exists",
        ["outbox_pub"],
      );

      if (!publication.rows[0].exists) {
        await client.query(`
          CREATE PUBLICATION outbox_pub
          FOR TABLE public.outbox
          WITH (publish = 'insert')
        `);
      }
    }

    return executed;
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [
          ADVISORY_LOCK_KEY,
        ]);
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
}
