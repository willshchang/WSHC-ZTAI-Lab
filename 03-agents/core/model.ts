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
  const client = new Anthropic({ apiKey });

  return {
    label: model,
    next: async (req: ModelRequest): Promise<ModelTurn> => {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: req.system,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
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
