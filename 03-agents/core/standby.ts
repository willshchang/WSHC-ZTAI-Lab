// ============================================================
// STAND BY
// ============================================================
// Lets a main agent say, on the record, "there is nothing to do".
// WHY a tool and not silence: standing by is a DECISION, so it is
// traced with a reason, and it satisfies the no-silent-failure
// guard. It posts nothing to Slack, so greetings create no noise.
// Only for "no task". Using it to dodge a real task would show up
// in the trace, with the reason she gave.
//
// Risk tier: read. It changes nothing.
// ============================================================

import type { AgentTool } from "./types.ts";

export function makeStandByTool(): AgentTool {
  return {
    name: "stand_by",
    description:
      "Use ONLY when there is no task to do (for example Will just said hi, or answered that he " +
      "needs nothing). Give a short reason. Never use it to skip a real request.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why there is nothing to do, in a few words" },
      },
      required: ["reason"],
    },
    risk: "read",
    run: async (input, ctx) => {
      const reason = String(input.reason ?? "").trim() || "no task";
      ctx.trace.record("stand_by", { reason });
      console.log(`💤 ${ctx.policy.name} is standing by: ${reason}`);
      return { standing_by: true, reason };
    },
  };
}
