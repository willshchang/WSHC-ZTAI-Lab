// ============================================================
// AGENT REGISTRY
// ============================================================
// The map Scarlet routes with: which agents exist, what each one
// handles, and the exact task format each one expects.
// WHY a registry: Scarlet can only hand work to agents listed
// here AND allowed in her policy. She cannot invent an agent,
// and she never holds the agents' tools herself.
// ============================================================

import type { RunResult } from "../core/agent.ts";
import type { ParentRef } from "../core/types.ts";
import { runGtm } from "../gtm-signal-router/agent.ts";
import { gtmPolicy } from "../gtm-signal-router/policy.ts";

export interface RegisteredAgent {
  id: string;
  name: string;
  handles: string;    // what kind of request belongs to this agent
  taskFormat: string; // the exact task string it expects
  run: (task: string, opts: { mock: boolean; parent: ParentRef }) => Promise<RunResult>;
}

export const registry: RegisteredAgent[] = [
  {
    id: gtmPolicy.id,
    name: gtmPolicy.name,
    handles: gtmPolicy.purpose,
    taskFormat: "Route this new signup. signup_id: <signup_id>",
    run: (task, opts) => runGtm({ task, mock: opts.mock, parent: opts.parent }),
  },
  // Next: the JML agent (joiner, mover, leaver on the identity layer)
];
