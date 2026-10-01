// ============================================================
// CORE TYPES
// ============================================================
// Shared shapes every agent in the lab uses. Keeping them in one
// place means a new agent (JML, drift, cost watchdog) only has to
// supply its own tools and policy; the engine stays the same.
// ============================================================

import type { Trace } from "./trace.ts";

// ------------------------------------------------------------
// RISK TIERS
// ------------------------------------------------------------
// WHY: not every action deserves the same scrutiny. This is
// graduated autonomy in code:
//   read           = looks at data only, runs freely
//   internal-write = changes something only our own team sees
//                    (e.g. a feedback report), runs freely, traced
//   external-write = changes something real people act on
//                    (e.g. a routing post to the GTM channel),
//                    needs a human to approve first
// ------------------------------------------------------------
export type Risk = "read" | "internal-write" | "external-write";

// ------------------------------------------------------------
// AGENT POLICY (the agent's identity + permissions)
// ------------------------------------------------------------
// WHY: each agent gets its own identity and an explicit list of
// tools. The model is never even shown tools outside this list.
// Same idea as a Tailscale ACL: anything not granted is denied.
// ------------------------------------------------------------
export interface AgentPolicy {
  id: string;             // stable identity, stamped on every trace line
  name: string;           // human-friendly name
  purpose: string;        // one sentence: the single job this agent does
  allowedTools: string[]; // least privilege: the only tools it may call
  maxSteps: number;       // hard stop so a confused agent can't loop forever
  apiKeyEnv: string;      // the .env variable holding THIS agent's own API key
  canDelegateTo?: string[]; // coordinators only: agent ids it may hand work to
  // NO SILENT FAILURE: at least one of these tools must succeed before
  // the run may end. Otherwise: one reminder, then a system-filed alert.
  requiredActions?: string[];
  // ACT FIRST: until one of the requiredActions has succeeded, the model
  // must call a tool (no plain-text reply). Once it has acted, it may
  // finish normally. The no-silent-failure guard stays as the backstop.
  actFirst?: boolean;
}

// ------------------------------------------------------------
// PARENT LINK (coordinator -> agent handoffs)
// ------------------------------------------------------------
// WHY: when a coordinator hands work to another agent, both traces
// must be joinable. One requestId runs through the whole request;
// the child also records which run started it. Same parent/child
// idea as OpenTelemetry spans.
// ------------------------------------------------------------
export interface ParentRef {
  requestId: string; // shared by every trace in one request
  agentId: string;   // who handed the work over
  runId: string;     // the exact run that handed it over
  sessionId?: string; // set when the work came from a chat session
}

export interface ToolContext {
  policy: AgentPolicy;
  trace: Trace;
  mock: boolean; // a test run: anything posted to Slack gets tagged [MOCK]
  // Set by the engine for an external write a human approved: the exact
  // text shown in the approval box, and its SHA-256 (also in the trace).
  // A tool that posts text posts THESE bytes, never a rebuilt copy.
  approved?: { text: string; sha256: string };
}

// The schema features the engine enforces (see core/validate.ts)
export interface PropertySchema {
  type: "string" | "boolean" | "number" | "integer";
  enum?: string[];
  maxLength?: number; // strings without one get a default cap
  description?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, PropertySchema>;
    required?: string[];
    // Extra fields are always refused by the engine. Sent to the API
    // too, so the model is told the same rule it is held to.
    additionalProperties?: false;
  };
  risk: Risk;
  // The tool prints its own user-facing line (chat), so the loop skips
  // its 🔧 console line. The trace still records every call in full.
  printsOwnLine?: boolean;
  // External writes only: the exact text the human approves. It may
  // throw when the write isn't ready (no draft, no plan): the engine
  // then refuses the call without asking anyone.
  describeForApproval?: (input: Record<string, unknown>, ctx: ToolContext) => string;
  // Shown after the tool name in the approval title, e.g. the channel
  approvalLabel?: string;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

// ------------------------------------------------------------
// MODEL MESSAGES
// ------------------------------------------------------------
// A small, provider-neutral shape. The real Claude client and the
// mock client both speak it, so the agent loop can't tell them
// apart. That is what makes mock mode safe for recording demos.
// ------------------------------------------------------------
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type Message =
  | { role: "user"; content: string | ToolResultBlock[] }
  | { role: "assistant"; content: Block[] };

export interface ModelTurn {
  blocks: Block[];
  // "tool_use" when it wants a tool, "end_turn" when done, "max_tokens"
  // when it was cut off, "refusal" when it declined (see core/agent.ts)
  stopReason: string;
}

export interface ModelRequest {
  system: string;
  messages: Message[];
  tools: AgentTool[];
  mustUseTool?: boolean; // ask the model to call a tool this turn, if it can be forced
  maxTokens?: number; // raised once by the loop when a tool call was cut off
}

export interface ModelClient {
  label: string; // shown in logs, e.g. "claude-haiku-4-5" or "MOCK"
  // True only if this model accepts a forced tool call (tool_choice "any").
  // Unknown or unsupported models: false, and the loop relies on the guard.
  canForceTool?: boolean;
  next: (req: ModelRequest) => Promise<ModelTurn>;
}
