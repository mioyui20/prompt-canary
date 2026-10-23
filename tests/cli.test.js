import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const run = (args) =>
  spawnSync(process.execPath, ["src/cli.js", ...args], { encoding: "utf8" });
test("CLI runs offline fixtures as JSON without a key", () => {
  const result = run([
    "--suite",
    "examples/support.en.json",
    "--demo",
    "--format",
    "json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "demo");
  assert.equal(report.summary.improvements, 2);
});
test("CLI has actionable help and rejects unknown options", () => {
  assert.match(run(["--help"]).stdout, /--fail-on-regression/);
  assert.equal(run(["--surprise"]).status, 2);
});
