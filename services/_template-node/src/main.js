import { createServer } from "node:http";

const SERVICE_NAME = process.env.SERVICE_NAME || "node-service";
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

export function createApp() {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const response = {
        status: "ok",
        service: SERVICE_NAME,
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

if (process.env.NODE_ENV !== "test") {
  const server = createApp();

  server.listen(PORT, HOST, () => {
    console.log(`${SERVICE_NAME} berjalan pada ${HOST}:${PORT}`);
  });
}
