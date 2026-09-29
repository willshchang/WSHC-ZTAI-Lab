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
  const ctx = { policy: jmlPolicy, trace: new Trace("agent-jml") };
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

process.exit(failures ? 1 : 0);
