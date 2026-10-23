import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getConfig, loadEnv, providerEndpoint } from "./config.js";
import { createExecutor } from "./provider.js";
import { runEvaluation, ValidationError } from "../public/core.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
};
function json(res, status, body) {
  res.writeHead(status, {
    ...SECURITY,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  if (
    !req.headers["content-type"]?.toLowerCase().startsWith("application/json")
  ) {
    const error = new Error("Use Content-Type: application/json.");
    error.status = 415;
    throw error;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 512_000) {
      req.resume();
      const error = new Error("Request exceeds 512 KB.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("Request body is not valid JSON.");
  }
}
export function createApp(config = getConfig()) {
  let busy = false;
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || "";
      const localPort = req.socket.localPort;
      if (
        ![
          `127.0.0.1:${localPort}`,
          `localhost:${localPort}`,
          `[::1]:${localPort}`,
        ].includes(host)
      ) {
        return json(res, 403, {
          error: "This server accepts localhost requests only.",
        });
      }
      if (
        (req.headers.origin && req.headers.origin !== `http://${host}`) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        return json(res, 403, {
          error: "Cross-origin requests are not allowed.",
        });
      }
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === "/api/config" && req.method === "GET") {
        let liveAvailable = false;
        try {
          providerEndpoint(config);
          liveAvailable = true;
        } catch {
          /* UI offers configuration instructions */
        }
        return json(res, 200, {
          liveAvailable,
          model: config.model || null,
          version: "1.0.0",
        });
      }
      if (url.pathname === "/api/evaluate" && req.method === "POST") {
        if (busy)
          return json(res, 409, {
            error: "An evaluation is already running. Wait for it to finish.",
          });
        busy = true;
        const abort = new AbortController();
        res.once("close", () => {
          if (!res.writableEnded) abort.abort();
        });
        try {
          const body = await readJson(req);
          if (!body || body.mode !== "live")
            throw new ValidationError(
              "API mode must be live. Demo runs entirely in the browser.",
            );
          const execute = createExecutor(config);
          const report = await runEvaluation(body.suite, {
            mode: "live",
            repeat: body.repeat ?? 1,
            execute,
            model: config.model,
            signal: abort.signal,
          });
          if (!res.destroyed) json(res, 200, report);
        } finally {
          busy = false;
        }
        return;
      }
      if (url.pathname.startsWith("/api/"))
        return json(res, 404, { error: "API route not found." });
      if (!["GET", "HEAD"].includes(req.method))
        return json(res, 405, { error: "Method not allowed." });
      let decoded;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        return json(res, 400, { error: "Invalid URL." });
      }
      const target = path.resolve(
        PUBLIC,
        `.${decoded === "/" ? "/index.html" : decoded}`,
      );
      if (
        !target.startsWith(PUBLIC) ||
        !TYPES[path.extname(target)] ||
        decoded.includes("\\")
      )
        return json(res, 404, { error: "File not found." });
      let content;
      try {
        content = await readFile(target);
      } catch {
        return json(res, 404, { error: "File not found." });
      }
      res.writeHead(200, {
        ...SECURITY,
        "Content-Type": TYPES[path.extname(target)],
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      json(
        res,
        error.status ?? (error instanceof ValidationError ? 400 : 500),
        {
          error:
            error instanceof ValidationError || error.status
              ? error.message
              : "Request failed. Check the local server and provider configuration.",
        },
      );
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  loadEnv();
  const config = getConfig();
  const server = createApp(config);
  server.listen(config.port, config.host, () => {
    console.log(
      `\n  PromptCanary → http://${config.host}:${server.address().port}\n  Demo needs no key · 演示无需 API Key\n  Live mode reads .env · 真实调用请配置 .env\n`,
    );
  });
  server.on("error", (error) => {
    console.error(`Could not start server: ${error.message}`);
    process.exitCode = 1;
  });
}
