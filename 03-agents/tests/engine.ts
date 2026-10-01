// ============================================================
// TEST: the engine's own guarantees (core/agent.ts and friends)
// ============================================================
//   - an error anywhere still ends with run_error, a system alert
//     and run_end (never a silent crash), even if Slack is down
//   - what a human approves is terminal-safe, hashed, and exactly
//     what the tool receives; hidden characters in an external write
//     are refused before anyone is asked
//   - tool input is checked against the schema before anything runs
//   - a tool call cut off by the token limit never runs; a refusal
//     never runs anything; an empty reply is never sent back
//   - default deny without a terminal, and one "no" stands for the run
//   - the trace stamp always wins over event data
// No network: the model, the human and Slack are scripted.
// ============================================================

import { createHash } from "node:crypto";
import { chmodSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { runAgent, RETRY_MAX_TOKENS } from "../core/agent.ts";
import { makeFrictionTool } from "../core/friction.ts";
import { forTerminal, hasControlChars, jsonSafe } from "../core/sanitize.ts";
import { cutAt, escapeSlack } from "../core/slack.ts";
import { Trace } from "../core/trace.ts";
import type { AgentPolicy, AgentTool, ToolContext } from "../core/types.ts";
import { DEFAULT_MAX_STRING, validateInput } from "../core/validate.ts";
import { scarletPolicy } from "../scarlet/policy.ts";
import { capture, check, done, noHuman, ofType, rejection, say, scriptHuman, scriptedModel, traceLines, use } from "./helpers.ts";

delete process.env.SLACK_WEBHOOK_AGENT_FEEDBACK;
const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

const policy: AgentPolicy = {
  id: "agent-test",
  name: "Test Agent",
  purpose: "test",
  allowedTools: ["read_tool", "write_tool", "stand_by"],
  maxSteps: 6,
  apiKeyEnv: "UNUSED",
};

let readRuns = 0;
const readTool: AgentTool = {
  name: "read_tool",
  description: "r",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, kind: { type: "string", enum: ["a", "b"] }, n: { type: "integer" }, short: { type: "string", maxLength: 5 } },
    required: ["id"],
    additionalProperties: false,
  },
  risk: "read",
  run: async () => { readRuns++; return { ok: true }; },
};

let written: ToolContext["approved"][] = [];
let shownText = "";
const writeTool: AgentTool = {
  name: "write_tool",
  description: "w",
  inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false },
  risk: "external-write",
  describeForApproval: () => shownText,
  run: async (_input, ctx) => { written.push(ctx.approved); return { posted: true }; },
};
const standBy: AgentTool = {
  name: "stand_by", description: "s", inputSchema: { type: "object", properties: {} }, risk: "read",
  run: async () => ({ ok: true }),
};
const tools = [readTool, writeTool, standBy];
const run = (model: ReturnType<typeof scriptedModel>["client"], p: AgentPolicy = policy) => {
  let result: Awaited<ReturnType<typeof runAgent>> | undefined;
  return capture(async () => { result = await runAgent({ policy: p, tools, model, system: "t", task: "test", mock: true }); })
    .then((out) => ({ out, r: result! }));
};

// ---- A1: an error still ends the run on the record ------------------
{
  const m = scriptedModel([[use("read_tool", { id: "x" })], () => { throw new Error("API returned 400"); }]);
  const { r, out } = await run(m.client);
  const lines = traceLines(r.traceFile);
  const last = lines.at(-1)!;
  check(r.outcome === "error", "a model call that throws ends the run with outcome error (it does not reject)");
  check(ofType(r.traceFile, "run_error").some((l) => String(l.error).includes("API returned 400")), "the error is recorded as run_error in the trace");
  check(last.type === "run_end" && last.outcome === "error", "the trace ends with run_end, outcome error");
  check(ofType(r.traceFile, "system_alert").length === 1 && /filed by the system/.test(out), "a system alert is filed for the error");
}
{
  // Slack is down: the alert can't post, but it still lands in the trace
  process.env.SLACK_WEBHOOK_AGENT_FEEDBACK = "https://hooks.slack.invalid/x";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("connect ECONNREFUSED"); }) as typeof fetch;
  const m = scriptedModel([() => { throw new Error("overloaded"); }]);
  const { r } = await run(m.client);
  globalThis.fetch = realFetch;
  delete process.env.SLACK_WEBHOOK_AGENT_FEEDBACK;
  const alert = ofType(r.traceFile, "system_alert")[0];
  check(alert?.alertDelivered === false && String(alert?.deliveryError).includes("ECONNREFUSED"), "if Slack fails, the system alert is still traced with alertDelivered false");
  check(traceLines(r.traceFile).at(-1)?.type === "run_end", "and the run still ends with run_end");
}

