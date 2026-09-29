// ============================================================
// SCARLET MOCK MODEL (no API calls)
// ============================================================
// A scripted stand-in for Claude that follows Scarlet's rules.
// Everything else (policy checks, the handoff, the GTM agent,
// approval, traces, Slack, ask_human) runs for real. Scenarios:
//   1. clear request with a signup id  -> hand off to GTM
//   2. identity request (offboarding)  -> simulated fooled model
//      tries an agent NOT in the policy; the runtime blocks it
//   3. signup request with no id       -> friction, then ask_human
//      (denied with no one at the keyboard; answered at a terminal)
//   4. request no agent handles        -> friction, no guessing
//   5. a greeting ("hello scarlet")    -> simulated model that just
//      chats and never acts; the no-silent-failure guard fires
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

const findSignup = (text: string) => signups.find((s) => text.includes(s.id));

export function createScarletMock(): ModelClient {
  return {
    label: "MOCK (scripted, no API)",
    next: async ({ messages }) => {
      const request = typeof messages[0]?.content === "string" ? messages[0].content : "";
      const done = history(messages);
      const last = (name: string) => [...done].reverse().find((d) => d.name === name);
      const failed = (d?: Done) => Boolean(d?.output.startsWith("Tool error"));
      const handoff = last("delegate");
      const reported = Boolean(last("report_friction"));
      const asked = last("ask_human");

      // Finished handoff: always quote the agent's own words
      if (handoff && !failed(handoff)) {
        const r = JSON.parse(handoff.output);
        return finish(`Handed to ${r.agent} (${r.outcome}). Its result, verbatim: "${r.result_text}"`);
      }

      // Scenario 5: a model that only chats and never acts
      if (/^\s*(hi|hello|hey)\b/i.test(request)) {
        return finish("[simulated chatty model] Hi Will! What would you like me to work on today?");
      }

      // Scenario 2: a fooled model reaches for an agent it was never given
      if (handoff && failed(handoff)) {
        if (!reported) {
          return toolUse(
            "report_friction",
            friction("unclear_instruction", request,
              "The request needs an identity (JML) agent, and none is in my policy", handoff.output),
            "That handoff was blocked by policy. Reporting instead of guessing.",
          );
        }
        return finish("I couldn't route this request safely, so I reported it to #agent-feedback.");
      }
      if (/\b(offboard|onboard|new hire|leaver|joiner|disable|jml)\b/i.test(request)) {
        return toolUse(
          "delegate",
          { agent: "agent-jml", task: request },
          "[simulated fooled model] This looks like an identity job, so I'll hand it to a JML agent.",
        );
      }

      // Scenario 1: clear request with a known signup id
      const signup = findSignup(request);
      if (signup) {
        return toolUse(
          "delegate",
          { agent: "agent-gtm-signal-router", task: `Route this new signup. signup_id: ${signup.id}` },
          `This is a signup routing request for ${signup.id}. Handing it to the GTM Signal Router.`,
        );
      }

      // Scenario 3: signup request with no id -> report, then ask Will
      if (/\b(signup|sign-up|lead|route)\b/i.test(request)) {
        if (!reported) {
          return toolUse(
            "report_friction",
            friction("missing_data", request, "The request is about a signup but names no signup_id",
              "No known signup id found in the request text"),
            "This belongs to the GTM agent, but there is no signup id. Recording the gap first.",
          );
        }
        if (!asked) {
          return toolUse("ask_human", { question: "Which signup should I route? (e.g. harbor-health)" },
            "Now asking Will which signup he means.");
        }
        if (failed(asked)) {
          return finish("No one was available to answer, so I stopped. The gap is reported in #agent-feedback.");
        }
        const answered = findSignup(JSON.parse(asked.output).answer ?? "");
        if (answered) {
          return toolUse(
            "delegate",
            { agent: "agent-gtm-signal-router", task: `Route this new signup. signup_id: ${answered.id}` },
            `Thanks. Handing ${answered.id} to the GTM Signal Router.`,
          );
        }
        return finish("That answer didn't name a known signup, so I stopped. The gap is reported in #agent-feedback.");
      }

      // Scenario 4: nothing on the map handles this
      if (!reported) {
        return toolUse(
          "report_friction",
          friction("unclear_instruction", request, "No agent in my policy handles this kind of request",
            "Allowed agents: agent-gtm-signal-router"),
          "No agent I can hand this to owns this job. Reporting instead of guessing.",
        );
      }
      return finish("I couldn't route this request safely, so I reported it to #agent-feedback instead of guessing.");
    },
  };
}
