import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.SERVICE_NAME = "test-service";
process.env.NODE_ENV = "test";

const { createApp } = await import("../src/main.js");

let server;
let baseUrl;

before(async () => {
  server = createApp();
  server.listen(0, "127.0.0.1");

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

test("GET /health returns HTTP 200", async () => {
  const response = await fetch(`${baseUrl}/health`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "test-service");
});

test("Unknown endpoint returns HTTP 404", async () => {
  const response = await fetch(`${baseUrl}/unknown`);

  assert.equal(response.status, 404);
});