// ---- A2: what the human sees is safe, hashed and exactly what runs ---
check(forTerminal("a\rb\x1b[2Jc\u202ed\u2066e\x07\nf") === "a\\rb\\x1b[2Jc\\u202ed\\u2066e\\x07\nf", "the sanitizer escapes CR, ESC, BEL and bidi controls, and keeps newlines");
check(forTerminal("\x85\x9b\x7f\t") === "\\x85\\x9b\\x7f\\t", "C1 controls, DEL and tab are escaped too");
check(hasControlChars("ok\u202e") && hasControlChars("x\r") && !hasControlChars("plain text\nline two"), "hasControlChars flags hidden characters, not newlines");
{
  shownText = "Post to #x:\nRoute to SALES\rRoute to NOBODY\x1b[2K \u202eevil";
  const h = scriptHuman(["y"]);
  written = [];
  const m = scriptedModel([[use("write_tool", { message: "m" })], [say("done")]]);
  const { r, out } = await run(m.client);
  const approval = ofType(r.traceFile, "approval")[0];
  const expected = forTerminal(shownText);
  check(!/[\r\x1b\u202e]/.test(out) && out.includes("Route to SALES\\rRoute to NOBODY\\x1b[2K \\u202eevil"), "the approval box shows control characters as visible escapes, never raw");
  check(approval?.shownSha256 === sha256(expected), "the approval trace records the SHA-256 of the exact text shown");
  check(written.length === 1 && written[0]?.text === expected && written[0]?.sha256 === sha256(expected), "the tool receives exactly the approved text and its hash");
  check(h.prompts.length === 1, "the human was asked once");
}
{
  const h = scriptHuman(["y"]);
  written = [];
  const m = scriptedModel([[use("write_tool", { message: "hi\x1b[2J" })], [say("done")]]);
  const { r } = await run(m.client);
  check(h.prompts.length === 0 && written.length === 0, "an external write whose input holds control characters is refused before a human is asked");
  check(ofType(r.traceFile, "input_invalid").length === 1, "and the refusal is traced");
}
for (const [label, bad] of [["a bidi override", "hi\u202e"], ["a C1 control", "hi\x85"], ["a zero-width space", "hi\u200b"], ["a byte order mark", "hi\ufeff"]] as const) {
  const h = scriptHuman(["y"]);
  written = [];
  const m = scriptedModel([[use("write_tool", { message: bad })], [say("done")]]);
  await run(m.client);
  check(h.prompts.length === 0 && written.length === 0, `an external write holding ${label} is refused before a human is asked`);
}
check(forTerminal("a\u2028b\u200bc\ufeffd\u2063e") === "a\\u2028b\\u200bc\\ufeffd\\u2063e", "line separators, zero-width characters, the BOM and invisible operators are shown as escapes");

// ---- A6: schema checks before anything runs -------------------------
check(validateInput(readTool.inputSchema, { id: "a" }).length === 0, "valid input passes");
for (const [input, why] of [
  [{}, "a missing required field"],
  [{ id: 5 }, "a wrong type"],
  [{ id: "a", kind: "c" }, "a value outside the enum"],
  [{ id: "a", extra: true }, "an extra field"],
  [{ id: "a", n: 1.5 }, "a non-integer"],
  [{ id: "a", short: "toolong" }, "a string over maxLength"],
  [{ id: "x".repeat(DEFAULT_MAX_STRING + 1) }, "a string over the default cap"],
  ["not an object", "input that is not an object"],
] as const) {
  check(validateInput(readTool.inputSchema, input).length > 0, `the validator refuses ${why}`);
}
{
  readRuns = 0;
  const h = scriptHuman(["y"]);
  written = [];
  const m = scriptedModel([[use("read_tool", { id: "a", kind: "zzz" })], [use("write_tool", { message: "m", extra: 1 })], [say("done")]]);
  const { r } = await run(m.client);
  const results = m.requests[1]?.messages.at(-1);
  check(readRuns === 0 && Array.isArray(results?.content) && (results.content[0] as { is_error?: boolean } | undefined)?.is_error === true, "invalid input never runs the tool, and the model gets an error");
  check(h.prompts.length === 0 && written.length === 0, "invalid input to an external write is refused before a human is asked");
  check(ofType(r.traceFile, "input_invalid").length === 2, "each invalid call is traced");
}

