// ============================================================
// MICROSOFT GRAPH LAYER (the door into Entra ID)
// ============================================================
// "Graph" here means Microsoft Graph, Microsoft's API for Entra
// users and groups. (Not LangGraph, the agent framework.)
//
// One interface, two implementations:
//   MockGraph  a fake tenant in a local file. The DEFAULT.
//   RealGraph  the real TinyCoDDG tenant. Only with --graph real.
//
// WHY mock by default: a missed flag can never touch the real
// directory. Same idea as the exit_node_enabled switch.
//
// LEAST PRIVILEGE: every call here maps to one of five
// application permissions. No delete call exists, and the app is
// never granted a delete permission, so users can't be deleted
// even by mistake. Group membership is checked from the GROUP
// side, because listing a user's groups needs Directory.Read.All,
// which is far broader than this agent needs.
// ============================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface GraphUser {
  id: string;
  displayName: string;
  upn: string;
  accountEnabled: boolean;
}

export interface TenantConfig {
  domain: string;
  groups: {
    teams: Record<string, string>; // team name -> static group object ID
    managed: string;               // scope marker: users JML created
    terminated: string;            // leavers land here (audit, legal hold)
    protected: string[];           // break-glass and admin groups: never touched (nested members too)
  };
}

// Every group write reports what it actually did, so nothing that was
// "already done" is ever shown as a change (and nothing is silent)
export type WriteResult = "changed" | "unchanged";

export interface GraphClient {
  label: string;
  getUser(upn: string): Promise<GraphUser | null>;                // User.Read.All
  listMemberIds(groupId: string): Promise<string[]>;              // GroupMember.ReadWrite.All (direct members)
  listTransitiveMemberIds(groupId: string): Promise<string[]>;    // GroupMember.ReadWrite.All (nested too)
  createUser(u: { displayName: string; upn: string; password: string }): Promise<{ id: string }>; // User.Create
  addMember(groupId: string, userId: string): Promise<WriteResult>;    // GroupMember.ReadWrite.All
  removeMember(groupId: string, userId: string): Promise<WriteResult>; // GroupMember.ReadWrite.All
  setAccountEnabled(userId: string, enabled: boolean): Promise<void>; // User.EnableDisableAccount.All
  revokeSessions(userId: string): Promise<void>;                  // User.RevokeSessions.All
}

// ------------------------------------------------------------
// TENANT CONFIG: checked at runtime, never just cast. A config
// that is incomplete, or whose protected list is empty or holds
// anything but group IDs, refuses to load (fails closed): an
// empty protected list would silently protect no one.
// ------------------------------------------------------------
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTenantConfig(raw: unknown, isGroupId: (id: string) => boolean, source: string): TenantConfig {
  const bad = (why: string): never => {
    throw new Error(`Refusing to use the ${source}: ${why}.`);
  };
  const c = raw as { domain?: unknown; groups?: Record<string, unknown> } | null;
  if (typeof c?.domain !== "string" || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(c.domain)) bad("the domain is missing or malformed");
  const g = c!.groups;
  if (!g || typeof g !== "object") return bad("groups are missing");
  const groupId = (v: unknown, what: string): string =>
    typeof v === "string" && isGroupId(v) ? v : bad(`${what} is not a valid group ID`);
  const managed = groupId(g.managed, "groups.managed");
  const terminated = groupId(g.terminated, "groups.terminated");
  if (!Array.isArray(g.protected) || g.protected.length === 0) bad("groups.protected is empty (it would protect no one)");
  const prot = (g.protected as unknown[]).map((v, i) => groupId(v, `groups.protected[${i}]`));
  const teamsRaw = g.teams;
  if (!teamsRaw || typeof teamsRaw !== "object" || Array.isArray(teamsRaw)) return bad("groups.teams is missing");
  const teams: Record<string, string> = {};
  for (const [name, id] of Object.entries(teamsRaw)) teams[name] = groupId(id, `groups.teams.${name}`);
  if (Object.keys(teams).length === 0) bad("groups.teams is empty");
  return { domain: c!.domain as string, groups: { teams, managed, terminated, protected: prot } };
}

// ------------------------------------------------------------
// MOCK TENANT
// ------------------------------------------------------------
const FIXTURE = new URL("./mock-tenant.json", import.meta.url);
const STATE = new URL("./.mock-state.json", import.meta.url);

