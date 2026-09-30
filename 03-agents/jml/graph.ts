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
    protected: string[];           // break-glass and admin groups: never touched
  };
}

// Every group write reports what it actually did, so nothing that was
// "already done" is ever shown as a change (and nothing is silent)
export type WriteResult = "changed" | "unchanged";

export interface GraphClient {
  label: string;
  getUser(upn: string): Promise<GraphUser | null>;                // User.Read.All
  listMemberIds(groupId: string): Promise<string[]>;              // GroupMember.ReadWrite.All
  createUser(u: { displayName: string; upn: string; password: string }): Promise<{ id: string }>; // User.Create
  addMember(groupId: string, userId: string): Promise<WriteResult>;    // GroupMember.ReadWrite.All
  removeMember(groupId: string, userId: string): Promise<WriteResult>; // GroupMember.ReadWrite.All
  setAccountEnabled(userId: string, enabled: boolean): Promise<void>; // User.EnableDisableAccount.All
  revokeSessions(userId: string): Promise<void>;                  // User.RevokeSessions.All
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
  memberships: Record<string, string[]>;
}

export function loadMockConfig(): TenantConfig {
  const f = JSON.parse(readFileSync(FIXTURE, "utf8")) as MockState;
  return { domain: f.domain, groups: f.groups };
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

export function loadRealConfig(): TenantConfig {
  if (!existsSync(LOCAL_CONFIG)) {
    throw new Error("Refusing to use the real tenant: jml/tenant.local.json is missing (see the JML setup steps).");
  }
  const c = JSON.parse(readFileSync(LOCAL_CONFIG, "utf8")) as TenantConfig;
  const g = c?.groups;
  if (!c?.domain || !g?.managed || !g?.terminated || !g?.teams || Object.keys(g.teams).length === 0 || !Array.isArray(g.protected)) {
    throw new Error("Refusing to use the real tenant: jml/tenant.local.json is incomplete.");
  }
  return c;
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
// ------------------------------------------------------------
const NOT_REPLICATED = /(does not|doesn't|don't|do not) exist/i;
const ALREADY_MEMBER = /already exist/i;

export class RealGraph implements GraphClient {
  label = "REAL tenant (Microsoft Graph)";
  static retryDelaysMs = [2000, 5000]; // tests set these to 0
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
    const res = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId!,
        client_secret: this.secret!,
        scope: "https://graph.microsoft.com/.default",
      }),
    });
    if (!res.ok) throw new Error(`Sign-in failed (${res.status}). Check the app registration and secret.`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };
    return this.token.value;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.auth()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
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
    alreadyDone?: (status: number, message: string) => boolean,
  ): Promise<WriteResult> {
    const delays = RealGraph.retryDelaysMs;
    for (let attempt = 0; ; attempt++) {
      const res = await this.call(method, path, body);
      if (res.ok) return "changed";
      const message = await this.errorMessage(res);
      if (alreadyDone?.(res.status, message)) return "unchanged";
      const retryable = (res.status === 400 || res.status === 404) && NOT_REPLICATED.test(message);
      if (retryable && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      throw new Error(`${what} failed (${res.status})${message ? `: ${message}` : ""}`);
    }
  }

  async getUser(upn: string) {
    const res = await this.call("GET", `/users/${encodeURIComponent(upn)}?$select=id,displayName,userPrincipalName,accountEnabled`);
    if (res.status === 404) return null;
    if (!res.ok) return this.fail(res, "Reading the user");
    const u = (await res.json()) as { id: string; displayName: string; userPrincipalName: string; accountEnabled: boolean };
    return { id: u.id, displayName: u.displayName, upn: u.userPrincipalName, accountEnabled: u.accountEnabled };
  }

  async listMemberIds(groupId: string) {
    const ids: string[] = [];
    let path: string | undefined = `/groups/${groupId}/members?$select=id&$top=999`;
    while (path) {
      const res = await this.call("GET", path);
      if (!res.ok) return this.fail(res, "Reading group members");
      const page = (await res.json()) as { value: { id: string }[]; "@odata.nextLink"?: string };
      ids.push(...page.value.map((m) => m.id));
      path = page["@odata.nextLink"]?.replace(GRAPH, "");
    }
    return ids;
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
    return { id: ((await res.json()) as { id: string }).id };
  }

  async addMember(groupId: string, userId: string): Promise<WriteResult> {
    return this.write(
      "POST",
      `/groups/${groupId}/members/$ref`,
      { "@odata.id": `${GRAPH}/directoryObjects/${userId}` },
      "Adding to the group",
      (status, message) => status === 400 && ALREADY_MEMBER.test(message), // already a member
    );
  }

  async removeMember(groupId: string, userId: string): Promise<WriteResult> {
    return this.write(
      "DELETE",
      `/groups/${groupId}/members/${userId}/$ref`,
      undefined,
      "Removing from the group",
      (status) => status === 404, // not a member any more
    );
  }

  // Setting the same value twice, or revoking twice, is already harmless;
  // these only need the "not replicated yet" retry
  async setAccountEnabled(userId: string, enabled: boolean) {
    await this.write("PATCH", `/users/${userId}`, { accountEnabled: enabled },
      enabled ? "Enabling the account" : "Disabling the account");
  }

  async revokeSessions(userId: string) {
    await this.write("POST", `/users/${userId}/revokeSignInSessions`, undefined, "Revoking sign-in sessions");
  }
}
