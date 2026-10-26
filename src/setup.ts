import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const FILE = path.join(ROOT, ".env");
const existing: Record<string, string> = {};
if (fs.existsSync(FILE))
  for (const l of fs.readFileSync(FILE, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) existing[m[1]] = m[2];
  }

p.intro("Bug Investigator setup (blank = keep current / skip)");
const out: Record<string, string> = { ...existing };
const ask = async (key: string, label: string, secret = false) => {
  const cur = existing[key];
  const v = await (secret ? p.password : p.text)({ message: `${label}${cur ? " (set)" : ""}`, ...(secret ? {} : { placeholder: cur ?? "" }) } as any);
  if (p.isCancel(v)) { p.cancel("Cancelled, nothing written."); process.exit(0); }
  if (String(v).trim()) out[key] = String(v).trim();
};

await ask("SARVAM_API_KEY", "Sarvam API key", true);
await ask("REPO_PATH", "Repository path to investigate");
for (const [name, fields] of [
  ["Slack", [["SLACK_BOT_TOKEN", "Slack bot token", true], ["SLACK_CHANNEL_ID", "Slack channel ID"]]],
  ["Linear", [["LINEAR_API_KEY", "Linear API key", true], ["LINEAR_TEAM_ID", "Linear team ID (optional)"]]],
  ["PostHog", [["POSTHOG_API_KEY", "PostHog personal API key", true], ["POSTHOG_PROJECT_ID", "PostHog project ID"], ["POSTHOG_HOST", "PostHog host (default https://us.posthog.com)"]]],
  ["Sentry", [["SENTRY_AUTH_TOKEN", "Sentry auth token", true], ["SENTRY_ORG", "Sentry org slug"], ["SENTRY_PROJECT", "Sentry project slug"]]],
] as const) {
  if (await p.confirm({ message: `Configure ${name}?`, initialValue: false }) === true)
    for (const [k, l, s] of fields as readonly (readonly [string, string, boolean?])[]) await ask(k, l, !!s);
}
await ask("CONFIDENCE_THRESHOLD", "Confidence threshold 0-1 (default 0.6)");

fs.writeFileSync(FILE, Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
p.outro("Saved .env (git-ignored). Try: npm run start -- --sample 0   then   npm run serve");
