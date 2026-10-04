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
// ============================================================

const SAFE_NAME = /^[\w:-]+$/;

export function npmRun(name: string, platform: string = process.platform): { command: string; args: string[] } {
  if (!SAFE_NAME.test(name)) throw new Error(`Refusing to run script ${JSON.stringify(name)}: the name must match ${SAFE_NAME}`);
  return platform === "win32"
    ? { command: "cmd.exe", args: ["/c", "npm", "run", "-s", name] }
    : { command: "npm", args: ["run", "-s", name] };
}