interface MockState {
  domain: string;
  groups: TenantConfig["groups"];
  users: GraphUser[];
  // group id -> member ids. A member id that is itself a group id is a
  // nested group, the way Entra nests security groups.
  memberships: Record<string, string[]>;
}

const MOCK_GROUP_ID = /^mock-grp-[a-z0-9-]+$/;

export function loadMockConfig(): TenantConfig {
  return parseTenantConfig(JSON.parse(readFileSync(FIXTURE, "utf8")), (id) => MOCK_GROUP_ID.test(id), "mock tenant");
}

export function resetMockTenant(): void {
  writeFileSync(STATE, readFileSync(FIXTURE, "utf8"));
}

export class MockGraph implements GraphClient {
  label = "MOCK tenant (local file, no Entra)";
  private s: MockState;
  private persist: boolean;
  failOn?: string; // tests only: make one method fail, to prove stop-on-error

  constructor(opts: { persist?: boolean; state?: MockState } = {}) {
    this.persist = opts.persist ?? true;
    const source = opts.state ?? JSON.parse(readFileSync(existsSync(STATE) && this.persist ? STATE : FIXTURE, "utf8"));
    this.s = structuredClone(source);
    this.s.memberships ??= {};
  }

  private save() {
    if (this.persist) writeFileSync(STATE, JSON.stringify(this.s, null, 2));
  }
  private maybeFail(method: string) {
    if (this.failOn === method) throw new Error(`Simulated Graph failure in ${method}`);
  }

  async getUser(upn: string) {
    return structuredClone(this.s.users.find((u) => u.upn.toLowerCase() === upn.toLowerCase()) ?? null);
  }
  async listMemberIds(groupId: string) {
    return [...(this.s.memberships[groupId] ?? [])];
  }
  // Every member, through any depth of nested groups (cycles are safe)
  async listTransitiveMemberIds(groupId: string) {
    const seen = new Set<string>();
    const queue = [groupId];
    while (queue.length > 0) {
      for (const m of this.s.memberships[queue.shift()!] ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m in this.s.memberships) queue.push(m); // a nested group
      }
    }
    return [...seen];
  }
  async createUser(u: { displayName: string; upn: string; password: string }) {
    this.maybeFail("createUser");
    const id = `mock-user-${u.upn.split("@")[0]}`;
    this.s.users.push({ id, displayName: u.displayName, upn: u.upn, accountEnabled: true });
    this.save();
    return { id };
  }
  async addMember(groupId: string, userId: string): Promise<WriteResult> {
    this.maybeFail("addMember");
    const list = (this.s.memberships[groupId] ??= []);
    if (list.includes(userId)) return "unchanged";
    list.push(userId);
    this.save();
    return "changed";
  }
  async removeMember(groupId: string, userId: string): Promise<WriteResult> {
    this.maybeFail("removeMember");
    const list = this.s.memberships[groupId] ?? [];
    if (!list.includes(userId)) return "unchanged";
    this.s.memberships[groupId] = list.filter((id) => id !== userId);
    this.save();
    return "changed";
  }
  async setAccountEnabled(userId: string, enabled: boolean) {
    this.maybeFail("setAccountEnabled");
    const u = this.s.users.find((x) => x.id === userId);
    if (!u) throw new Error("User not found");
    u.accountEnabled = enabled;
    this.save();
  }
  async revokeSessions(userId: string) {
    this.maybeFail("revokeSessions");
    if (!this.s.users.some((x) => x.id === userId)) throw new Error("User not found");
  }
}

// ------------------------------------------------------------
// REAL TENANT (Microsoft Graph v1.0, app-only)
// ------------------------------------------------------------
// Auth: OAuth 2.0 client credentials. The app's own identity
// (wshc-agent-jml) signs in; no user password is involved.
// Roadmap: certificate, then managed identity (no secret at all).
// ------------------------------------------------------------
const GRAPH = "https://graph.microsoft.com/v1.0";
const LOCAL_CONFIG = new URL("./tenant.local.json", import.meta.url);

export function loadRealConfig(file: URL | string = LOCAL_CONFIG): TenantConfig {
  if (!existsSync(file)) {
    throw new Error("Refusing to use the real tenant: jml/tenant.local.json is missing (see the JML setup steps).");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("Refusing to use the real tenant: jml/tenant.local.json is not valid JSON.");
  }
  // Real group object IDs are GUIDs: anything else is a mistake
  return parseTenantConfig(raw, (id) => GUID.test(id), "real tenant (jml/tenant.local.json)");
}

