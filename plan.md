# Plan: Claude Code project settings and hooks

## Context

CLAUDE.md lists things Claude must never do in this repo (read `.env*`, state, tfvars, real data and traces; run `terraform apply`, `destroy` or `output`; push to `main`). Today those are instructions only. This change turns them into enforced rules: a committed `.claude/settings.json` with permission rules, plus two Node hooks. Nothing in `01-identity/`, `02-network/` or `03-agents/` changes.

Docs checked (linked in the PR description too):
- Permissions: https://code.claude.com/docs/en/permissions
- Settings: https://code.claude.com/docs/en/settings
- Hooks: https://code.claude.com/docs/en/hooks

## What the docs changed in the spec

1. **`npm run test:*` does not do what it looks like.** A trailing `:*` is the legacy way to write ` *`, so it means `npm run test *` and would not match `npm run test:jml`. Decided: use `Bash(npm run test*)`.
2. **Bash rules do not cover the PowerShell tool.** They are separate rule sets with the same shape. Decided: mirror every Bash rule as a `PowerShell(...)` rule.
3. **Path rules only count on `Read` and `Edit`.** `Edit` rules cover every built-in editing tool (Write included). A `Write(path)` rule is accepted but never consulted, so none are written.
4. **Leading `/` is right for this file.** In project settings `/path` anchors at the primary working directory (the repo root). Patterns follow gitignore syntax; `**` crosses directories.
5. **Order is deny, then ask, then allow.** So `git push * main` (deny) beats `git push *` (ask), and nothing in allow can override either.
6. **Allow rules wait for workspace trust**; deny and ask rules apply straight away.
7. **Hooks:** matcher `Edit|Write` is an exact list. Exit 2 on PreToolUse blocks the call and sends stderr to Claude. Exit 2 on PostToolUse cannot block (the tool already ran) but shows stderr to Claude. Exec form (`command` plus `args`) spawns `node` directly with no shell, which is the documented way to use `${CLAUDE_PROJECT_DIR}` and works on Windows.

## Files

| File | Purpose |
|---|---|
| `plan.md` | This plan, committed first (CLAUDE.md workflow rule) |
| `.claude/settings.json` | Permissions and hook wiring |
| `.claude/hooks/protect-paths.mjs` | PreToolUse: block edits to protected paths |
| `.claude/hooks/terraform-fmt.mjs` | PostToolUse: format the edited `.tf` file |
| `.claude/hooks/protect-paths.test.mjs` | `node --test` checks for the PreToolUse hook |

### `.claude/settings.json`

Strict JSON, no comments. Top key `"$schema": "https://json.schemastore.org/claude-code-settings.json"`.

**deny**
- `Read(...)` and `Edit(...)` for each of: `/**/.env`, `/**/.env.*`, `/**/*.tfstate`, `/**/*.tfstate.*`, `/**/*.tfvars`, `/**/data/**`, `/03-agents/traces/**`, `/03-agents/jml/tenant.local.json` (16 rules)
- `Bash(...)` and `PowerShell(...)` for each of: `terraform apply *`, `terraform destroy *`, `terraform output *`, `gh pr merge *`, `git push --force *`, `git push -f *`, `git push * main` (14 rules)

**ask**
- `Bash(...)` and `PowerShell(...)` for: `git push *`, `terraform plan *`
- `Edit(/03-agents/package.json)`: any change to the agents' dependencies or scripts prompts first. `Edit` rules cover Write too, so one rule is enough.

**allow**
- `Bash(...)` and `PowerShell(...)` for: `npm ci`, `npm run typecheck`, `npm test`, `npm run test*`, `git status *`, `git diff *`, `git log *`, `git add *`, `git commit *`, `git switch *`, `terraform fmt *`, `terraform validate *`, `terraform state list *`, `gh pr create *`, `gh pr view *`, `gh pr checks *`

**hooks**
```json
"hooks": {
  "PreToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node",
    "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/protect-paths.mjs"], "timeout": 10 }] }],
  "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node",
    "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/terraform-fmt.mjs"], "timeout": 30 }] }]
}
```

### `protect-paths.mjs`
- Node built-ins only. Reads the hook JSON from stdin, takes `tool_input.file_path`.
- Resolves it against `CLAUDE_PROJECT_DIR` (falls back to `cwd` from the input), converts to a forward-slash path relative to the repo root, compares case-insensitively.
- The normalising is done on strings (backslashes to forward slashes, drive letter and case folded) instead of leaning on the host's `path` module, so a `C:\...` path is handled the same on Windows and on a Linux CI runner.
- Blocks when: the file name is `.env` or starts with `.env.`; the name ends in `.tfstate` or contains `.tfstate.`; the name ends in `.tfvars`; any parent folder is named `data`; the path is under `03-agents/traces/`; the path is `03-agents/jml/tenant.local.json`.
- After the slash conversion, `.` and `..` segments are collapsed with `path.posix.normalize` (on both the file path and the project dir) before the path is made relative to the repo root. So `03-agents\core\..\.env` is checked as `03-agents/.env`. A path whose `..` segments leave the repo counts as outside it.
- The stderr reason starts with a fixed prefix, `protect-paths hook:`, so a hook block can be told apart from a deny-rule block.
- Blocked: one-line reason on stderr, exit 2. Allowed: exit 0. Paths outside the repo: exit 0, matching the root-anchored deny list.
- Fails closed: unreadable stdin or a missing `file_path` exits 2 (default deny).
- Nothing is exported and there is no "run only when called directly" guard: the script always runs its check, so there is no way for it to load and silently do nothing. The test spawns the real script for every case. (Changed during the build; the first plan had an exported matcher.)
- A comment says the list must stay in step with the deny list in `settings.json`.

