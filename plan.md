# Plan: keep `@types/node` on the Node 22 major in Dependabot

## Context

`03-agents/package.json` pins `"@types/node": "^22"` and `engines.node` is `>=22.18`. Dependabot's weekly npm run will offer `@types/node` 23, 24 and so on, which would describe Node APIs our runtime does not have. An `ignore` entry for major updates stops those PRs. Minor and patch updates inside 22 still come through.

## The change

One file: `.github/dependabot.yml`, npm block only. The github-actions block is untouched.

```yaml
  - package-ecosystem: npm
    directory: /03-agents
    schedule:
      interval: weekly
    # @types/node tracks the Node major we run (22, see engines in
    # 03-agents/package.json). Majors are ignored; minor and patch still come.
    # Raise this by hand when the Node major moves.
    ignore:
      - dependency-name: "@types/node"
        update-types: ["version-update:semver-major"]
```

## Docs

Syntax: confirmed against the GitHub Docs Dependabot options reference, which shows this exact shape. This is the link for the PR:
https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference

Security updates: the options reference does not say whether `update-types` in `ignore` applies to them. The guide "Controlling which dependencies are updated" does: `ignore` as a whole covers version and security updates, but `update-types` only affects version updates, so a security update for `@types/node` could still open a major PR. I read that through a summarising fetch, so the PR will state it as "per that guide" with the link, not as a quote.
https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/controlling-dependencies-updated

In practice this is a small gap: `@types/node` is type declarations only and security advisories against it are unlikely. No extra rule is added for it.

## Order of work

1. Branch `chore/dependabot-types-node` from `main`.
2. Replace `plan.md` with this plan and commit (`docs:`), per the repo workflow.
3. Edit `.github/dependabot.yml`, commit (`chore:`).
4. Push the branch, open the PR. I do not merge.

## Verification

- Parse the edited file as YAML locally and print the npm block, to prove the indentation and structure are right. Output pasted.
- `npm run typecheck` and `npm test` are not run: nothing under `03-agents/` changes.
- No CI runs on this PR. Both workflows are path-filtered (`agents-check.yml` to `03-agents/**`, `terraform-validate.yml` to the two terraform folders, each plus its own workflow file), and neither matches `.github/dependabot.yml` or `plan.md`. The PR says so, so an empty checks list is expected.
- GitHub only validates `dependabot.yml` on the default branch, so the real check is after merge: repo Insights > Dependency graph > Dependabot should show the npm entry with no config error. This goes in the PR as a step for you.
- Read-only: `gh pr list` for an open Dependabot PR bumping `@types/node` to a new major. If one exists, I will name it in the PR.

## PR

- Title: `chore: ignore @types/node major updates in Dependabot`
- Body: what and why, the options reference link, the security-updates note, that no CI runs and why, the exact merge steps, and the post-merge Dependabot check.

## Review

No reviewer subagent. The review runs in your other session; I fix what it reports, you merge.

## Not in this change

- No change to the github-actions block or the schedule.
- No change to `package.json` or `docs/THREAT_MODEL.md` (row A16 still reads true).
