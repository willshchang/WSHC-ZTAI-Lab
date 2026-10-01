// ============================================================
// AGENT LOOP (ReAct: reason, act, observe, repeat)
// ============================================================
// The engine every agent in the lab runs on. Each turn:
//   1. The model reasons and either answers or asks for a tool
//   2. The loop checks the request against the agent's policy
//   3. The tool input is checked against the tool's schema
//   4. External writes pause for a human
//   5. The tool runs, the result goes back to the model
//   6. Every step is written to the trace, including errors: a run
//      that throws still ends with run_error, a system alert and
//      run_end, never a silent crash
// ============================================================

import { createHash } from "node:crypto";
import { requestApproval, type ApprovalResult } from "./approval.ts";
import { fileFrictionReport } from "./friction.ts";
import { forTerminal, hasControlChars, say } from "./sanitize.ts";
import { Trace } from "./trace.ts";
import type {
  AgentPolicy,
  AgentTool,
  Message,
  ModelClient,
  ModelTurn,
  ParentRef,
  ToolResultBlock,
  ToolContext,
} from "./types.ts";
import { validateInput } from "./validate.ts";

export type Outcome = "completed" | "no_action" | "max_steps_reached" | "error";

export interface RunOptions {
  policy: AgentPolicy;
  tools: AgentTool[];
  model: ModelClient;
  system: string;
  task: string;
  parent?: ParentRef; // set when a coordinator handed this work over
  // Required, so every caller has to decide: a test run (scripted model
  // or mock tenant) tags everything it posts to Slack as [MOCK]
  mock: boolean;
  // SESSION MEMORY (main agents only): earlier messages from the same
  // chat session, text only. Never passed on to other agents.
  history?: Message[];
  sessionId?: string;
  // Runs once after the loop, whatever the outcome (even an error), and
  // before run_end, so its own steps land in the same trace. Returns
  // warnings for the caller (e.g. a status card that failed to post).
  onEnd?: (trace: Trace, outcome: Outcome) => Promise<string[]>;
}

export interface RunResult {
  runId: string;
  requestId: string;
  traceFile: string; // absolute path on this machine
  traceRef: string; // "traces/<file>", safe to record in another trace
  finalText: string;
  steps: number;
  outcome: Outcome;
  warnings: string[]; // problems after the run (never hidden, never fatal to the run)
}

// Every engine line may carry model or data text: always terminal-safe
const log = say;

// ----------------------------------------------------------
// STOP REASONS
// https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
//   max_tokens: the reply was cut off. If the last block is a tool
//     call, its input may be incomplete: the docs say to retry with a
//     higher max_tokens. We never run a cut-off tool call.
//   model_context_window_exceeded: also cut off; treated the same.
//   refusal: the model declined. Nothing in that reply is run.
// ----------------------------------------------------------
const TRUNCATED = new Set(["max_tokens", "model_context_window_exceeded"]);
export const RETRY_MAX_TOKENS = 4096;

// ----------------------------------------------------------
// CONSOLE PREVIEW: long tool inputs (like a full Slack message)
// are shortened on screen so the log stays readable. The trace
// file and the approval prompt still show the FULL input.
// ----------------------------------------------------------
const PREVIEW_CHARS = 60;
function preview(input: Record<string, unknown>): string {
  const short = Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (typeof value !== "string") return [key, value];
      const oneLine = value.replace(/\s+/g, " ").trim();
      return [
        key,
        oneLine.length > PREVIEW_CHARS
          ? `${oneLine.slice(0, PREVIEW_CHARS)}... (${value.length} chars)`
          : oneLine,
      ];
    }),
  );
  return JSON.stringify(short);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// Per-run state the tool gate needs across calls
interface GateState {
  humanSaidNo: boolean; // after one "no", no more approval prompts this run
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { policy, model, system, task, parent, mock } = opts;
  const sessionId = opts.sessionId ?? parent?.sessionId;
  const trace = new Trace(policy.id, parent?.requestId, sessionId);

  // ----------------------------------------------------------
  // LEAST PRIVILEGE, LAYER 1: the model only SEES allowed tools
  // ----------------------------------------------------------
  const offered = opts.tools.filter((t) => policy.allowedTools.includes(t.name));
  const byName = new Map(offered.map((t) => [t.name, t]));

