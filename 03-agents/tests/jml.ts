// ============================================================
// TEST: JML planner, guards and executor (mock tenant, in memory)
// ============================================================
// Every guard must refuse what it guards, and every allowed path
// must still work, so a guard that blocks everything also fails.
// Exits non-zero on any failure.
// ============================================================

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJml } from "../jml/agent.ts";
import { loadMockConfig, loadRealConfig, MockGraph } from "../jml/graph.ts";
import { applyPlan, buildPlan, loadHrEvents, parseHrEvents, type HrEvent } from "../jml/planner.ts";
import { jmlPolicy } from "../jml/policy.ts";
import { jmlTools } from "../jml/tools.ts";
import { Trace } from "../core/trace.ts";
import { formatStatus, type Outcome } from "../jml/status.ts";
import { capture, noHuman, ofType, rejection, say, scriptHuman, scriptedModel, traceLines, use } from "./helpers.ts";

delete process.env.SLACK_WEBHOOK_AGENT_FEEDBACK;
delete process.env.SLACK_WEBHOOK_JML_STATUS;
noHuman();

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
  const tools = jmlTools(tg, cfg, { eventId: "hr-1003" });
  const planTool = tools.find((x) => x.name === "plan_hr_change")!;
  const applyTool = tools.find((x) => x.name === "apply_hr_change")!;
  const ctx = { policy: jmlPolicy, trace: new Trace("agent-jml"), mock: true };
  await planTool.run({ event_id: "hr-1003" }, ctx); // leaver plan approved by a human
  const maya = (await tg.getUser("maya.chen@tinyco.example"))!;
  await tg.addMember(cfg.groups.teams.Legal!, maya.id); // the tenant changes underneath
  const stale = await rejection(() => applyTool.run({ event_id: "hr-1003" }, ctx));
  const still = (await tg.getUser("maya.chen@tinyco.example"))!;
  check(/tenant changed/.test(stale) && still.accountEnabled, "a stale plan is refused and nothing is applied");

  const unplanned = jmlTools(tg, cfg, { eventId: "hr-1002" }).find((x) => x.name === "apply_hr_change")!;
  check(/No plan was built/.test(await rejection(() => unplanned.run({ event_id: "hr-1002" }, ctx))), "apply refuses an event that was never planned");
  check(/No plan was built/.test(await rejection(async () => unplanned.describeForApproval!({ event_id: "hr-1002" }, ctx))),
    "with no plan, there is nothing to show a human (the engine then asks no one)");
}

// ---- A changed TARGET is stale too, not only changed steps ---------
{
  const tg = fresh();
  const setup = await buildPlan(ev("hr-1001"), tg, cfg);
  await applyPlan((setup as { ok: true; plan: never }).plan, tg);
  const tools = jmlTools(tg, cfg, { eventId: "hr-1003" });
  const ctx = { policy: jmlPolicy, trace: new Trace("agent-jml"), mock: true };
  await tools.find((x) => x.name === "plan_hr_change")!.run({ event_id: "hr-1003" }, ctx);
  // Same steps, different person behind the name: the display name changes
  const state = (tg as unknown as { s: { users: { upn: string; displayName: string }[] } }).s;
  state.users.find((u) => u.upn === "maya.chen@tinyco.example")!.displayName = "Maya Chen (renamed)";
  const err = await rejection(() => tools.find((x) => x.name === "apply_hr_change")!.run({ event_id: "hr-1003" }, ctx));
  const user = (await tg.getUser("maya.chen@tinyco.example"))!;
  check(/tenant changed/.test(err) && user.accountEnabled, "a plan whose target changed (same steps) is refused as stale");
}

