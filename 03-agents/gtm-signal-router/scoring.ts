// ============================================================
// ACCOUNT SCORING (deterministic, no AI)
// ============================================================
// WHY plain code instead of the model: the score must be cheap,
// repeatable and testable. The same signup always gets the same
// number, and anyone can read exactly why. The model's job is to
// reason about the result and decide what to do, not to invent
// the number. Least privilege for compute: code does what code
// can do; the model only does the judgement.
// ============================================================

import signupsData from "./signups.json" with { type: "json" };

export type Route = "sales" | "nurture" | "self_serve";

export interface Signup {
  id: string;
  company: string;
  contact_email: string;
  email_domain_type: "company" | "personal";
  team_size: number | null;
  builds_last_7d: number | null;
  eas_update_enabled: boolean | null;
  store_submissions_30d: number | null;
  plan: "free" | "starter" | "production" | "enterprise" | null;
  notes: string;
}

// ------------------------------------------------------------
// RUNTIME CHECK, NOT A CAST: signups are customer-supplied data.
// A record with a wrong type (a team size of "lots", a plan we don't
// score) is refused at load, instead of flowing into the score.
// ------------------------------------------------------------
const PLANS = ["free", "starter", "production", "enterprise"];
const SIGNUP_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseSignups(raw: unknown): Signup[] {
  if (!Array.isArray(raw)) throw new Error("signups.json must be a list");
  return raw.map((r: unknown, i) => {
    const bad = (why: string): never => {
      throw new Error(`signups.json record #${i + 1} is invalid: ${why}`);
    };
    if (typeof r !== "object" || r === null) return bad("not an object");
    const s = r as Record<string, unknown>;
    const text = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : bad(`${k} must be text`));
    const countOrNull = (k: string) =>
      s[k] === null || (typeof s[k] === "number" && Number.isInteger(s[k]) && (s[k] as number) >= 0)
        ? (s[k] as number | null)
        : bad(`${k} must be a whole number or null`);
    const id = text("id");
    if (!SIGNUP_ID.test(id)) bad(`id "${id}" is not lowercase words joined by hyphens`);
    const domainType = text("email_domain_type");
    if (domainType !== "company" && domainType !== "personal") bad("email_domain_type must be company or personal");
    const eas = s.eas_update_enabled;
    if (eas !== null && typeof eas !== "boolean") bad("eas_update_enabled must be true, false or null");
    const plan = s.plan;
    if (plan !== null && !(typeof plan === "string" && PLANS.includes(plan))) bad(`plan must be one of ${PLANS.join(", ")} or null`);
    return {
      id,
      company: text("company"),
      contact_email: text("contact_email"),
      email_domain_type: domainType as Signup["email_domain_type"],
      team_size: countOrNull("team_size"),
      builds_last_7d: countOrNull("builds_last_7d"),
      eas_update_enabled: eas as boolean | null,
      store_submissions_30d: countOrNull("store_submissions_30d"),
      plan: plan as Signup["plan"],
      notes: text("notes"),
    };
  });
}

export const signups = parseSignups(signupsData);

export function findSignup(id: string): Signup | undefined {
  return signups.find((s) => s.id === id);
}

// Thresholds: score at or above -> route
export const SALES_THRESHOLD = 70;
export const NURTURE_THRESHOLD = 40;

// Most points each signal can contribute (they add up to 100)
const MAX_POINTS = {
  builds_last_7d: 30,
  team_size: 25,
  store_submissions_30d: 15,
  eas_update_enabled: 10,
  email_domain_type: 10,
  plan: 10,
} as const;

type SignalName = keyof typeof MAX_POINTS;

function points(signal: SignalName, s: Signup): number | null {
  switch (signal) {
    case "builds_last_7d": {
      const v = s.builds_last_7d;
      if (v === null) return null;
      return v >= 100 ? 30 : v >= 30 ? 20 : v >= 5 ? 10 : 0;
    }
    case "team_size": {
      const v = s.team_size;
      if (v === null) return null;
      return v >= 25 ? 25 : v >= 8 ? 15 : v >= 3 ? 8 : 2;
    }
    case "store_submissions_30d": {
      const v = s.store_submissions_30d;
      if (v === null) return null;
      return v >= 4 ? 15 : v >= 1 ? 8 : 0;
    }
    case "eas_update_enabled":
      return s.eas_update_enabled === null ? null : s.eas_update_enabled ? 10 : 0;
    case "email_domain_type":
      return s.email_domain_type === "company" ? 10 : 0;
    case "plan":
      if (s.plan === null) return null;
      return s.plan === "production" || s.plan === "enterprise" ? 10 : s.plan === "starter" ? 5 : 0;
  }
}

export function routeFor(score: number): Route {
  if (score >= SALES_THRESHOLD) return "sales";
  if (score >= NURTURE_THRESHOLD) return "nurture";
  return "self_serve";
}

export interface ScoreResult {
  signup_id: string;
  score: number;
  best_case_score: number;       // if every missing signal had scored full points
  recommended_route: Route;
  best_case_route: Route;
  route_uncertain: boolean;      // missing data could change the route
  missing_signals: string[];
  breakdown: Record<string, number | "missing">;
}

export function scoreAccount(s: Signup): ScoreResult {
  const breakdown: Record<string, number | "missing"> = {};
  const missing: string[] = [];
  let score = 0;
  let bestCase = 0;

  for (const signal of Object.keys(MAX_POINTS) as SignalName[]) {
    const p = points(signal, s);
    if (p === null) {
      breakdown[signal] = "missing";
      missing.push(signal);
      bestCase += MAX_POINTS[signal];
    } else {
      breakdown[signal] = p;
      score += p;
      bestCase += p;
    }
  }

  const recommended = routeFor(score);
  const best = routeFor(bestCase);
  return {
    signup_id: s.id,
    score,
    best_case_score: bestCase,
    recommended_route: recommended,
    best_case_route: best,
    route_uncertain: recommended !== best,
    missing_signals: missing,
    breakdown,
  };
}
