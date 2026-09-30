// ============================================================
// TEST: act first (forced tool call until the agent has acted)
// ============================================================
// Scarlet must call a tool until she has delegated, reported or
// stood by, so a greeting can't end in a plain-text reply. Once she
// has acted she may finish normally (forcing every turn would loop).
// Models that reject forced tool calls never get the setting.
// No network: the model and the API are stubbed.
// ============================================================

import { runAgent } from "../core/agent.ts";
import { canForceTool, createClaudeClient } from "../core/model.ts";
import type { AgentPolicy, AgentTool, Block, ModelClient, ModelRequest } from "../core/types.ts";
import { gtmPolicy } from "../gtm-signal-router/policy.ts";
import { scarletPolicy } from "../scarlet/policy.ts";

delete process.env.SLACK_WEBHOOK_AGENT_FEEDBACK;

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "OK" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const orig = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = orig; }
};

// Fake tools with the real names; one of them can be made to fail
const tool = (name: string, fail = false): AgentTool => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: {} },
  risk: "read",
  run: async () => { if (fail) throw new Error("refused"); return { ok: true }; },
});

// A scripted model that records whether each turn was forced
function scripted(turns: Block[][]): { client: ModelClient; forced: boolean[] } {
  const forced: boolean[] = [];
  let i = 0;
  let n = 0;
  return {
    forced,
    client: {
      label: "stub",
      canForceTool: true,
      next: async (req: ModelRequest) => {
        forced.push(Boolean(req.mustUseTool));
        const blocks = (turns[i++] ?? [{ type: "text", text: "done" }]).map((b) =>
          b.type === "tool_use" ? { ...b, id: `t${++n}` } : b,
        );
        return { blocks, stopReason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" };
      },
    },
  };
}
const use = (name: string): Block => ({ type: "tool_use", id: "", name, input: {} });
const say = (text: string): Block => ({ type: "text", text });
const tools = (failDelegate = false) => [tool("ask_human"), tool("stand_by"), tool("report_friction"), tool("delegate", failDelegate)];
const run = (policy: AgentPolicy, client: ModelClient, t = tools()) =>
  quiet(() => runAgent({ policy, tools: t, model: client, system: "t", task: "Good morning Scarlet", mock: true }));

// ---- The loop -----------------------------------------------------
// Greeting: ask_human (not an action), then stand_by (an action), then a summary
let s = scripted([[use("ask_human")], [use("stand_by")], [say("Standing by.")]]);
let r = await run(scarletPolicy, s.client);
check(s.forced.join() === "true,true,false" && r.outcome === "completed",
  "Scarlet is forced to use a tool until she acts (ask_human alone doesn't count), then may finish");

// A required action that FAILS doesn't count: still forced until one succeeds
s = scripted([[use("delegate")], [use("report_friction")], [say("Reported.")]]);
r = await run(scarletPolicy, s.client, tools(true));
check(s.forced.join() === "true,true,false", "a failed handoff doesn't count as acting; she stays forced until one succeeds");

// Acting on the first turn frees her immediately
s = scripted([[use("delegate")], [say("Handed off.")]]);
await run(scarletPolicy, s.client);
check(s.forced.join() === "true,false", "after a successful handoff she is no longer forced");

// Agents without act-first are never forced (GTM unchanged)
s = scripted([[say("Hello")]]);
await run(gtmPolicy, s.client);
check(s.forced.every((f) => f === false), "an agent without act-first is never forced");

// Required actions alone don't force: act-first is opt-in per agent
s = scripted([[say("Hi")], [use("stand_by")], [say("ok")]]);
await run({ ...scarletPolicy, actFirst: false }, s.client);
check(s.forced.length > 0 && s.forced.every((f) => f === false), "an agent with required actions but no act-first is never forced (the guard alone applies)");

// The guard is still the backstop if the model talks anyway
s = scripted([[say("Hi Will!")], [use("stand_by")], [say("ok")]]);
r = await run(scarletPolicy, s.client);
check(r.outcome === "completed" && s.forced.join() === "true,true,false", "if a model talks anyway, the guard still reminds her and she stays forced");

// ---- The model client --------------------------------------------
check(canForceTool("claude-haiku-4-5-20251001"), "Haiku 4.5 can be forced");
for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1", "claude-future-9"]) {
  check(!canForceTool(m), `${m} is never forced (documented 400, or unknown: safe default)`);
}

// What actually goes to the API (fetch stubbed, no network)
const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  sent.push(JSON.parse(String(init?.body ?? "{}")));
  return new Response(JSON.stringify({
    id: "msg_1", type: "message", role: "assistant", model: "x",
    content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

process.env.ANTHROPIC_API_KEY_SCARLET = "test-key";
const req = (mustUseTool: boolean): ModelRequest => ({ system: "t", messages: [{ role: "user", content: "hi" }], tools: tools(), mustUseTool });

process.env.ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
let c = createClaudeClient(scarletPolicy);
await c.next(req(true));
await c.next(req(false));
check(JSON.stringify(sent[0]?.tool_choice) === '{"type":"any"}', "Haiku + must use a tool: the API call carries tool_choice any");
check(sent[1] !== undefined && !("tool_choice" in sent[1]), "Haiku + already acted: no tool_choice (the default, auto)");

process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
c = createClaudeClient(scarletPolicy);
await c.next(req(true));
check(sent[2] !== undefined && !("tool_choice" in sent[2]) && c.canForceTool === false, "Sonnet 5.5 is never sent tool_choice any, even when a tool is required");

process.exit(failures ? 1 : 0);
