// ============================================================
// JML AGENT: ENTRY POINT
// ============================================================
// Usage:
//   npm run jml -- --list                         show HR events
//   npm run jml:mock -- --event hr-1001           scripted model, mock tenant
//   npm run jml -- --event hr-1001                real Claude, mock tenant
//   npm run jml -- --event hr-1001 --graph real   real Claude, REAL tenant
//   npm run jml -- --reset-mock                   reset the mock tenant
// The real tenant is only ever reached with an explicit --graph real.
// ============================================================

import { say } from "../core/sanitize.ts";
import { resetMockTenant } from "./graph.ts";
import { runJml } from "./agent.ts";
import { HR_EVENT_ID, loadHrEvents } from "./planner.ts";
import { jmlTask } from "./policy.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("reset-mock")) {
  resetMockTenant();
  console.log("Mock tenant reset to its starting state.");
  process.exit(0);
}

if (flag("list")) {
  console.log("HR events:");
  // Names and teams are HR data: shown terminal-safe
  for (const e of loadHrEvents()) say(`  ${e.id}  ${e.type.padEnd(7)} ${e.displayName}${e.team ? ` -> ${e.team}` : ""}`);
  process.exit(0);
}

const eventId = value("event");
if (!eventId || !HR_EVENT_ID.test(eventId)) {
  console.error("Give an event, e.g. --event hr-1001 (see --list).");
  process.exit(1);
}
const graphArg = value("graph") ?? "mock";
if (graphArg !== "mock" && graphArg !== "real") {
  console.error('--graph must be "mock" or "real".');
  process.exit(1);
}

try {
  // The --event value is the one event this run may touch
  const result = await runJml({ task: jmlTask(eventId), mock: flag("mock"), graph: graphArg });
  // An error, or a status card that failed to post, is never a quiet success
  for (const w of result.warnings) console.error(`❗ ${w}`);
  if (result.outcome === "error" || result.warnings.length > 0) process.exitCode = 1;
} catch (err) {
  // e.g. a missing key, missing tenant config or credentials: refuse clearly
  console.error(`\n⛔ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
