// ============================================================
// TEST: test runs are tagged [MOCK] in Slack, real runs never are
// ============================================================
// A scripted model or the mock tenant makes a run a test run.
// Everything it posts (friction reports, system alerts, GTM
// routing posts) must carry the [MOCK] tag, added by code so the
// model can't drop it. A real run must never carry the tag.
// Slack is in dry-run here, so we capture what WOULD be posted.
// ============================================================

delete process.env.SLACK_WEBHOOK_AGENT_FEEDBACK;
delete process.env.SLACK_WEBHOOK_GTM_ROUTING;

const { fileFrictionReport } = await import("../core/friction.ts");
const { runAgent } = await import("../core/agent.ts");
const { Trace } = await import("../core/trace.ts");
const { gtmPolicy } = await import("../gtm-signal-router/policy.ts");
const { gtmTools } = await import("../gtm-signal-router/tools.ts");
const { scarletPolicy } = await import("../scarlet/policy.ts");

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "OK" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};

// Capture what the dry-run would have posted
const capture = async (fn: () => Promise<unknown>) => {
  const orig = console.log;
  let out = "";
  console.log = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
  try { await fn(); } finally { console.log = orig; }
  return out;
};
const posted = (out: string, channel: string) => out.split(`Would post to ${channel}:\n`)[1] ?? "";

const fields = { category: "missing_data", task: "t", expected: "e", actual: "a", evidence: "ev" };

// ---- Friction reports -------------------------------------------
let out = await capture(() => fileFrictionReport(fields, gtmPolicy, "r1", "agent", true));
check(posted(out, "#agent-feedback").startsWith(":test_tube: *[MOCK]* :warning: *Agent friction report*"), "a test run's friction report starts with the MOCK tag");
out = await capture(() => fileFrictionReport(fields, gtmPolicy, "r2", "agent", false));
check(posted(out, "#agent-feedback").startsWith(":warning: *Agent friction report*") && !out.includes("[MOCK]"), "a real run's friction report has no MOCK tag");

// ---- System alerts (the no-silent-failure guard) ----------------
const silent = { label: "test", next: async () => ({ blocks: [{ type: "text" as const, text: "Hi!" }], stopReason: "end_turn" as const }) };
out = await capture(() => runAgent({ policy: scarletPolicy, tools: [], model: silent, system: "t", task: "hello", mock: true }));
check(/:test_tube: \*\[MOCK\]\* :warning: \*Agent friction report\*.*filed by the system/.test(out), "a system alert from a test run is tagged MOCK");
out = await capture(() => runAgent({ policy: scarletPolicy, tools: [], model: silent, system: "t", task: "hello", mock: false }));
check(/filed by the system/.test(out) && !out.includes("[MOCK]"), "a system alert from a real run has no MOCK tag");

// ---- GTM routing posts ------------------------------------------
const post = gtmTools.find((t) => t.name === "post_to_slack")!;
const msg = { message: ":dart: *New signup routed: Test Co*" };
const ctx = (mock: boolean) => ({ policy: gtmPolicy, trace: new Trace("agent-gtm-signal-router"), mock });
out = await capture(() => post.run(msg, ctx(true)));
check(posted(out, "#gtm-routing").startsWith(":test_tube: *[MOCK]* :dart:"), "a test run's routing post is tagged MOCK");
check(post.describeForApproval!(msg, ctx(true)).includes("[MOCK]"), "the approval box shows the MOCK tag, matching what will post");
out = await capture(() => post.run(msg, ctx(false)));
check(posted(out, "#gtm-routing").startsWith(":dart:") && !out.includes("[MOCK]"), "a real run's routing post has no MOCK tag");

// The model can't remove the tag: it's added after the model's text
out = await capture(() => post.run({ message: "no tag please" }, ctx(true)));
check(posted(out, "#gtm-routing").startsWith(":test_tube: *[MOCK]* no tag please"), "the tag is added by code, whatever the model writes");

// ---- JML: which runs count as tests -----------------------------
const { isTestRun } = await import("../jml/agent.ts");
check(isTestRun(false, "mock") && isTestRun(false, undefined), "JML with a real model on the MOCK tenant is a test run (tagged)");
check(isTestRun(true, "real"), "JML with the scripted model is a test run, even on the real tenant");
check(!isTestRun(false, "real"), "JML with a real model on the real tenant is real (no tag)");

process.exit(failures ? 1 : 0);
