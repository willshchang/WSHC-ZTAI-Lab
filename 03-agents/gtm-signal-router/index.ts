// ============================================================
// GTM SIGNAL ROUTER: ENTRY POINT
// ============================================================
// Usage:
//   npm run gtm -- --signup harbor-health          (real Claude)
//   npm run gtm:mock -- --signup harbor-health     (scripted, no API)
//   npm run gtm -- --list                          (show signup ids)
// ============================================================

import { runGtm } from "./agent.ts";
import { signups } from "./scoring.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("list")) {
  console.log("Signups:");
  for (const s of signups) console.log(`  ${s.id.padEnd(20)} ${s.company}`);
  process.exit(0);
}

const signupId = value("signup") ?? signups[0]!.id;
if (!signups.some((s) => s.id === signupId)) {
  console.error(`Unknown signup "${signupId}". Run with --list to see ids.`);
  process.exit(1);
}

try {
  await runGtm({ task: `Route this new signup. signup_id: ${signupId}`, mock: flag("mock") });
} catch (err) {
  // e.g. the agent's own API key is missing: refuse clearly, no stack trace
  console.error(`\n⛔ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

