import { validateSuite, runEvaluation, markdownReport } from "./core.js";
import { getPreset } from "./presets.js";
import { translations } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const STORE = "promptcanary.workspace.v1";
const safeRead = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const safeWrite = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Export remains available in private browsing. */
  }
};
let language =
  safeRead("promptcanary.language") ||
  (navigator.language.startsWith("zh") ? "zh" : "en");
if (!translations[language]) language = "en";
let suite = getPreset(language),
  topic = "support",
  dirty = false,
  report = null,
  stale = false;
let mode = "demo",
  running = false,
  jsonEditing = false,
  filter = "all",
  controller,
  toastTimeout;
let liveConfig = { liveAvailable: false, model: null };
try {
  const saved = JSON.parse(safeRead(STORE));
  if (saved) {
    suite = validateSuite(saved.suite);
    topic = saved.topic || "custom";
    dirty = saved.dirty ?? true;
  }
} catch {
  /* Invalid or obsolete drafts fall back to the starter. */
}
const t = (key, values = {}) =>
  Object.entries(values).reduce(
    (str, [name, value]) => str.replaceAll(`{${name}}`, () => String(value)),
    translations[language][key] ?? key,
  );
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const percent = (value) => `${Math.round(value * 100)}%`;
function notify(message) {
  clearTimeout(toastTimeout);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimeout = setTimeout(() => {
    $("toast").hidden = true;
  }, 4200);
}
function showError(error) {
  $("error").textContent = t("errorPrefix") + (error.message || String(error));
  $("error").hidden = false;
}
function currentSuite() {
  let cases = suite.cases;
  if (jsonEditing) {
    try {
      cases = JSON.parse($("cases-json").value);
    } catch {
      throw new Error(
        language === "zh"
          ? "用例 JSON 格式有误，请检查逗号和引号。"
          : "Cases JSON is invalid. Check commas and quotes.",
      );
    }
  }
  return validateSuite({
    ...suite,
    prompts: { a: $("prompt-a").value, b: $("prompt-b").value },
    cases,
  });
}
function persist() {
  try {
    suite = currentSuite();
    safeWrite(STORE, JSON.stringify({ suite, topic, dirty }));
  } catch {
    /* Keep incomplete edits in the editor. */
  }
}
function markChanged() {
  dirty = true;
  stale = Boolean(report);
  persist();
  updateCounts();
  if (report) renderReport();
}
function applyTranslations() {
  document.documentElement.lang = language === "zh" ? "zh" : "en";
  document.title =
    language === "zh"
      ? "PromptCanary · 看清提示词的每次改变"
      : "PromptCanary — Catch the change.";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (["headline", "heroCopy"].includes(key)) node.innerHTML = t(key);
    else node.textContent = t(key);
  });
  $("language").innerHTML =
    language === "en" ? "中文 <span>⇄</span>" : "EN <span>⇄</span>";
  $("language").setAttribute(
    "aria-label",
    language === "en" ? "切换到中文" : "Switch to English",
  );
  $("prompt-a").setAttribute("aria-label", t("baseline"));
  $("prompt-b").setAttribute("aria-label", t("candidate"));
  $("close-case").setAttribute("aria-label", t("close"));
  $("close-setup").setAttribute("aria-label", t("close"));
  $("navigation").setAttribute("aria-label", t("workspaceShort"));
  if ($("preset").querySelector('[value="custom"]'))
    $("preset").querySelector('[value="custom"]').textContent =
      t("customPreset");
  $("edit-json").textContent = t(jsonEditing ? "doneEditing" : "editJson");
  updateCounts();
  updateMode();
  renderCases();
  renderReport();
}
function setEditors() {
  $("prompt-a").value = suite.prompts.a;
  $("prompt-b").value = suite.prompts.b;
  $("cases-json").value = JSON.stringify(suite.cases, null, 2);
  if (!["support", "extract"].includes(topic)) {
    if (!$("preset").querySelector('[value="custom"]'))
      $("preset").add(new Option(t("customPreset"), "custom"));
    $("preset").value = "custom";
  } else $("preset").value = topic;
  updateCounts();
  renderCases();
}
function updateCounts() {
  for (const key of ["a", "b"])
    $(`count-${key}`).textContent = t("characters", {
      count: [...$(`prompt-${key}`).value].length,
    });
  $("case-count").textContent = suite.cases.length;
  $("nav-count").textContent = suite.cases.length;
  $("run-hint").textContent =
    mode === "demo"
      ? t("runHint", { cases: suite.cases.length })
      : t("liveHint", {
          calls: suite.cases.length * Number($("repeat").value) * 2,
        });
}
function updateMode() {
  const demo = mode === "demo";
  $("mode-demo").classList.toggle("selected", demo);
  $("mode-live").classList.toggle("selected", !demo);
  $("mode-demo").setAttribute("aria-pressed", String(demo));
  $("mode-live").setAttribute("aria-pressed", String(!demo));
  $("repeat").disabled = demo || running;
  $("notice-text").textContent = t(
    demo
      ? "demoNotice"
      : liveConfig.liveAvailable
        ? "liveNotice"
        : "unavailableNotice",
  );
  $("configure").hidden = demo;
  $("run").querySelector("[data-i18n]").textContent = t(
    running ? "running" : demo ? "runDemo" : "runLive",
  );
  $("hero-status").querySelector("[data-i18n]").textContent = demo
    ? t("noKey")
    : liveConfig.model || t("setupTitle");
  updateCounts();
}
function checkLabel(check) {
  const label = t(`rule_${check.type}`);
  if (check.type === "json") return label;
  const value =
    typeof check.value === "string" ? check.value : JSON.stringify(check.value);
  return `${label}${check.path ? ` · ${check.path}` : ""}: ${value}`;
}
function renderCases() {
  $("case-list").hidden = jsonEditing;
  $("case-list").innerHTML = suite.cases
    .map(
      (item, index) =>
        `<div class="case-row"><span class="case-index">${String(index + 1).padStart(2, "0")}</span><span class="case-name">${esc(item.name)}</span><span class="case-input" title="${esc(item.input)}">${esc(item.input)}</span><span class="check-tags">${item.checks.map((check) => `<span class="check-tag" title="${esc(checkLabel(check))}">${esc(t(`rule_${check.type}`))}</span>`).join("")}</span><button class="icon-button delete-case" type="button" data-case="${esc(item.id)}" aria-label="${esc(t("deleteCase") + ": " + item.name)}" ${running ? "disabled" : ""}>×</button></div>`,
    )
    .join("");
}
function renderReport() {
  $("empty").hidden = Boolean(report);
  $("report").hidden = !report;
  $("export-json").disabled = !report || running;
  $("export-markdown").disabled = !report || running;
  if (!report) {
    $("report-meta").textContent = "";
    return;
  }
  const { variants, changes, improvements, regressions } = report.summary;
  $("report-meta").textContent = t("reportMeta", {
    cases: changes.length,
    repeat: report.repeat,
    model: report.mode === "demo" ? t("demoMode") : report.model,
  });
  const cards = [
    [
      "passRateA",
      percent(variants.a.passRate),
      t("passedRuns", variants.a),
      "",
    ],
    [
      "passRateB",
      percent(variants.b.passRate),
      t("passedRuns", variants.b),
      "is-candidate",
    ],
    ["improved", improvements, t("improvedFoot"), "improved"],
    ["regressed", regressions, t("regressedFoot"), "regressed"],
  ];
  const filtered = changes.filter(
    (change) =>
      filter === "all" ||
      (filter === "changes"
        ? change.status !== "unchanged"
        : report.results.some(
            (row) => row.caseId === change.caseId && !row.passed,
          )),
  );
  $("report").innerHTML =
    `<div class="metrics">${cards.map(([label, value, foot, cls]) => `<div class="metric ${cls}"><div class="metric-label">${esc(t(label))}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`).join("")}</div><div class="report-banner"><span>${esc(t(report.mode === "demo" ? "demoReport" : "liveReport"))}</span>${stale ? `<span class="stale-notice">${esc(t("stale"))}</span>` : ""}</div><div class="result-filters">${["all", "changes", "failures"].map((key) => `<button class="filter-button ${filter === key ? "selected" : ""}" data-filter="${key}" type="button" aria-pressed="${filter === key}">${esc(t(key))}</button>`).join("")}</div>${filtered
      .map((change) => {
        const rows = report.results.filter(
          (row) => row.caseId === change.caseId,
        );
        const open =
          change.status !== "unchanged" || rows.some((row) => !row.passed);
        return `<details class="result-case" ${open ? "open" : ""}><summary><span>${esc(rows[0].caseName)}</span><span class="result-status ${change.status}">${esc(t(`status_${change.status}`))}</span></summary><div class="result-input">${esc(rows[0].input)}</div><div class="result-outputs">${[
          "a",
          "b",
        ]
          .map(
            (key) =>
              `<div class="output">${rows
                .filter((row) => row.variant === key)
                .map(
                  (row) =>
                    `<div class="output-heading"><span class="variant-icon ${key === "a" ? "baseline" : "candidate"}">${key.toUpperCase()}</span>${esc(t(key === "a" ? "baseline" : "candidate"))}${report.repeat > 1 ? ` · ${esc(t("runNumber", { run: row.run }))}` : ""}<span class="output-stats">${row.latencyMs === null ? "— ms" : `${row.latencyMs} ms`} · ${row.tokens === null ? "—" : row.tokens} tokens</span></div><pre class="output-text">${esc(row.error ? t("errorOutput") : row.output)}</pre><div class="check-results">${row.error ? `<span class="check-result error">${esc(row.error)}</span>` : row.checks.map((check) => `<span class="check-result ${check.passed ? "" : "failed"}">${check.passed ? "✓" : "×"} ${esc(checkLabel(check))}</span>`).join("")}</div>`,
                )
                .join("<hr>")}</div>`,
          )
          .join("")}</div></details>`;
      })
      .join(
        "",
      )}${filtered.length ? "" : `<div class="no-matches">${esc(t("noMatches"))}</div>`}`;
}
function setBusy(value) {
  running = value;
  document.body.classList.toggle("running", value);
  for (const id of [
    "run",
    "preset",
    "mode-demo",
    "mode-live",
    "prompt-a",
    "prompt-b",
    "cases-json",
    "import",
    "export-suite",
    "edit-json",
    "add-case",
  ])
    $(id).disabled = value;
  $("cancel").hidden = !value;
  updateMode();
  renderCases();
  renderReport();
}
async function run() {
  if (running) return;
  $("error").hidden = true;
  try {
    suite = currentSuite();
    persist();
    if (mode === "live" && !liveConfig.liveAvailable) {
      $("setup-dialog").showModal();
      return;
    }
    controller = new AbortController();
    setBusy(true);
    let next;
    if (mode === "demo")
      next = await runEvaluation(suite, {
        mode: "demo",
        signal: controller.signal,
      });
    else {
      const response = await fetch("./api/evaluate", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "live",
          suite,
          repeat: Number($("repeat").value),
        }),
      });
      let value;
      try {
        value = await response.json();
      } catch {
        throw new Error(t("requestFailed"));
      }
      if (!response.ok) throw new Error(value.error || t("requestFailed"));
      next = value;
    }
    report = next;
    stale = false;
    filter = "all";
    renderReport();
    notify(t("done"));
    $("results").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  } catch (error) {
    if (error.name === "AbortError") notify(t("canceled"));
    else showError(error);
  } finally {
    setBusy(false);
  }
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  notify(t("exportSuccess"));
}
$("run").addEventListener("click", run);
$("cancel").addEventListener("click", () => controller?.abort());
$("language").addEventListener("click", () => {
  language = language === "en" ? "zh" : "en";
  safeWrite("promptcanary.language", language);
  if (!dirty && !report && !running) {
    suite = getPreset(language, topic);
    setEditors();
    persist();
  }
  applyTranslations();
});
$("preset").addEventListener("change", () => {
  if ($("preset").value === "custom") return;
  topic = $("preset").value;
  suite = getPreset(language, topic);
  dirty = false;
  stale = Boolean(report);
  jsonEditing = false;
  $("json-editor-wrap").hidden = true;
  $("edit-json").textContent = t("editJson");
  $("error").hidden = true;
  setEditors();
  persist();
  renderReport();
});
for (const key of ["a", "b"])
  $(`prompt-${key}`).addEventListener("input", markChanged);
