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

import { resetMockTenant } from "./graph.ts";
import { runJml } from "./agent.ts";
import { loadHrEvents } from "./planner.ts";

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
  for (const e of loadHrEvents()) console.log(`  ${e.id}  ${e.type.padEnd(7)} ${e.displayName}${e.team ? ` -> ${e.team}` : ""}`);
  process.exit(0);
}

const eventId = value("event");
if (!eventId || !/^hr-\d{4}$/.test(eventId)) {
  console.error("Give an event, e.g. --event hr-1001 (see --list).");
  process.exit(1);
}
const graphArg = value("graph") ?? "mock";
if (graphArg !== "mock" && graphArg !== "real") {
  console.error('--graph must be "mock" or "real".');
  process.exit(1);
}

try {
  await runJml({ task: `Process HR event. event_id: ${eventId}`, mock: flag("mock"), graph: graphArg });
} catch (err) {
  // e.g. a missing key, missing tenant config or credentials: refuse clearly
  console.error(`\n⛔ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
