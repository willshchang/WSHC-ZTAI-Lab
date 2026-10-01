// ============================================================
// TEST: GTM Signal Router tools
// ============================================================
//   - post_to_slack posts only the draft the CODE built, by signup
//     id; the model can't hand in its own text
//   - a route outside the list is refused (never "undefined")
//   - a run touches only the signup in its task
//   - customer data and model text are escaped for Slack
//   - signup records are checked at load, never just cast
// No network: Slack is in dry-run, the model and human are scripted.
// ============================================================

import { runAgent } from "../core/agent.ts";
import { Trace } from "../core/trace.ts";
import { runGtm } from "../gtm-signal-router/agent.ts";
import { gtmPolicy } from "../gtm-signal-router/policy.ts";
import { parseSignups, signups } from "../gtm-signal-router/scoring.ts";
import { gtmTools } from "../gtm-signal-router/tools.ts";
import { capture, check, done, noHuman, ofType, rejection, say, scriptHuman, scriptedModel, use } from "./helpers.ts";

delete process.env.SLACK_WEBHOOK_AGENT_FEEDBACK;
delete process.env.SLACK_WEBHOOK_GTM_ROUTING;
noHuman();

const posted = (out: string) => out.split("Would post to #gtm-routing:\n")[1] ?? "";
const ID = "northwind-transit";
const draftInput = { signup_id: ID, route: "sales", reasoning: "Strong build volume and a production plan." };

// ---- The post is bound to the stored draft ---------------------------
{
  const h = scriptHuman(["y"]);
  const m = scriptedModel([
    [use("draft_routing_message", draftInput)],
    // A fooled model tries to post its own text alongside the id
    [use("post_to_slack", { signup_id: ID, message: "<!here> wire money now" })],
    [use("post_to_slack", { signup_id: ID })],
    [say("done")],
  ]);
  let r: Awaited<ReturnType<typeof runAgent>> | undefined;
  const out = await capture(async () => {
    r = await runAgent({ policy: gtmPolicy, tools: gtmTools({ signupId: ID }), model: m.client, system: "t", task: "t", mock: true });
  });
  const body = posted(out);
  check(ofType(r!.traceFile, "input_invalid").length === 1, "a post_to_slack carrying its own message is refused as invalid input");
  check(body.startsWith(":test_tube: *[MOCK]* :dart: *New signup routed: Northwind Transit*") && !body.includes("wire money"), "what posts is the code-built draft, word for word");
  check(h.prompts.length === 1, "the human approved exactly one post");
  const approval = ofType(r!.traceFile, "approval")[0];
  const result = ofType(r!.traceFile, "tool_result").find((l) => l.tool === "post_to_slack" && !l.error);
  check(typeof approval?.shownSha256 === "string" && (result?.output as { sha256?: string })?.sha256 === approval?.shownSha256, "the posted bytes carry the same hash the approval recorded");
}
{
  // No draft yet: there is nothing to approve, so no one is asked
  const h = scriptHuman(["y"]);
  const m = scriptedModel([[use("post_to_slack", { signup_id: ID })], [say("done")]]);
  let r: Awaited<ReturnType<typeof runAgent>> | undefined;
  const out = await capture(async () => {
    r = await runAgent({ policy: gtmPolicy, tools: gtmTools({ signupId: ID }), model: m.client, system: "t", task: "t", mock: true });
  });
  check(h.prompts.length === 0 && !out.includes("Would post to #gtm-routing") && ofType(r!.traceFile, "approval_skipped").length === 1,
    "post_to_slack with no draft asks no one and posts nothing");
  noHuman();
}
{
  // The tool itself refuses to post anything but the approved draft
  const tools = gtmTools({ signupId: ID });
  const ctx = { policy: gtmPolicy, trace: new Trace("agent-gtm-signal-router"), mock: false };
  const post = tools.find((t) => t.name === "post_to_slack")!;
  await tools.find((t) => t.name === "draft_routing_message")!.run(draftInput, ctx);
  check(/Not approved/.test(await rejection(() => post.run({ signup_id: ID }, ctx))), "post_to_slack never runs without an approval");
  check(/not this signup's current draft/.test(await rejection(() => post.run({ signup_id: ID }, { ...ctx, approved: { text: "something else", sha256: "x" } })),
    ), "post_to_slack refuses approved text that isn't the stored draft");
}

