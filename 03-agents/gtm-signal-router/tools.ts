// ============================================================
// GTM SIGNAL ROUTER: TOOLS
// ============================================================
// The only actions this agent can take. Each tool declares its
// risk tier, which decides whether it runs freely or waits for a
// human (see core/types.ts).
//
// WHY a fresh set of tools per run: each run is bound to ONE signup
// (the id in its task) and keeps its own drafts. Nothing carries
// over from one run to the next.
// ============================================================

import { makeFrictionTool } from "../core/friction.ts";
import { forTerminal, hasControlChars } from "../core/sanitize.ts";
import { escapeSlack, MOCK_TAG, postToSlack } from "../core/slack.ts";
import type { AgentTool, ToolContext } from "../core/types.ts";
import { findSignup, scoreAccount, type Route } from "./scoring.ts";

const ROUTE_LABEL: Record<Route, string> = {
  sales: "SALES (enterprise AE follow-up)",
  nurture: "NURTURE (automated education sequence)",
  self_serve: "SELF-SERVE (docs and community)",
};
const ROUTES = Object.keys(ROUTE_LABEL) as Route[];
const isRoute = (v: unknown): v is Route => typeof v === "string" && (ROUTES as string[]).includes(v);

const SIGNUP_ID_MAX = 64;
const REASONING_MAX = 400;

