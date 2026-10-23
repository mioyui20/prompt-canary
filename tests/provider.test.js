import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { getConfig, providerEndpoint } from "../src/config.js";
import { createExecutor } from "../src/provider.js";

async function stub(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: "test-model",
    apiKey: "test-secret",
    timeoutMs: 2000,
  };
}
test("endpoint configuration rejects insecure remote providers and URL credentials", () => {
  assert.throws(
    () =>
      providerEndpoint({
        baseUrl: "http://example.com",
        model: "x",
        apiKey: "k",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      providerEndpoint({
        baseUrl: "https://example.com?key=x",
        model: "x",
        apiKey: "k",
      }),
    /query/,
  );
  assert.throws(
    () =>
      providerEndpoint({
        baseUrl: "https://user:pass@example.com",
        model: "x",
        apiKey: "k",
      }),
    /credentials/,
  );
  assert.throws(
    () =>
      providerEndpoint({
        baseUrl: "https://example.com",
        model: "x",
        apiKey: "",
      }),
    /API_KEY/,
  );
  assert.equal(
    providerEndpoint({ baseUrl: "http://localhost:11434/v1/", model: "x" }),
    "http://localhost:11434/v1/chat/completions",
  );
  assert.throws(() => getConfig({ PORT: "bad" }), /PORT/);
});
test("real HTTP adapter preserves UTF-8, model, prompt and usage", async (t) => {
  let request;
  const config = await stub(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    request = {
      path: req.url,
      body: JSON.parse(Buffer.concat(chunks)),
      auth: req.headers.authorization,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    const body = Buffer.from(
      JSON.stringify({
        choices: [{ message: { content: "你好 🐤" }, finish_reason: "stop" }],
        usage: { total_tokens: 12 },
      }),
    );
    res.write(body.subarray(0, 45));
    res.end(body.subarray(45));
  });
  const result = await createExecutor(config)("literal {{input}}");
  assert.equal(result.output, "你好 🐤");
  assert.equal(result.tokens, 12);
  assert.ok(result.latencyMs >= 0);
  assert.equal(request.path, "/v1/chat/completions");
  assert.equal(request.auth, "Bearer test-secret");
  assert.equal(request.body.model, "test-model");
  assert.equal(request.body.messages[0].content, "literal {{input}}");
});
test("upstream error bodies do not leak into reports", async (t) => {
  const config = await stub(t, (req, res) => {
    res.writeHead(401);
    res.end("test-secret");
  });
  await assert.rejects(
    createExecutor(config)("input"),
    (error) =>
      /HTTP 401/.test(error.message) && !error.message.includes("test-secret"),
  );
});
test("timeouts fail clearly without hanging", async (t) => {
  const config = await stub(t, () => {});
  config.timeoutMs = 100;
  await assert.rejects(createExecutor(config)("input"), /timed out/);
});
test("truncated outputs are not scored as complete answers", async (t) => {
  const config = await stub(t, (req, res) =>
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "partial" }, finish_reason: "length" }],
      }),
    ),
  );
  await assert.rejects(createExecutor(config)("input"), /truncated/);
});
test("missing usage stays null instead of a fabricated zero", async (t) => {
  const config = await stub(t, (req, res) =>
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
  );
  assert.equal((await createExecutor(config)("input")).tokens, null);
});
