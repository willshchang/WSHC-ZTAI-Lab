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
import { runScripts } from "./npm-run.ts";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
const names = ["typecheck", ...Object.keys(pkg.scripts).filter((s) => s.startsWith("test:")).sort()];

const { failed, checks } = runScripts(names, (command, args) =>
  spawnSync(command, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", cwd: new URL("..", import.meta.url) }));
console.log(`\n${names.length - failed}/${names.length} passed, ${checks} checks in total`);
process.exit(failed ? 1 : 0);
