// ============================================================
// SCARLET MOCK MODEL (no API calls)
// ============================================================
// A scripted stand-in for Claude that follows Scarlet's rules.
// Everything else (policy checks, the handoff, the GTM agent,
// approval, traces, Slack, ask_human) runs for real. Scenarios:
//   1. clear request with a signup id  -> hand off to GTM
//   2. payroll request ("run payroll")  -> simulated fooled model
//      tries an agent NOT in the policy; the runtime blocks it
//   3. signup request with no id       -> friction, then ask_human
//      (denied with no one at the keyboard; answered at a terminal)
//   4. request no agent handles        -> friction, no guessing
//   5. a greeting ("hello scarlet")    -> ask Will what he needs;
//      no task (or no one there) -> stand_by on the record
//   6. "simulate a chatty model"       -> a model that only talks;
//      the no-silent-failure guard must fire
//   7. "route it" in a session         -> uses session memory to find
//      the signup, still hands off the exact contract task
//   8. a question ("what can you do about pixel-pine?") -> offer
//      first; act only on a yes; no one there -> stand_by
//   9. a command naming an HR event ("process hr-1001") -> JML Agent
//  10. an identity request with no event id ("offboard maya") ->
//      friction, then ask which HR event
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
const findHrEvent = (text: string) => /\bhr-\d{4}\b/i.exec(text)?.[0]?.toLowerCase();
const jmlTask = (id: string) => `Process HR event. event_id: ${id}`;

