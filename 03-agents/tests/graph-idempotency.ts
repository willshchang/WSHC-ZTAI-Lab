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
// No network: fetch is replaced by a scripted fake.
// ============================================================

process.env.ENTRA_TENANT_ID = "test-tenant";
process.env.ENTRA_CLIENT_ID = "test-client";
process.env.ENTRA_CLIENT_SECRET = "test-secret";

const { RealGraph } = await import("../jml/graph.ts");
RealGraph.retryDelaysMs = [0, 0];

type Reply = { status: number; message?: string };
let script: Reply[] = [];
let calls = 0;
globalThis.fetch = (async (url: string | URL) => {
  if (String(url).includes("login.microsoftonline.com")) {
    return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
  }
  calls++;
  const r = script.shift() ?? { status: 204 };
  const body = r.message ? JSON.stringify({ error: { message: r.message } }) : null;
  return new Response(body, { status: r.status });
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

process.exit(failures ? 1 : 0);
