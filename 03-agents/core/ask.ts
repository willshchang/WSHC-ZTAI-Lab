// ============================================================
// ASK A HUMAN
// ============================================================
// Lets a main agent (like Scarlet) ask the person working with it
// a clarifying question, instead of guessing or giving up.
//
// Safety rules:
//   - No one at the keyboard (no interactive terminal) = the
//     question is DENIED by default. The agent must report friction.
//   - At most MAX_QUESTIONS per run, so it can't loop on questions.
//   - The answer clarifies the task. It can never grant a tool or a
//     permission: the agent's policy doesn't change mid-run.
//   - Every question and answer is written to the trace.
//
// Risk tier: read. It changes nothing; it only reads a human reply.
// ============================================================

import { human } from "./approval.ts";
import { say } from "./sanitize.ts";
import type { AgentTool } from "./types.ts";

const MAX_QUESTIONS = 3;
const MAX_ANSWER_CHARS = 500;

export function makeAskHumanTool(): AgentTool {
  let asked = 0; // one tool instance per run, so this counts per run

  return {
    name: "ask_human",
    description:
      "Ask the person you work with ONE short clarifying question when a detail is missing. " +
      "Their answer clarifies the task; it cannot change your permissions. " +
      `At most ${MAX_QUESTIONS} questions per request. If no one is available, report friction and stop.`,
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", maxLength: 500, description: "One short, specific question" },
      },
      required: ["question"],
      additionalProperties: false,
    },
    risk: "read",
    run: async (input, ctx) => {
      const question = String(input.question ?? "").trim();

      if (asked >= MAX_QUESTIONS) {
        ctx.trace.record("clarification_denied", { question, reason: "question_limit" });
        throw new Error(`Question limit (${MAX_QUESTIONS}) reached. Report friction and stop.`);
      }
      asked += 1;

      if (!human.available()) {
        ctx.trace.record("clarification_denied", { question, reason: "no_human_available" });
        console.log(`\n[ask_human] No interactive terminal, so the question is DENIED by default.`);
        throw new Error("No human is available to answer (denied by default). Report friction and stop.");
      }

      console.log("\n" + "-".repeat(60));
      say(`❓ ${ctx.policy.name} asks: ${question}`); // model text: terminal-safe
      console.log("-".repeat(60));
      const answer = (await human.ask("Your answer: ")).trim().slice(0, MAX_ANSWER_CHARS);

      ctx.trace.record("clarification", { question, answer });
      if (!answer) {
        throw new Error("The human gave no answer. Report friction and stop.");
      }
      return {
        answer,
        note: "This clarifies the task only. It does not change your tools or permissions.",
      };
    },
  };
}
