import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buatLogger, jalankanMigrasi } from "@puisiapp/events";
import { loadConfig } from "./config.js";

const { Pool } = pg;

const config = loadConfig();
const log = buatLogger(config.serviceName);

export function createApp() {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const response = {
        status: "ok",
        service: config.serviceName,
      };

      res.writeHead(200, {
        "Content-Type": "application/json",
      });

      res.end(JSON.stringify(response));
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json",
    });

    res.end(JSON.stringify({ error: "Not Found" }));
  });
}

async function main() {
  if (config.databaseUrl) {
    const pool = new Pool({
      connectionString: config.databaseUrl,
    });

    try {
      // processed_event dari libs/node selalu dibuat; outbox + publication
      // hanya untuk layanan yang menerbitkan event (OUTBOX=true).
      await jalankanMigrasi(pool, {
        folder: fileURLToPath(new URL("../migrations", import.meta.url)),
        outbox: process.env.OUTBOX === "true",
        log,
      });
      log.info("migrasi database selesai");
    } finally {
      await pool.end();
    }
  }

  const server = createApp();

  server.listen(config.port, config.host, () => {
    log.info("service berjalan", {
      host: config.host,
      port: config.port,
    });
  });
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    log.error("service gagal dijalankan", { err: error });
    process.exitCode = 1;
  });
}