// ------------------------------------------------------------
// EVENTUAL CONSISTENCY (found on the first real run, Sep 29)
// ------------------------------------------------------------
// Entra is eventually consistent, and app-only requests (like
// this agent's) get NO read-after-write consistency: a read right
// after a write can return old data. So every write here is made
// safe to repeat:
//   - adding someone who is already a member counts as success
//   - removing someone who isn't a member counts as success
//   - "object doesn't exist yet" (not replicated) is retried
//     briefly, as Microsoft's docs recommend
// The planner's stale-plan check is the other half: a plan built
// on stale reads is never run without a fresh approval.
//
// THROTTLING: a 429 (or a 503) is retried a few times, waiting the
// number of seconds in Retry-After, as Microsoft's throttling
// guidance says. https://learn.microsoft.com/en-us/graph/throttling
// Every request also has a timeout, so a hung call can't hang the run.
// ------------------------------------------------------------
const NOT_REPLICATED = /(does not|doesn't|don't|do not) exist/i;
const ALREADY_MEMBER = /already exist/i;
export const GRAPH_TIMEOUT_MS = 15_000;

export class RealGraph implements GraphClient {
  label = "REAL tenant (Microsoft Graph)";
  static retryDelaysMs = [2000, 5000]; // tests set these to 0
  static throttleRetries = 3;
  static maxThrottleWaitMs = 60_000; // never wait longer than this on one Retry-After
  static sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)); // tests record instead
  private token?: { value: string; expires: number };
  private tenantId = process.env.ENTRA_TENANT_ID;
  private clientId = process.env.ENTRA_CLIENT_ID;
  private secret = process.env.ENTRA_CLIENT_SECRET;

  constructor() {
    if (!this.tenantId || !this.clientId || !this.secret) {
      throw new Error("Refusing to use the real tenant: ENTRA_TENANT_ID, ENTRA_CLIENT_ID or ENTRA_CLIENT_SECRET is not set.");
    }
  }

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.token.expires) return this.token.value;
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(this.tenantId!)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId!,
        client_secret: this.secret!,
        scope: "https://graph.microsoft.com/.default",
      }),
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Sign-in failed (${res.status}). Check the app registration and secret.`);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new Error("Sign-in returned an unexpected response.");
    }
    this.token = { value: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };
    return this.token.value;
  }

  // One request, with a timeout, retried on 429/503 after Retry-After
  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${GRAPH}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.auth()}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
      if ((res.status !== 429 && res.status !== 503) || attempt >= RealGraph.throttleRetries) return res;
      const seconds = Number(res.headers.get("Retry-After"));
      const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2 ** attempt * 1000;
      await res.body?.cancel();
      await RealGraph.sleep(Math.min(wait, RealGraph.maxThrottleWaitMs));
    }
  }

  private async errorMessage(res: Response): Promise<string> {
    try {
      return ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      return ""; // no body
    }
  }

  private async fail(res: Response, what: string): Promise<never> {
    const detail = await this.errorMessage(res);
    throw new Error(`${what} failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }

  // A write that is safe to repeat: "already done" counts as success,
  // and "not replicated yet" is retried after a short wait
  private async write(
    method: string,
    path: string,
    body: unknown,
    what: string,
    alreadyDone?: (status: number, message: string) => Promise<boolean> | boolean,
  ): Promise<WriteResult> {
    const delays = RealGraph.retryDelaysMs;
    for (let attempt = 0; ; attempt++) {
      const res = await this.call(method, path, body);
      if (res.ok) return "changed";
      const message = await this.errorMessage(res);
      if (await alreadyDone?.(res.status, message)) return "unchanged";
      const retryable = (res.status === 400 || res.status === 404) && NOT_REPLICATED.test(message);
      if (retryable && attempt < delays.length) {
        await RealGraph.sleep(delays[attempt]!);
        continue;
      }
      throw new Error(`${what} failed (${res.status})${message ? `: ${message}` : ""}`);
    }
  }

  async getUser(upn: string) {
    const res = await this.call("GET", `/users/${encodeURIComponent(upn)}?$select=id,displayName,userPrincipalName,accountEnabled`);
    if (res.status === 404) return null;
    if (!res.ok) return this.fail(res, "Reading the user");
    const u = (await res.json()) as Record<string, unknown>;
    if (typeof u.id !== "string" || typeof u.userPrincipalName !== "string" || typeof u.accountEnabled !== "boolean") {
      throw new Error("Reading the user returned an unexpected response.");
    }
    return { id: u.id, displayName: String(u.displayName ?? ""), upn: u.userPrincipalName, accountEnabled: u.accountEnabled };
  }

  // Pages through @odata.nextLink. A next link that points anywhere
  // but Graph is refused: this client's token never leaves Graph.
  private async listIds(firstPath: string, what: string): Promise<string[]> {
    const ids: string[] = [];
    let path: string | undefined = firstPath;
    while (path) {
      const res = await this.call("GET", path);
      if (!res.ok) return this.fail(res, what);
      const page = (await res.json()) as { value?: { id?: unknown }[]; "@odata.nextLink"?: unknown };
      if (!Array.isArray(page.value)) throw new Error(`${what} returned an unexpected response.`);
      for (const m of page.value) if (typeof m.id === "string") ids.push(m.id);
      const next = page["@odata.nextLink"];
      if (next === undefined) break;
      if (typeof next !== "string" || !next.startsWith(`${GRAPH}/`)) throw new Error(`${what}: refusing a next page outside Microsoft Graph.`);
      path = next.slice(GRAPH.length);
    }
    return ids;
  }

  async listMemberIds(groupId: string) {
    return this.listIds(`/groups/${encodeURIComponent(groupId)}/members?$select=id&$top=999`, "Reading group members");
  }

  // Direct AND nested members, so an admin who is protected through a
  // nested group is still protected
  // https://learn.microsoft.com/en-us/graph/api/group-list-transitivemembers?view=graph-rest-1.0
  async listTransitiveMemberIds(groupId: string) {
    return this.listIds(`/groups/${encodeURIComponent(groupId)}/transitiveMembers?$select=id&$top=999`, "Reading nested group members");
  }

  async createUser(u: { displayName: string; upn: string; password: string }) {
    const res = await this.call("POST", "/users", {
      accountEnabled: true,
      displayName: u.displayName,
      mailNickname: u.upn.split("@")[0]!.replace(/[^A-Za-z0-9]/g, ""),
      userPrincipalName: u.upn,
      passwordProfile: { forceChangePasswordNextSignIn: true, password: u.password },
    });
    if (!res.ok) return this.fail(res, "Creating the user");
    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id !== "string") throw new Error("Creating the user returned no id.");
    return { id: body.id };
  }

  async addMember(groupId: string, userId: string): Promise<WriteResult> {
    return this.write(
      "POST",
      `/groups/${encodeURIComponent(groupId)}/members/$ref`,
      { "@odata.id": `${GRAPH}/directoryObjects/${encodeURIComponent(userId)}` },
      "Adding to the group",
      (status, message) => status === 400 && ALREADY_MEMBER.test(message), // already a member
    );
  }

  // A 404 on removal can mean "not a member" (already done) or "no
  // such group" (a real error). The two are told apart by reading the
  // group: if it exists, the 404 was about the membership. The user id
  // came from a fresh read, so a missing user is also "not a member".
  async removeMember(groupId: string, userId: string): Promise<WriteResult> {
    return this.write(
      "DELETE",
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/$ref`,
      undefined,
      "Removing from the group",
      async (status) => {
        if (status !== 404) return false;
        const probe = await this.call("GET", `/groups/${encodeURIComponent(groupId)}/members?$select=id&$top=1`);
        await probe.body?.cancel();
        return probe.ok;
      },
    );
  }

  // Setting the same value twice, or revoking twice, is already harmless;
  // these only need the "not replicated yet" retry
  async setAccountEnabled(userId: string, enabled: boolean) {
    await this.write("PATCH", `/users/${encodeURIComponent(userId)}`, { accountEnabled: enabled },
      enabled ? "Enabling the account" : "Disabling the account");
  }

  async revokeSessions(userId: string) {
    await this.write("POST", `/users/${encodeURIComponent(userId)}/revokeSignInSessions`, undefined, "Revoking sign-in sessions");
  }
}