  const messages: Message[] = [...(opts.history ?? []), { role: "user", content: task }];
  let finalText = "";
  let step = 0;
  const succeeded = new Set<string>(); // tools that ran without error
  const gate: GateState = { humanSaidNo: false };
  const required = policy.requiredActions ?? [];
  const hasActed = () => required.length === 0 || required.some((name) => succeeded.has(name));

  // One model call, recorded. A refusal ends the run: nothing in it runs.
  const ask = async (mustUseTool: boolean, maxTokens?: number): Promise<ModelTurn> => {
    const turn = await model.next({ system, messages, tools: offered, mustUseTool, maxTokens });
    trace.record("model_turn", {
      stopReason: turn.stopReason,
      mustUseTool,
      ...(maxTokens ? { maxTokens } : {}),
      blocks: turn.blocks,
    });
    if (turn.stopReason === "refusal") {
      trace.record("model_refusal", { toolCallsDropped: turn.blocks.filter((b) => b.type === "tool_use").length });
      throw new Error("The model declined to respond (stop reason: refusal). Nothing it proposed was run.");
    }
    return turn;
  };

  const loop = async (): Promise<Outcome> => {
    trace.record("run_start", {
      model: model.label,
      purpose: policy.purpose,
      toolsOffered: offered.map((t) => `${t.name} (${t.risk})`),
      task,
      ...(parent ? { parentAgent: parent.agentId, parentRunId: parent.runId } : {}),
      rememberedMessages: opts.history?.length ?? 0,
    });
    log(`\n▶ ${policy.name} [${policy.id}] | model: ${model.label} | run: ${trace.runId}`);
    if (parent) log(`  Requested by ${parent.agentId} | request: ${trace.requestId}`);
    log(`  Tools allowed: ${offered.map((t) => t.name).join(", ")}`);
    if (policy.actFirst) {
      log(model.canForceTool
        ? `  Act first: must call a tool until it has acted`
        : `  Act first: this model can't force a tool call, so the guard alone enforces it`);
    }
    log("");

    let reminded = false;
    for (step = 1; step <= policy.maxSteps; step++) {
      // ACT FIRST: force a tool call until the agent has acted, then let
      // it finish with a normal summary (forcing every turn would loop)
      const mustUseTool = Boolean(policy.actFirst) && !hasActed();
      let turn = await ask(mustUseTool);

      // A tool call cut off by the token limit may have a partial input:
      // never run it. Retry once with a higher limit, then give up.
      const cutOffToolCall = (t: ModelTurn) => TRUNCATED.has(t.stopReason) && t.blocks.at(-1)?.type === "tool_use";
      if (cutOffToolCall(turn)) {
        trace.record("truncated_tool_call", { stopReason: turn.stopReason, retryMaxTokens: RETRY_MAX_TOKENS });
        log(`✂ The model's tool call was cut off by the token limit. Not running it; retrying once with ${RETRY_MAX_TOKENS}.`);
        turn = await ask(mustUseTool, RETRY_MAX_TOKENS);
        if (cutOffToolCall(turn)) {
          throw new Error(`The model's tool call was cut off twice (limit ${RETRY_MAX_TOKENS} tokens). Nothing was run.`);
        }
      }

      // An empty reply is never sent back as an empty assistant turn
      if (turn.blocks.length > 0) messages.push({ role: "assistant", content: turn.blocks });

      for (const b of turn.blocks) {
        if (b.type === "text" && b.text.trim()) log(`💭 ${b.text.trim()}`);
      }

      const toolCalls = turn.blocks.filter((b) => b.type === "tool_use");
      if (toolCalls.length === 0) {
        finalText = turn.blocks
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("\n")
          .trim();

        // ------------------------------------------------------
        // NO SILENT FAILURE: an agent with required actions may not
        // just talk and stop. One reminder, then the system alerts.
        // ------------------------------------------------------
        const acted = hasActed();
        if (!acted && !reminded) {
          reminded = true;
          const reminder =
            `You ended without acting. No one can reply to plain text here. ` +
            `Call one of: ${required.join(", ")}. If something is missing, report friction.`;
          trace.record("reminder", { reason: "ended_without_required_action", required });
          log(`⚠ ${policy.name} ended without acting. Reminding once.`);
          messages.push({ role: "user", content: reminder });
          continue;
        }
        return acted ? "completed" : "no_action";
      }

      const results: ToolResultBlock[] = [];
      for (const call of toolCalls) {
        if (call.type !== "tool_use") continue;
        const r = await handleToolCall(call, byName, { policy, trace, mock }, gate);
        if (!r.is_error) succeeded.add(call.name);
        results.push(r);
      }
      messages.push({ role: "user", content: results });
    }
    step = policy.maxSteps;
    return "max_steps_reached";
  };

