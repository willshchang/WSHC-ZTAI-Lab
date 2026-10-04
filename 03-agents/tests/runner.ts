// ============================================================
// TEST: how npm test starts each script (tests/npm-run.ts)
// ============================================================
// On Windows the script name passes through cmd.exe, so the name
// check is a safety control: a name that could carry a second
// command must be refused on every platform, before any spawn.
// Nothing is spawned here; the builder is a pure function.
// ============================================================

import { readFileSync } from "node:fs";
import { npmRun } from "./npm-run.ts";
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
  ["a>b", "a redirect"],
  ["x\n", "a trailing newline"],
  ["", "nothing in it"],
];
for (const [name, what] of unsafe) {
  for (const platform of ["win32", "linux"]) {
    check(refusal(name, platform).startsWith("Refusing to run script"), `a name with ${what} is refused on ${platform}`);
  }
}

done();
