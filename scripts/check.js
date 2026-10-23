import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await visit(file);
    else if (entry.name.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
      });
      if (result.status !== 0) {
        console.error(result.stderr);
        process.exitCode = 1;
      }
    }
  }
}
for (const dir of ["src", "public", "tests", "scripts"]) await visit(dir);
if (!process.exitCode) console.log("JavaScript syntax checks passed.");
