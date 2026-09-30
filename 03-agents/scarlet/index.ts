// ============================================================
// SCARLET: ENTRY POINT
// ============================================================
// Usage:
//   npm run scarlet -- "route the harbor-health signup"  one request, then exit
//   npm run scarlet                                      chat session (needs a terminal)
//   add :mock to either (npm run scarlet:mock ...) for the scripted model, no API
//   add --graph real to let the JML agent reach the REAL tenant (mock otherwise)
// ============================================================

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runAgent } from "../core/agent.ts";
import { createClaudeClient } from "../core/model.ts";
import type { GraphMode } from "../jml/agent.ts";
import type { Message, ModelClient } from "../core/types.ts";
import { createScarletMock } from "./mock.ts";
import { buildScarletPrompt, scarletPolicy } from "./policy.ts";
import { loadRegistry, type AgentEntry } from "./registry.ts";
import { scarletTools } from "./tools.ts";

// ------------------------------------------------------------
// SESSION MEMORY LIMITS
// ------------------------------------------------------------
// WHY bounded: memory costs tokens on every request, and old
// context goes stale. She keeps only the last messages, only as
// plain text (never raw tool data), only in this running program.
// It is wiped on exit or after the idle timeout. Nothing is saved
// to disk except the traces that already exist.
// ------------------------------------------------------------
const MEMORY_MESSAGES = 20;
const IDLE_MINUTES = 30;

const args = process.argv.slice(2);
const mock = args.includes("--mock");
const gi = args.indexOf("--graph");
const graph: GraphMode = gi >= 0 && args[gi + 1] === "real" ? "real" : "mock";
// Drop the flags (and --graph's value) so only the request text remains
const flagIdx = new Set(gi >= 0 ? [gi, gi + 1] : []);
const request = args
  .filter((a, i) => a !== "--mock" && !flagIdx.has(i))
  .join(" ")
  .trim();

async function handle(
  registry: AgentEntry[],
  model: ModelClient,
  task: string,
  session?: { id: string; history: Message[] },
) {
  const result = await runAgent({
    policy: scarletPolicy,
    tools: scarletTools(registry, { mock, graph, message: task }), // fresh tools per request (question limit resets)
    model,
    system: buildScarletPrompt(registry),
    task,
    history: session?.history,
    sessionId: session?.id,
    mock, // scripted model: posts are tagged [MOCK]
  });
  if (session) {
    // Remember what was said, not raw data: the request and her final reply
    session.history.push(
      { role: "user", content: task },
      { role: "assistant", content: [{ type: "text", text: result.finalText || "(no reply)" }] },
    );
    session.history.splice(0, Math.max(0, session.history.length - MEMORY_MESSAGES));
  }
}

try {
  // Fails closed: a broken agents.json or a missing key means no start
  const registry = loadRegistry();
  const model = mock ? createScarletMock() : createClaudeClient(scarletPolicy);

  if (request) {
    await handle(registry, model, request);
  } else {
    // ----------------------------------------------------------
    // SESSION MODE: a chat that stays open until "exit".
    // Needs a person at the keyboard; otherwise it refuses.
    // ----------------------------------------------------------
    if (!stdin.isTTY) {
      throw new Error("Session mode needs an interactive terminal. Pass a request instead.");
    }
    const session = { id: randomUUID(), history: [] as Message[] };
    console.log(`\n💬 Scarlet session ${session.id.slice(0, 8)} started. Type "exit" to leave.`);
    console.log(`   Memory: last ${MEMORY_MESSAGES} messages, this session only, cleared after ${IDLE_MINUTES} min idle.\n`);

    while (true) {
      const rl = createInterface({ input: stdin, output: stdout });
      let line: string;
      try {
        line = (await rl.question("You: ", { signal: AbortSignal.timeout(IDLE_MINUTES * 60_000) })).trim();
      } catch {
        console.log(`\n⏱ No message for ${IDLE_MINUTES} minutes. Session ended and memory cleared.`);
        break;
      } finally {
        rl.close();
      }
      if (!line) continue;
      if (/^(exit|quit|bye)$/i.test(line)) {
        console.log("👋 Session ended. Memory cleared.");
        break;
      }
      try {
        await handle(registry, model, line, session);
      } catch (err) {
        // One failed request never kills the session
        console.error(`\n⛔ ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }
} catch (err) {
  // e.g. a missing API key or a broken agents.json: refuse clearly, no stack trace
  console.error(`\n⛔ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
