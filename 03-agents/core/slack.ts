// ============================================================
// SLACK
// ============================================================
// Posts a message to a Slack incoming webhook. WHY dry-run: with
// no webhook configured, it prints what it WOULD post instead of
// failing. Safe for demos and for anyone cloning the repo.
// ============================================================

// Anything a test run posts carries this tag, so a scripted or
// mock-tenant post can never be mistaken for a real one in Slack
export const MOCK_TAG = ":test_tube: *[MOCK]* ";

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
    console.log(`\n[dry-run] Would post to ${channel}:\n${text}\n`);
    return { posted: false, dryRun: true, channel };
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    throw new Error(`Slack returned ${res.status} for ${channel}`);
  }
  return { posted: true, dryRun: false, channel };
}
