// ============================================================
// MODEL CLIENT (Claude)
// ============================================================
// Wraps the Anthropic SDK behind our small ModelClient interface.
// WHY a wrapper: the agent loop never talks to a vendor directly,
// so the model can be swapped (Haiku, Sonnet, a mock, later Jev
// for fast decisions) without touching agent logic.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import type { Block, ModelClient, ModelRequest, ModelTurn } from "./types.ts";

// Cheap and fast by default; override with ANTHROPIC_MODEL in .env
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function createClaudeClient(): ModelClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env, or run with --mock.");
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
