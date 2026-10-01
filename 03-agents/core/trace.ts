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
import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TRACE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "traces");

// Traces can hold signup data and tenant details: owner-only access.
// The modes apply on POSIX systems; Windows ignores them.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export class Trace {
  readonly runId: string;
  readonly requestId: string; // shared by every agent working on one request
  readonly sessionId?: string; // shared by every request in one chat session
  readonly agentId: string;
  readonly file: string; // absolute path, for this machine only
  readonly ref: string; // "traces/<file>": relative to 03-agents, safe to record and share
  private step = 0;

  // requestId: pass the coordinator's request id when this run was
  // handed work by another agent; otherwise this run starts a new request
  constructor(agentId: string, requestId?: string, sessionId?: string) {
    this.runId = randomUUID();
    this.requestId = requestId ?? this.runId;
    this.sessionId = sessionId;
    this.agentId = agentId;
    mkdirSync(TRACE_DIR, { recursive: true, mode: DIR_MODE });
    try {
      chmodSync(TRACE_DIR, DIR_MODE); // tighten a folder made before this rule existed
    } catch {
      // Not ours to change (or not POSIX): the file mode below still applies
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${stamp}_${agentId}_${this.runId.slice(0, 8)}.jsonl`;
    this.file = join(TRACE_DIR, name);
    this.ref = `traces/${name}`;
  }

  // type examples: run_start, model_turn, tool_call, tool_result,
  // policy_denied, approval, delegation, run_error, run_end
  record(type: string, data: Record<string, unknown> = {}): void {
    this.step += 1;
    const stamp = {
      ts: new Date().toISOString(),
      // Always present (null outside a chat session), so event data can
      // never slip in a session id of its own
      sessionId: this.sessionId ?? null,
      requestId: this.requestId, // joins traces across agents
      runId: this.runId,
      agent: this.agentId, // identity on every line
      step: this.step,
      type,
    };
    // The stamp is applied first (for readable field order) AND last,
    // so event data can never overwrite who did it or when
    const line = { ...stamp, ...data, ...stamp };
    appendFileSync(this.file, JSON.stringify(line) + "\n", { mode: FILE_MODE });
  }
}
