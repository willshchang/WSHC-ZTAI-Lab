// ============================================================
// FRICTION REPORTS (agent feedback)
// ============================================================
// Lets an agent say "I got stuck here" instead of guessing.
// WHY this shape: task / expected / actual / wrong approach /
// evidence turns every report into a ready-made eval case, the
// same pattern Expo uses to collect feedback from coding agents.
//
// Two ways a report gets filed:
//   by the agent   through the report_friction tool
//   by the system  when an agent fails silently (ends without
//                  acting, or hits its step limit). The alert must
//                  never depend on the model choosing to report.
//
// Risk tier: internal-write. It only posts to our own feedback
// channel, so it runs without approval, but it is always traced.
// ============================================================

import { postToSlack } from "./slack.ts";
import type { AgentPolicy, AgentTool } from "./types.ts";

export interface FrictionFields {
  category: string;
  task: string;
  expected: string;
  actual: string;
  wrong_approach?: string;
  evidence: string;
}

export async function fileFrictionReport(
  fields: FrictionFields,
  policy: AgentPolicy,
  runId: string,
  filedBy: "agent" | "system" = "agent",
) {
  const text =
    `:warning: *Agent friction report* (${fields.category})` +
    (filedBy === "system" ? " :rotating_light: *filed by the system*" : "") +
    `\n*Agent:* ${policy.name} (\`${policy.id}\`)\n` +
    `*Task:* ${fields.task}\n` +
    `*Expected:* ${fields.expected}\n` +
    `*Actual:* ${fields.actual}\n` +
    (fields.wrong_approach ? `*Wrong approach avoided:* ${fields.wrong_approach}\n` : "") +
    `*Evidence:* ${fields.evidence}\n` +
    `*Trace:* \`${runId}\``;

  const result = await postToSlack(process.env.SLACK_WEBHOOK_AGENT_FEEDBACK, "#agent-feedback", text);
  return { reported: true, filedBy, ...result };
}

export function makeFrictionTool(): AgentTool {
  return {
    name: "report_friction",
    description:
      "Report where you got stuck or where data was missing, unclear or contradictory, " +
      "INSTEAD of guessing. Use the eval shape: task, expected, actual, wrong_approach, evidence.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["missing_data", "conflicting_data", "tool_error", "unclear_instruction"],
          description: "What kind of friction this is",
        },
        task: { type: "string", description: "What you were trying to do" },
        expected: { type: "string", description: "What should have happened" },
        actual: { type: "string", description: "What actually happened" },
        wrong_approach: {
          type: "string",
          description: "The tempting shortcut you did NOT take (e.g. guessing a value)",
        },
        evidence: { type: "string", description: "Tool outputs or facts that show the problem" },
      },
      required: ["category", "task", "expected", "actual", "evidence"],
    },
    risk: "internal-write",
    run: async (input, ctx) =>
      fileFrictionReport(input as unknown as FrictionFields, ctx.policy, ctx.trace.runId, "agent"),
  };
}
