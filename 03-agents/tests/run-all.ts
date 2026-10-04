// ============================================================
// npm test: typecheck, then EVERY test:* script in package.json
// ============================================================
// WHY read the list from package.json: a new test file added as a
// test:* script runs here (and in CI) without anyone having to
// remember a second list. stdin is closed for every test, so no test
// can ever wait on a human. Exits non-zero if anything fails.
// ============================================================

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { npmRun } from "./npm-run.ts";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
const names = ["typecheck", ...Object.keys(pkg.scripts).filter((s) => s.startsWith("test:")).sort()];

let failed = 0;
let checks = 0;
for (const name of names) {
  // A name that fails the check is never spawned; it counts as a failure
  let cmd;
  try {
    cmd = npmRun(name);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  const r = spawnSync(cmd.command, cmd.args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", cwd: new URL("..", import.meta.url) });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const ok = (out.match(/^OK/gm) ?? []).length;
  const bad = out.split("\n").filter((l) => l.startsWith("FAIL"));
  checks += ok;
  if (r.status !== 0 || bad.length > 0) {
    failed++;
    console.log(`FAIL ${name} (exit ${r.status})`);
    console.log(bad.length ? bad.join("\n") : out);
  } else {
    console.log(`ok   ${name}${ok ? ` (${ok} checks)` : ""}`);
  }
}
console.log(`\n${names.length - failed}/${names.length} passed, ${checks} checks in total`);
process.exit(failed ? 1 : 0);
