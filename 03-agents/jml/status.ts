// ============================================================
// JML STATUS CARDS (#jml-status)
// ============================================================
// One easy-to-read Slack card per HR event, for HR and IT: who,
// what changed, what didn't, and the trace to follow it back.
//
// WHY code writes the card, not the model: the card is built from
// the executor's actual result, so it can never claim a change that
// didn't happen. The model's summary is for the terminal only.
//
// Audiences:
//   #jml-status      HR and IT: the outcome for each person
//   #agent-feedback  builders: friction reports (why it got stuck)
//
// Risk tier: internal-write (our own channel). Runs without
// approval, always traced. Never contains a password.
//
// Names, teams, emails, refusal reasons and Graph error messages come
// from HR data or the tenant, so each is escaped for Slack (a display
// name of "<!channel>" must not ping anyone) and capped in length.
// ============================================================

import { userInfo } from "node:os";
import { escapeSlack, MOCK_TAG, postToSlack, type SlackResult } from "../core/slack.ts";
import type { ApplyResult, HrEvent, Plan } from "./planner.ts";

export type Outcome =
  | { kind: "planned"; plan: Plan }
  | { kind: "applied"; plan: Plan; result: ApplyResult }
  | { kind: "stale"; plan: Plan }
  | { kind: "refused"; reason: string }
  | { kind: "nothing"; plan: Plan };

const TYPE = {
  joiner: { icon: ":wave:", label: "Joiner" },
  mover: { icon: ":arrows_counterclockwise:", label: "Mover" },
  leaver: { icon: ":door:", label: "Leaver" },
} as const;

// Who approved at the terminal. This is the local OS account, not a
// verified identity; a Slack front door would record the verified
// Slack user instead (roadmap).
function approver(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

export function formatStatus(
  event: HrEvent,
  outcome: Outcome,
  ctx: { mock: boolean; runId: string },
): string {
  const t = TYPE[event.type];
  const e = (text: string, max = 200) => escapeSlack(text, max);
  const who = `*${e(event.displayName, 120)}*`;
  const mock = ctx.mock ? MOCK_TAG : "";
  const team = event.team ? `  |  *Team:* ${e(event.team, 80)}` : "";
  const when = event.effective ? `  |  *Effective:* ${e(event.effective, 40)}` : "";
  const footer = `\n*HR event:* ${e(event.id, 16)}  |  *Trace:* \`${ctx.runId}\``;

  const person = (plan: Plan) =>
    `*Email:* ${e(plan.target.upn, 200)}  |  *Object ID:* \`${e(plan.target.objectId ?? "new", 64)}\`${team}${when}`;

  switch (outcome.kind) {
    case "applied": {
      const r = outcome.result;
      const done = r.completed.map((s) => `:white_check_mark: ${e(s)}`).join("\n");
      // Steps already true in the tenant (a rerun, or Entra catching up):
      // shown in their own section, never as a change, never hidden
      const already = (r.unchanged ?? []).map((s) => `:heavy_equals_sign: ${e(s)}`).join("\n");
      const alreadySection = already ? `\n*Already done (no change needed):*\n${already}` : "";
      if (!r.failed) {
        return (
          `${mock}:large_green_circle: ${t.icon} *${t.label} complete:* ${who}\n` +
          `${person({ ...outcome.plan, target: { ...outcome.plan.target, objectId: r.objectId } })}\n` +
          `*What changed:*\n${done || "(nothing, everything was already done)"}${alreadySection}\n` +
          `*Approved by:* ${e(approver(), 64)} (terminal)${footer}`
        );
      }
      const failed = `:x: ${e(r.failed.step)} (${e(r.failed.error, 400)})`;
      const notDone = r.notDone.map((s) => `:double_vertical_bar: ${e(s)} (not done)`).join("\n");
      return (
        `${mock}:warning: ${t.icon} *${t.label} only partly done:* ${who}\n` +
        `${person(outcome.plan)}\n` +
        `*What changed:*\n${done || "(nothing)"}${alreadySection}\n${failed}${notDone ? `\n${notDone}` : ""}\n` +
        `*Needs a human to finish.* Approved by: ${e(approver(), 64)} (terminal)${footer}`
      );
    }
    case "refused":
      return (
        `${mock}:no_entry: ${t.icon} *${t.label} refused:* ${who}\n` +
        `*Why:* ${e(outcome.reason, 400)}\nNothing was changed.${footer}`
      );
    case "nothing":
      return (
        `${mock}:heavy_equals_sign: ${t.icon} *Already up to date:* ${who}\n` +
        `${person(outcome.plan)}\nNothing needed changing.${footer}`
      );
    case "planned":
    case "stale": {
      const why =
        outcome.kind === "stale"
          ? "The account changed after the plan was approved, so nothing ran. Process the event again."
          : "The plan was not approved, or the run stopped before applying it.";
      return (
        `${mock}:black_square_for_stop: ${t.icon} *${t.label} not applied:* ${who}\n` +
        `${person(outcome.plan)}\n*Why:* ${why}\nNothing was changed.${footer}`
      );
    }
  }
}

export async function postStatus(
  event: HrEvent,
  outcome: Outcome,
  ctx: { mock: boolean; runId: string },
): Promise<SlackResult> {
  return postToSlack(process.env.SLACK_WEBHOOK_JML_STATUS, "#jml-status", formatStatus(event, outcome, ctx));
}
