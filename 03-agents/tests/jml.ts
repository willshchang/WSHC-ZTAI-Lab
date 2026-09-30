// ============================================================
// TEST: JML planner, guards and executor (mock tenant, in memory)
// ============================================================
// Every guard must refuse what it guards, and every allowed path
// must still work, so a guard that blocks everything also fails.
// Exits non-zero on any failure.
// ============================================================

import { readFileSync } from "node:fs";
import { loadMockConfig, MockGraph } from "../jml/graph.ts";
import { applyPlan, buildPlan, loadHrEvents, type HrEvent } from "../jml/planner.ts";
import { jmlPolicy } from "../jml/policy.ts";
import { jmlTools } from "../jml/tools.ts";
import { Trace } from "../core/trace.ts";
import { formatStatus, type Outcome } from "../jml/status.ts";

const cfg = loadMockConfig();
const fixture = JSON.parse(readFileSync(new URL("../jml/mock-tenant.json", import.meta.url), "utf8"));
const fresh = () => new MockGraph({ persist: false, state: fixture });
const ev = (id: string) => loadHrEvents().find((e) => e.id === id)!;

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "OK" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};
const kinds = (r: Awaited<ReturnType<typeof buildPlan>>) => (r.ok ? r.plan.steps.map((s) => s.kind + ("group" in s ? `:${s.group}` : "")) : []);

// ---- Allowed paths still work ------------------------------------
const g = fresh();
const joiner = await buildPlan(ev("hr-1001"), g, cfg);
check(joiner.ok && kinds(joiner).join() === "create_user,add_to_group:JML-Managed,add_to_group:Frontend", "joiner plans create + managed + team");

// Spy on the real generated password, then prove that exact string
// never appears in the result the agent (and the trace) receives
let captured = "";
const original = g.createUser.bind(g);
g.createUser = async (u) => {
  captured = u.password;
  return original(u);
};
const applied = await applyPlan((joiner as { ok: true; plan: never }).plan, g);
check(applied.failed === null && applied.completed.length === 3, "joiner applies all 3 steps");
check(captured.length >= 16 && /[A-Z]/.test(captured) && /[a-z]/.test(captured) && /\d/.test(captured) && /[^A-Za-z0-9]/.test(captured),
  "temporary password is 16+ chars with upper, lower, digit and symbol");
check(captured !== "" && !JSON.stringify(applied).includes(captured), "the real password never appears in the apply result");

const mover = await buildPlan(ev("hr-1002"), g, cfg);
check(mover.ok && kinds(mover).join() === "remove_from_group:Frontend,add_to_group:Product", "mover removes old team, adds new team");
await applyPlan((mover as { ok: true; plan: never }).plan, g);

const leaver = await buildPlan(ev("hr-1003"), g, cfg);
check(
  leaver.ok && kinds(leaver).join() === "disable_account,revoke_sessions,remove_from_group:Product,add_to_group:JML-Terminated",
  "leaver disables, revokes, removes team, adds JML-Terminated",
);
await applyPlan((leaver as { ok: true; plan: never }).plan, g);
const user = await g.getUser("maya.chen@tinyco.example");
check(user !== null && user.accountEnabled === false, "leaver is disabled, not deleted");

const again = await buildPlan(ev("hr-1003"), g, cfg);
check(again.ok && again.plan.steps.length === 0, "rerunning a finished leaver plans nothing (idempotent)");

// ---- Guards refuse what they guard -------------------------------
const breakglass = await buildPlan(ev("hr-1004"), fresh(), cfg);
check(!breakglass.ok && /protected/.test(breakglass.reason), "break-glass account is refused (protected)");

const terraformUser = await buildPlan(ev("hr-1005"), fresh(), cfg);
check(!terraformUser.ok && /not managed by JML/.test(terraformUser.reason), "Terraform-managed user is refused (out of scope)");

const unknownTeam = await buildPlan(ev("hr-1006"), fresh(), cfg);
check(!unknownTeam.ok && /not a known team/.test(unknownTeam.reason), "unknown team is refused");

