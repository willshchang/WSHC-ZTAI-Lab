// ============================================================
// JML AGENT: RUN FUNCTION
// ============================================================
// Used by its own command line (index.ts) and by Scarlet.
// Whoever starts it, the agent runs with ITS OWN policy, tools,
// key and approval gate, against the MOCK tenant unless the
// caller explicitly asks for the real one.
// ============================================================

import { runAgent, type RunResult } from "../core/agent.ts";
import { createClaudeClient } from "../core/model.ts";
import type { ParentRef } from "../core/types.ts";
import { loadMockConfig, loadRealConfig, MockGraph, RealGraph } from "./graph.ts";
import { createJmlMock } from "./mock.ts";
import { jmlPolicy, jmlSystemPrompt } from "./policy.ts";
import { jmlTools } from "./tools.ts";

export type GraphMode = "mock" | "real";

export async function runJml(opts: {
  task: string;
  mock: boolean;
  graph?: GraphMode;
  parent?: ParentRef;
}): Promise<RunResult> {
  const real = opts.graph === "real";
  // Fails closed: the real tenant needs its config file AND its credentials
  const cfg = real ? loadRealConfig() : loadMockConfig();
  const graph = real ? new RealGraph() : new MockGraph();
  console.log(`\n🏢 JML tenant: ${graph.label}`);

  return runAgent({
    policy: jmlPolicy,
    tools: jmlTools(graph, cfg),
    model: opts.mock ? createJmlMock() : createClaudeClient(jmlPolicy),
    system: jmlSystemPrompt,
    task: opts.task,
    parent: opts.parent,
  });
}
