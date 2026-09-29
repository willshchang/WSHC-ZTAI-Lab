# Layer 3: Agents

**Document Type:** Layer Overview  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** IT Administrator  
**Last Updated:** September 2026  
**Repository:** https://github.com/willshchang/WSHC-ZTAI-Lab  

---

## Overview

AI agents built on the same Zero Trust rules as the rest of the lab. Layer 1
controls **Accessibility** (who can access what) and Layer 2 controls
**Reachability** (what can reach what). This layer applies both to agents.

Most agent demos give the model one admin key and hope. Here every agent gets:

| Control | What it means in plain English |
|---|---|
| **Its own identity** | A stable agent ID stamped on every trace line, and its own API key. No key, no run |
| **Least privilege** | The model only sees the tools in its policy; anything else is refused, even if it asks |
| **Risk tiers** | Reads run freely, internal writes run and are traced, external writes wait for a human |
| **Default deny** | No human at the keyboard means the answer is no |
| **A trace** | Every step (what it saw, decided and did) written to a JSONL file |
| **A way to say "I'm stuck"** | `report_friction` files an eval-shaped report instead of guessing |

---

## Agents

| Agent | Job | Status |
|---|---|---|
| **GTM Signal Router** | Score a new signup from product signals and route it to sales, nurture or self-serve | Built |
| **Scarlet** (coordinator) | Read a request and hand it to the one agent whose job it is. Holds no data tools | Built |
| JML Agent | Joiner, mover and leaver changes on the identity layer, with human approval for leavers | Planned |

---

## How an Agent Runs

```
task ─▶ model reasons ─▶ asks for a tool
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     in the agent's policy?            not in the policy
              │                        → denied + traced
              ▼
     risk tier?
       read / internal-write  → runs, result traced
       external-write         → human approves? ─ no → denied + traced
                                      │ yes
                                      ▼
                                 runs, result traced
              │
              ▼
     result goes back to the model ─▶ repeat until done (step limit)
```

The engine lives in `core/`. A new agent only supplies its own tools, policy
and instructions.

---

## GTM Signal Router

**Tools and risk tiers:**

| Tool | Risk | What it does |
|---|---|---|
| `get_signup` | read | Reads the signup record |
| `score_account` | read | Scores 0 to 100 with fixed rules, no AI |
| `draft_routing_message` | read | Formats the Slack message, posts nothing |
| `report_friction` | internal-write | Posts an eval-shaped report to `#agent-feedback` |
| `post_to_slack` | external-write | Posts to `#gtm-routing` after human approval |

**Why the score is plain code:** it must be cheap, repeatable and testable.
The model reasons about the score and decides the route; it never invents the
number.

**Demo scenarios** (sample data uses reserved `.example` domains):

| Signup | What it shows |
|---|---|
| `northwind-transit` | Clear sales lead, human approval before posting |
| `pixel-pine` | Nurture route |
| `sam-side-project` | Self-serve route |
| `harbor-health` | Missing data that could change the route: friction report instead of a guess, flagged for a human |
| `quickship-labs` | Prompt injection hidden in the signup notes: the forbidden tool call is blocked by policy and reported |

---

## Scarlet (Coordinator)

Scarlet knows the map and routes each request to the one agent whose job it is.
She holds no data tools of her own. **A coordinator routes, it never holds:** if
she held the other agents' tools, she would be the god-mode agent by the back door.

**Tools and risk tiers:**

| Tool | Risk | What it does |
|---|---|---|
| `delegate` | internal-write | Hands a task to one agent on her allowlist |
| `report_friction` | internal-write | Reports a request she can't route safely, instead of guessing |

**Coordinator safety rules:**

| Rule | How it's enforced |
|---|---|
| **No privilege passing** | Only a task string crosses over. The agent runs with its own policy, tools, key and approval gate. Scarlet can't grant tools or pre-approve anything |
| **Human approval stays at the action** | The GTM agent still asks a human before posting, even when Scarlet started it |
| **No made-up agents** | The agent name is a fixed list in the tool schema, and checked again at runtime |
| **No made-up results** | The agent's own final words are printed verbatim, and Scarlet's summary must quote them |
| **Handoff results are data** | Another agent's result is never treated as instructions |
| **No loops** | Handoff depth is 1: agents can't call Scarlet or each other. Plus a 5-step limit |
| **Default deny** | Unknown requests and missing details are reported, never guessed |
| **Joined traces** | One request ID runs through Scarlet's trace and the agent's trace. The agent's trace also records which run handed it the work (the same parent/child idea as OpenTelemetry spans) |