const clash: HrEvent = { id: "hr-9001", type: "joiner", username: "jamie.taylor", displayName: "Jamie Taylor", team: "Design" };
const clashPlan = await buildPlan(clash, fresh(), cfg);
check(!clashPlan.ok && /already exists and is not managed/.test(clashPlan.reason), "joiner name clash with an unmanaged user is refused");

const moverMissing = await buildPlan(ev("hr-1002"), fresh(), cfg);
check(!moverMissing.ok && /not found/.test(moverMissing.reason), "mover for a user who doesn't exist is refused");

const badName: HrEvent = { id: "hr-9002", type: "joiner", username: "Robert'); DROP", displayName: "x", team: "Design" };
check(!(await buildPlan(badName, fresh(), cfg)).ok, "malformed username is refused");

// ---- Executor stops at the first error and says what's left ------
const broken = fresh();
broken.failOn = "addMember";
const plan2 = await buildPlan(ev("hr-1001"), broken, cfg);
const partial = await applyPlan((plan2 as { ok: true; plan: never }).plan, broken);
check(
  partial.completed.length === 1 && partial.failed !== null && partial.notDone.length === 1,
  "executor stops at the first failure and reports completed / failed / not done",
);

// ---- A stale plan never runs --------------------------------------
// The human approves plan A. Before it runs, the tenant changes (here:
// someone else adds Maya to Legal). Apply must re-plan, see the
// difference, and refuse instead of running the approved-but-stale plan.
{
  const tg = fresh();
  const setup = await buildPlan(ev("hr-1001"), tg, cfg);
  await applyPlan((setup as { ok: true; plan: never }).plan, tg); // Maya exists, in Frontend
  const tools = jmlTools(tg, cfg);
  const planTool = tools.find((x) => x.name === "plan_hr_change")!;
  const applyTool = tools.find((x) => x.name === "apply_hr_change")!;
  const ctx = { policy: jmlPolicy, trace: new Trace("agent-jml"), mock: true };
  await planTool.run({ event_id: "hr-1003" }, ctx); // leaver plan approved by a human
  const maya = (await tg.getUser("maya.chen@tinyco.example"))!;
  await tg.addMember(cfg.groups.teams.Legal!, maya.id); // the tenant changes underneath
  let refused = false;
  try {
    await applyTool.run({ event_id: "hr-1003" }, ctx);
  } catch (err) {
    refused = /tenant changed/.test(String(err));
  }
  const still = (await tg.getUser("maya.chen@tinyco.example"))!;
  check(refused && still.accountEnabled, "a stale plan is refused and nothing is applied");

  let noPlan = false;
  try {
    await tools.find((x) => x.name === "apply_hr_change")!.run({ event_id: "hr-1002" }, ctx);
  } catch (err) {
    noPlan = /No plan was built/.test(String(err));
  }
  check(noPlan, "apply refuses an event that was never planned");
}

