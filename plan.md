# Plan: one copy of each diagram, and the docs around them

Brief: `Lab diagrams brief.md` from the reviewer chat, October 26, 2026, scope approved by Will.
Branch `docs/diagram-cleanup` from `main` at `f7be4aa`. Docs only.

## Context

The Lab had 11 Mermaid blocks. Four were copies of another block, and some no longer matched the code: the identity foundation left out the admin-group bridge and the break-glass exclusion, the network diagram used dotted lines for routes, and the Security Model kept friction reports behind approval. This PR keeps one copy of each diagram, swaps in corrected blocks, and fixes the broken fences and leftover text in the docs around them. The result is 7 blocks.

Rules for diagrams on GitHub (agreed Oct 26):
- GitHub's default look: no `classDef`, `linkStyle` or `style` lines; keep the `%%{init...}%%` line.
- Solid lines move forward. Dotted lines are a write to the record or a log, or a reply. A path that only runs sometimes is solid, with the condition in its label.
- One line under each diagram's title says what dotted means (if used) and what the diagram leaves out.
- One copy of each diagram: it stays in its home file, and other files link to it.

## Order of work

1. Branch `docs/diagram-cleanup` from `main`.
2. This plan as `plan.md`, committed first (`docs:`).
3. Commits 1 to 3 below.
4. Checks, push, PR. Will merges.

## Commit 1: one copy of each diagram

| Diagram | Home | Copy replaced with a link |
|---|---|---|
| Identity foundation | `01-identity/README.md#zero-trust--two-layers` | `01-identity/docs/admin/02-security-model.md` |
| Identity journey | `01-identity/README.md#identity-journey` | `README.md` (Identity Journey), `01-identity/docs/ARCHITECTURE.md` |
| Network | `02-network/README.md#architecture` | `02-network/docs/03-Network_Architecture.md` |

Each link is one sentence. `README.md` keeps its numbered steps. `02-security-model.md` loses the leftover caption, and "See the security architecture diagram above" points at the link. The network copy's caption goes with it, since the home README says the same.

## Commit 2: the diagrams

- `README.md`, Security Model: new block (the checks box names policy, schema and risk tier; friction reports reach Slack with no approval). Legend: "Dotted: written to the trace. Left out: JML's `#jml-status` card and the system alerts in `#agent-feedback`, which code posts to Slack itself, not through these checks."
- `01-identity/README.md`: new foundation block (admin roles bridge, break-glass exclusion, JML groups) and new journey block (MFA at sign-in is solid, not dotted). The journey's heading line says one human review comes before apply, and what the Free tenant changes.
- `02-network/README.md`: new block (exit node as a solid conditional path, router 2 takes over on failure, internet node). The note says every arrow from the engineer devices is an `acl.tf` grant.
- `03-agents/README.md`: new How an Agent Runs block (refusals reply to the model, dotted). Scarlet keeps its block and gains a legend line.
- `README.md` overview: no change.

Legend lines go right above the block when the brief says "under the title", and right below it when it says "under it".

## Commit 3: the docs around them

- `03-Network_Architecture.md`: remove the pasted chat text; keep one RFC 1918 section (the longer one); move Site B and Engineer Devices back under Network Topology; fence the five unfenced diagrams, re-indenting the lab VNet tree so its nesting shows.
- `ARCHITECTURE.md`: fix the four broken fences; the Identity Journey becomes a numbered list in the order things happen.
- `README.md`: Layer 3 reads as built, with next steps, in Repository Structure and Roadmap; the SSO row says the Tailscale app exists in Entra but the tailnet doesn't sign in through Entra yet.
- `03-agents/README.md`, Act first: name all four models that reject forced tool calls (Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1), as `core/model.ts`, `tests/act-first.ts` and Anthropic's [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#forcing-tool-use) page do.
- Last Updated: October 2026 on every changed file.

## Decisions

- No "left out" lines for the overview, the identity journey, the network or Scarlet: their paragraph, heading line or note already says it.
- How an Agent Runs doesn't draw the two extra refusals on external writes (control characters, tool not ready). It is a summary.
- No local mermaid-cli render. The reviewer rendered the blocks; Will checks GitHub in light and dark.

## Checks

- Every Mermaid block with file and line: 7, no two the same, no styling lines, every dotted edge a trace write or a reply.
- Fences balanced in every changed file; no control or hidden Unicode characters.
- `cd 03-agents && npm run typecheck && npm test`, with the count.
- `git diff --name-only main`: only the Markdown files named here and `plan.md`.
- After the push, the rendered HTML from GitHub's API has each link's target heading id.

## Review

Runs in Will's other session, read-only. The reviewer reports, the writer fixes, Will merges.
