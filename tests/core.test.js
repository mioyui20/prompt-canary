import test from "node:test";
import assert from "node:assert/strict";
import { getPreset } from "../public/presets.js";
import {
  validateSuite,
  renderPrompt,
  evaluateChecks,
  runEvaluation,
  markdownReport,
} from "../public/core.js";

for (const language of ["en", "zh"]) {
  test(`${language} support fixtures give transparent, reproducible results`, async () => {
    const report = await runEvaluation(getPreset(language));
    assert.equal(report.summary.variants.a.passed, 3);
    assert.equal(report.summary.variants.b.passed, 5);
    assert.equal(report.summary.improvements, 2);
    assert.equal(report.summary.regressions, 0);
    assert.equal(report.summary.variants.a.averageLatencyMs, null);
    assert.equal(report.summary.variants.b.tokens, null);
    assert.equal(report.model, "prerecorded fixtures");
    assert.match(
      markdownReport(report, language),
      language === "zh" ? /预录/ : /prerecorded/,
    );
  });
  test(`${language} extraction fixtures validate JSON and typed fields`, async () => {
    const report = await runEvaluation(getPreset(language, "extract"));
    assert.equal(report.summary.variants.a.passed, 1);
    assert.equal(report.summary.variants.b.passed, 3);
  });
}
test("suite validation rejects ambiguous or unscored configurations", () => {
  for (const mutate of [
    (suite) => {
      suite.version = 2;
    },
    (suite) => {
      suite.prompts.a = "Missing placeholder";
    },
    (suite) => {
      suite.cases[0].checks = [];
    },
    (suite) => {
      suite.cases[1].id = suite.cases[0].id;
    },
    (suite) => {
      suite.cases[0].checks = [
        { type: "json_path", path: "constructor.name", value: "Object" },
      ];
    },
    (suite) => {
      suite.cases[0].checks = [{ type: "max_length", value: 1.2 }];
    },
    (suite) => {
      suite.cases[0].checks = [{ type: "unknown" }];
    },
    (suite) => {
      suite.cases[0].demo = {};
    },
  ]) {
    const suite = getPreset();
    mutate(suite);
    assert.throws(() => validateSuite(suite));
  }
});
test("substitution preserves dollar signs, placeholders and repeated input literally", () => {
  assert.equal(
    renderPrompt("{{input}} + {{input}}", "$& {{input}}"),
    "$& {{input}} + $& {{input}}",
  );
});
test("checks count Unicode code points and require strict JSON", () => {
  assert.equal(
    evaluateChecks("🐤好", [{ type: "max_length", value: 2 }])[0].passed,
    true,
  );
  assert.equal(
    evaluateChecks("```json\n{}\n```", [{ type: "json" }])[0].passed,
    false,
  );
  assert.equal(
    evaluateChecks('{"ok":false,"n":0}', [
      { type: "json_path", path: "ok", value: false },
    ])[0].passed,
    true,
  );
  assert.equal(
    evaluateChecks('{"ok":false}', [
      { type: "json_path", path: "ok", value: "false" },
    ])[0].passed,
    false,
  );
  assert.equal(
    evaluateChecks("{}", [
      { type: "json_path", path: "toString", value: "x" },
    ])[0].passed,
    false,
  );
  assert.equal(
    evaluateChecks("Order ID", [{ type: "contains", value: "order id" }])[0]
      .passed,
    true,
  );
});
test("demo playback never invokes an executor and rejects missing fixtures", async () => {
  await runEvaluation(getPreset(), {
    mode: "demo",
    execute: () => assert.fail("Model must not be called."),
  });
  const suite = getPreset();
  delete suite.cases[0].demo;
  await assert.rejects(runEvaluation(suite), /prerecorded/);
  await assert.rejects(runEvaluation(getPreset(), { repeat: 0 }), /Repeat/);
});
test("live runs are bounded, ordered and aggregate repeated outcomes", async () => {
  const suite = getPreset();
  suite.cases = suite.cases.slice(0, 1);
  let active = 0,
    maximum = 0,
    calls = 0;
  const report = await runEvaluation(suite, {
    mode: "live",
    repeat: 3,
    concurrency: 2,
    model: "stub",
    execute: async () => {
      const index = calls++;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return {
        output: index % 2 === 0 ? "Your order ID please." : "Hello.",
        latencyMs: 12,
        tokens: index === 0 ? null : 5,
      };
    },
  });
  assert.equal(maximum, 2);
  assert.equal(calls, 6);
  assert.equal(report.summary.variants.a.passRate, 1);
  assert.equal(report.summary.variants.b.passRate, 0);
  assert.equal(report.summary.regressions, 1);
  assert.equal(report.summary.variants.a.tokens, 10);
  assert.equal(report.summary.variants.a.tokenMeasurements, 2);
  assert.deepEqual(
    report.results.map((row) => row.variant),
    ["a", "b", "a", "b", "a", "b"],
  );
});
test("provider errors stay distinct from assertion failures", async () => {
  const suite = getPreset();
  suite.cases = suite.cases.slice(0, 1);
  const report = await runEvaluation(suite, {
    mode: "live",
    execute: async () => {
      throw new Error("Unavailable");
    },
  });
  assert.equal(report.summary.variants.a.errors, 1);
  assert.equal(report.results[0].checks.length, 0);
  assert.equal(report.results[0].error, "Unavailable");
});
test("abort stops scheduling new work", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    runEvaluation(getPreset(), {
      mode: "live",
      signal: controller.signal,
      concurrency: 1,
      execute: async () => {
        calls++;
        controller.abort();
        controller.signal.throwIfAborted();
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});
test("markdown output escapes table cells and describes failures", async () => {
  const suite = getPreset();
  suite.cases[0].name = "name | newline\nhere";
  const report = await runEvaluation(suite);
  const markdown = markdownReport(report);
  assert.ok(markdown.includes("name \\| newline here"));
  assert.match(markdown, /contains: "order ID"/);
});
