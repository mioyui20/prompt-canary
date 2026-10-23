import { readFileSync } from "node:fs";
import { ValidationError } from "../public/core.js";

export function loadEnv(path = ".env", target = process.env) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(target, match[1])) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    target[match[1]] = value;
  }
}
export function getConfig(env = process.env) {
  const port = Number(env.PORT || 3210);
  const timeoutMs = Number(env.LLM_TIMEOUT_MS || 45000);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new ValidationError("PORT must be an integer between 0 and 65535.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000)
    throw new ValidationError("LLM_TIMEOUT_MS must be between 100 and 120000.");
  return {
    host: "127.0.0.1",
    port,
    baseUrl: (env.LLM_BASE_URL || "").trim(),
    model: (env.LLM_MODEL || "").trim(),
    apiKey: (env.LLM_API_KEY || "").trim(),
    timeoutMs,
  };
}
export function providerEndpoint(config) {
  if (!config.baseUrl || !config.model)
    throw new ValidationError(
      "Set LLM_BASE_URL and LLM_MODEL in .env to use live mode.",
    );
  let url;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new ValidationError("LLM_BASE_URL must be an absolute URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    throw new ValidationError(
      "Use HTTPS for remote providers; HTTP is allowed only on localhost.",
    );
  if (url.username || url.password || url.search || url.hash)
    throw new ValidationError(
      "LLM_BASE_URL cannot include credentials, a query or a fragment.",
    );
  if (!loopback && !config.apiKey)
    throw new ValidationError("Set LLM_API_KEY for a remote provider.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions"))
    url.pathname += "/chat/completions";
  return url.toString();
}
