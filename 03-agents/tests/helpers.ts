// ============================================================
// TEST HELPERS (shared by the newer test files)
// ============================================================
// No network, no API key, no real Slack: every test drives the real
// engine with a scripted model and, when a human is needed, a
// scripted human in place of the terminal.
// ============================================================

import { readFileSync } from "node:fs";
import { human } from "../core/approval.ts";
import type { Block, ModelClient, ModelRequest, ModelTurn } from "../core/types.ts";

let failures = 0;
export const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "OK" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};
export const done = () => process.exit(failures ? 1 : 0);

// Runs fn with console output captured (and hidden); returns the output
export async function capture(fn: () => Promise<unknown>): Promise<string> {
  const log = console.log;
  const err = console.error;
  let out = "";
  console.log = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
  console.error = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
  try { await fn(); } finally { console.log = log; console.error = err; }
  return out;
}

// The error message a promise rejects with, or "" if it doesn't reject
export async function rejection(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// A scripted human at the terminal: answers in order, records each prompt
export function scriptHuman(answers: string[]): { prompts: string[] } {
  const prompts: string[] = [];
  human.available = () => true;
  human.ask = async (prompt: string) => {
    prompts.push(prompt);
    return answers.shift() ?? "";
  };
  return { prompts };
}
export function noHuman(): void {
  human.available = () => false;
}

// A scripted model. Each entry is one turn: a list of blocks (stop
// reason inferred), a full ModelTurn, or a function that throws.
type Step = Block[] | ModelTurn | (() => never);
export function scriptedModel(steps: Step[], opts: { canForceTool?: boolean } = {}) {
  const requests: ModelRequest[] = [];
  let i = 0;
  let n = 0;
  const client: ModelClient = {
    label: "stub",
    canForceTool: opts.canForceTool ?? false,
    next: async (req) => {
      requests.push({ ...req, messages: structuredClone(req.messages) });
      const s = steps[i++] ?? [{ type: "text", text: "done" }];
      if (typeof s === "function") s();
      const turn: ModelTurn = Array.isArray(s)
        ? { blocks: s, stopReason: s.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" }
        : (s as ModelTurn);
      return { ...turn, blocks: turn.blocks.map((b) => (b.type === "tool_use" && !b.id ? { ...b, id: `t${++n}` } : b)) };
    },
  };
  return { client, requests };
}
export const use = (name: string, input: Record<string, unknown> = {}): Block => ({ type: "tool_use", id: "", name, input });
export const say = (text: string): Block => ({ type: "text", text });

// Trace lines as objects
export const traceLines = (file: string): Record<string, unknown>[] =>
  readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
export const ofType = (file: string, type: string) => traceLines(file).filter((l) => l.type === type);
