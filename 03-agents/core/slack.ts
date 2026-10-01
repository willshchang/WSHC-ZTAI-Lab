// ============================================================
// SLACK
// ============================================================
// Posts a message to a Slack incoming webhook. WHY dry-run: with
// no webhook configured, it prints what it WOULD post instead of
// failing. Safe for demos and for anyone cloning the repo.
// ============================================================

import { say } from "./sanitize.ts";

// Anything a test run posts carries this tag, so a scripted or
// mock-tenant post can never be mistaken for a real one in Slack
export const MOCK_TAG = ":test_tube: *[MOCK]* ";

// A webhook that hangs must not hang the agent
export const SLACK_TIMEOUT_MS = 15_000;

// ------------------------------------------------------------
// ESCAPING UNTRUSTED TEXT
// ------------------------------------------------------------
// Slack reads &, < and > as control characters: <!here> pings the
// whole channel and <https://evil.example|here> is a disguised link.
// Customer data (a company name), HR data (a display name) and
// model-written text (a reason, a friction report) could carry
// either. Slack's docs: replace exactly these three with HTML
// entities, and nothing else.
// https://docs.slack.dev/messaging/formatting-message-text
//
// maxChars caps a field so one long value can't flood a channel.
// ------------------------------------------------------------
export function escapeSlack(text: string, maxChars?: number): string {
  const capped =
    maxChars !== undefined && text.length > maxChars ? `${text.slice(0, maxChars)}... (truncated)` : text;
  return capped.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SlackResult {
  posted: boolean;
  dryRun: boolean;
  channel: string;
}

export async function postToSlack(
  webhookUrl: string | undefined,
  channel: string,
  text: string,
): Promise<SlackResult> {
  if (!webhookUrl) {
    say(`\n[dry-run] Would post to ${channel}:\n${text}\n`);
    return { posted: false, dryRun: true, channel };
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Slack returned ${res.status} for ${channel}`);
  }
  return { posted: true, dryRun: false, channel };
}