### `terraform-fmt.mjs`
- Reads stdin, exits 0 unless `tool_input.file_path` ends in `.tf`.
- Runs `terraform fmt <that file>` with `spawnSync` and an argument array (no shell, so no injection through the file name).
- Terraform not installed: exit 0 quietly. `fmt` fails (syntax error): exit 2 with terraform's message on stderr so Claude sees it.

### `protect-paths.test.mjs`
- `node:test` cases: each protected pattern is blocked (nested and root-level, backslash and forward-slash, mixed case); normal files pass (`README.md`, `03-agents/core/x.ts`, `main.tf`, `database/x.ts`, `.envrc`); bad stdin exits 2.
- Windows path forms, each checked for both a blocked and an allowed file:
  - backslash relative paths: `03-agents\traces\run.jsonl`, `01-identity\terraform\terraform.tfvars`
  - full drive paths with the project dir set to match: `C:\Users\sample\repo\03-agents\.env`, `C:\Users\sample\repo\02-network\terraform\terraform.tfstate.backup`
  - mixed capitals in the drive, folders and file name: `c:\USERS\Sample\Repo\03-Agents\JML\Tenant.Local.json`, `01-Identity\Data\Users.CSV`, `.ENV`, `Prod.TFVARS`
  - mixed separators: `C:\Users\sample\repo/03-agents/traces\x.jsonl`
  - a full drive path outside the repo (`C:\Users\sample\other\.env`) passes, matching the root-anchored deny list
- Dot segments, blocked: `03-agents\core\..\.env`, `03-agents/./traces/x.jsonl`, `01-identity/terraform/modules/../terraform.tfvars`, `C:\Users\sample\repo\docs\..\03-agents\jml\tenant.local.json`. Allowed: `03-agents/traces/../core/x.ts` (lands outside `traces/`), `data/../README.md` (the `data` segment is gone after collapsing).
- The sample paths use a made-up user folder (`sample`), never the real one, since the repo is public.
- Spawns the real script for the exit-code and stderr checks.

## Known effects and limits (go in the PR description)
- `.env.example` matches `/**/.env.*`, so Claude can no longer read or edit it. That matches the CLAUDE.md "never read `.env*`" rule.
- Bash and PowerShell rules match command text. `git -C . push origin main` or `git push origin HEAD:main` is not caught by the `main` deny, though any `git push ...` form still hits the ask rule. `--force-with-lease` also falls to ask, not deny. Branch protection on GitHub stays the real guard for `main`.
- `Read` deny covers Claude's file tools and recognised shell file commands (`cat`, `head`, redirects). It does not stop a script that opens the file itself. The docs point to sandboxing for that.
- `terraform output *` denies every form, which is stricter than CLAUDE.md (`-json` and `-raw` only), as specified.
- After the fmt hook rewrites a `.tf` file, Claude has to re-read it before the next edit.

## Steps
1. `git switch -c chore/claude-settings` from `main` (already in sync with `origin/main`).
2. Add `plan.md` at the repo root, commit `docs: plan for Claude Code settings and hooks`.
3. Write the four `.claude/` files, commit `chore: add Claude Code project settings and hooks`.
4. Run the verification below and fix anything it finds.
5. `git push -u origin chore/claude-settings`, then `gh pr create` with the summary, doc links, known limits, pasted test output, and the merge checklist.
6. No self-review. You run the review in a fresh session, I fix what it reports, you merge.

## Verification
- `node -e` parse of `.claude/settings.json` to confirm strict JSON, and a count of rules per list.
- `node --test .claude/hooks/protect-paths.test.mjs` all green, output pasted. (Changed during the build: Node 24 does not accept a bare directory here.)
- Mutation sweep on `protect-paths.mjs`: break each of these in turn and confirm a test fails each time. Results pasted as a table (mutation, failing test).
  - each protected pattern check (one mutation per pattern)
  - the fail-closed branch (bad stdin, missing `file_path`)
  - the case folding (remove the lower-casing)
  - the backslash conversion (leave `\` as is)
  - the `..` handling (remove the `path.posix.normalize` call)
- If any mutation survives, I add or fix a test until it is killed. The hook code is not bent to fit the test. Originals restored from a backup copy in the scratchpad, never `git checkout --`.
- Manual run of both hooks with sample JSON on stdin: a protected path gives exit 2 plus reason, a normal path gives exit 0, a badly formatted scratch `.tf` file comes back formatted.
- Scan the new files for control characters and non-ASCII.
- `npm run typecheck` and `npm test` in `03-agents/` to show nothing else moved, output pasted.

### Merge checklist for you (also in the PR description)
In a new Claude Code session on the branch, before merging:
1. Accept the trust dialog, run `/status` (settings file loaded, no Settings Error) and `/permissions` (rules listed, no startup warnings).
2. Ask Claude to read `.env.example` and confirm it is refused.
3. Ask Claude to edit `.env.example` and confirm the block message comes from the hook, not only the deny rule: the reason must start with `protect-paths hook:`. If only a permission-rule message shows, the hook is not wired up, so do not merge. Verified in the docs: "A hook that exits with code 2 stops the tool call before permission rules are evaluated" (https://code.claude.com/docs/en/permissions, "Extend permissions with hooks"). So the hook's message is the one expected here.
4. Ask Claude to edit `03-agents/package.json` and confirm it prompts.
5. Review in a fresh session, then merge with the commands listed in the PR.
