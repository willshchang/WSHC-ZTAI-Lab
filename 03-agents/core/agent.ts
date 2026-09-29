// ============================================================
// AGENT LOOP (ReAct: reason, act, observe, repeat)
// ============================================================
// The engine every agent in the lab runs on. Each turn:
//   1. The model reasons and either answers or asks for a tool
//   2. The loop checks the request against the agent's policy
//   3. External writes pause for a human
//   4. The tool runs, the result goes back to the model
//   5. Every step is written to the trace
// ============================================================

import { requestApproval } from "./approval.ts";
import { Trace } from "./trace.ts";
import type {
  AgentPolicy,
  AgentTool,
  Message,
  ModelClient,
  ToolResultBlock,
} from "./types.ts";

export interface RunOptions {
  policy: AgentPolicy;
  tools: AgentTool[];
  model: ModelClient;
  system: string;
  task: string;
}

export interface RunResult {
  runId: string;
  traceFile: string;
  finalText: string;
  steps: number;
}

const log = (msg: string) => console.log(msg);

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

export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { policy, model, system, task } = opts;
  const trace = new Trace(policy.id);

  // ----------------------------------------------------------
  // LEAST PRIVILEGE, LAYER 1: the model only SEES allowed tools
  // ----------------------------------------------------------
  const offered = opts.tools.filter((t) => policy.allowedTools.includes(t.name));
  const byName = new Map(offered.map((t) => [t.name, t]));

  trace.record("run_start", {
    model: model.label,
    purpose: policy.purpose,
    toolsOffered: offered.map((t) => `${t.name} (${t.risk})`),
    task,
  });
  log(`\n▶ ${policy.name} [${policy.id}] | model: ${model.label} | run: ${trace.runId}`);
  log(`  Tools allowed: ${offered.map((t) => t.name).join(", ")}\n`);

  const messages: Message[] = [{ role: "user", content: task }];
  let finalText = "";

  for (let step = 1; step <= policy.maxSteps; step++) {
    const turn = await model.next({ system, messages, tools: offered });
    trace.record("model_turn", { stopReason: turn.stopReason, blocks: turn.blocks });
    messages.push({ role: "assistant", content: turn.blocks });

    for (const b of turn.blocks) {
      if (b.type === "text" && b.text.trim()) log(`💭 ${b.text.trim()}`);
    }

    const toolCalls = turn.blocks.filter((b) => b.type === "tool_use");
    if (toolCalls.length === 0) {
      finalText = turn.blocks
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("\n")
        .trim();
      trace.record("run_end", { outcome: "completed", steps: step });
      log(`\n✅ Done in ${step} step(s). Trace: ${trace.file}\n`);
      return { runId: trace.runId, traceFile: trace.file, finalText, steps: step };
    }

    const results: ToolResultBlock[] = [];
    for (const call of toolCalls) {
      if (call.type !== "tool_use") continue;
      results.push(await handleToolCall(call, byName, policy, trace));
    }
    messages.push({ role: "user", content: results });
  }

  // ----------------------------------------------------------
  // STEP LIMIT: a confused agent stops instead of looping forever
  // ----------------------------------------------------------
  trace.record("run_end", { outcome: "max_steps_reached", steps: policy.maxSteps });
  log(`\n⛔ Stopped: reached the ${policy.maxSteps}-step limit. Trace: ${trace.file}\n`);
  return { runId: trace.runId, traceFile: trace.file, finalText, steps: policy.maxSteps };
}

async function handleToolCall(
  call: { id: string; name: string; input: Record<string, unknown> },
  byName: Map<string, AgentTool>,
  policy: AgentPolicy,
  trace: Trace,
): Promise<ToolResultBlock> {
  const tool = byName.get(call.name);

  // ----------------------------------------------------------
  // LEAST PRIVILEGE, LAYER 2: refuse anything not granted,
  // even if the model asks for it anyway (defense in depth)
  // ----------------------------------------------------------
  if (!tool) {
    trace.record("policy_denied", { tool: call.name, input: call.input });
    log(`🚫 Denied: "${call.name}" is not in ${policy.id}'s policy`);
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: `Denied by policy: tool "${call.name}" is not allowed for this agent.`,
      is_error: true,
    };
  }

  log(`🔧 ${tool.name} (${tool.risk}) ${preview(call.input)}`);
  trace.record("tool_call", { tool: tool.name, risk: tool.risk, input: call.input });

  // ----------------------------------------------------------
  // HUMAN IN THE LOOP: external writes wait for a person
  // ----------------------------------------------------------
  if (tool.risk === "external-write") {
    const details = tool.describeForApproval
      ? tool.describeForApproval(call.input)
      : JSON.stringify(call.input, null, 2);
    const approval = await requestApproval(`${policy.name} wants to run ${tool.name}`, details);
    trace.record("approval", { tool: tool.name, ...approval });
    if (!approval.approved) {
      const why =
        approval.reason === "no_human_available"
          ? "no human reviewer was available, so it was denied by default"
          : "a human reviewer denied it";
      log(`🙅 Not approved: ${why}`);
      return {
        type: "tool_result",
        tool_use_id: call.id,
        content: `Denied by approval gate: ${why}. Do not retry; summarize and stop.`,
        is_error: true,
      };
    }
    log("👍 Human approved");
  }

  try {
    const output = await tool.run(call.input, { policy, trace });
    trace.record("tool_result", { tool: tool.name, output });
    return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(output) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace.record("tool_result", { tool: tool.name, error: message });
    log(`❗ ${tool.name} failed: ${message}`);
    return { type: "tool_result", tool_use_id: call.id, content: `Tool error: ${message}`, is_error: true };
  }
}
