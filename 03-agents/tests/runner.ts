// ============================================================
// TEST: how npm test starts each script (tests/npm-run.ts)
// ============================================================
// On Windows the script name passes through cmd.exe, so the name
// check is a safety control: a name that could carry a second
// command must be refused on every platform, before any spawn.
// And the loop must fail closed: a refused name is never started
// and still fails the run. No real process is spawned here.
// ============================================================

import { readFileSync } from "node:fs";
import { npmRun, runScripts, type Spawn } from "./npm-run.ts";
import { check, done } from "./helpers.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const refusal = (name: string, platform: string): string => {
  try {
    npmRun(name, platform);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

// ---- The command per platform -----------------------------------
check(same(npmRun("test:jml", "win32"), { command: "cmd.exe", args: ["/c", "npm", "run", "-s", "test:jml"] }), "on Windows npm runs through cmd.exe /c");
check(same(npmRun("test:jml", "linux"), { command: "npm", args: ["run", "-s", "test:jml"] }), "on Linux npm is spawned directly");
check(same(npmRun("test:jml", "darwin"), { command: "npm", args: ["run", "-s", "test:jml"] }), "on macOS npm is spawned directly");

// ---- Every real script name is accepted -------------------------
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
const real = ["typecheck", ...Object.keys(pkg.scripts).filter((s) => s.startsWith("test:"))];
check(real.length > 1 && real.every((n) => refusal(n, "win32") === "" && refusal(n, "linux") === ""), "typecheck and every test:* script name is accepted");

// ---- Unsafe names are refused, on every platform ----------------
const unsafe: [string, string][] = [
  ["test:jml & calc", "a second command (&)"],
  ["a|b", "a pipe"],
  ["a b", "a space"],
  ["%PATH%", "a variable (%)"],
  ['a"b', "a quote"],
  ["a^b", "a caret"],
  ["a>b", "a redirect out"],
  ["a<b", "a redirect in"],
  ["(a)", "brackets"],
  ["x\n", "a trailing newline"],
  ["\nx", "a leading newline"],
  ["x\r", "a carriage return"],
  ["", "nothing in it"],
];
for (const [name, what] of unsafe) {
  for (const platform of ["win32", "linux"]) {
    check(refusal(name, platform).startsWith("Refusing to run script"), `a name with ${what} is refused on ${platform}`);
  }
}

// ---- The loop fails closed --------------------------------------
// A fake spawn stands in for npm: it records what was started
const run = (names: string[], result: ReturnType<Spawn> = { status: 0, stdout: "OK: one\nOK: two\n", stderr: "" }) => {
  const started: string[] = [];
  const lines: string[] = [];
  const spawn: Spawn = (_command, args) => {
    started.push(args[args.length - 1]!);
    return result;
  };
  return { ...runScripts(names, spawn, (l) => lines.push(l)), started, lines };
};

let r = run(["test:a", "test:b"]);
check(r.failed === 0 && r.checks === 4 && same(r.started, ["test:a", "test:b"]), "safe names all run, and their checks are counted");

r = run(["test:a", "test:b & calc", "test:c"]);
check(same(r.started, ["test:a", "test:c"]), "a refused name is never spawned, and the names after it still run");
check(r.failed === 1, "a refused name counts as a failure, so the run exits non-zero");
check(r.lines.some((l) => l.startsWith("FAIL Refusing to run script")), "a refused name is reported as a FAIL line");

r = run(["test:x\nok   test:forged"]);
check(r.failed === 1 && r.lines.every((l) => !l.includes("\n")), "a refused name can't forge an extra line in the output");

r = run(["test:a"], { status: null, stdout: null, stderr: null, error: new Error("spawn npm ENOENT") });
check(r.failed === 1 && r.lines.some((l) => l.includes("spawn npm ENOENT")), "a spawn that can't start fails the run and says why");

r = run(["test:a"], { status: 0, stdout: "OK: one\nFAIL: two\n", stderr: "" });
check(r.failed === 1, "a FAIL line fails the script even when it exits 0");

done();
