import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { createApp } from "../src/server.js";
import { getPreset } from "../public/presets.js";

async function app(t, config = {}) {
  const server = createApp({
    baseUrl: "",
    model: "",
    apiKey: "",
    timeoutMs: 2000,
    ...config,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, body, headers = {}) =>
  fetch(`${base}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
test("static UI and public config never expose server API keys", async (t) => {
  const base = await app(t, { apiKey: "never-send-this-key" });
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.match(await response.text(), /PromptCanary/);
  const config = await fetch(`${base}/api/config`);
  const text = await config.text();
  assert.ok(!text.includes("never-send-this-key"));
  assert.equal(JSON.parse(text).liveAvailable, false);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%5c.env`)).status, 404);
});
test("cross-origin and rebinding-style requests are rejected", async (t) => {
  const base = await app(t);
  assert.equal(
    (await post(base, {}, { Origin: "https://attacker.example" })).status,
    403,
  );
  const rebindingStatus = await new Promise((resolve, reject) => {
    const request = http.request(
      `${base}/api/config`,
      { headers: { Host: "attacker.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(rebindingStatus, 403);
});
test("invalid, oversized and unsupported bodies fail with actionable status codes", async (t) => {
  const base = await app(t);
  assert.equal((await post(base, "{broken")).status, 400);
  assert.equal((await post(base, null)).status, 400);
  assert.equal((await post(base, { mode: "demo" })).status, 400);
  const huge = await post(base, JSON.stringify({ value: "x".repeat(520000) }));
  assert.equal(huge.status, 413);
  assert.equal(
    (await fetch(`${base}/api/evaluate`, { method: "POST", body: "{}" }))
      .status,
    415,
  );
});
test("live endpoint executes the actual provider adapter with bounded requests", async (t) => {
  let calls = 0;
  const provider = http.createServer(async (req, res) => {
    calls++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(body.model, "stub-model");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "Please share your order ID." } }],
        usage: { total_tokens: 8 },
      }),
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(() => {
    provider.closeAllConnections();
    provider.close();
  });
  const base = await app(t, {
    baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
    model: "stub-model",
  });
  const suite = getPreset();
  suite.cases = suite.cases.slice(0, 1);
  const response = await post(base, { mode: "live", suite, repeat: 2 });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(calls, 4);
  assert.equal(report.results.length, 4);
  assert.equal(report.summary.variants.b.tokens, 16);
  assert.equal(report.summary.variants.a.passRate, 1);
});
