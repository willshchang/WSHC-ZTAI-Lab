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
| `03-agents/tests/npm-run.ts` | New. The command builder, the name check, and the run loop (`runScripts`) |
| `03-agents/tests/run-all.ts` | Reads the names, calls `runScripts` with the real spawn, prints the total, exits |
| `03-agents/tests/runner.ts` | New. Tests for the builder and the loop |
| `03-agents/package.json` | Add `"test:runner": "node tests/runner.ts"` |
| `03-agents/README.md` | Add `test:runner` to the command list; a short note on Windows and `cmd.exe`; add the name check to the sweep paragraph |

### `tests/npm-run.ts`

It has to be its own module: `run-all.ts` runs and calls `process.exit` on import, so a test cannot import from it.

```ts
const SAFE_NAME = /^[\w:-]+$/;

export function npmRun(name: string, platform: string = process.platform): { command: string; args: string[] } {
  if (!SAFE_NAME.test(name)) throw new Error(`Refusing to run script ${JSON.stringify(name)}: the name must match ${SAFE_NAME}`);
  return platform === "win32"
    ? { command: "cmd.exe", args: ["/c", "npm", "run", "-s", name] }
    : { command: "npm", args: ["run", "-s", name] };
}
```

The check runs on every platform, not only Windows, so Linux CI exercises it too. Header comment in the repo's banner style, with the WHY and the Node docs link.

### `tests/run-all.ts`

The loop moves into `runScripts(names, spawn, log)` in `npm-run.ts`, so a test can pass a fake spawn (see "Changed after review"). Inside it: build the command in a `try`. On a throw: `failed++`, print `FAIL` with the message (the name is JSON-escaped in it), `continue` (no spawn). Otherwise call `spawn(command, args)`; a spawn error is printed. `run-all.ts` passes the real `spawnSync` with the same options as before. Counting and the summary line stay as they are.

### `tests/runner.ts`

Uses `check` and `done` from `tests/helpers.ts`. Checks:
- `win32` gives `cmd.exe` and `["/c", "npm", "run", "-s", name]`
- `linux` and `darwin` give `npm` and `["run", "-s", name]`
- every `typecheck` and `test:*` name in `package.json` is accepted
- refused on both `win32` and `linux`: `"test:jml & calc"`, `"a|b"`, `"a b"`, `"%PATH%"`, `'a"b'`, `"a^b"`, `"a>b"`, `"a<b"`, `"(a)"`, `"x\n"`, `"\nx"`, `"x\r"`, `""`
- the loop, with a fake spawn: safe names run and are counted; a refused name is never spawned, counts as a failure, is reported, and cannot forge an output line; a spawn that cannot start fails the run and says why; a `FAIL` line fails a script that exits 0

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
3. Remove `failed++` for a refused name in `runScripts`. Expect `test:runner` to fail.
4. Remove the `continue` after a refused name. Expect `test:runner` to fail.
Restore, rerun `npm test`, confirm green.

Also `npm run typecheck` clean.

## Review and merge

- Review runs in the reviewer subagent with read-only tools: one agent, one light pass over a small diff (Bugs, Security, Plan). It reports, I fix, you merge.
- The PR description will list the exact merge steps and what to check first.

## Changed after review

The reviewer found that the fail-closed branch in `run-all.ts` had no test and no sweep, because that file exits on import. Fix: the loop moved into `runScripts` in `npm-run.ts`, with tests and sweep entries 3 and 4. Also from the review: more refused characters in the test, the spawn error is printed, and a refused name is only ever printed JSON-escaped.

Known and left alone: the regex allows a leading `-`, so the builder would accept a name like `--version`. `run-all.ts` only ever passes `typecheck` and names starting with `test:`, and the regex is the one asked for.

## Not in this change

- No Windows job in CI. `agents-check.yml` stays Ubuntu only; say so if you want a `windows-latest` job as a follow-up PR.
- No change to how checks are counted or to any existing test.
