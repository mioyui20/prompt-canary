#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { runEvaluation, markdownReport } from "../public/core.js";
import { loadEnv, getConfig } from "./config.js";
import { createExecutor } from "./provider.js";

const HELP = `PromptCanary — tiny prompt regression tests / 轻量提示词回归测试

node src/cli.js --suite examples/support.en.json --demo
node src/cli.js --suite examples/support.zh.json --format json --out report.json

--suite PATH           JSON suite (required) / 测试集路径
--demo                 Replay fixtures; no model calls / 预录回放，不调用模型
--repeat 1|2|3         Runs per case and variant (default: 1) / 每个用例每版的运行次数
--format markdown|json Output format (default: markdown) / 输出格式
--lang en|zh          Report language (default: en) / 报告语言
--out PATH             Save report instead of stdout / 保存报告
--fail-on-regression   Exit 1 if B regresses on any case / 存在退化时退出码为 1
--help                 Show help / 显示帮助

Live mode uses LLM_BASE_URL, LLM_MODEL and LLM_API_KEY from .env.
真实调用从 .env 读取接口地址、模型与 API Key。
`;
function parseArgs(args) {
  const result = {
    format: "markdown",
    lang: "en",
    repeat: 1,
    demo: false,
    fail: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") {
      result.help = true;
      continue;
    }
    if (arg === "--demo") {
      result.demo = true;
      continue;
    }
    if (arg === "--fail-on-regression") {
      result.fail = true;
      continue;
    }
    if (["--suite", "--repeat", "--format", "--lang", "--out"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}.`);
      result[arg.slice(2)] = arg === "--repeat" ? Number(value) : value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!["markdown", "json"].includes(result.format))
    throw new Error("--format must be markdown or json.");
  if (!["en", "zh"].includes(result.lang))
    throw new Error("--lang must be en or zh.");
  return result;
}
try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
  } else {
    if (!args.suite)
      throw new Error("Provide --suite PATH. Use --help for examples.");
    loadEnv();
    const config = getConfig();
    const suite = JSON.parse(await readFile(args.suite, "utf8"));
    const report = await runEvaluation(suite, {
      mode: args.demo ? "demo" : "live",
      repeat: args.repeat,
      ...(args.demo
        ? {}
        : { execute: createExecutor(config), model: config.model }),
    });
    const output =
      args.format === "json"
        ? JSON.stringify(report, null, 2) + "\n"
        : markdownReport(report, args.lang);
    if (args.out) await writeFile(args.out, output, "utf8");
    else process.stdout.write(output);
    if (args.fail && report.summary.regressions > 0) process.exitCode = 1;
    if (report.results.some((row) => row.error)) process.exitCode = 2;
  }
} catch (error) {
  console.error(`PromptCanary: ${error.message}`);
  process.exitCode = 2;
}
