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
  readonly agentId: string;
  readonly file: string;
  private step = 0;

  constructor(agentId: string) {
    this.runId = randomUUID();
    this.agentId = agentId;
    mkdirSync(TRACE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = join(TRACE_DIR, `${stamp}_${agentId}_${this.runId.slice(0, 8)}.jsonl`);
  }

  // type examples: run_start, model_turn, tool_call, tool_result,
  // policy_denied, approval, run_end
  record(type: string, data: Record<string, unknown> = {}): void {
    this.step += 1;
    const line = {
      ts: new Date().toISOString(),
      runId: this.runId,
      agent: this.agentId, // identity on every line
      step: this.step,
      type,
      ...data,
    };
    appendFileSync(this.file, JSON.stringify(line) + "\n");
  }
}
