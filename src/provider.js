import { performance } from "node:perf_hooks";
import { providerEndpoint } from "./config.js";

export function createExecutor(config) {
  const endpoint = providerEndpoint(config);
  return async (prompt, { signal } = {}) => {
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const started = performance.now();
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: combined,
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 1024,
          stream: false,
        }),
      });
    } catch {
      signal?.throwIfAborted();
      if (timeout.aborted) throw new Error("Provider request timed out.");
      throw new Error(
        "Could not reach the configured provider. Check the endpoint and network.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Provider returned HTTP ${response.status}. Check the model, API key, quota and provider compatibility.`,
      );
    }
    let data;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 2_000_000) throw new Error("Response too large.");
        chunks.push(Buffer.from(chunk));
      }
      // Buffer once to preserve UTF-8 sequences split across network chunks.
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      signal?.throwIfAborted();
      if (timeout.aborted) throw new Error("Provider response timed out.");
      throw new Error(
        "Provider returned an invalid or oversized JSON response.",
      );
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new Error(
        "Provider returned no text. Use a text chat-completions model.",
      );
    if (data.choices[0].finish_reason === "length")
      throw new Error(
        "Provider output was truncated at the token limit. Shorten the request.",
      );
    const tokens = data.usage?.total_tokens;
    return {
      output: content,
      latencyMs: Math.round(performance.now() - started),
      tokens: Number.isInteger(tokens) && tokens >= 0 ? tokens : null,
    };
  };
}