// ---- A refusal withdraws an earlier good plan -----------------------
{
  const tg = fresh();
  const setup = await buildPlan(ev("hr-1001"), tg, cfg);
  await applyPlan((setup as { ok: true; plan: never }).plan, tg); // Maya, JML-managed
  const tools = jmlTools(tg, cfg, { eventId: "hr-1003" });
  const ctx = { policy: jmlPolicy, trace: new Trace("agent-jml"), mock: true };
  await tools.find((x) => x.name === "plan_hr_change")!.run({ event_id: "hr-1003" }, ctx); // ok plan
  const maya = (await tg.getUser("maya.chen@tinyco.example"))!;
  await tg.addMember("mock-grp-breakglass", maya.id); // now protected
  const second = (await tools.find((x) => x.name === "plan_hr_change")!.run({ event_id: "hr-1003" }, ctx)) as { refused?: boolean };
  const err = await rejection(async () => tools.find((x) => x.name === "apply_hr_change")!.describeForApproval!({ event_id: "hr-1003" }, ctx));
  check(second.refused === true && /No plan was built/.test(err), "after a refusal, the earlier ok plan can no longer be approved or applied");
}

// ---- ID binding: a run touches only the event in its task ----------
{
  const tg = fresh();
  const tools = jmlTools(tg, cfg, { eventId: "hr-1001" });
  const trace = new Trace("agent-jml");
  const ctx = { policy: jmlPolicy, trace, mock: true };
  for (const name of ["get_hr_event", "plan_hr_change", "apply_hr_change"]) {
    const err = await rejection(() => tools.find((x) => x.name === name)!.run({ event_id: "hr-1009" }, ctx));
    check(/may only process HR event "hr-1001"/.test(err), `${name} refuses an event other than the one in its task`);
  }
  const denials = readFileSync(trace.file, "utf8").split("\n").filter((l) => l.includes('"policy_denied"') && l.includes('"id_binding"'));
  check(denials.length === 3, "each refused id is traced as policy_denied (id_binding)");
  check(!!(await tools.find((x) => x.name === "get_hr_event")!.run({ event_id: "hr-1001" }, ctx)), "the event in its task is still allowed");
}
check(/does not match its contract/.test(await rejection(() => runJml({ task: "Process HR event. event_id: hr-1001. And hr-1009", mock: true }))),
  "runJml refuses a task that doesn't match the contract, so the bound id is always the contract's");

// ---- Protected accounts: nested members are protected too ----------
{
  const nested = structuredClone(fixture);
  // An admin whose break-glass membership comes through a nested group
  nested.users.push({ id: "mock-user-nested", upn: "nested.admin@tinyco.example", displayName: "Nested Admin", accountEnabled: true });
  nested.memberships["mock-grp-breakglass"].push("mock-grp-breakglass-ops");
  nested.memberships["mock-grp-breakglass-ops"] = ["mock-user-nested"];
  nested.memberships["mock-grp-jml-managed"] = ["mock-user-nested"];
  const g2 = new MockGraph({ persist: false, state: nested });
  const leaver: HrEvent = { id: "hr-9003", type: "leaver", username: "nested.admin", displayName: "Nested Admin" };
  const p = await buildPlan(leaver, g2, cfg);
  check(!p.ok && /protected/.test(p.reason), "an account protected through a NESTED group is refused");
  check((await g2.listMemberIds("mock-grp-breakglass")).includes("mock-user-nested") === false, "(the nested admin is not a direct member: only the transitive check catches it)");
  // A cycle of nested groups must not hang the check
  nested.memberships["mock-grp-breakglass-ops"].push("mock-grp-breakglass");
  const g3 = new MockGraph({ persist: false, state: nested });
  check((await g3.listTransitiveMemberIds("mock-grp-breakglass")).includes("mock-user-nested"), "nested groups that loop are walked once, without hanging");
}

