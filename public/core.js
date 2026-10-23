// Shared by the browser, server and CLI. No framework or model SDK required.
export const VERSION = 1;
const CHECKS = new Set([
  "contains",
  "not_contains",
  "json",
  "json_path",
  "max_length",
]);
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}
const requireThat = (condition, message) => {
  if (!condition) throw new ValidationError(message);
};
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function boundedText(value, label, max, allowEmpty = false) {
  requireThat(
    typeof value === "string" &&
      (allowEmpty || value.trim().length > 0) &&
      value.length <= max,
    `${label}: expected ${allowEmpty ? "a" : "a non-empty"} string (max ${max} characters).`,
  );
  return value;
}
export function validateSuite(source) {
  requireThat(isObject(source), "Suite must be a JSON object.");
  requireThat(source.version === VERSION, "Suite version must be 1.");
  const name = boundedText(source.name, "Suite name", 120);
  requireThat(isObject(source.prompts), "Provide prompts.a and prompts.b.");
  const prompts = {};
  for (const key of ["a", "b"]) {
    prompts[key] = boundedText(
      source.prompts[key],
      `Prompt ${key.toUpperCase()}`,
      12000,
    );
    requireThat(
      prompts[key].includes("{{input}}"),
      `Prompt ${key.toUpperCase()} must contain {{input}}.`,
    );
  }
  requireThat(
    Array.isArray(source.cases) &&
      source.cases.length > 0 &&
      source.cases.length <= 20,
    "Provide between 1 and 20 test cases.",
  );
  const ids = new Set();
  const cases = source.cases.map((item, index) => {
    requireThat(isObject(item), `Case ${index + 1} must be an object.`);
    const id = boundedText(item.id, `Case ${index + 1} ID`, 80);
    requireThat(!ids.has(id), `Duplicate case ID: ${id}`);
    ids.add(id);
    const input = boundedText(item.input, `${id} input`, 12000);
    const label = boundedText(item.name ?? id, `${id} name`, 160);
    requireThat(
      Array.isArray(item.checks) &&
        item.checks.length > 0 &&
        item.checks.length <= 10,
      `${id}: provide between 1 and 10 checks.`,
    );
    const checks = item.checks.map((check) => {
      requireThat(
        isObject(check) && CHECKS.has(check.type),
        `${id}: unknown check type.`,
      );
      if (check.type === "json") return { type: check.type };
      if (check.type === "max_length") {
        requireThat(
          Number.isInteger(check.value) &&
            check.value >= 1 &&
            check.value <= 64000,
          `${id}: max_length must be an integer between 1 and 64000.`,
        );
        return { type: check.type, value: check.value };
      }
      if (check.type === "json_path") {
        const path = boundedText(check.path, `${id} JSON path`, 200);
        requireThat(
          path
            .split(".")
            .every(
              (part) =>
                /^[\w-]+$/.test(part) &&
                !["__proto__", "prototype", "constructor"].includes(part),
            ),
          `${id}: invalid JSON path.`,
        );
        requireThat(
          check.value !== undefined &&
            (check.value === null ||
              ["string", "number", "boolean"].includes(typeof check.value)),
          `${id}: JSON path value must be a scalar.`,
        );
        requireThat(
          typeof check.value !== "number" || Number.isFinite(check.value),
          `${id}: invalid numeric value.`,
        );
        if (typeof check.value === "string")
          boundedText(check.value, `${id} expected value`, 4000, true);
        return { type: check.type, path, value: check.value };
      }
      return {
        type: check.type,
        value: boundedText(check.value, `${id} check value`, 4000),
      };
    });
    const result = { id, name: label, input, checks };
    if (item.demo !== undefined) {
      requireThat(
        isObject(item.demo),
        `${id}: demo must provide a and b output strings.`,
      );
      result.demo = {};
      for (const key of ["a", "b"])
        result.demo[key] = boundedText(
          item.demo[key],
          `${id} demo.${key}`,
          64000,
          true,
        );
    }
    return result;
  });
  return { version: VERSION, name, prompts, cases };
}
export function renderPrompt(template, input) {
  // A callback keeps literal $&, $` and $' in user inputs intact.
  return template.replaceAll("{{input}}", () => input);
}
export function evaluateChecks(output, checks) {
  let parsed,
    validJson = false;
  try {
    parsed = JSON.parse(output);
    validJson = true;
  } catch {
    /* strict JSON: no markdown fences */
  }
  return checks.map((check) => {
    let passed = false;
    if (check.type === "contains")
      passed = output
        .toLocaleLowerCase()
        .includes(check.value.toLocaleLowerCase());
    if (check.type === "not_contains")
      passed = !output
        .toLocaleLowerCase()
        .includes(check.value.toLocaleLowerCase());
    if (check.type === "json") passed = validJson;
    if (check.type === "max_length") passed = [...output].length <= check.value;
    if (check.type === "json_path" && validJson) {
      let value = parsed;
      for (const part of check.path.split(".")) {
        value =
          value !== null &&
          typeof value === "object" &&
          Object.hasOwn(value, part)
            ? value[part]
            : undefined;
      }
      passed = value === check.value;
    }
    return { ...check, passed };
  });
}
export function aggregate(results) {
  const variants = {};
  for (const key of ["a", "b"]) {
    const rows = results.filter((row) => row.variant === key);
    const timed = rows.filter((row) => Number.isFinite(row.latencyMs));
    const metered = rows.filter((row) => Number.isInteger(row.tokens));
    variants[key] = {
      total: rows.length,
      passed: rows.filter((row) => row.passed).length,
      errors: rows.filter((row) => row.error).length,
      passRate: rows.length
        ? rows.filter((row) => row.passed).length / rows.length
        : 0,
      averageLatencyMs: timed.length
        ? Math.round(
            timed.reduce((n, row) => n + row.latencyMs, 0) / timed.length,
          )
        : null,
      tokens: metered.length
        ? metered.reduce((n, row) => n + row.tokens, 0)
        : null,
      tokenMeasurements: metered.length,
    };
  }
  const changes = [...new Set(results.map((row) => row.caseId))].map(
    (caseId) => {
      const rates = ["a", "b"].map((key) => {
        const rows = results.filter(
          (row) => row.caseId === caseId && row.variant === key,
        );
        return rows.length
          ? rows.filter((row) => row.passed).length / rows.length
          : 0;
      });
      return {
        caseId,
        a: rates[0],
        b: rates[1],
        status:
          rates[1] > rates[0]
            ? "improved"
            : rates[1] < rates[0]
              ? "regressed"
              : "unchanged",
      };
    },
  );
  return {
    variants,
    changes,
    regressions: changes.filter((row) => row.status === "regressed").length,
    improvements: changes.filter((row) => row.status === "improved").length,
  };
}
export async function runEvaluation(source, options = {}) {
  const suite = validateSuite(source);
  const mode = options.mode ?? "demo";
  requireThat(["demo", "live"].includes(mode), "Mode must be demo or live.");
  const repeat = options.repeat ?? 1;
  requireThat(
    Number.isInteger(repeat) && repeat >= 1 && repeat <= 3,
    "Repeat must be 1, 2 or 3.",
  );
  if (mode === "demo")
    requireThat(
      suite.cases.every((item) => item.demo),
      "Demo needs prerecorded demo.a and demo.b fixtures for every case.",
    );
  if (mode === "live")
    requireThat(
      typeof options.execute === "function",
      "Live mode needs a model executor.",
    );
  const jobs = suite.cases.flatMap((item) =>
    Array.from({ length: repeat }, (_, run) =>
      ["a", "b"].map((variant) => ({ item, run: run + 1, variant })),
    ).flat(),
  );
  const results = new Array(jobs.length);
  let cursor = 0;
  const startedAt = new Date().toISOString();
  async function worker() {
    while (cursor < jobs.length) {
      options.signal?.throwIfAborted();
      const index = cursor++;
      const { item, run, variant } = jobs[index];
      let row = {
        caseId: item.id,
        caseName: item.name,
        input: item.input,
        run,
        variant,
        output: "",
        latencyMs: null,
        tokens: null,
        error: null,
        passed: false,
        checks: [],
      };
      try {
        const value =
          mode === "demo"
            ? { output: item.demo[variant], latencyMs: null, tokens: null }
            : await options.execute(
                renderPrompt(suite.prompts[variant], item.input),
                { signal: options.signal },
              );
        requireThat(
          typeof value.output === "string" && value.output.length <= 64000,
          "Model output must be a string of at most 64000 characters.",
        );
        const checks = evaluateChecks(value.output, item.checks);
        row = {
          ...row,
          output: value.output,
          checks,
          passed: checks.every((check) => check.passed),
          latencyMs:
            Number.isFinite(value.latencyMs) && value.latencyMs >= 0
              ? Math.round(value.latencyMs)
              : null,
          tokens:
            Number.isInteger(value.tokens) && value.tokens >= 0
              ? value.tokens
              : null,
        };
      } catch (error) {
        options.signal?.throwIfAborted();
        row.error = error.message || "Model request failed.";
      }
      results[index] = row;
      options.onProgress?.({
        completed: results.filter(Boolean).length,
        total: jobs.length,
      });
    }
  }
  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  );
  return {
    version: VERSION,
    name: suite.name,
    mode,
    repeat,
    startedAt,
    finishedAt: new Date().toISOString(),
    model:
      mode === "demo"
        ? "prerecorded fixtures"
        : (options.model ?? "configured model"),
    prompts: suite.prompts,
    results,
    summary: aggregate(results),
  };
}
export function markdownReport(report, language = "en") {
  const zh = language === "zh";
  const escape = (value) =>
    String(value)
      .replaceAll("|", "\\|")
      .replaceAll("\n", " ")
      .replaceAll("\r", " ");
  const rate = (value) => `${Math.round(value * 100)}%`;
  const lines = [
    `# PromptCanary · ${escape(report.name)}`,
    "",
    `${zh ? "模式" : "Mode"}: **${report.mode}** · ${zh ? "模型" : "Model"}: ${escape(report.model)} · ${report.startedAt}`,
    "",
    report.mode === "demo"
      ? zh
        ? "> 演示为预录输出回放；不调用模型，不反映编辑后的提示词效果，也不测量延迟或 Token。"
        : "> Demo replays prerecorded outputs. It does not call a model, respond to prompt edits, or measure latency/tokens."
      : zh
        ? "> 通过率表示规则检查通过率，不代表通用回答质量。结果受模型随机性影响。"
        : "> Pass rates measure configured checks, not general answer quality. Model outputs can vary.",
    "",
    `| ${zh ? "版本" : "Variant"} | ${zh ? "通过" : "Passed"} | ${zh ? "规则通过率" : "Check pass rate"} | ${zh ? "平均延迟" : "Avg latency"} | Tokens |`,
    "| --- | --- | --- | --- | --- |",
  ];
  for (const key of ["a", "b"]) {
    const stat = report.summary.variants[key];
    lines.push(
      `| ${key.toUpperCase()} | ${stat.passed}/${stat.total} | ${rate(stat.passRate)} | ${stat.averageLatencyMs === null ? "—" : `${stat.averageLatencyMs} ms`} | ${stat.tokens === null ? "—" : `${stat.tokens} (${stat.tokenMeasurements}/${stat.total})`} |`,
    );
  }
  lines.push(
    "",
    `${zh ? "改善用例" : "Improved cases"}: ${report.summary.improvements} · ${zh ? "退化用例" : "Regressed cases"}: ${report.summary.regressions}`,
    "",
    `| ${zh ? "用例" : "Case"} | ${zh ? "版本" : "Variant"} | ${zh ? "轮次" : "Run"} | ${zh ? "结果" : "Result"} | ${zh ? "失败规则 / 错误" : "Failed checks / error"} |`,
    "| --- | --- | --- | --- | --- |",
  );
  for (const row of report.results) {
    const failures = row.checks
      .filter((check) => !check.passed)
      .map(
        (check) =>
          check.type +
          (check.path ? ` ${check.path}` : "") +
          (check.value !== undefined ? `: ${JSON.stringify(check.value)}` : ""),
      );
    lines.push(
      `| ${escape(row.caseName)} | ${row.variant.toUpperCase()} | ${row.run} | ${row.passed ? "PASS" : "FAIL"} | ${escape(row.error ?? failures.join("; "))} |`,
    );
  }
  return lines.join("\n") + "\n";
}
