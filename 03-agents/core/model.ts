// ============================================================
// MODEL CLIENT (Claude)
// ============================================================
// Wraps the Anthropic SDK behind our small ModelClient interface.
// WHY a wrapper: the agent loop never talks to a vendor directly,
// so the model can be swapped (Haiku, Sonnet, a mock, later Jev
// for fast decisions) without touching agent logic.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import type { AgentPolicy, Block, ModelClient, ModelRequest, ModelTurn } from "./types.ts";

// Cheap and fast by default; override with ANTHROPIC_MODEL in .env
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// The loop raises max_tokens once if a tool call was cut off (core/agent.ts)
export const DEFAULT_MAX_TOKENS = 1024;
export const API_BASE_URL = "https://api.anthropic.com";
const REQUEST_TIMEOUT_MS = 60_000; // one request; the SDK retries on timeout
const MAX_RETRIES = 2; // SDK retries on connection errors, 408, 409, 429 and 5xx

// ------------------------------------------------------------
// FORCED TOOL CALLS: an allowlist, not a denylist
// ------------------------------------------------------------
// tool_choice "any" makes the model call a tool instead of replying
// in text. Anthropic's docs list models that reject it with a 400
// (Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1). WHY an allowlist:
// an unknown or future model gets the safe default ("auto" plus the
// loop's guard), so swapping models can never break a run. Add a
// model here only after checking the docs.
// https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
// ------------------------------------------------------------
const FORCED_TOOL_MODELS = [/^claude-haiku-4-5/];
export const canForceTool = (model: string) => FORCED_TOOL_MODELS.some((re) => re.test(model));

// ------------------------------------------------------------
// ONE KEY PER AGENT, OR NO RUN
// ------------------------------------------------------------
// WHY: each agent reads only its own key (named in its policy).
// Spend shows per agent in the Console, and one key can be revoked
// without touching the others. If the key is missing, the agent
// refuses to run. It never falls back to a shared key: a fallback
// would quietly turn one agent's credential into everyone's.
// ------------------------------------------------------------
export function createClaudeClient(policy: AgentPolicy): ModelClient {
  const apiKey = process.env[policy.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Refusing to run ${policy.id}: ${policy.apiKeyEnv} is not set. ` +
        `Each agent needs its own API key and never borrows another's. ` +
        `Add it to .env, or run with --mock.`,
    );
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  // ----------------------------------------------------------
  // EVERYTHING EXPLICIT: left unset, the SDK fills these from the
  // environment (ANTHROPIC_AUTH_TOKEN as a second credential sent
  // on every request, ANTHROPIC_BASE_URL as a different host that
  // would receive this agent's key). Pinning them means this agent
  // talks to Anthropic with its own key and nothing else. (The SDK
  // also adds any headers listed in ANTHROPIC_CUSTOM_HEADERS; this
  // lab never sets it.)
  // Option names checked against @anthropic-ai/sdk 0.129 (client.d.ts).
  // ----------------------------------------------------------
  const client = new Anthropic({
    apiKey,
    authToken: null,
    baseURL: API_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  const forceable = canForceTool(model);
  return {
    label: model,
    canForceTool: forceable,
    next: async (req: ModelRequest): Promise<ModelTurn> => {
      const response = await client.messages.create({
        model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: req.system,
        ...(req.mustUseTool && forceable ? { tool_choice: { type: "any" as const } } : {}),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
        messages: req.messages as Anthropic.MessageParam[],
      });

      // Keep only the block types our loop understands
      const blocks: Block[] = [];
      for (const b of response.content) {
        if (b.type === "text") blocks.push({ type: "text", text: b.text });
        if (b.type === "tool_use") {
          blocks.push({
            type: "tool_use",
            id: b.id,
            name: b.name,
            input: (b.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      return { blocks, stopReason: response.stop_reason ?? "end_turn" };
    },
  };
}
