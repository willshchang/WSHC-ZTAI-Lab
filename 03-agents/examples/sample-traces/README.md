# Sample Agent Traces

**Document Type:** Reference  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** Security and platform engineers  
**Last Updated:** September 2026  

---

## Why traces matter

When an agent does something wrong, the first questions in any security
investigation are: which agent did it, under which identity, what did it see,
what did it try, who approved it, and what else ran as part of the same
request. Every agent in this lab writes a trace that answers those questions,
one JSON line per step.

Real traces are gitignored, since they can hold customer data and, for JML,
real tenant details. The three files here come from **mock runs** (a scripted
model and sample data), so they are safe to publish and show the exact format.

| File | What happened | The line to look at |
|---|---|---|
| `1-gtm-injection-blocked.jsonl` | A signup's notes field told the agent to export all contacts to an outside email. The (deliberately fooled) model tried it | `"type":"policy_denied"`: the tool isn't in the agent's policy, so it never ran. The target address is recorded as evidence |
| `2-scarlet-handoff-to-jml.jsonl` | Scarlet received "process hr-1004" and handed it to the JML agent through its contract | `"type":"delegation"`: who handed what to whom. The `delegate` result's `child_trace` points to the worker's own trace |
| `3-jml-protected-account-refused.jsonl` | The JML agent planned the change, found the break-glass account (`breakglass.admin`), refused it, and filed a friction report | `"type":"tool_result"` from `plan_hr_change` with `"refused":true`, then `report_friction`, then the `status_card` written by code |

Files 2 and 3 share one `requestId`: a single request can be followed across
every agent that touched it. `child_trace` is recorded relative to `03-agents`
(`traces/<file>`), never as an absolute path on the machine that ran it; it
names the file as it was saved at the time, which is file 3 here.

---

## Reading a trace line

Every line carries the same identity fields, stamped by the engine **after**
the event data, so no tool output can overwrite who did it.

| Field | Meaning |
|---|---|
| `ts` | When the step happened (UTC) |
| `sessionId` | The chat session the request came from, or `null` for a single request. Always set by the engine, so event data can't supply one |
| `agent` | Which agent acted. Each agent has its own API key, so this maps to one credential |
| `requestId` | The original request. Shared by a coordinator and every agent it hands work to |
| `runId` | This agent's run. Differs from `requestId` when the agent was started by another agent |
| `step` | Order within the run |
| `type` | What happened (below) |

| `type` | Records |
|---|---|
| `run_start` | The model, the agent's purpose and the exact tools it was offered |
| `model_turn` | What the model said and asked for, its stop reason, and whether a tool call was forced |
| `tool_call` / `tool_result` | Each tool, its risk tier, its input and its output |
| `policy_denied` | A tool the agent asked for that isn't in its policy, or an id outside the one its task names (`"reason":"id_binding"`). It never ran |
| `input_invalid` | Tool input that failed the tool's schema, or an external write holding control characters. Refused before anything ran or anyone was asked |
| `approval` | A human's decision on an external write (or a default deny when nobody was there, or a deny because the human already said no in this run), with `shownSha256`: the SHA-256 of the exact text the human saw |
| `approval_skipped` | An external write that wasn't ready (no draft, no plan), so no human was asked |
| `delegation` / `delegation_failed` | A coordinator handing work to another agent, and a handoff whose worker did not complete |
| `truncated_tool_call` / `model_refusal` | A tool call cut off by the token limit (never run), or a model refusal (nothing in it run) |
| `reminder` / `system_alert` | The engine catching an agent that tried to end without acting, or that stopped on an error. `alertDelivered` says whether Slack took the alert |
| `run_error` | An error that stopped the run (an API failure, a refusal, a crashed tool helper) |
| `status_card` / `status_post_failed` | JML: the `#jml-status` card written by code, or a card that failed to post |
| `run_end` | The outcome: completed, no action, step limit reached, or error. Always the last line |

---

## Investigating an incident

```bash
cd 03-agents/examples/sample-traces

# Everything the agents were stopped from doing
grep '"type":"policy_denied"' *.jsonl

# Every human approval decision, with the reason
grep '"type":"approval"' *.jsonl

# Everything that happened for one request, across all agents
grep '4a1dbfce-d8bc-44cb-8bb8-d1359c8517a4' *.jsonl
```

What this gives a responder:

1. **Scope:** the `requestId` shows every agent and step involved in one request.
2. **Identity:** `agent` maps to one API key, so containment is revoking one
   key without touching the other agents.
3. **Intent vs effect:** `model_turn` shows what the model asked for, and
   `policy_denied` or `tool_result` shows what actually happened.
4. **Accountability:** `approval` records whether a human said yes, or whether
   the request was denied because nobody was there, and the hash of exactly
   what they were shown.
5. **Prevention:** each incident becomes a test case. The friction report is
   already written in eval shape (task, expected, actual, evidence).

---

## In production

These are local JSONL files today. In production I would send the same events
as OpenTelemetry spans (the `requestId` / `runId` pair already maps to trace
and span IDs) to a central store with access controls and a retention policy,
redact secrets and personal data before they are written, and alert on
`policy_denied`, `system_alert` and repeated approval denials.
