// ============================================================
// HUMAN APPROVAL
// ============================================================
// Pauses the agent and asks a person before any external-write.
// WHY: the agent can decide, but a human owns anything that other
// people will act on. Safe default: if nobody is at the keyboard
// (no interactive terminal), the answer is NO.
// ============================================================

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export interface ApprovalResult {
  approved: boolean;
  reason: "approved" | "denied_by_human" | "no_human_available";
}

export async function requestApproval(title: string, details: string): Promise<ApprovalResult> {
  if (!stdin.isTTY) {
    console.log(`\n[approval] No interactive terminal, so "${title}" is DENIED by default.`);
    return { approved: false, reason: "no_human_available" };
  }

  console.log("\n" + "=".repeat(60));
  console.log(`APPROVAL NEEDED: ${title}`);
  console.log("=".repeat(60));
  console.log(details);
  console.log("=".repeat(60));

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question("Approve? (y/N): ")).trim().toLowerCase();
    const approved = answer === "y" || answer === "yes";
    return { approved, reason: approved ? "approved" : "denied_by_human" };
  } finally {
    rl.close();
  }
}
