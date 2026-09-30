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
| `2-scarlet-handoff-to-jml.jsonl` | Scarlet received "process hr-1004" and handed it to the JML agent through its contract | `"type":"delegation"`: who handed what to whom, plus a pointer to the worker's own trace |
| `3-jml-protected-account-refused.jsonl` | The JML agent planned the change, found a break-glass admin account, refused it, and filed a friction report | `"type":"tool_result"` from `plan_hr_change` with `"refused":true`, then `report_friction` |

Files 2 and 3 share one `requestId`: a single request can be followed across
every agent that touched it.

---

## Reading a trace line

Every line carries the same identity fields, stamped by the engine **after**
the event data, so no tool output can overwrite who did it.

| Field | Meaning |
|---|---|
| `ts` | When the step happened (UTC) |
| `agent` | Which agent acted. Each agent has its own API key, so this maps to one credential |
| `requestId` | The original request. Shared by a coordinator and every agent it hands work to |
| `runId` | This agent's run. Differs from `requestId` when the agent was started by another agent |
| `step` | Order within the run |
| `type` | What happened (below) |

| `type` | Records |
|---|---|
| `run_start` | The model, the agent's purpose and the exact tools it was offered |
| `model_turn` | What the model said and asked for, and whether a tool call was forced |
| `tool_call` / `tool_result` | Each tool, its risk tier, its input and its output |
| `policy_denied` | A tool the agent asked for that isn't in its policy. It never ran |
| `approval` | A human's decision on an external write, or a default deny when nobody was there |
| `delegation` | A coordinator handing work to another agent, and the task it sent |
| `reminder` / `system_alert` | The engine catching an agent that tried to end without acting |
| `run_end` | The outcome: completed, no action, or step limit reached |

---

## Investigating an incident

```bash
cd 03-agents/examples/sample-traces

# Everything the agents were stopped from doing
grep '"type":"policy_denied"' *.jsonl

# Every human approval decision, with the reason
grep '"type":"approval"' *.jsonl

# Everything that happened for one request, across all agents
grep '601328b0-84b8-4909-af32-0165f994896e' *.jsonl
```

What this gives a responder:

1. **Scope:** the `requestId` shows every agent and step involved in one request.
2. **Identity:** `agent` maps to one API key, so containment is revoking one
   key without touching the other agents.
3. **Intent vs effect:** `model_turn` shows what the model asked for, and
   `policy_denied` or `tool_result` shows what actually happened.
4. **Accountability:** `approval` records whether a human said yes, or whether
   the request was denied because nobody was there.
5. **Prevention:** each incident becomes a test case. The friction report is
   already written in eval shape (task, expected, actual, evidence).

---

## In production

These are local JSONL files today. In production I would send the same events
as OpenTelemetry spans (the `requestId` / `runId` pair already maps to trace
and span IDs) to a central store with access controls and a retention policy,
redact secrets and personal data before they are written, and alert on
`policy_denied`, `system_alert` and repeated approval denials.
