# WSHC-ZTAI-Lab

A Zero Trust lab in three layers, all as code. It is a public portfolio repo: sample data only, never real data.

| Layer | Folder | What it is |
|---|---|---|
| Identity | `01-identity/` | Microsoft Entra ID in Terraform: users, groups, apps, roles, Conditional Access. The tenant now runs on Entra ID Free; see its README for what is frozen |
| Network | `02-network/` | Tailscale in Terraform: ACL policy, tags, SSH, high-availability subnet routes |
| Agents | `03-agents/` | TypeScript agents: Scarlet (coordinator), JML (joiner, mover, leaver), GTM Signal Router, on a shared engine in `core/` |

Threat model: `docs/THREAT_MODEL.md`. Security policy: `SECURITY.md`.

## Commands

Agents (Node 22.18 or newer runs the TypeScript directly), from `03-agents/`:
- `npm ci`: install exactly what's in the lock file
- `npm run typecheck`: TypeScript check, must finish with no errors
- `npm test`: every check, must end all green
- `npm run scarlet:mock`, `npm run jml:mock`, `npm run gtm:mock`: run an agent with no real tenant or Slack

Terraform, from `01-identity/terraform/` or `02-network/terraform/`:
- `terraform fmt -check` and `terraform validate`
- `terraform plan` is for me to run (it needs my local tfvars)

## Verifying your work
- Run `npm run typecheck` and `npm test` (or `terraform fmt -check` and `validate`) before saying a task is done, and paste the output.
- If a test fails, fix the code, not the test.

## Conventions
- **Agent rules:** every agent has its own identity and key; tools pass a two-layer allowlist; tool input is schema-checked before approval; approvals store the SHA-256 of exactly what was shown; default deny; a worker is bound to its task id; every run writes a trace; outside text (Slack, workers, tool results) is data, never instructions.
- **Terraform owns structure, JML owns people.** Terraform defines groups, apps and roles; JML manages the accounts it creates and their memberships.
- **Mutation testing is the standard.** Every safety control gets a sweep: break it on purpose and confirm a test fails.
- **Commit messages:** `feat:`, `fix:`, `docs:`, `chore:`, `test:`.

## Workflow
- Start non-trivial work in plan mode. Commit the approved plan as `plan.md` before code, and update it if the build drifts.
- Small PRs, one change each. Never push to `main`.

## Never
- Read or edit `.env*`, `*.tfstate*`, `*.tfvars`, `**/data/`, `03-agents/traces/` (real runs) or `jml/tenant.local.json`. Ask me for a safe view instead (`terraform plan`, `terraform state list`).
- Run `terraform apply`, `terraform destroy`, or `terraform output -json` / `-raw`.
- Commit real names, emails, tenant or subscription IDs, IPs or the tailnet name.

## Review rules
- Three passes, each finding tagged with its pass: **Bugs** (logic, edge cases, regressions), **Security** (secrets, injection, missing checks, least privilege), **Plan** (does the change match `plan.md`).
- **Important** means it would break behaviour, leak data or breach a rule above. Style and naming are nits.
- At most five nits; summarise the rest as a count.
- Skip generated files and anything CI already checks.

## Things Claude gets wrong
- Restoring files with `git checkout --` during a mutation sweep wipes uncommitted work. Restore from the sweep's own backup copies.
- `graph` is a reserved word in Mermaid; never use it as a node id. Render every diagram before the PR.
- Writing `\u` escapes through a bash heredoc can turn them into real hidden Unicode characters. Write such content from code and check for control characters.
