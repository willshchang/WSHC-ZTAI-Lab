# Plan: map the lab to NIST's agent identity tenets, and fix the SP 800-207 table

Intent: `pr-in-progress/Lab-NIST-tenets-intent.md` (Will, November 4, 2026, status ready).
Source: both NIST posts, captured in `resource-capture/NIST-agent-identity-posts-1-and-2.md`, and checked against the live pages (all ten tenet names match).
Branch `docs/nist-agent-tenets` from `main` at `8798abc`. Docs only: `docs/THREAT_MODEL.md`, `README.md`, and this plan. The tooling freeze since PR #18 stands.

## Context

NIST published ten design tenets for agent identity, authentication and authorization on October 27, 2026 (post #2; post #1 was August 27). The threat model maps to OWASP and the README maps to SP 800-207, but nothing maps to the new tenets. The lab's agents are the early version of eZTrust; the product is the eZTrust Engine, a private build. Its status per tenet is given, never its design.

## Order of work

1. This plan as `plan.md`, committed first (`docs:`).
2. Commit: the threat model section and rows A18 to A21.
3. Commit: the README tenet table, checked against the official SP 800-207 PDF.
4. Run the five acceptance scenarios, push, open the PR. Will merges.

## Commit 2: `docs/THREAT_MODEL.md`

- New section **"NIST agent identity tenets"**, after "How to read this" and before "What we protect": one paragraph (what the tenets are, a link to post #2, the lab and engine positioning, no link to the engine), a short legend for the engine's status words, and a table of the ten tenets with NIST's exact names, numbered 01 to 10.
- Columns: **Tenet** · **Lab** (status, a short reason, the row IDs) · **eZTrust Engine (private build)** (status plus at most one short principle-level phrase).
- Lab statuses use the lab's own legend (Built, Partial, Gap), read from the rows cited. Where a tenet is mostly met with one weak part, the lab's existing form is used ("Built, fatigue Partial").
- A note under the table for tenet 06: the `agents.json` contracts and the schema checks are the "organizationally defined templates" the tenet allows; nothing signs them, in the lab or the engine yet.
- New Layer 3 rows A18 to A21. Each Control cell says what the lab does today, then one line starting "In the eZTrust Engine:".
  - A18 Static agent keys (tenets 01, 04). Also names the JML Graph app's client secret (`jml/graph.ts`), which is the same kind of static secret.
  - A19 Worker authority comes from its own key (tenet 02). A3's id binding is the partial answer.
  - A20 Traces are written by the agent process (tenet 10).
  - A21 No anomaly detection (tenet 09).
- A20 and A21 have no OWASP match, so they say n/a; "How to read this" gains one sentence saying so.
- Last Updated: November 2026. Official References: post #2, post #1, and the Microsoft page on access token lifetime (backs "short-lived tokens" in A18).
- Existing rows keep their IDs and wording.

## Engine statuses

Taken from ZTAI's `docs/THREAT_MODEL.md` on `main` at `a427407`, read only. Where the intent's table and that doc disagree, the stricter word is used, and the handoff lists every case. Found while planning:

| Tenet | Intent | ZTAI doc | Used |
|---|---|---|---|
| 01 | Planned | Agent impersonation row: Partial (checks in the policy core; the agent's own sign-in is planned) | Planned (stricter) |
| 03 | Designed | Self-approval row: Partial; executor reach row: Planned | Designed (stricter than Partial) |
| 05 | Designed | Approval fatigue row: Partial; push-bombing row: Planned | Designed (stricter than Partial) |
| 07, 08 | Built in part | "A model decides" row: Partial | Built in part (claims no more than Partial) |
| 09 | Partial, "per-agent limits ... anomaly detection on the roadmap" | Friction row: Partial; pending cap per identity: Planned; anomaly detection not in any ZTAI doc | Partial, with the phrase narrowed: per-agent request types and friction flags, pending cap planned, no anomaly detection yet |
| 10 | Planned | Record row: Planned; chain head copy to immutable storage: Later | Planned, and A20 says the immutable copy comes later |

Statuses 02, 04 and 06 agree.

## Commit 3: `README.md`

Checked against SP 800-207 section 2.1 in the official PDF (nvlpubs.nist.gov). Today's table says "Mapped to the tenets" but has five rows that are not the tenets: "Policy is centrally managed and auditable" is not one of the seven; "decided per request" says more than NIST's "per-session"; tenets 1, 5 and 7 are missing; and "Entra ID SSO with MFA" leaves out that Conditional Access is frozen on today's Free tenant.

**Open question from the intent, proposed answer: list all seven tenets.** Each row quotes NIST's tenet sentence and says how the lab meets it, with a plain Gap where it doesn't (device posture, behaviour signals). Why: fewer rows under an accurate heading would hide exactly the tenets the lab misses, and seven rows mirror the new agent tenet table. The policy-as-code content moves into tenet 4, where NIST defines policy. Will can ask for the shorter form in review.

Also: one line pointing to the new threat model section, Last Updated November 2026, and post #2, post #1 and the SP 800-207 PDF in Official References.

## Checks

- The five acceptance scenarios, run as searches on the branch.
- Every new row ID cited exists; every anchor link resolves; no em dashes or control characters in the changed files.
- No Mermaid changes, so no render step. No code changes, so `npm test` is not affected; it is run anyway.

## Risks

- A public reader could take engine statuses as product claims. Every engine phrase is principle-level, and each status is the stricter of the two sources.
- The lab statuses are judgement calls on whole tenets. Each one names its rows so a reader can check.