// ---- A8: stop reasons -----------------------------------------------
{
  readRuns = 0;
  const m = scriptedModel([
    { blocks: [say("calling"), use("read_tool", { id: "partial" })], stopReason: "max_tokens" },
    [use("read_tool", { id: "full" })],
    [say("done")],
  ]);
  const { r } = await run(m.client);
  check(readRuns === 1, "a tool call cut off by max_tokens is not run; the retried call is");
  check(m.requests[1]?.maxTokens === RETRY_MAX_TOKENS && m.requests[0]?.maxTokens === undefined, "the retry asks for a higher token limit, once");
  check(ofType(r.traceFile, "truncated_tool_call").length === 1 && r.outcome === "completed", "the cut-off call is traced and the run continues");
}
{
  readRuns = 0;
  const m = scriptedModel([
    { blocks: [use("read_tool", { id: "partial" })], stopReason: "model_context_window_exceeded" },
    [say("done")],
  ]);
  const { r } = await run(m.client);
  check(readRuns === 0 && ofType(r.traceFile, "truncated_tool_call").length === 1, "a tool call cut off by the context window limit is not run either");
}
{
  readRuns = 0;
  const cut = { blocks: [use("read_tool", { id: "p" })], stopReason: "max_tokens" };
  const m = scriptedModel([cut, cut]);
  const { r } = await run(m.client);
  check(readRuns === 0 && r.outcome === "error", "cut off twice: nothing runs and the run ends with an error");
}
{
  readRuns = 0;
  const m = scriptedModel([{ blocks: [use("read_tool", { id: "x" })], stopReason: "refusal" }]);
  const { r } = await run(m.client);
  check(readRuns === 0 && r.outcome === "error" && ofType(r.traceFile, "model_refusal").length === 1, "a refusal runs nothing, is traced and ends the run as an error");
}
{
  const m = scriptedModel([[], [use("stand_by")], [say("ok")]]);
  await run(m.client, { ...policy, requiredActions: ["stand_by"] });
  const empties = m.requests.flatMap((q) => q.messages).filter((msg) => msg.role === "assistant" && msg.content.length === 0);
  check(m.requests.length === 3 && empties.length === 0, "an empty reply is never sent back as an empty assistant turn");
}

// ---- Approval gate: default deny, and one "no" stands ---------------
{
  noHuman();
  written = [];
  shownText = "Post this";
  const m = scriptedModel([[use("write_tool", { message: "m" })], [say("done")]]);
  const { r } = await run(m.client);
  check(written.length === 0 && ofType(r.traceFile, "approval")[0]?.reason === "no_human_available", "with no terminal, an external write is denied by default");
}
{
  const h = scriptHuman(["n", "y"]);
  written = [];
  const m = scriptedModel([[use("write_tool", { message: "a" })], [use("write_tool", { message: "b" })], [say("done")]]);
  const { r } = await run(m.client);
  const approvals = ofType(r.traceFile, "approval");
  check(h.prompts.length === 1 && written.length === 0, "after a human says no, a second approval request in the same run is denied without asking");
  check(approvals[1]?.reason === "denied_after_earlier_no", "and that second denial is traced as denied_after_earlier_no");
}
{
  const h = scriptHuman(["y", "y"]);
  written = [];
  const m = scriptedModel([[use("write_tool", { message: "a" })], [use("write_tool", { message: "b" })], [say("done")]]);
  await run(m.client);
  check(h.prompts.length === 2 && written.length === 2, "a yes does not stop the next request from being asked (only a no carries over)");
}
noHuman();