// ---- #jml-status cards tell the truth ---------------------------
{
  // Run a joiner through the real tools, recording outcomes like runJml does
  const sg = fresh();
  const outcomes = new Map<string, Outcome>();
  const tools = jmlTools(sg, cfg, (id, o) => outcomes.set(id, o));
  const ctx = { policy: jmlPolicy, trace: new Trace("agent-jml"), mock: true };
  let pw = "";
  const orig = sg.createUser.bind(sg);
  sg.createUser = async (u) => { pw = u.password; return orig(u); };
  await tools.find((x) => x.name === "plan_hr_change")!.run({ event_id: "hr-1001" }, ctx);
  check(outcomes.get("hr-1001")?.kind === "planned", "a planned but unapplied event is recorded as planned (card: not applied)");
  await tools.find((x) => x.name === "apply_hr_change")!.run({ event_id: "hr-1001" }, ctx);
  const applied = outcomes.get("hr-1001")!;
  check(applied.kind === "applied", "an applied event is recorded as applied");
  const card = formatStatus(ev("hr-1001"), applied, { mock: false, runId: "r1" });
  check(/Joiner complete/.test(card) && (card.match(/:white_check_mark:/g) ?? []).length === 3, "applied card lists exactly the 3 completed changes");
  check(pw.length > 0 && !card.includes(pw), "the card never contains the password");
  check(!card.includes("[MOCK]"), "a real-tenant card has no MOCK tag");
  check(formatStatus(ev("hr-1001"), applied, { mock: true, runId: "r1" }).includes("[MOCK]"), "a mock-tenant card is tagged MOCK");

  // A partial result: completed, failed and not-done steps are all shown honestly
  const plan = (applied as Extract<Outcome, { kind: "applied" }>).plan;
  const partial: Outcome = {
    kind: "applied",
    plan,
    result: { completed: ["Step A"], unchanged: [], failed: { step: "Step B", error: "403" }, notDone: ["Step C"], objectId: "x" },
  };
  const pc = formatStatus(ev("hr-1001"), partial, { mock: false, runId: "r2" });
  check(
    /only partly done/.test(pc) && (pc.match(/:white_check_mark:/g) ?? []).length === 1 && /:x: Step B \(403\)/.test(pc) && /Step C \(not done\)/.test(pc),
    "a partial card shows 1 done, the failure with its reason, and what was not done (never as done)",
  );

  const refusedCard = formatStatus(ev("hr-1004"), { kind: "refused", reason: "protected account" }, { mock: false, runId: "r3" });
  check(/refused/.test(refusedCard) && /protected account/.test(refusedCard) && /Nothing was changed/.test(refusedCard), "a refused card states the reason and that nothing changed");

  const staleCard = formatStatus(ev("hr-1003"), { kind: "stale", plan }, { mock: false, runId: "r4" });
  check(/not applied/.test(staleCard) && /changed after the plan was approved/.test(staleCard), "a stale plan card says it was not applied and why");

  // Already-done steps get their own section, never listed as a change
  const mixed: Outcome = {
    kind: "applied",
    plan,
    result: { completed: ["Remove from group Frontend"], unchanged: ["Already in group Product (no change needed)"], failed: null, notDone: [], objectId: "x" },
  };
  const mc = formatStatus(ev("hr-1002"), mixed, { mock: false, runId: "r5" });
  const changedPart = mc.split("*What changed:*")[1]!.split("*Already done")[0]!;
  check(
    (mc.match(/:white_check_mark:/g) ?? []).length === 1 &&
      /\*Already done \(no change needed\):\*\n:heavy_equals_sign: Already in group Product/.test(mc) &&
      !changedPart.includes("Product"),
    "an already-done step is shown in its own section, never under What changed",
  );
  const allSame: Outcome = { kind: "applied", plan, result: { completed: [], unchanged: ["Already in group Product (no change needed)"], failed: null, notDone: [], objectId: "x" } };
  check(/everything was already done/.test(formatStatus(ev("hr-1002"), allSame, { mock: false, runId: "r6" })), "a run where everything was already done says so instead of an empty list");
}

// ---- Already done is reported, never silent -----------------------
{
  // Entra lag: the plan says "add to Product", but by apply time she's already in it
  const lg = fresh();
  const j = await buildPlan(ev("hr-1001"), lg, cfg);
  await applyPlan((j as { ok: true; plan: never }).plan, lg);
  const move = await buildPlan(ev("hr-1002"), lg, cfg);
  const maya = await lg.getUser("maya.chen@tinyco.example");
  await lg.addMember(cfg.groups.teams["Product"]!, maya!.id); // someone (or Entra) got there first
  const r = await applyPlan((move as { ok: true; plan: never }).plan, lg);
  check(
    r.failed === null && r.completed.join() === "Remove from group Frontend" && r.unchanged.join() === "Already in group Product (no change needed)",
    "a step that was already true is reported as 'already done', not as a change and not silently",
  );
  const out = await lg.removeMember(cfg.groups.teams["Frontend"]!, maya!.id);
  check(out === "unchanged", "removing someone already removed reports no change");
}

process.exit(failures ? 1 : 0);
