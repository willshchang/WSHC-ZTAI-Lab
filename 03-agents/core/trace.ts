// ============================================================
// TRACE
// ============================================================
// Writes every step of a run to its own file, one JSON object per
// line (JSONL). WHY: "what did the agent see, decide and do, and
// under which identity?" must always have an answer. This is the
// visibility layer; the roadmap upgrades it to OpenTelemetry spans
// for live, end-to-end observability.
// ============================================================

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TRACE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "traces");

export class Trace {
  readonly runId: string;
  readonly requestId: string; // shared by every agent working on one request
  readonly sessionId?: string; // shared by every request in one chat session
  readonly agentId: string;
  readonly file: string;
  private step = 0;

  // requestId: pass the coordinator's request id when this run was
  // handed work by another agent; otherwise this run starts a new request
  constructor(agentId: string, requestId?: string, sessionId?: string) {
    this.runId = randomUUID();
    this.requestId = requestId ?? this.runId;
    this.sessionId = sessionId;
    this.agentId = agentId;
    mkdirSync(TRACE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = join(TRACE_DIR, `${stamp}_${agentId}_${this.runId.slice(0, 8)}.jsonl`);
  }

  // type examples: run_start, model_turn, tool_call, tool_result,
  // policy_denied, approval, delegation, run_end
  record(type: string, data: Record<string, unknown> = {}): void {
    this.step += 1;
    const stamp = {
      ts: new Date().toISOString(),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}), // joins a whole chat session
      requestId: this.requestId, // joins traces across agents
      runId: this.runId,
      agent: this.agentId, // identity on every line
      step: this.step,
      type,
    };
    // The stamp is applied first (for readable field order) AND last,
    // so event data can never overwrite who did it or when
    const line = { ...stamp, ...data, ...stamp };
    appendFileSync(this.file, JSON.stringify(line) + "\n");
  }
}
