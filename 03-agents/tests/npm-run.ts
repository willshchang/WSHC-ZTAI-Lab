// ============================================================
// HOW run-all.ts STARTS AN npm SCRIPT (one place, so it can be tested)
// ============================================================
// WHY cmd.exe on Windows: npm there is npm.cmd, and Node can't start
// a .cmd file without a shell. The Node docs say to spawn cmd.exe
// with /c instead of turning on shell: true:
// https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows
//
// WHY the name check: on Windows the name passes through cmd.exe, so
// a name with & | < > ^ % " or a space could run something else.
// Anything outside letters, digits, _ : - is refused, on every
// platform, before anything is spawned.
//
// WHY the loop lives here too: run-all.ts exits the process when it
// is imported, so no test could reach it. Here a test can pass in a
// fake spawn and prove a refused name is never started and still
// fails the run.
// ============================================================

const SAFE_NAME = /^[\w:-]+$/;

export function npmRun(name: string, platform: string = process.platform): { command: string; args: string[] } {
  if (!SAFE_NAME.test(name)) throw new Error(`Refusing to run script ${JSON.stringify(name)}: the name must match ${SAFE_NAME}`);
  return platform === "win32"
    ? { command: "cmd.exe", args: ["/c", "npm", "run", "-s", name] }
    : { command: "npm", args: ["run", "-s", name] };
}

export type Spawn = (command: string, args: string[]) => { status: number | null; stdout?: string | null; stderr?: string | null; error?: Error };

// Runs every script in order. Returns how many failed and how many checks passed.
export function runScripts(names: string[], spawn: Spawn, log: (line: string) => void = console.log): { failed: number; checks: number } {
  let failed = 0;
  let checks = 0;
  for (const name of names) {
    // A name that fails the check is never spawned; it counts as a failure.
    // The message carries the name JSON-escaped, so it can't forge a line.
    let cmd;
    try {
      cmd = npmRun(name);
    } catch (e) {
      failed++;
      log(`FAIL ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const r = spawn(cmd.command, cmd.args);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const ok = (out.match(/^OK/gm) ?? []).length;
    const bad = out.split("\n").filter((l) => l.startsWith("FAIL"));
    checks += ok;
    if (r.status !== 0 || bad.length > 0) {
      failed++;
      log(`FAIL ${name} (exit ${r.status})${r.error ? `: ${r.error.message}` : ""}`);
      log(bad.length ? bad.join("\n") : out);
    } else {
      log(`ok   ${name}${ok ? ` (${ok} checks)` : ""}`);
    }
  }
  return { failed, checks };
}