**Demo scenarios:**

| Request | What it shows |
|---|---|
| `"route the harbor-health signup"` | Handoff to the GTM agent, which still waits for a human before posting |
| `"offboard jane from the directory"` | A fooled model reaches for an agent outside her policy (`agent-jml`), and the runtime blocks it |
| `"route the new signup"` | No signup id: reported, not guessed |
| `"write me a poem about tacos"` | No agent owns this job: reported, not guessed |

**On hallucination:** no design can promise a model is never wrong. This one
limits the damage: Scarlet can only choose real agents, her answers must quote
real results, and every step is traced so anyone can check it.

---

## Quick Start

Requires Node.js 22.18 or later (runs TypeScript directly, no build step).

```bash
cd 03-agents
npm install

# No API key needed: scripted model, everything else real
npm run gtm:mock -- --signup harbor-health

# Real Claude (needs .env)
cp .env.example .env
# add one API key per agent (ANTHROPIC_API_KEY_GTM, ANTHROPIC_API_KEY_SCARLET),
# optionally the two Slack webhook URLs
npm run gtm -- --signup harbor-health

# Scarlet routes a plain-language request to the right agent
npm run scarlet:mock -- "route the harbor-health signup"
npm run scarlet -- "route the harbor-health signup"

npm run gtm -- --list      # show all signup ids
npm run typecheck          # type-check everything
```

Without Slack webhooks, posts are printed as a dry run instead of sent.

> **Mock mode** replaces only the model with a scripted one. Policy checks,
> human approval, tools, traces and Slack all run for real. The `quickship-labs`
> run plays a fooled model on purpose, to prove the policy layer still blocks it.

---

## Security Notes

- API keys and webhook URLs live only in `.env`, which is gitignored
- One API key per agent, each named after its agent in the Anthropic Console, so spend shows per agent and one key can be revoked without touching the others
- An agent whose own key is missing **refuses to run**. It never falls back to a shared key, since that would quietly turn one agent's credential into everyone's
- Spend is capped by prepaid credit with auto-reload off (the Default workspace can't take a spend limit; a dedicated workspace with its own limit comes with an organization account)
- Traces are gitignored, since they can contain signup data
- Customer data is treated as data, never instructions: injected commands are refused and reported
- **Known gap:** Scarlet and the agents she calls run in one process. Each reads only its own key, but the process could technically read both. Real isolation needs separate processes, and the end state is secretless identity (below)

**Roadmap (production build):**

- **Secretless agent identity:** every agent gets its own identity **and a named human owner**, running under an Entra managed identity on the Azure VM plus workload identity federation, so no static key exists anywhere. This also closes the shared-process gap above
- **OpenTelemetry traces** for live end-to-end observability (the request ID and parent link already follow the span model)
- **A fast decision model** (such as Jev) for routing and guardrail checks

**Spend watcher (designed, not built):** tracks API spend per agent key. The
cost report needs an organization-wide admin key, so the design splits the
work: plain code holds the admin key and pulls the numbers, and only the
numbers reach the model or Slack. The model never sees the key. It's on hold
because the admin API isn't available on individual accounts.

---

## Official References

| Topic | URL |
|---|---|
| Claude tool use | https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools |
| Claude models | https://platform.claude.com/docs/en/models/overview |
| Node.js TypeScript support | https://nodejs.org/api/typescript.html |
| Slack incoming webhooks | https://api.slack.com/messaging/webhooks |
| Claude Usage and Cost API | https://platform.claude.com/docs/en/manage-claude/usage-cost-api |
| Claude Console workspaces and spend limits | https://platform.claude.com/docs/en/manage-claude/workspaces |
| LangGraph recursion limit (no-loop design) | https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT |
| OpenTelemetry GenAI semantic conventions | https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/ |
| RFC 2606 reserved domains (`.example`) | https://www.rfc-editor.org/rfc/rfc2606 |
