// ============================================================
// SCARLET MOCK MODEL (no API calls)
// ============================================================
// A scripted stand-in for Claude that follows Scarlet's rules.
// Everything else (policy checks, the handoff, the GTM agent,
// approval, traces, Slack) runs for real. Four scenarios:
//   1. clear request with a signup id  -> hand off to GTM
//   2. identity request (offboarding)  -> simulated fooled model
//      tries an agent NOT in the policy; the runtime blocks it
//   3. signup request with no id       -> friction, no guessing
//   4. request no agent handles        -> friction, no guessing
// ============================================================

import type { Block, Message, ModelClient, ModelTurn } from "../core/types.ts";
import { signups } from "../gtm-signal-router/scoring.ts";

type Done = { name: string; input: Record<string, unknown>; output: string };

function history(messages: Message[]): Done[] {
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const done: Done[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      for (const b of m.content) if (b.type === "tool_use") calls.set(b.id, { name: b.name, input: b.input });
    } else if (Array.isArray(m.content)) {
      for (const r of m.content) {
        const call = calls.get(r.tool_use_id);
        if (call) done.push({ ...call, output: r.content });
      }
    }
  }
  return done;
}

let counter = 0;
const toolUse = (name: string, input: Record<string, unknown>, thought: string): ModelTurn => ({
  blocks: [
    { type: "text", text: thought },
    { type: "tool_use", id: `mock_s${++counter}`, name, input },
  ] as Block[],
  stopReason: "tool_use",
});
const finish = (text: string): ModelTurn => ({ blocks: [{ type: "text", text }], stopReason: "end_turn" });

const friction = (category: string, request: string, actual: string, evidence: string) => ({
  category,
  task: `Route this request to the right agent: "${request}"`,
  expected: "A request that matches one allowed agent, with every detail its task format needs",
  actual,
  wrong_approach: "Guessing the missing detail, or doing the work without an agent that owns it",
  evidence,
});

export function createScarletMock(): ModelClient {
  return {
    label: "MOCK (scripted, no API)",
    next: async ({ messages }) => {
      const request = typeof messages[0]?.content === "string" ? messages[0].content : "";
      const done = history(messages);
      const handoff = done.find((d) => d.name === "delegate");
      const reported = done.some((d) => d.name === "report_friction");

      // Finished paths: always quote the agent's own words
      if (handoff && !handoff.output.startsWith("Tool error")) {
        const r = JSON.parse(handoff.output);
        return finish(`Handed to ${r.agent} (${r.outcome}). Its result, verbatim: "${r.result_text}"`);
      }
      if (reported) {
        return finish("I couldn't route this request safely, so I reported it to #agent-feedback instead of guessing.");
      }

      // Scenario 2: a fooled model reaches for an agent it was never given
      if (handoff && handoff.output.startsWith("Tool error")) {
        return toolUse(
          "report_friction",
          friction(
            "unclear_instruction",
            request,
            "The request needs an identity (JML) agent, and none is in my policy",
            handoff.output,
          ),
          "That handoff was blocked by policy. Reporting instead of guessing.",
        );
      }
      if (/\b(offboard|onboard|new hire|leaver|joiner|disable|jml)\b/i.test(request)) {
        return toolUse(
          "delegate",
          { agent: "agent-jml", task: request },
          "[simulated fooled model] This looks like an identity job, so I'll hand it to a JML agent.",
        );
      }

      // Scenario 1: clear request with a known signup id
      const signup = signups.find((s) => request.includes(s.id));
      if (signup) {
        return toolUse(
          "delegate",
          { agent: "agent-gtm-signal-router", task: `Route this new signup. signup_id: ${signup.id}` },
          `This is a signup routing request for ${signup.id}. Handing it to the GTM Signal Router.`,
        );
      }

      // Scenario 3: signup request, but no id to route
      if (/\b(signup|sign-up|lead|route)\b/i.test(request)) {
        return toolUse(
          "report_friction",
          friction(
            "missing_data",
            request,
            "The request is about a signup but names no signup_id",
            "No known signup id found in the request text",
          ),
          "This belongs to the GTM agent, but there is no signup id. Reporting instead of guessing.",
        );
      }

      // Scenario 4: nothing on the map handles this
      return toolUse(
        "report_friction",
        friction(
          "unclear_instruction",
          request,
          "No agent in my policy handles this kind of request",
          "Allowed agents: agent-gtm-signal-router",
        ),
        "No agent I can hand this to owns this job. Reporting instead of guessing.",
      );
    },
  };
}
