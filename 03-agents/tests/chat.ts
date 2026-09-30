// ============================================================
// TEST: Scarlet's chat tool can't swallow a real request
// ============================================================
// chat lets her answer small talk like a person, and it counts as
// acting. The risk: chatting past a request ("sure, on it!") and
// doing nothing. The backstop, in code: chat refuses any message
// that matches an agent's requestPattern (ids and action words),
// and a refusal doesn't count as acting, so she stays forced.
// ============================================================

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../core/agent.ts";
import { Trace } from "../core/trace.ts";
import type { AgentTool, Block, ModelClient, ModelRequest } from "../core/types.ts";
import { scarletPolicy } from "../scarlet/policy.ts";
import { loadRegistry } from "../scarlet/registry.ts";
import { makeChatTool } from "../scarlet/tools.ts";

delete process.env.SLACK_WEBHOOK_AGENT_FEEDBACK;

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "OK" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};
const capture = async (fn: () => Promise<unknown>) => {
  const orig = console.log;
  let out = "";
  console.log = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
  try { await fn(); } finally { console.log = orig; }
  return out;
};

const registry = loadRegistry();
const ctx = { policy: scarletPolicy, trace: new Trace("agent-scarlet"), mock: true };
const tryChat = async (message: string) => {
  try {
    await capture(() => makeChatTool(registry, message).run({ message: "Hi Will!" }, ctx));
    return "allowed";
  } catch {
    return "refused";
  }
};

// ---- Small talk is allowed ---------------------------------------
for (const m of ["Good morning Scarlet, ready for today?", "hello scarlet", "thanks, that was great!", "how are you doing?"]) {
  check((await tryChat(m)) === "allowed", `small talk is allowed: "${m}"`);
}

// ---- Anything an agent could act on is refused --------------------
for (const m of [
  "process hr-1008",
  "Good morning! Can you process hr-1010?",
  "route it",
  "route the new signup",
  "what can you do about pixel-pine?",
  "onboard ava please",
  "offboard maya",
  "any new signups today?",
]) {
  check((await tryChat(m)) === "refused", `a request is refused by chat: "${m}"`);
}

// ---- Each agent's own pattern catches its own requests ------------
// (checked one agent at a time, so one agent's pattern can't hide a gap in another's)
const own = (id: string) => registry.find((a) => a.id === id)!.requestPattern;
const gtmP = own("agent-gtm-signal-router");
const jmlP = own("agent-jml");
check(["route pixel-pine", "Route PIXEL-PINE", "any new SIGNUPS?"].every((m) => gtmP.test(m)), "the GTM pattern alone catches its ids and action words, in any case");
check(["process hr-1008", "Process HR-1008", "OFFBOARD maya", "a new joiner starts monday"].every((m) => jmlP.test(m)), "the JML pattern alone catches its ids and action words, in any case");
check((await tryChat("Process HR-1008 please")) === "refused", "an upper-case request is still refused by chat");

// ---- A fooled model can't chat past a request ---------------------
const fake = (name: string): AgentTool => ({
  name, description: name, inputSchema: { type: "object", properties: {} }, risk: "read",
  run: async () => ({ ok: true }),
});
const forced: boolean[] = [];
let i = 0;
const script: Block[][] = [
  [{ type: "tool_use", id: "c1", name: "chat", input: { message: "Sure, on it!" } }],
  [{ type: "tool_use", id: "d1", name: "delegate", input: {} }],
  [{ type: "text", text: "Handed off." }],
];
const fooled: ModelClient = {
  label: "stub",
  canForceTool: true,
  next: async (req: ModelRequest) => {
    forced.push(Boolean(req.mustUseTool));
    const blocks = script[i++] ?? [{ type: "text", text: "done" }];
    return { blocks, stopReason: blocks[0]?.type === "tool_use" ? "tool_use" : "end_turn" };
  },
};
const message = "route pixel-pine";
let result: Awaited<ReturnType<typeof runAgent>> | undefined;
const out = await capture(async () => {
  result = await runAgent({
    policy: scarletPolicy,
    tools: [fake("delegate"), fake("report_friction"), fake("ask_human"), fake("stand_by"), makeChatTool(registry, message)],
    model: fooled, system: "t", task: message, mock: true,
  });
});
const trace = readFileSync(result!.traceFile, "utf8");
check(/"chat_refused"/.test(trace) && !out.includes("Sure, on it!"), "a fooled model's chat on a request is refused and never shown as a reply");
check(forced.join() === "true,true,false" && result!.outcome === "completed",
  "a refused chat doesn't count as acting: she stays forced until she delegates");

// ---- Her reply shows as one 💭 line; the trace keeps the call ------
let greetResult: Awaited<ReturnType<typeof runAgent>> | undefined;
const greet = await capture(async () => {
  const s: Block[][] = [[{ type: "tool_use", id: "c2", name: "chat", input: { message: "Good morning, Will!" } }], [{ type: "text", text: "" }]];
  let j = 0;
  greetResult = await runAgent({
    policy: scarletPolicy, tools: [makeChatTool(registry, "Good morning Scarlet")],
    model: { label: "stub", canForceTool: true, next: async () => { const b = s[j++]!; return { blocks: b, stopReason: b[0]?.type === "tool_use" ? "tool_use" : "end_turn" }; } },
    system: "t", task: "Good morning Scarlet", mock: true,
  });
});
check(/"tool_call".*"chat"/.test(readFileSync(greetResult!.traceFile, "utf8")) && greetResult!.outcome === "completed",
  "chat is recorded in the trace and counts as acting");
check(greet.includes("💭 Good morning, Will!") && !greet.includes("🔧 chat") && !greet.includes("ended without acting"),
  "a greeting shows as one 💭 line, with no tool line and no reminder");

// ---- The directory fails closed without a requestPattern ----------
const dir = mkdtempSync(join(tmpdir(), "reg-"));
const raw = JSON.parse(readFileSync(new URL("../scarlet/agents.json", import.meta.url), "utf8"));
const refused = (mutate: (a: Record<string, unknown>) => void) => {
  const copy = structuredClone(raw);
  mutate(copy.agents[0]);
  const f = join(dir, "agents.json");
  writeFileSync(f, JSON.stringify(copy));
  try { loadRegistry(f); return false; } catch { return true; }
};
check(refused((a) => { delete a.requestPattern; }), "an agent with no requestPattern: Scarlet refuses to start");
check(refused((a) => { a.requestPattern = "(unclosed"; }), "a broken requestPattern: Scarlet refuses to start");

process.exit(failures ? 1 : 0);