export function gtmTools(opts: { signupId: string }): AgentTool[] {
  // Drafts the CODE built in this run, by signup id. post_to_slack can
  // only post one of these: the model never hands in its own text.
  const drafts = new Map<string, string>();

  // --------------------------------------------------------
  // ID BINDING: this run may only touch the signup in its task.
  // A fooled model asking for any other record is refused and
  // the attempt is traced, exactly like a tool outside the policy.
  // --------------------------------------------------------
  const requireSignup = (input: Record<string, unknown>, ctx: ToolContext, tool: string) => {
    const id = String(input.signup_id ?? "");
    if (id !== opts.signupId) {
      ctx.trace.record("policy_denied", { tool, reason: "id_binding", requested: id, allowed: opts.signupId });
      throw new Error(`Denied by policy: this run may only work on signup "${opts.signupId}", not "${id}".`);
    }
    const signup = findSignup(id);
    if (!signup) throw new Error(`No signup found with id "${id}"`);
    return signup;
  };

  const signupIdField = { type: "string" as const, maxLength: SIGNUP_ID_MAX, description: "The signup's id" };

  // ------------------------------------------------------------
  // get_signup (read): look at the raw signup record
  // ------------------------------------------------------------
  const getSignup: AgentTool = {
    name: "get_signup",
    description: "Read a new signup's record: company, contact, team size, and product usage signals.",
    inputSchema: {
      type: "object",
      properties: { signup_id: signupIdField },
      required: ["signup_id"],
      additionalProperties: false,
    },
    risk: "read",
    run: async (input, ctx) => requireSignup(input, ctx, "get_signup"),
  };

  // ------------------------------------------------------------
  // score_account (read): deterministic score, no AI involved
  // ------------------------------------------------------------
  const scoreAccountTool: AgentTool = {
    name: "score_account",
    description:
      "Score a signup 0-100 from product signals with fixed rules. Returns the recommended route, " +
      "any missing signals, and whether missing data could change the route (route_uncertain).",
    inputSchema: {
      type: "object",
      properties: { signup_id: signupIdField },
      required: ["signup_id"],
      additionalProperties: false,
    },
    risk: "read",
    run: async (input, ctx) => scoreAccount(requireSignup(input, ctx, "score_account")),
  };

  // ------------------------------------------------------------
  // draft_routing_message (read): formats the Slack message and
  // keeps it for post_to_slack. Writes nothing, so it runs freely.
  // Every value from the signup or the model is escaped for Slack,
  // so a company named "<!here>" can't ping the channel.
  // ------------------------------------------------------------
  const draftRoutingMessage: AgentTool = {
    name: "draft_routing_message",
    description:
      "Draft the Slack routing message for a signup. Does not post anything. " +
      "post_to_slack posts this draft exactly as drafted.",
    inputSchema: {
      type: "object",
      properties: {
        signup_id: signupIdField,
        route: { type: "string", enum: ROUTES },
        reasoning: { type: "string", maxLength: REASONING_MAX, description: "One or two sentences on why this route" },
        needs_data: {
          type: "boolean",
          description: "True if missing data means a human should confirm the route",
        },
      },
      required: ["signup_id", "route", "reasoning"],
      additionalProperties: false,
    },
    risk: "read",
    run: async (input, ctx) => {
      const s = requireSignup(input, ctx, "draft_routing_message");
      // Checked here too, not only by the engine: a route outside the
      // list would render as "undefined" in a real post
      if (!isRoute(input.route)) throw new Error(`route must be one of ${ROUTES.join(", ")}`);
      const reasoning = String(input.reasoning ?? "").trim();
      if (!reasoning) throw new Error("reasoning is required");
      if (hasControlChars(reasoning)) throw new Error("reasoning may not contain control characters");

      const result = scoreAccount(s);
      const flag = input.needs_data === true
        ? `\n:mag: *Needs data:* ${result.missing_signals.join(", ")} missing. Could be ${result.best_case_route.toUpperCase()} (up to ${result.best_case_score}/100).`
        : "";
      const message =
        `:dart: *New signup routed: ${escapeSlack(s.company, 120)}*  →  *${ROUTE_LABEL[input.route]}*\n` +
        `*Score:* ${result.score}/100  |  builds/7d: ${s.builds_last_7d ?? "?"}  |  team: ${s.team_size ?? "?"}  |  plan: ${s.plan ?? "?"}\n` +
        `*Why:* ${escapeSlack(reasoning, REASONING_MAX)}` +
        flag +
        `\n*Contact:* ${escapeSlack(s.contact_email, 120)}  |  *Trace:* \`${ctx.trace.runId}\``;
      drafts.set(s.id, message);
      return { drafted: true, signup_id: s.id, message };
    },
  };

  // ------------------------------------------------------------
  // post_to_slack (external-write): real people act on this post,
  // so the core loop pauses for human approval before it runs.
  // It takes only a signup id and posts the stored draft; the model
  // can't hand in text of its own.
  // ------------------------------------------------------------
  // The exact text that would post. Code adds the tag, not the model,
  // so a test post can't drop it. Terminal-safe, because the human
  // approves this exact text and these are the bytes that post.
  const postText = (id: string, mock: boolean): string => {
    const draft = drafts.get(id);
    if (!draft) throw new Error(`No draft for signup "${id}". Call draft_routing_message first.`);
    return forTerminal((mock ? MOCK_TAG : "") + draft);
  };

  const postRouting: AgentTool = {
    name: "post_to_slack",
    description:
      "Post the drafted routing message for a signup to #gtm-routing. Takes only the signup id: " +
      "it posts the draft exactly as drafted. A human must approve first.",
    inputSchema: {
      type: "object",
      properties: { signup_id: signupIdField },
      required: ["signup_id"],
      additionalProperties: false,
    },
    risk: "external-write",
    approvalLabel: "post to #gtm-routing",
    // The approval box shows exactly what will post, tag included.
    // Throws (so nobody is asked) if there is no draft to post.
    describeForApproval: (input, ctx) => postText(requireSignup(input, ctx, "post_to_slack").id, ctx.mock),
    run: async (input, ctx) => {
      const id = requireSignup(input, ctx, "post_to_slack").id;
      // Post ONLY the bytes the human approved, and only if they are
      // still this signup's draft
      if (!ctx.approved) throw new Error("Not approved: post_to_slack only runs after a human approves it.");
      if (ctx.approved.text !== postText(id, ctx.mock)) {
        throw new Error("The approved text is not this signup's current draft. Nothing was posted.");
      }
      const result = await postToSlack(process.env.SLACK_WEBHOOK_GTM_ROUTING, "#gtm-routing", ctx.approved.text);
      drafts.delete(id); // one approval, one post
      return { ...result, sha256: ctx.approved.sha256 };
    },
  };

  return [getSignup, scoreAccountTool, draftRoutingMessage, postRouting, makeFrictionTool()];
}
