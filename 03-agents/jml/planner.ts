// ============================================================
// JML PLANNER AND EXECUTOR (plain code, no AI)
// ============================================================
// The planner turns one HR event into an exact list of changes.
// The executor applies that list, one step at a time.
//
// WHY plain code: the model never writes Graph calls or chooses
// groups. It reads the event, asks for the plan, and asks a human
// to approve it. Same pattern as the GTM score: code does the
// heavy lifting, the model makes the call.
//
// GUARDS (enforced here, not in the prompt):
//   - Protected accounts (break-glass, admin groups): refused
//   - Scope: only users JML created (members of JML-Managed).
//     Terraform-managed users are refused, so the agent never
//     fights the code that is the source of truth.
//   - Name clash: a joiner whose username already belongs to
//     someone JML doesn't manage is refused, never merged
//   - Unknown team: refused, never guessed
//   - Idempotent: a finished event plans to "nothing to change"
//   - Reversible: leavers are disabled, never deleted
// ============================================================

import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import type { GraphClient, TenantConfig } from "./graph.ts";

export interface HrEvent {
  id: string;
  type: "joiner" | "mover" | "leaver";
  username: string;
  displayName: string;
  team?: string;
  title?: string;
  effective?: string;
  notes?: string;
}

export function loadHrEvents(): HrEvent[] {
  const raw = JSON.parse(readFileSync(new URL("./hr-events.json", import.meta.url), "utf8"));
  return raw.events as HrEvent[];
}

export type Step =
  | { kind: "create_user"; upn: string; displayName: string }
  | { kind: "add_to_group"; group: string; groupId: string }
  | { kind: "remove_from_group"; group: string; groupId: string }
  | { kind: "disable_account" }
  | { kind: "revoke_sessions" };

export interface Plan {
  eventId: string;
  type: HrEvent["type"];
  target: { displayName: string; upn: string; objectId: string | null };
  steps: Step[];
}

export type PlanResult =
  | { ok: true; plan: Plan }
  | { ok: false; category: "missing_data" | "conflicting_data" | "unclear_instruction"; reason: string };

const refuse = (category: "missing_data" | "conflicting_data" | "unclear_instruction", reason: string): PlanResult => ({
  ok: false,
  category,
  reason,
});

export async function buildPlan(event: HrEvent, graph: GraphClient, cfg: TenantConfig): Promise<PlanResult> {
  if (!/^[a-z]+(\.[a-z]+)+$/.test(event.username ?? "")) {
    return refuse("missing_data", `Username "${event.username}" is not in firstname.lastname form`);
  }
  const upn = `${event.username}@${cfg.domain}`;
  const user = await graph.getUser(upn);
  const target = { displayName: user?.displayName ?? event.displayName, upn, objectId: user?.id ?? null };

  // Group lookups are done from the group side (least privilege)
  const memberOf = async (groupId: string) => (user ? (await graph.listMemberIds(groupId)).includes(user.id) : false);

  if (user) {
    for (const g of cfg.groups.protected) {
      if (await memberOf(g)) {
        return refuse("conflicting_data", `${upn} is a protected account (break-glass or admin). JML never changes it.`);
      }
    }
  }

  const teamGroups = Object.entries(cfg.groups.teams);
  const steps: Step[] = [];

  if (event.type === "joiner") {
    const groupId = event.team ? cfg.groups.teams[event.team] : undefined;
    if (!event.team || !groupId) {
      return refuse("missing_data", `Team "${event.team ?? "(none)"}" is not a known team. Known: ${Object.keys(cfg.groups.teams).join(", ")}`);
    }
    if (user && !(await memberOf(cfg.groups.managed))) {
      return refuse("conflicting_data", `${upn} already exists and is not managed by JML (a name clash or a Terraform-managed user). Refusing to merge.`);
    }
    if (!user) steps.push({ kind: "create_user", upn, displayName: event.displayName });
    if (!(await memberOf(cfg.groups.managed))) steps.push({ kind: "add_to_group", group: "JML-Managed", groupId: cfg.groups.managed });
    if (!(await memberOf(groupId))) steps.push({ kind: "add_to_group", group: event.team, groupId });
    return { ok: true, plan: { eventId: event.id, type: event.type, target, steps } };
  }

  // Movers and leavers must already exist and be in JML's scope
  if (!user) return refuse("missing_data", `${upn} was not found in the tenant.`);
  if (!(await memberOf(cfg.groups.managed))) {
    return refuse("conflicting_data", `${upn} is not managed by JML (Terraform or another process owns it). Refusing.`);
  }

  if (event.type === "mover") {
    const groupId = event.team ? cfg.groups.teams[event.team] : undefined;
    if (!event.team || !groupId) {
      return refuse("missing_data", `Team "${event.team ?? "(none)"}" is not a known team.`);
    }
    for (const [name, id] of teamGroups) {
      if (id !== groupId && (await memberOf(id))) steps.push({ kind: "remove_from_group", group: name, groupId: id });
    }
    if (!(await memberOf(groupId))) steps.push({ kind: "add_to_group", group: event.team, groupId });
    return { ok: true, plan: { eventId: event.id, type: event.type, target, steps } };
  }

  if (event.type === "leaver") {
    const alreadyTerminated = await memberOf(cfg.groups.terminated);
    if (user.accountEnabled) steps.push({ kind: "disable_account" });
    if (user.accountEnabled || !alreadyTerminated) steps.push({ kind: "revoke_sessions" });
    for (const [name, id] of teamGroups) {
      if (await memberOf(id)) steps.push({ kind: "remove_from_group", group: name, groupId: id });
    }
    if (!alreadyTerminated) steps.push({ kind: "add_to_group", group: "JML-Terminated", groupId: cfg.groups.terminated });
    return { ok: true, plan: { eventId: event.id, type: event.type, target, steps } };
  }

  return refuse("unclear_instruction", `Unknown event type "${(event as HrEvent).type}".`);
}

