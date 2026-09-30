// ============================================================
// AGENT REGISTRY
// ============================================================
// The map Scarlet routes with. Two parts, kept apart on purpose:
//   agents.json   what each agent handles and the task it accepts
//                 (knowledge: reviewed in git, safe to show her)
//   RUNNERS       the code that starts each agent (can't be data)
//
// WHY a separate knowledge file: adding an agent is one JSON entry
// plus one runner, and every change is visible in a reviewed PR.
// Knowledge is NOT permission: who Scarlet may hand work to is set
// only by her policy's allowlist.
//
// FAILS CLOSED: if the file is malformed, or names an agent with no
// runner, loading throws and Scarlet refuses to start. She never
// routes with a broken map.
// ============================================================

import { readFileSync } from "node:fs";
import type { RunResult } from "../core/agent.ts";
import type { ParentRef } from "../core/types.ts";
import { runGtm } from "../gtm-signal-router/agent.ts";
import { runJml, type GraphMode } from "../jml/agent.ts";

export interface RunnerOpts {
  mock: boolean;
  parent: ParentRef;
  graph: GraphMode; // Microsoft Graph: "mock" unless Will explicitly passes --graph real
}
type Runner = (task: string, opts: RunnerOpts) => Promise<RunResult>;

// The only code that knows how to start each agent
const RUNNERS: Record<string, Runner> = {
  "agent-gtm-signal-router": (task, opts) => runGtm({ task, mock: opts.mock, parent: opts.parent }),
  "agent-jml": (task, opts) => runJml({ task, mock: opts.mock, graph: opts.graph, parent: opts.parent }),
};

export interface AgentEntry {
  id: string;
  name: string;
  handles: string;
  taskFormat: string;
  taskPattern: RegExp; // the contract: a task must match this exactly
  idFormat: string;
  // What a request for this agent can look like (its ids and action
  // words). The chat tool refuses any message that matches, so small
  // talk can never swallow a real request. Knowledge, reviewed in git.
  requestPattern: RegExp;
  examples: { request: string; action: string }[];
  run: Runner;
}

const FILE = new URL("./agents.json", import.meta.url);

// `file` is only overridden by tests, to prove a bad directory fails closed
export function loadRegistry(file: URL | string = FILE): AgentEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Refusing to start: agents.json could not be read (${(err as Error).message})`);
  }

  const fail = (why: string): never => {
    throw new Error(`Refusing to start: agents.json is invalid (${why})`);
  };
  const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

  const list = (raw as { agents?: unknown })?.agents;
  if (!Array.isArray(list) || list.length === 0) fail("no agents listed");

  const seen = new Set<string>();
  return (list as Record<string, unknown>[]).map((a, i) => {
    for (const key of ["id", "name", "handles", "taskFormat", "taskPattern", "idFormat", "requestPattern"]) {
      if (!isText(a[key])) fail(`agent #${i + 1} is missing "${key}"`);
    }
    const id = a.id as string;
    if (seen.has(id)) fail(`"${id}" is listed twice`);
    seen.add(id);

    const run = RUNNERS[id];
    if (!run) fail(`"${id}" has no runner in code`);

    let taskPattern: RegExp;
    try {
      taskPattern = new RegExp(a.taskPattern as string);
    } catch {
      return fail(`"${id}" has a broken taskPattern`);
    }
    let requestPattern: RegExp;
    try {
      requestPattern = new RegExp(a.requestPattern as string, "i");
    } catch {
      return fail(`"${id}" has a broken requestPattern`);
    }

    const examples = Array.isArray(a.examples)
      ? (a.examples as { request: string; action: string }[]).filter((e) => isText(e?.request) && isText(e?.action))
      : [];

    return {
      id,
      name: a.name as string,
      handles: a.handles as string,
      taskFormat: a.taskFormat as string,
      taskPattern,
      idFormat: a.idFormat as string,
      requestPattern,
      examples,
      run: run!,
    };
  });
}
