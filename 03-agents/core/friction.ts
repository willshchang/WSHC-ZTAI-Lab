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
//                  acting, hits its step limit, or errors). The alert
//                  must never depend on the model choosing to report.
//
// Risk tier: internal-write. It only posts to our own feedback
// channel, so it runs without approval, but it is always traced.
// Because no human checks it first, every field is written by the
// model or copied from data, and Slack would otherwise obey <!here>
// or a disguised link, each field is escaped and capped in code.
// ============================================================

import { escapeSlack, MOCK_TAG, postToSlack } from "./slack.ts";
import type { AgentPolicy, AgentTool } from "./types.ts";

export const FRICTION_CATEGORIES = ["missing_data", "conflicting_data", "tool_error", "unclear_instruction"];

// Longest each field may be. The tool schema uses the same numbers,
// so the model is refused before anything is posted; the report
// itself caps them again for the system-filed path.
const FIELD_MAX = { task: 500, expected: 500, actual: 1000, wrong_approach: 500, evidence: 1500 } as const;

export interface FrictionFields {
  category: string;
  task: string;
  expected: string;
  actual: string;
  wrong_approach?: string;
  evidence: string;
}

// Runtime check instead of a cast: the model's input is checked
// against the schema by the engine, and checked again here so this
// function can never be handed something it doesn't expect
export function toFrictionFields(input: Record<string, unknown>): FrictionFields {
  const text = (key: string, required: boolean): string | undefined => {
    const v = input[key];
    if (v === undefined || v === null) {
      if (required) throw new Error(`report_friction needs "${key}"`);
      return undefined;
    }
    if (typeof v !== "string") throw new Error(`report_friction "${key}" must be text`);
    return v;
  };
  const category = text("category", true)!;
  if (!FRICTION_CATEGORIES.includes(category)) {
    throw new Error(`report_friction category must be one of ${FRICTION_CATEGORIES.join(", ")}`);
  }
  return {
    category,
    task: text("task", true)!,
    expected: text("expected", true)!,
    actual: text("actual", true)!,
    wrong_approach: text("wrong_approach", false),
    evidence: text("evidence", true)!,
  };
}

export async function fileFrictionReport(
  fields: FrictionFields,
  policy: AgentPolicy,
  runId: string,
  filedBy: "agent" | "system",
  mock: boolean,
) {
  const f = (value: string, max: number) => escapeSlack(value, max);
  const text =
    (mock ? MOCK_TAG : "") +
    `:warning: *Agent friction report* (${f(fields.category, 40)})` +
    (filedBy === "system" ? " :rotating_light: *filed by the system*" : "") +
    `\n*Agent:* ${f(policy.name, 80)} (\`${f(policy.id, 80)}\`)\n` +
    `*Task:* ${f(fields.task, FIELD_MAX.task)}\n` +
    `*Expected:* ${f(fields.expected, FIELD_MAX.expected)}\n` +
    `*Actual:* ${f(fields.actual, FIELD_MAX.actual)}\n` +
    (fields.wrong_approach ? `*Wrong approach avoided:* ${f(fields.wrong_approach, FIELD_MAX.wrong_approach)}\n` : "") +
    `*Evidence:* ${f(fields.evidence, FIELD_MAX.evidence)}\n` +
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
          enum: FRICTION_CATEGORIES,
          description: "What kind of friction this is",
        },
        task: { type: "string", maxLength: FIELD_MAX.task, description: "What you were trying to do" },
        expected: { type: "string", maxLength: FIELD_MAX.expected, description: "What should have happened" },
        actual: { type: "string", maxLength: FIELD_MAX.actual, description: "What actually happened" },
        wrong_approach: {
          type: "string",
          maxLength: FIELD_MAX.wrong_approach,
          description: "The tempting shortcut you did NOT take (e.g. guessing a value)",
        },
        evidence: { type: "string", maxLength: FIELD_MAX.evidence, description: "Tool outputs or facts that show the problem" },
      },
      required: ["category", "task", "expected", "actual", "evidence"],
      additionalProperties: false,
    },
    risk: "internal-write",
    run: async (input, ctx) =>
      fileFrictionReport(toFrictionFields(input), ctx.policy, ctx.trace.runId, "agent", ctx.mock),
  };
}