// ------------------------------------------------------------
// HUMAN-READABLE PLAN (shown in the approval box)
// Name, email AND object ID, because names clash in big orgs
// ------------------------------------------------------------
export function describePlan(plan: Plan): string {
  const header =
    (plan.type === "leaver" ? "⚠ HIGH RISK: LEAVER\n" : "") +
    `HR event:  ${plan.eventId} (${plan.type})\n` +
    `Name:      ${plan.target.displayName}\n` +
    `Email:     ${plan.target.upn}\n` +
    `Object ID: ${plan.target.objectId ?? "(new user, assigned on creation)"}\n\nChanges:`;
  const lines = plan.steps.map((s, i) => `  ${i + 1}. ${stepText(s)}`);
  return [header, ...lines].join("\n");
}

export function stepText(s: Step): string {
  switch (s.kind) {
    case "create_user": return `Create user ${s.upn} (temporary password, must change at first sign-in)`;
    case "add_to_group": return `Add to group ${s.group}`;
    case "remove_from_group": return `Remove from group ${s.group}`;
    case "disable_account": return "Disable the account (reversible, never deleted)";
    case "revoke_sessions": return "Revoke all active sign-in sessions";
  }
}

// ------------------------------------------------------------
// TEMPORARY PASSWORD: random, never printed, traced or returned
// ------------------------------------------------------------
function temporaryPassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%^&*-_=+"];
  const chars = sets.map((set) => set[randomInt(set.length)]);
  const all = sets.join("");
  for (let i = 0; i < 16; i++) chars.push(all[randomInt(all.length)]!);
  // Fisher-Yates shuffle with a cryptographic random source
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

// ------------------------------------------------------------
// EXECUTOR: applies steps in order and STOPS at the first error,
// reporting exactly what was done and what was not
// ------------------------------------------------------------
export interface ApplyResult {
  completed: string[];
  failed: { step: string; error: string } | null;
  notDone: string[];
  objectId: string | null;
}

export async function applyPlan(plan: Plan, graph: GraphClient): Promise<ApplyResult> {
  let userId = plan.target.objectId;
  const completed: string[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    try {
      switch (step.kind) {
        case "create_user":
          userId = (await graph.createUser({ displayName: step.displayName, upn: step.upn, password: temporaryPassword() })).id;
          break;
        case "add_to_group":
          await graph.addMember(step.groupId, userId!);
          break;
        case "remove_from_group":
          await graph.removeMember(step.groupId, userId!);
          break;
        case "disable_account":
          await graph.setAccountEnabled(userId!, false);
          break;
        case "revoke_sessions":
          await graph.revokeSessions(userId!);
          break;
      }
      completed.push(stepText(step));
    } catch (err) {
      return {
        completed,
        failed: { step: stepText(step), error: err instanceof Error ? err.message : String(err) },
        notDone: plan.steps.slice(i + 1).map(stepText),
        objectId: userId,
      };
    }
  }
  return { completed, failed: null, notDone: [], objectId: userId };
}
