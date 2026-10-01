// ============================================================
// JML MOCK MODEL (no API calls)
// ============================================================
// A scripted stand-in for Claude that follows the JML steps.
// Everything else (planner, guards, approval, Graph layer, traces,
// Slack) runs for real. Pair it with the mock tenant (default) to
// run the whole agent with nothing touching Entra.
// ============================================================

import type { Block, Message, ModelClient, ModelTurn } from "../core/types.ts";

type Done = { name: string; output: string };

function history(messages: Message[]): Done[] {
  const calls = new Map<string, string>();
  const done: Done[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      for (const b of m.content) if (b.type === "tool_use") calls.set(b.id, b.name);
    } else if (Array.isArray(m.content)) {
      for (const r of m.content) {
        const name = calls.get(r.tool_use_id);
        if (name) done.push({ name, output: r.content });
      }
    }
  }
  return done;
}

let counter = 0;
const toolUse = (name: string, input: Record<string, unknown>, thought: string): ModelTurn => ({
  blocks: [
    { type: "text", text: thought },
    { type: "tool_use", id: `mock_j${++counter}`, name, input },
  ] as Block[],
  stopReason: "tool_use",
});
const finish = (text: string): ModelTurn => ({ blocks: [{ type: "text", text }], stopReason: "end_turn" });

export function createJmlMock(): ModelClient {
  return {
    label: "MOCK (scripted, no API)",
    next: async ({ messages }) => {
      const task = typeof messages[0]?.content === "string" ? messages[0].content : "";
      const eventId = /event_id:\s*(hr-\d{4})/.exec(task)?.[1] ?? "";
      const done = history(messages);
      const last = (n: string) => [...done].reverse().find((d) => d.name === n);

      const applied = last("apply_hr_change");
      if (applied) {
        if (/^(Tool error|Invalid input|Not ready|Denied)/.test(applied.output)) {
          return finish(`Nothing was applied for ${eventId}: ${applied.output.replace(/^Tool error: /, "")}`);
        }
        const r = JSON.parse(applied.output);
        return finish(
          `${eventId}: completed ${r.completed.length} step(s)` +
            (r.unchanged?.length ? `, ${r.unchanged.length} already done (no change needed)` : "") +
            (r.failed ? `, failed at "${r.failed.step}" (${r.failed.error}), not done: ${r.notDone.length}` : "") +
            ".",
        );
      }
      if (last("report_friction")) return finish(`${eventId} was refused and reported. Nothing was changed.`);

      if (!last("get_hr_event")) return toolUse("get_hr_event", { event_id: eventId }, "Reading the HR event.");

      const plan = last("plan_hr_change");
      if (!plan) return toolUse("plan_hr_change", { event_id: eventId }, "Asking the planner for the exact changes.");

      const p = JSON.parse(plan.output);
      if (p.refused) {
        return toolUse(
          "report_friction",
          {
            category: p.category,
            task: `Process HR event ${eventId}`,
            expected: "A plan the rules allow",
            actual: p.reason,
            wrong_approach: "Working around the refusal or changing the account another way",
            evidence: `plan_hr_change refused: ${p.reason}`,
          },
          "The plan was refused. Reporting it instead of working around it.",
        );
      }
      if (p.nothing_to_change) return finish(`${eventId}: nothing to change, the tenant already matches.`);
      return toolUse("apply_hr_change", { event_id: eventId }, "Plan is ready. Asking a human to approve it.");
    },
  };
}
