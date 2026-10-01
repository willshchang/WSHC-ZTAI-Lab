// ============================================================
// HUMAN APPROVAL
// ============================================================
// Pauses the agent and asks a person before any external-write.
// WHY: the agent can decide, but a human owns anything that other
// people will act on. Safe default: if nobody is at the keyboard
// (no interactive terminal), the answer is NO.
//
// The box shows text that was already made terminal-safe by the
// engine (core/sanitize.ts), so nothing in it can move the cursor,
// clear the screen or flip the reading order.
// ============================================================

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export interface ApprovalResult {
  approved: boolean;
  reason: "approved" | "denied_by_human" | "no_human_available" | "denied_after_earlier_no";
}

// ------------------------------------------------------------
// TYPE-AHEAD: keys pressed BEFORE the question appeared (say, a
// "y" and Enter typed while the agent was still thinking) sit in
// the terminal's buffer and would answer the prompt on their own.
// Before asking, read and throw away anything already waiting.
// ------------------------------------------------------------
const DRAIN_MS = 100;
async function discardTypeAhead(): Promise<void> {
  const discard = () => {};
  stdin.on("data", discard);
  stdin.resume();
  await new Promise((r) => setTimeout(r, DRAIN_MS));
  stdin.pause();
  stdin.off("data", discard);
}

async function askTerminal(prompt: string): Promise<string> {
  await discardTypeAhead();
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

// The human side of the gate. Tests swap in a scripted human; the
// real one is the terminal, and only when it is interactive.
export const human = {
  available: (): boolean => Boolean(stdin.isTTY),
  ask: askTerminal,
};

export async function requestApproval(title: string, details: string): Promise<ApprovalResult> {
  if (!human.available()) {
    console.log(`\n[approval] No interactive terminal, so "${title}" is DENIED by default.`);
    return { approved: false, reason: "no_human_available" };
  }

  console.log("\n" + "=".repeat(60));
  console.log(`APPROVAL NEEDED: ${title}`);
  console.log("=".repeat(60));
  console.log(details);
  console.log("=".repeat(60));

  const answer = (await human.ask("Approve? (y/N): ")).trim().toLowerCase();
  const approved = answer === "y" || answer === "yes";
  return { approved, reason: approved ? "approved" : "denied_by_human" };
}
