// ============================================================
// TEST: real Graph writes are safe to repeat (fetch is stubbed)
// ============================================================
// Entra is eventually consistent, and app-only requests get no
// read-after-write consistency, so a plan can be built on stale
// data. These tests prove the real Graph client:
//   - treats "already a member" as success, reported "unchanged"
//   - treats "not a member" on removal as success, reported "unchanged"
//   - reports a real write as "changed" (so the card never lies)
//   - retries "not replicated yet" and then succeeds
//   - still fails loudly on a real error (so nothing is hidden)
//   - waits out throttling (429/503 + Retry-After), within limits
//   - reads protected groups transitively, across every page
// No network: fetch is replaced by a scripted fake.
// ============================================================

process.env.ENTRA_TENANT_ID = "test-tenant";
process.env.ENTRA_CLIENT_ID = "test-client";
process.env.ENTRA_CLIENT_SECRET = "test-secret";

const { RealGraph } = await import("../jml/graph.ts");
RealGraph.retryDelaysMs = [0, 0];
RealGraph.sleep = async () => {};

type Reply = { status: number; message?: string; retryAfter?: string };
let script: Reply[] = [];
let pages: Record<string, unknown>[] = []; // list responses, in order
const paths: string[] = [];
const signals: boolean[] = [];
let calls = 0;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  signals.push(init?.signal instanceof AbortSignal);
  if (String(url).includes("login.microsoftonline.com")) {
    return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
  }
  calls++;
  paths.push(String(url));
  if (pages.length > 0 && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify(pages.shift()), { status: 200 });
  const r = script.shift() ?? { status: 204 };
  const body = r.message ? JSON.stringify({ error: { message: r.message } }) : null;
  return new Response(body, { status: r.status, headers: r.retryAfter ? { "Retry-After": r.retryAfter } : {} });
}) as typeof fetch;

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "OK" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};
const run = async (fn: () => Promise<unknown>) => {
  try {
    const r = await fn();
    return r === undefined ? "ok" : String(r);
  } catch (e) {
    return String(e);
  }
};

const g = new RealGraph();

script = [{ status: 400, message: "One or more added object references already exist for the following modified properties: 'members'." }];
check((await run(() => g.addMember("grp", "usr"))) === "unchanged", "adding someone who is already a member counts as success, reported as no change");

script = [{ status: 404, message: "Resource not found" }];
check((await run(() => g.removeMember("grp", "usr"))) === "unchanged", "removing someone who isn't a member counts as success, reported as no change");

script = [{ status: 204 }];
check((await run(() => g.addMember("grp", "usr"))) === "changed", "a real add is reported as a change");

script = [{ status: 204 }];
check((await run(() => g.removeMember("grp", "usr"))) === "changed", "a real removal is reported as a change");

script = [{ status: 400, message: "The source resource object or one of the objects being referenced don't exist." }, { status: 204 }];
calls = 0;
check((await run(() => g.addMember("grp", "usr"))) === "changed" && calls === 2, "'not replicated yet' is retried, then succeeds as a change");

script = [{ status: 404, message: "Resource 'usr' does not exist or one of its queried reference-property objects are not present." }, { status: 204 }];
calls = 0;
check((await run(() => g.setAccountEnabled("usr", false))) === "ok" && calls === 2, "disabling a just-created user retries until it has replicated");

script = [
  { status: 400, message: "objects being referenced don't exist." },
  { status: 400, message: "objects being referenced don't exist." },
  { status: 400, message: "objects being referenced don't exist." },
];
calls = 0;
const gaveUp = await run(() => g.addMember("grp", "usr"));
check(gaveUp.includes("failed (400)") && calls === 3, "retries are limited, then it fails loudly");

script = [{ status: 403, message: "Insufficient privileges to complete the operation." }];
const forbidden = await run(() => g.addMember("grp", "usr"));
check(forbidden.includes("failed (403)"), "a real error (403) is never swallowed");

script = [{ status: 400, message: "Invalid object identifier 'x'." }];
const other400 = await run(() => g.addMember("grp", "usr"));
check(other400.includes("failed (400)"), "an unrelated 400 is not mistaken for 'already a member'");

// ---- A 404 on removal is "not a member" only if the group exists -----
script = [{ status: 404, message: "Resource not found" }, { status: 404, message: "Resource 'grp' does not exist" }];
const noGroup = await run(() => g.removeMember("grp", "usr"));
check(noGroup.includes("failed (404)"), "a 404 for a group that doesn't exist is a real error, not 'already removed'");

// ---- Throttling: 429 waits Retry-After, then retries (bounded) --------
const waits: number[] = [];
RealGraph.sleep = async (ms: number) => { waits.push(ms); };
script = [{ status: 429, retryAfter: "7" }, { status: 204 }];
calls = 0;
check((await run(() => g.addMember("grp", "usr"))) === "changed" && calls === 2 && waits[0] === 7000, "a 429 waits the Retry-After seconds, then retries and succeeds");
waits.length = 0;
script = [{ status: 503 }, { status: 204 }];
calls = 0;
check((await run(() => g.revokeSessions("usr"))) === "ok" && calls === 2 && waits.length === 1, "a 503 is retried too");
waits.length = 0;
script = [{ status: 429, retryAfter: "1" }, { status: 429, retryAfter: "1" }, { status: 429, retryAfter: "1" }, { status: 429, retryAfter: "1" }, { status: 429, retryAfter: "1" }];
calls = 0;
const throttled = await run(() => g.addMember("grp", "usr"));
check(throttled.includes("failed (429)") && calls === RealGraph.throttleRetries + 1, "throttling retries are bounded, then it fails loudly");
script = [{ status: 429, retryAfter: "86400" }, { status: 204 }];
waits.length = 0;
await run(() => g.addMember("grp", "usr"));
check(waits[0] === RealGraph.maxThrottleWaitMs, "a huge Retry-After is capped");

// ---- Every Graph request carries a timeout -----------------------------
check(signals.length > 0 && signals.every(Boolean), "every Graph and sign-in request has an abort signal (timeout)");

// ---- Protected groups: nested members, every page --------------------
pages = [
  { value: [{ id: "u1" }, { id: "grp-nested" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/groups/g/transitiveMembers?$skiptoken=abc" },
  { value: [{ id: "u2" }] },
];
paths.length = 0;
const ids = await g.listTransitiveMemberIds("g");
check(ids.join() === "u1,grp-nested,u2", "transitive members are read across every page");
check(paths[0]?.includes("/groups/g/transitiveMembers?$select=id") === true && paths[1]?.includes("$skiptoken=abc") === true,
  "protected-group checks use /transitiveMembers and follow @odata.nextLink");
pages = [{ value: [{ id: "u1" }], "@odata.nextLink": "https://evil.example/steal?token" }];
check((await run(() => g.listTransitiveMemberIds("g"))).includes("outside Microsoft Graph"), "a next link that leaves Microsoft Graph is refused (the token stays on Graph)");
pages = [];

process.exit(failures ? 1 : 0);
