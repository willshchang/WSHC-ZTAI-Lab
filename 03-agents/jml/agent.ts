// ============================================================
// JML AGENT: RUN FUNCTION
// ============================================================
// Used by its own command line (index.ts) and by Scarlet.
// Whoever starts it, the agent runs with ITS OWN policy, tools,
// key and approval gate, against the MOCK tenant unless the
// caller explicitly asks for the real one. The task must match
// the contract, and the event id in it is the only event the run
// may touch.
// ============================================================

import { runAgent, type RunResult } from "../core/agent.ts";
import { createClaudeClient } from "../core/model.ts";
import type { ModelClient, ParentRef } from "../core/types.ts";
import { loadMockConfig, loadRealConfig, MockGraph, RealGraph, type GraphClient } from "./graph.ts";
import { createJmlMock } from "./mock.ts";
import { JML_TASK, jmlPolicy, jmlSystemPrompt } from "./policy.ts";
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
  // Tests only: a scripted model and an in-memory tenant
  deps?: { model?: ModelClient; graph?: GraphClient };
}): Promise<RunResult> {
  const eventId = JML_TASK.exec(opts.task)?.[1];
  if (!eventId) {
    throw new Error(`Refusing to run ${jmlPolicy.id}: the task does not match its contract ("Process HR event. event_id: <event_id>").`);
  }
  const real = opts.graph === "real";
  // Fails closed: the real tenant needs its config file AND its credentials
  const cfg = real ? loadRealConfig() : loadMockConfig();
  const graph = opts.deps?.graph ?? (real ? new RealGraph() : new MockGraph());
  console.log(`\n🏢 JML tenant: ${graph.label}`);

  // The latest outcome per event, recorded by the tools as it happens
  const outcomes = new Map<string, Outcome>();
  return runAgent({
    policy: jmlPolicy,
    tools: jmlTools(graph, cfg, { eventId }, (id, o) => outcomes.set(id, o)),
    model: opts.deps?.model ?? (opts.mock ? createJmlMock() : createClaudeClient(jmlPolicy)),
    system: jmlSystemPrompt,
    task: opts.task,
    parent: opts.parent,
    mock: isTestRun(opts.mock, opts.graph),
    // --------------------------------------------------------
    // #jml-status: one card per event, written by CODE from the
    // final recorded outcome (never the model's summary). It runs
    // whatever the outcome, even when the model call after apply
    // failed, so a tenant change is always reported. A card that
    // fails to post is traced and makes the run exit non-zero.
    // --------------------------------------------------------
    onEnd: async (trace) => {
      const warnings: string[] = [];
      const events = loadHrEvents();
      for (const [id, outcome] of outcomes) {
        const event = events.find((e) => e.id === id);
        if (!event) continue;
        try {
          const posted = await postStatus(event, outcome, { mock: !real, runId: trace.runId });
          trace.record("status_card", { eventId: id, outcome: outcome.kind, ...posted });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          trace.record("status_post_failed", { eventId: id, outcome: outcome.kind, error: message });
          console.error(`❗ Could not post to #jml-status: ${message}`);
          warnings.push(`#jml-status card for ${id} was not posted: ${message}`);
        }
      }
      return warnings;
    },
  });
}
