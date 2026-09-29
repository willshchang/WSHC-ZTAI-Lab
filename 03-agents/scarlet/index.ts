// ============================================================
// SCARLET: ENTRY POINT
// ============================================================
// Usage:
//   npm run scarlet -- "route the harbor-health signup"       (real Claude)
//   npm run scarlet:mock -- "route the harbor-health signup"  (scripted, no API)
// ============================================================

import { runAgent } from "../core/agent.ts";
import { createClaudeClient } from "../core/model.ts";
import { createScarletMock } from "./mock.ts";
import { buildScarletPrompt, scarletPolicy } from "./policy.ts";
import { loadRegistry } from "./registry.ts";
import { scarletTools } from "./tools.ts";

const args = process.argv.slice(2);
const mock = args.includes("--mock");
const request = args.filter((a) => a !== "--mock").join(" ").trim();

if (!request) {
  console.error('Give Scarlet a request, e.g. npm run scarlet -- "route the harbor-health signup"');
  process.exit(1);
}

try {
  // Fails closed: a broken agents.json means Scarlet refuses to start
  const registry = loadRegistry();
  await runAgent({
    policy: scarletPolicy,
    tools: scarletTools(registry, { mock }),
    model: mock ? createScarletMock() : createClaudeClient(scarletPolicy),
    system: buildScarletPrompt(registry),
    task: request,
  });
} catch (err) {
  // e.g. a missing API key or a broken agents.json: refuse clearly, no stack trace
  console.error(`\n⛔ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