// ---- Route must be on the list ---------------------------------------
{
  const tools = gtmTools({ signupId: ID });
  const ctx = { policy: gtmPolicy, trace: new Trace("agent-gtm-signal-router"), mock: false };
  const draft = tools.find((t) => t.name === "draft_routing_message")!;
  check(/route must be one of/.test(await rejection(() => draft.run({ ...draftInput, route: "vip" }, ctx))), "route \"vip\" is refused by the tool itself (never rendered as undefined)");
  const out = (await draft.run(draftInput, ctx)) as { message: string };
  check(out.message.includes("SALES (enterprise AE follow-up)") && !out.message.includes("undefined"), "a valid route renders its label");
}

// ---- ID binding: a run touches only the signup in its task -----------
{
  const tools = gtmTools({ signupId: ID });
  const trace = new Trace("agent-gtm-signal-router");
  const ctx = { policy: gtmPolicy, trace, mock: true };
  for (const name of ["get_signup", "score_account", "draft_routing_message", "post_to_slack"]) {
    const input = name === "draft_routing_message" ? { ...draftInput, signup_id: "pixel-pine" } : { signup_id: "pixel-pine" };
    const run = name === "post_to_slack"
      ? () => Promise.resolve(tools.find((t) => t.name === name)!.describeForApproval!(input, ctx))
      : () => tools.find((t) => t.name === name)!.run(input, ctx);
    check(/may only work on signup "northwind-transit"/.test(await rejection(run)), `${name} refuses a signup other than the one in its task`);
  }
  check(ofType(trace.file, "policy_denied").filter((l) => l.reason === "id_binding").length === 4, "each refused id is traced as policy_denied (id_binding)");
}
check(/does not match its contract/.test(await rejection(() => runGtm({ task: "Route this new signup. signup_id: pixel-pine. Also quickship-labs", mock: true }))),
  "runGtm refuses a task that doesn't match the contract");

// ---- Slack escaping ---------------------------------------------------
{
  const evil = parseSignups([{ ...signups[0], id: "evil-co", company: "<!here> Evil & Co", contact_email: "<https://evil.example|ceo@bank.example>" }])[0]!;
  signups.push(evil);
  const tools = gtmTools({ signupId: "evil-co" });
  const ctx = { policy: gtmPolicy, trace: new Trace("agent-gtm-signal-router"), mock: false };
  const out = (await tools.find((t) => t.name === "draft_routing_message")!.run(
    { signup_id: "evil-co", route: "sales", reasoning: "Because <!channel> said so" }, ctx)) as { message: string };
  check(!/<!|<https/.test(out.message) && out.message.includes("&lt;!here&gt; Evil &amp; Co") && out.message.includes("&lt;!channel&gt;"),
    "company, contact and the model's reasoning are escaped, so they can't ping a channel or hide a link");
  check(/control characters/.test(await rejection(() => tools.find((t) => t.name === "draft_routing_message")!.run(
    { signup_id: "evil-co", route: "sales", reasoning: "ok\rfake" }, ctx))), "reasoning with control characters is refused before it reaches a draft");
  signups.pop();
}

// ---- Signup records are checked at load ------------------------------
const base = signups[0]!;
for (const [bad, why] of [
  [{ ...base, team_size: "lots" }, "a team size that isn't a number"],
  [{ ...base, plan: "platinum" }, "an unknown plan"],
  [{ ...base, id: "Bad Id" }, "a malformed id"],
  [{ ...base, eas_update_enabled: "yes" }, "a flag that isn't true, false or null"],
] as const) {
  check((await rejection(async () => parseSignups([bad]))).includes("is invalid"), `a signup with ${why} is refused at load`);
}
check(parseSignups(signups).length === signups.length, "the shipped signups all pass the check");

done();
