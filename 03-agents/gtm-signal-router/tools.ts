// ============================================================
// GTM SIGNAL ROUTER: TOOLS
// ============================================================
// The only actions this agent can take. Each tool declares its
// risk tier, which decides whether it runs freely or waits for a
// human (see core/types.ts).
// ============================================================

import { makeFrictionTool } from "../core/friction.ts";
import { postToSlack } from "../core/slack.ts";
import type { AgentTool } from "../core/types.ts";
import { findSignup, scoreAccount } from "./scoring.ts";

const ROUTE_LABEL: Record<string, string> = {
  sales: "SALES (enterprise AE follow-up)",
  nurture: "NURTURE (automated education sequence)",
  self_serve: "SELF-SERVE (docs and community)",
};

function requireSignup(input: Record<string, unknown>) {
  const id = String(input.signup_id ?? "");
  const signup = findSignup(id);
  if (!signup) throw new Error(`No signup found with id "${id}"`);
  return signup;
}

// ------------------------------------------------------------
// get_signup (read): look at the raw signup record
// ------------------------------------------------------------
const getSignup: AgentTool = {
  name: "get_signup",
  description: "Read a new signup's record: company, contact, team size, and product usage signals.",
  inputSchema: {
    type: "object",
    properties: { signup_id: { type: "string", description: "The signup's id" } },
    required: ["signup_id"],
  },
  risk: "read",
  run: async (input) => requireSignup(input),
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
    properties: { signup_id: { type: "string" } },
    required: ["signup_id"],
  },
  risk: "read",
  run: async (input) => scoreAccount(requireSignup(input)),
};

// ------------------------------------------------------------
// draft_routing_message (read): formats the Slack message.
// Writes nothing, so it runs freely; posting is a separate tool.
// ------------------------------------------------------------
const draftRoutingMessage: AgentTool = {
  name: "draft_routing_message",
  description: "Draft the Slack routing message for a signup. Does not post anything.",
  inputSchema: {
    type: "object",
    properties: {
      signup_id: { type: "string" },
      route: { type: "string", enum: ["sales", "nurture", "self_serve"] },
      reasoning: { type: "string", description: "One or two sentences on why this route" },
      needs_data: {
        type: "boolean",
        description: "True if missing data means a human should confirm the route",
      },
    },
    required: ["signup_id", "route", "reasoning"],
  },
  risk: "read",
  run: async (input, ctx) => {
    const s = requireSignup(input);
    const result = scoreAccount(s);
    const flag = input.needs_data
      ? `\n:mag: *Needs data:* ${result.missing_signals.join(", ")} missing. Could be ${result.best_case_route.toUpperCase()} (up to ${result.best_case_score}/100).`
      : "";
    const message =
      `:dart: *New signup routed: ${s.company}*  →  *${ROUTE_LABEL[String(input.route)]}*\n` +
      `*Score:* ${result.score}/100  |  builds/7d: ${s.builds_last_7d ?? "?"}  |  team: ${s.team_size ?? "?"}  |  plan: ${s.plan ?? "?"}\n` +
      `*Why:* ${input.reasoning}` +
      flag +
      `\n*Contact:* ${s.contact_email}  |  *Trace:* \`${ctx.trace.runId}\``;
    return { message };
  },
};

// ------------------------------------------------------------
// post_to_slack (external-write): real people act on this post,
// so the core loop pauses for human approval before it runs
// ------------------------------------------------------------
const postRouting: AgentTool = {
  name: "post_to_slack",
  description: "Post an approved routing message to the #gtm-routing channel. A human must approve first.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string", description: "The drafted routing message" } },
    required: ["message"],
  },
  risk: "external-write",
  describeForApproval: (input) => `Post to #gtm-routing:\n\n${String(input.message)}`,
  run: async (input) =>
    postToSlack(process.env.SLACK_WEBHOOK_GTM_ROUTING, "#gtm-routing", String(input.message)),
};

export const gtmTools: AgentTool[] = [
  getSignup,
  scoreAccountTool,
  draftRoutingMessage,
  postRouting,
  makeFrictionTool(),
];