export function createScarletMock(): ModelClient {
  return {
    label: "MOCK (scripted, no API)",
    next: async ({ messages }) => {
      // The current request is the latest plain-text message from Will
      // (earlier ones are session memory; the reminder is from the engine)
      const said = messages
        .filter((m) => m.role === "user" && typeof m.content === "string")
        .map((m) => m.content as string)
        .filter((c) => !c.startsWith("You ended without acting"));
      const request = said.at(-1) ?? "";
      const earlier = said.slice(0, -1).join(" ");
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

      // Standing by is always a clean finish
      if (last("stand_by")) return finish("Standing by. Just say the word when you need me.");

      // Scenario 6: a model that only chats and never acts
      if (/simulate a chatty model/i.test(request)) {
        return finish("[simulated chatty model] Hi Will! What would you like me to work on today?");
      }

      // Scenario 5: a greeting with no task -> ask, then act on the answer
      if (/^\s*(hi|hello|hey)\b/i.test(request)) {
        if (!asked) {
          return toolUse("ask_human", { question: "Hi Will! What can I help with?" }, "No task yet, so I'll ask.");
        }
        const answer = failed(asked) ? "" : String(JSON.parse(asked.output).answer ?? "");
        const answered = findSignup(answer);
        if (answered) {
          return toolUse(
            "delegate",
            { agent: "agent-gtm-signal-router", task: `Route this new signup. signup_id: ${answered.id}` },
            `On it. Handing ${answered.id} to the GTM Signal Router.`,
          );
        }
        return toolUse(
          "stand_by",
          { reason: failed(asked) ? "No task, and no one is at the keyboard" : "Will has no task right now" },
          "Nothing to do right now.",
        );
      }

      // Scenario 8: a QUESTION about a signup -> offer first, act only on a yes
      const isQuestion = /\?\s*$|^\s*(what|how|can you|could you|should)\b/i.test(request);
      const hrAsked = findHrEvent(request);
      if (isQuestion && hrAsked) {
        if (!asked) {
          return toolUse(
            "ask_human",
            { question: `I can hand ${hrAsked} to the JML Agent. It plans the identity changes and waits for your approval before touching the tenant. Want me to?` },
            "That's a question, so I'll offer before acting.",
          );
        }
        const answer = failed(asked) ? "" : String(JSON.parse(asked.output).answer ?? "");
        if (/\b(yes|yep|sure|go|do it|please)\b/i.test(answer)) {
          return toolUse("delegate", { agent: "agent-jml", task: jmlTask(hrAsked) }, `On it. Handing ${hrAsked} to the JML Agent.`);
        }
        return toolUse("stand_by",
          { reason: failed(asked) ? "Question not confirmed: no one at the keyboard" : "Will declined the offer" },
          "Okay, I won't start anything.");
      }
      const mentioned = findSignup(request);
      if (isQuestion && mentioned) {
        if (!asked) {
          return toolUse(
            "ask_human",
            {
              question:
                `I can route ${mentioned.id} through the GTM Signal Router. It scores the signup and ` +
                `posts the route to #gtm-routing once you approve. Want me to?`,
            },
            "That's a question, so I'll offer before acting.",
          );
        }
        const answer = failed(asked) ? "" : String(JSON.parse(asked.output).answer ?? "");
        if (/\b(yes|yep|sure|go|do it|route it|please)\b/i.test(answer)) {
          return toolUse(
            "delegate",
            { agent: "agent-gtm-signal-router", task: `Route this new signup. signup_id: ${mentioned.id}` },
            `On it. Handing ${mentioned.id} to the GTM Signal Router.`,
          );
        }
        return toolUse(
          "stand_by",
          { reason: failed(asked) ? "Question not confirmed: no one at the keyboard" : "Will declined the offer" },
          "Okay, I won't start anything.",
        );
      }

      // Scenario 7: "route it" -> session memory resolves which signup
      const remembered = /\b(it|that one|same one)\b/i.test(request) ? findSignup(earlier) : undefined;
      if (remembered && !findSignup(request)) {
        return toolUse(
          "delegate",
          { agent: "agent-gtm-signal-router", task: `Route this new signup. signup_id: ${remembered.id}` },
          `From earlier in our chat, "it" is ${remembered.id}. Handing it to the GTM Signal Router.`,
        );
      }

      // Scenario 2: a fooled model reaches for an agent it was never given
      if (handoff && failed(handoff)) {
        if (!reported) {
          return toolUse(
            "report_friction",
            friction("unclear_instruction", request,
              "The request needs a payroll agent, and none is in my policy", handoff.output),
            "That handoff was blocked by policy. Reporting instead of guessing.",
          );
        }
        return finish("I couldn't route this request safely, so I reported it to #agent-feedback.");
      }
      if (/\bpayroll\b/i.test(request)) {
        return toolUse(
          "delegate",
          { agent: "agent-payroll", task: request },
          "[simulated fooled model] This looks like a payroll job, so I'll hand it to a payroll agent.",
        );
      }

      // Scenario 9: a command naming an HR event -> the JML Agent
      const hrEvent = findHrEvent(request);
      if (hrEvent) {
        return toolUse("delegate", { agent: "agent-jml", task: jmlTask(hrEvent) },
          `This is HR event ${hrEvent}. Handing it to the JML Agent.`);
      }

      // Scenario 10: an identity request with no event id -> report, then ask
      if (/\b(offboard|onboard|new hire|leaver|joiner|disable)\b/i.test(request)) {
        if (!reported) {
          return toolUse("report_friction",
            friction("missing_data", request, "An identity request with no HR event id", "No hr-#### id in the request"),
            "This belongs to the JML Agent, but there is no HR event id. Recording the gap first.");
        }
        if (!asked) {
          return toolUse("ask_human", { question: "Which HR event is this? (e.g. hr-1003)" }, "Asking Will for the event id.");
        }
        const answered = failed(asked) ? undefined : findHrEvent(String(JSON.parse(asked.output).answer ?? ""));
        if (answered) {
          return toolUse("delegate", { agent: "agent-jml", task: jmlTask(answered) }, `Thanks. Handing ${answered} to the JML Agent.`);
        }
        return finish("I don't have an HR event id, so I stopped. The gap is reported in #agent-feedback.");
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
            "Allowed agents: agent-gtm-signal-router, agent-jml"),
          "No agent I can hand this to owns this job. Reporting instead of guessing.",
        );
      }
      return finish("I couldn't route this request safely, so I reported it to #agent-feedback instead of guessing.");
    },
  };
}