  // ----------------------------------------------------------
  // ANY ERROR IS RECORDED: an API failure, a refusal, a cut-off tool
  // call or a crashed tool helper ends the run with run_error, a
  // system alert and run_end, instead of an unrecorded crash
  // ----------------------------------------------------------
  let outcome: Outcome;
  let failure = "";
  try {
    outcome = await loop();
  } catch (err) {
    outcome = "error";
    failure = errorText(err);
    trace.record("run_error", { error: failure, atStep: step });
    log(`\n❗ ${policy.name} stopped on an error: ${failure}`);
  }

  // ----------------------------------------------------------
  // STEP LIMIT, NO ACTION OR ERROR: the stop is reported, never silent
  // ----------------------------------------------------------
  if (outcome !== "completed") {
    const actual =
      outcome === "no_action" ? `Ended twice without calling any of: ${required.join(", ")}`
      : outcome === "max_steps_reached" ? `Reached the ${policy.maxSteps}-step limit before finishing`
      : `Stopped on an error: ${failure}`;
    await raiseSilentFailure(policy, trace, mock, task, outcome, actual, finalText);
  }

  const warnings: string[] = [];
  if (opts.onEnd) {
    try {
      warnings.push(...(await opts.onEnd(trace, outcome)));
    } catch (err) {
      trace.record("on_end_error", { error: errorText(err) });
      warnings.push(errorText(err));
    }
  }

  trace.record("run_end", { outcome, steps: step });
  if (outcome === "completed") log(`\n✅ ${policy.name} done in ${step} step(s). Trace: ${trace.ref}\n`);
  else log(`⛔ ${policy.name} ended with outcome "${outcome}". Trace: ${trace.ref}\n`);

  return {
    runId: trace.runId,
    requestId: trace.requestId,
    traceFile: trace.file,
    traceRef: trace.ref,
    finalText,
    steps: step,
    outcome,
    warnings,
  };
}

// ----------------------------------------------------------
// SYSTEM ALERT: filed by the engine, not the model, so the alert
// never depends on the model choosing to report its own failure.
// If Slack itself is down, the alert is still written to the trace
// (alertDelivered: false) and the run still ends normally.
// ----------------------------------------------------------
async function raiseSilentFailure(
  policy: AgentPolicy,
  trace: Trace,
  mock: boolean,
  task: string,
  outcome: Exclude<Outcome, "completed">,
  actual: string,
  lastText: string,
): Promise<void> {
  log(`\n⚠ ${policy.name}: ${actual}. Filing a system alert.`);
  let delivery: Record<string, unknown>;
  try {
    const report = await fileFrictionReport(
      {
        category: "tool_error",
        task,
        expected: "The agent finishes by acting (a handoff, a report or a completed job)",
        actual,
        evidence: lastText ? `Last message: "${lastText.slice(0, 300)}"` : "No final message",
      },
      policy,
      trace.runId,
      "system",
      mock,
    );
    delivery = { alertDelivered: true, ...report };
  } catch (err) {
    delivery = { alertDelivered: false, deliveryError: errorText(err) };
    log(`❗ The system alert could not be posted (${errorText(err)}). It is in the trace.`);
  }
  trace.record("system_alert", { outcome, actual, ...delivery });
}