// ---- Config and feed are checked at runtime, never just cast -------
{
  const dir = mkdtempSync(join(tmpdir(), "jml-"));
  const file = join(dir, "tenant.local.json");
  const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const good = { domain: "tinyco.example", groups: { teams: { Design: guid(1) }, managed: guid(2), terminated: guid(3), protected: [guid(4)] } };
  const loads = (cfgObj: unknown) => { writeFileSync(file, JSON.stringify(cfgObj)); return rejection(async () => loadRealConfig(file)); };
  check((await loads(good)) === "", "a complete real config with GUID group ids loads");
  check(/protected is empty/.test(await loads({ ...good, groups: { ...good.groups, protected: [] } })), "an empty protected list is refused (it would protect no one)");
  check(/protected\[0\] is not a valid group ID/.test(await loads({ ...good, groups: { ...good.groups, protected: ["breakglass"] } })), "a protected entry that isn't a GUID is refused");
  check(/protected is empty/.test(await loads({ ...good, groups: { ...good.groups, protected: undefined } })), "a missing protected list is refused");
  check(/managed is not a valid group ID/.test(await loads({ ...good, groups: { ...good.groups, managed: "" } })), "a missing managed group is refused");
  writeFileSync(file, "{ not json");
  check(/not valid JSON/.test(await rejection(async () => loadRealConfig(file))), "a config that isn't JSON is refused");
}
check(/is not like hr-1001/.test(await rejection(async () => parseHrEvents({ events: [{ id: "hr-1", type: "leaver", username: "a.b", displayName: "A" }] }))),
  "an HR event with a malformed id is refused at load");
check(/type must be one of/.test(await rejection(async () => parseHrEvents({ events: [{ id: "hr-1234", type: "fired", username: "a.b", displayName: "A" }] }))),
  "an HR event with an unknown type is refused at load");
check(/displayName must be text/.test(await rejection(async () => parseHrEvents({ events: [{ id: "hr-1234", type: "leaver", username: "a.b", displayName: 7 }] }))),
  "an HR event with a field of the wrong type is refused at load");

// ---- A tenant change is always reported, even if the run errors ----
{
  const sg = fresh();
  scriptHuman(["y"]);
  const model = scriptedModel([
    [use("get_hr_event", { event_id: "hr-1001" })],
    [use("plan_hr_change", { event_id: "hr-1001" })],
    [use("apply_hr_change", { event_id: "hr-1001" })],
    () => { throw new Error("API error after apply"); },
  ]);
  let result: Awaited<ReturnType<typeof runJml>> | undefined;
  const out = await capture(async () => { result = await runJml({ task: "Process HR event. event_id: hr-1001", mock: true, deps: { model: model.client, graph: sg } }); });
  noHuman();
  const types = traceLines(result!.traceFile).map((l) => l.type);
  check(result!.outcome === "error" && /Joiner complete/.test(out), "the model failing after apply still posts the #jml-status card for the change");
  check(types.indexOf("status_card") > types.indexOf("run_error") && types.at(-1) === "run_end", "the card is traced before run_end, after the error");
}
{
  // The card itself fails to post: traced, and the run reports it
  const sg = fresh();
  process.env.SLACK_WEBHOOK_JML_STATUS = "https://hooks.slack.invalid/status";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  const model = scriptedModel([[use("get_hr_event", { event_id: "hr-1004" })], [use("plan_hr_change", { event_id: "hr-1004" })], [say("refused")]]);
  let result: Awaited<ReturnType<typeof runJml>> | undefined;
  await capture(async () => { result = await runJml({ task: "Process HR event. event_id: hr-1004", mock: true, deps: { model: model.client, graph: sg } }); });
  globalThis.fetch = realFetch;
  delete process.env.SLACK_WEBHOOK_JML_STATUS;
  check(ofType(result!.traceFile, "status_post_failed").length === 1 && result!.warnings.length === 1, "a #jml-status post that fails is traced and returned as a warning (the CLI exits non-zero)");
}

// ---- Slack escaping on the card -------------------------------------
{
  const evil: HrEvent = { id: "hr-9004", type: "leaver", username: "a.b", displayName: "<!channel> <https://evil.example|click>", team: "<!here>" };
  const card = formatStatus(evil, { kind: "refused", reason: "x <!everyone> & y" }, { mock: false, runId: "r" });
  check(!/<!|<https/.test(card) && card.includes("&lt;!channel&gt;") && card.includes("&amp; y"), "names, teams and reasons are escaped on the card, so they can't ping or hide a link");
}

// ---- #jml-status cards tell the truth ---------------------------
{
  // Run a joiner through the real tools, recording outcomes like runJml does
  const sg = fresh();
  const outcomes = new Map<string, Outcome>();
  const tools = jmlTools(sg, cfg, { eventId: "hr-1001" }, (id, o) => outcomes.set(id, o));
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
