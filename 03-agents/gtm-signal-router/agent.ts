// ============================================================
// GTM SIGNAL ROUTER: RUN FUNCTION
// ============================================================
// One place that knows how to start this agent, used both by its
// own command line (index.ts) and by the Scarlet coordinator.
// WHY: whoever starts it, the agent always runs with ITS OWN
// policy, tools, key and approval gate. A caller can hand it a
// task string, never extra permissions.
// ============================================================

import { runAgent, type RunResult } from "../core/agent.ts";
import { createClaudeClient } from "../core/model.ts";
import type { ParentRef } from "../core/types.ts";
import { createMockClient } from "./mock.ts";
import { gtmPolicy, gtmSystemPrompt } from "./policy.ts";
import { gtmTools } from "./tools.ts";

export async function runGtm(opts: {
  task: string;
  mock: boolean;
  parent?: ParentRef;
}): Promise<RunResult> {
  const model = opts.mock ? createMockClient() : createClaudeClient(gtmPolicy);
  return runAgent({
    policy: gtmPolicy,
    tools: gtmTools,
    model,
    system: gtmSystemPrompt,
    task: opts.task,
    parent: opts.parent,
  });
}