$("repeat").addEventListener("change", () => {
  stale = Boolean(report);
  updateCounts();
  renderReport();
});
$("cases-json").addEventListener("input", markChanged);
for (const key of ["demo", "live"])
  $(`mode-${key}`).addEventListener("click", () => {
    mode = key;
    updateMode();
  });
$("configure").addEventListener("click", () => $("setup-dialog").showModal());
$("close-setup").addEventListener("click", () => $("setup-dialog").close());
$("close-case").addEventListener("click", () => $("case-dialog").close());
$("edit-json").addEventListener("click", () => {
  try {
    $("error").hidden = true;
    if (jsonEditing) {
      suite = currentSuite();
      jsonEditing = false;
      persist();
    } else {
      $("cases-json").value = JSON.stringify(suite.cases, null, 2);
      jsonEditing = true;
    }
    $("json-editor-wrap").hidden = !jsonEditing;
    $("edit-json").textContent = t(jsonEditing ? "doneEditing" : "editJson");
    renderCases();
    updateCounts();
  } catch (error) {
    showError(error);
  }
});
$("case-list").addEventListener("click", (event) => {
  const button = event.target.closest(".delete-case");
  if (!button || running) return;
  if (suite.cases.length === 1) {
    notify(t("lastCase"));
    return;
  }
  suite.cases = suite.cases.filter((item) => item.id !== button.dataset.case);
  markChanged();
  renderCases();
});
$("add-case").addEventListener("click", () => {
  if (suite.cases.length >= 20) {
    notify(t("maxCases"));
    return;
  }
  try {
    suite = currentSuite();
  } catch (error) {
    showError(error);
    return;
  }
  $("case-form").reset();
  $("check-value").hidden = false;
  $("check-value").required = true;
  $("check-value-label").hidden = false;
  $("check-value").type = "text";
  $("case-dialog").showModal();
});
$("check-type").addEventListener("change", () => {
  const json = $("check-type").value === "json";
  $("check-value").hidden = json;
  $("check-value-label").hidden = json;
  $("check-value").required = !json;
  $("check-value").type =
    $("check-type").value === "max_length" ? "number" : "text";
  if ($("check-type").value === "max_length") {
    $("check-value").min = "1";
    $("check-value").max = "64000";
  }
});
$("case-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const check = { type: $("check-type").value };
  if (check.type !== "json")
    check.value =
      check.type === "max_length"
        ? Number($("check-value").value)
        : $("check-value").value;
  const item = {
    id: `case-${crypto.randomUUID()}`,
    name: $("case-name").value.trim(),
    input: $("case-input").value,
    checks: [check],
  };
  try {
    suite = validateSuite({ ...currentSuite(), cases: [...suite.cases, item] });
    $("cases-json").value = JSON.stringify(suite.cases, null, 2);
    $("case-dialog").close();
    markChanged();
    renderCases();
    notify(t("caseAdded"));
  } catch (error) {
    showError(error);
  }
});
$("import").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 512000) throw new Error(t("importLarge"));
    suite = validateSuite(JSON.parse(await file.text()));
    topic = "custom";
    dirty = true;
    stale = Boolean(report);
    jsonEditing = false;
    $("json-editor-wrap").hidden = true;
    $("edit-json").textContent = t("editJson");
    $("error").hidden = true;
    setEditors();
    persist();
    renderReport();
    notify(t("importSuccess"));
  } catch (error) {
    showError(error);
  }
  event.target.value = "";
});
$("export-suite").addEventListener("click", () => {
  try {
    download(
      "promptcanary-suite.json",
      JSON.stringify(currentSuite(), null, 2),
      "application/json",
    );
  } catch (error) {
    showError(error);
  }
});
$("export-json").addEventListener(
  "click",
  () =>
    report &&
    download(
      "promptcanary-report.json",
      JSON.stringify(report, null, 2),
      "application/json",
    ),
);
$("export-markdown").addEventListener(
  "click",
  () =>
    report &&
    download(
      "promptcanary-report.md",
      markdownReport(report, language),
      "text/markdown;charset=utf-8",
    ),
);
$("report").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  filter = button.dataset.filter;
  renderReport();
});
document.addEventListener("keydown", (event) => {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key === "Enter" &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    run();
  }
});
document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }),
);
document.querySelectorAll(".nav-link").forEach((link) =>
  link.addEventListener("click", () => {
    document
      .querySelectorAll(".nav-link")
      .forEach((item) => item.classList.toggle("active", item === link));
  }),
);
setEditors();
applyTranslations();
// Static hosting intentionally has no model endpoint: only the local server serves this route.
if (!location.hostname.endsWith(".github.io")) {
  fetch("./api/config")
    .then((response) => (response.ok ? response.json() : {}))
    .then((config) => {
      if (typeof config.liveAvailable === "boolean") {
        liveConfig = config;
        updateMode();
      }
    })
    .catch(() => {
      /* Static host: fixture playback remains fully functional. */
    });
}