async function handleToolCall(
  call: { id: string; name: string; input: Record<string, unknown> },
  byName: Map<string, AgentTool>,
  ctx: ToolContext,
  gate: GateState,
): Promise<ToolResultBlock> {
  const { policy, trace } = ctx;
  const tool = byName.get(call.name);
  const refuse = (content: string): ToolResultBlock => ({ type: "tool_result", tool_use_id: call.id, content, is_error: true });

  // ----------------------------------------------------------
  // LEAST PRIVILEGE, LAYER 2: refuse anything not granted,
  // even if the model asks for it anyway (defense in depth)
  // ----------------------------------------------------------
  if (!tool) {
    trace.record("policy_denied", { tool: call.name, input: call.input });
    log(`🚫 Denied: "${call.name}" is not in ${policy.id}'s policy`);
    return refuse(`Denied by policy: tool "${call.name}" is not allowed for this agent.`);
  }

  if (!tool.printsOwnLine) log(`🔧 ${tool.name} (${tool.risk}) ${preview(call.input)}`);
  trace.record("tool_call", { tool: tool.name, risk: tool.risk, input: call.input });

  // ----------------------------------------------------------
  // SCHEMA CHECK: before anything runs or a human is asked
  // ----------------------------------------------------------
  const problems = validateInput(tool.inputSchema, call.input);
  if (problems.length > 0) {
    trace.record("input_invalid", { tool: tool.name, errors: problems });
    log(`🚫 Denied: invalid input for "${tool.name}": ${problems.join("; ")}`);
    return refuse(`Invalid input for ${tool.name}: ${problems.join("; ")}. Fix the input; do not guess values.`);
  }

  let runCtx: ToolContext = ctx;

  // ----------------------------------------------------------
  // HUMAN IN THE LOOP: external writes wait for a person
  // ----------------------------------------------------------
  if (tool.risk === "external-write") {
    // Hidden characters in an external write have no honest use:
    // refused before a human is shown anything
    const hidden = Object.entries(call.input)
      .filter(([, v]) => typeof v === "string" && hasControlChars(v))
      .map(([k]) => k);
    if (hidden.length > 0) {
      trace.record("input_invalid", { tool: tool.name, errors: [`control characters in: ${hidden.join(", ")}`] });
      log(`🚫 Denied: "${tool.name}" input holds control characters (${hidden.join(", ")})`);
      return refuse(`Invalid input for ${tool.name}: control characters are not allowed in ${hidden.join(", ")}.`);
    }

    // What the human sees is exactly what gets approved. A tool that
    // isn't ready (no draft, no plan) says so here and nobody is asked.
    let details: string;
    try {
      details = tool.describeForApproval ? tool.describeForApproval(call.input, ctx) : JSON.stringify(call.input, null, 2);
    } catch (err) {
      trace.record("approval_skipped", { tool: tool.name, reason: errorText(err) });
      log(`🙅 Not sent for approval: ${errorText(err)}`);
      return refuse(`Not ready for approval: ${errorText(err)}`);
    }
    const shown = forTerminal(details);
    const shownSha256 = sha256(shown);

    let approval: ApprovalResult;
    if (gate.humanSaidNo) {
      // One "no" stands for the rest of the run: no second prompt that a
      // tired human might wave through
      approval = { approved: false, reason: "denied_after_earlier_no" };
    } else {
      const title = `${policy.name} wants to run ${tool.name}${tool.approvalLabel ? ` (${tool.approvalLabel})` : ""}`;
      approval = await requestApproval(forTerminal(title), shown);
      if (approval.reason === "denied_by_human") gate.humanSaidNo = true;
    }
    trace.record("approval", { tool: tool.name, ...approval, shownSha256 });
    if (!approval.approved) {
      const why =
        approval.reason === "no_human_available" ? "no human reviewer was available, so it was denied by default"
        : approval.reason === "denied_after_earlier_no" ? "a human reviewer already said no in this run, so it was denied without asking again"
        : "a human reviewer denied it";
      log(`🙅 Not approved: ${why}`);
      return refuse(`Denied by approval gate: ${why}. Do not retry; summarize and stop.`);
    }
    log("👍 Human approved");
    runCtx = { ...ctx, approved: { text: shown, sha256: shownSha256 } };
  }

  try {
    const output = await tool.run(call.input, runCtx);
    trace.record("tool_result", { tool: tool.name, output });
    return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(output) };
  } catch (err) {
    const message = errorText(err);
    trace.record("tool_result", { tool: tool.name, error: message });
    log(`❗ ${tool.name} failed: ${message}`);
    return refuse(`Tool error: ${message}`);
  }
}
