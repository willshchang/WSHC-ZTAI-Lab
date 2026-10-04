# Plan: make `npm test` work on Windows

## Context

`03-agents/tests/run-all.ts` runs each script with `spawnSync("npm", ["run", "-s", name])` and no shell. On Windows `npm` is `npm.cmd`, and Node cannot start a `.cmd` file without a shell, so every entry fails and `npm test` is red on Windows. CI is Ubuntu only, so it never showed.

Fix per the Node docs, "Spawning .bat and .cmd files on Windows": on `win32`, spawn `cmd.exe` with `/c npm run -s <name>`. Everywhere else keep today's direct spawn. No `shell: true`.
https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows

Because the name now passes through `cmd.exe`, it is checked first and refused unless it matches `^[\w:-]+$`. That rules out spaces and every cmd metacharacter (`& | < > ^ % "`). Fail closed: a refused name is never spawned and the run exits non-zero.

## Files

| File | Change |
|---|---|
| `plan.md` | Replaced with this plan, committed first |
| `03-agents/tests/npm-run.ts` | New. The command builder and the name check |
| `03-agents/tests/run-all.ts` | Use the builder; a refused name counts as a FAIL |
| `03-agents/tests/runner.ts` | New. Tests for the builder |
| `03-agents/package.json` | Add `"test:runner": "node tests/runner.ts"` |
| `03-agents/README.md` | Add `test:runner` to the command list; add the name check to the sweep paragraph |

### `tests/npm-run.ts`

It has to be its own module: `run-all.ts` runs and calls `process.exit` on import, so a test cannot import from it.

```ts
const SAFE_NAME = /^[\w:-]+$/;

export function npmRun(name: string, platform: string = process.platform): { command: string; args: string[] } {
  if (!SAFE_NAME.test(name)) throw new Error(`Refusing to run script "${name}": name must match ${SAFE_NAME}`);
  return platform === "win32"
    ? { command: "cmd.exe", args: ["/c", "npm", "run", "-s", name] }
    : { command: "npm", args: ["run", "-s", name] };
}
```

The check runs on every platform, not only Windows, so Linux CI exercises it too. Header comment in the repo's banner style, with the WHY and the Node docs link.

### `tests/run-all.ts`

Inside the loop, build the command in a `try`. On a throw: `failed++`, print `FAIL <name>` with the message, `continue` (no spawn). Otherwise `spawnSync(command, args, { same options as today })`. Counting and the summary line stay as they are.

### `tests/runner.ts`

Uses `check` and `done` from `tests/helpers.ts`. Checks:
- `win32` gives `cmd.exe` and `["/c", "npm", "run", "-s", name]`
- `linux` and `darwin` give `npm` and `["run", "-s", name]`
- every `typecheck` and `test:*` name in `package.json` is accepted
- refused on both `win32` and `linux`: `"test:jml & calc"`, `"a|b"`, `"a b"`, `"%PATH%"`, `'a"b'`, `"a^b"`, `"a>b"`, `"x\n"`, `""`

## Order of work

1. Branch `fix/windows-npm-test` from `main`.
2. Commit `plan.md` (`docs:`).
3. Add `npm-run.ts`, wire `run-all.ts`. Run proof A below. Commit (`fix:`).
4. Add `runner.ts`, the `test:runner` script and the README lines. Run proof B and the sweep. Commit (`test:`).
5. Push the branch, open the PR. I do not merge.

## Verification (on this Windows machine, output pasted)

**Proof A, the 238.** With the fix in and before the new test exists: run each `test:*` script on its own, count lines starting with `OK`, and add them up. Then run `npm test`. Both must say 238, and `npm test` must be all green.

**Proof B, after the new test.** `test:runner` adds its own checks, so the total goes above 238 by exactly that number. Same comparison again: sum of individual runs equals the `npm test` total. I will report both numbers so the 238 baseline stays visible.

**Mutation sweep.** Backups go to the scratchpad and files are restored from those copies, never with `git checkout --`.
1. Remove the name check in `npm-run.ts`. Expect `test:runner` and `npm test` to fail on the refusal checks.
2. Remove the `win32` branch. Expect `test:runner` to fail (and on Windows, `npm test` as a whole).
Restore, rerun `npm test`, confirm green.

Also `npm run typecheck` clean.

## Review and merge

- Review runs in the reviewer subagent with read-only tools: one agent, one light pass over a small diff (Bugs, Security, Plan). It reports, I fix, you merge.
- The PR description will list the exact merge steps and what to check first.

## Not in this change

- No Windows job in CI. `agents-check.yml` stays Ubuntu only; say so if you want a `windows-latest` job as a follow-up PR.
- No change to how checks are counted or to any existing test.
