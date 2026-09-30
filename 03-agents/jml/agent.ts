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
import { loadHrEvents } from "./planner.ts";
import { postStatus, type Outcome } from "./status.ts";
import { jmlTools } from "./tools.ts";

export type GraphMode = "mock" | "real";

// A scripted model OR the mock tenant makes this a test run, so its
// friction reports are tagged [MOCK]. The status card follows the
// tenant only: a real-tenant change is real, whoever drove it.
export const isTestRun = (mockModel: boolean, graph: GraphMode | undefined) => mockModel || graph !== "real";

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

  // The latest outcome per event, recorded by the tools as it happens
  const outcomes = new Map<string, Outcome>();
  const result = await runAgent({
    policy: jmlPolicy,
    tools: jmlTools(graph, cfg, (id, o) => outcomes.set(id, o)),
    model: opts.mock ? createJmlMock() : createClaudeClient(jmlPolicy),
    system: jmlSystemPrompt,
    task: opts.task,
    parent: opts.parent,
    mock: isTestRun(opts.mock, opts.graph),
  });

  // ----------------------------------------------------------
  // #jml-status: one card per event, written by CODE from the
  // final recorded outcome (never the model's summary)
  // ----------------------------------------------------------
  const events = loadHrEvents();
  for (const [id, outcome] of outcomes) {
    const event = events.find((e) => e.id === id);
    if (!event) continue;
    try {
      await postStatus(event, outcome, { mock: !real, runId: result.runId });
    } catch (err) {
      // A failed status post never hides the change itself; it's in the trace
      console.error(`❗ Could not post to #jml-status: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