// ---- Traces: an existing loose folder is tightened; lines are grep-safe
if (process.platform !== "win32") {
  const first = new Trace("agent-real");
  chmodSync(dirname(first.file), 0o755); // a folder made before the 0700 rule
  const again = new Trace("agent-real");
  check((statSync(dirname(again.file)).mode & 0o777) === 0o700, "an existing trace folder with loose permissions is tightened to 0700");
}
{
  const t = new Trace("agent-real");
  t.record("tool_result", { output: "ok\u202eevil\x85\u200b" });
  const raw = readFileSync(t.file, "utf8");
  check(!/[\u202e\x85\u200b]/.test(raw) && raw.includes("\\u202e"), "trace lines store bidi, C1 and invisible characters as escapes, so grep can't be spoofed");
  check(traceLines(t.file)[0]?.output === "ok\u202eevil\x85\u200b", "the escaped line is still valid JSON with the original value");
  check(jsonSafe('"a\u2066b"') === '"a\\u2066b"', "jsonSafe escapes bidi isolates");
}
{
  const emoji = "ab\u{1F600}";
  check(cutAt(emoji, 3) === "ab" && escapeSlack(emoji, 3) === "ab... (truncated)", "Slack truncation never splits an emoji in half");
}

// ---- The trace stamp always wins ------------------------------------
{
  const t = new Trace("agent-real", "req-1");
  t.record("tool_result", { agent: "agent-evil", runId: "r-evil", requestId: "q-evil", sessionId: "s-evil", step: 99, ts: "1999", type: "fake", output: 1 });
  const line = traceLines(t.file)[0]!;
  check(line.agent === "agent-real" && line.runId === t.runId && line.requestId === "req-1" && line.step === 1 && line.type === "tool_result" && line.ts !== "1999",
    "event data can never overwrite the agent, run, request, step, time or type");
  check(line.sessionId === null, "a run outside a session stamps sessionId null, so data can't supply one");
  const s = new Trace("agent-real", undefined, "sess-1");
  s.record("x", { sessionId: "s-evil" });
  check(traceLines(s.file)[0]?.sessionId === "sess-1", "a session run's sessionId can't be overwritten either");
  check(t.ref.startsWith("traces/") && !t.ref.includes(dirname(dirname(t.file))), "the shareable trace reference is relative (traces/<file>)");
  if (process.platform !== "win32") {
    check((statSync(t.file).mode & 0o777) === 0o600, "trace files are owner read/write only (0600)");
    check((statSync(dirname(t.file)).mode & 0o777) === 0o700, "the trace folder is owner only (0700)");
  }
}

// ---- A5: friction reports can't ping a channel or hide a link -------
{
  const friction = makeFrictionTool();
  const ctx = { policy, trace: new Trace("agent-test"), mock: false };
  const out = await capture(() => friction.run({
    category: "missing_data", task: "<!here> look", expected: "a & b", actual: "<https://evil.example|safe link>",
    wrong_approach: "<!channel>", evidence: "x".repeat(5000),
  }, ctx));
  const posted = out.split("Would post to #agent-feedback:\n")[1] ?? "";
  check(posted.length > 0 && !/<!|<https/.test(posted) && posted.includes("&lt;!here&gt;") && posted.includes("a &amp; b"),
    "every friction field is escaped for Slack (no <!here>, no disguised links)");
  check(!posted.includes("x".repeat(1600)) && posted.includes("(truncated)"), "a very long field is capped");
  check(/category must be one of/.test(await rejection(() => friction.run({ category: "vip", task: "t", expected: "e", actual: "a", evidence: "v" }, ctx))),
    "the friction tool checks its input at runtime, not by cast");
}

// ---- The real coordinator policy still finishes cleanly -------------
{
  const m = scriptedModel([[use("stand_by")], [say("ok")]], { canForceTool: true });
  let r: Awaited<ReturnType<typeof runAgent>> | undefined;
  await capture(async () => { r = await runAgent({ policy: scarletPolicy, tools: [standBy], model: m.client, system: "t", task: "hi", mock: true }); });
  check(r?.outcome === "completed" && r.warnings.length === 0, "a normal run completes with no warnings");
}

done();
