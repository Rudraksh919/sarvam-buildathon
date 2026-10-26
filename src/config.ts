import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO_REPO = path.join(ROOT, "fixtures", "demo-repo");
/** Persistent data (run history, repo maps). Point DATA_DIR at a mounted disk when deploying. */
export const DATA_DIR = process.env.DATA_DIR?.trim() ? path.resolve(process.env.DATA_DIR.trim()) : ROOT;
export const RUNS_DIR = path.join(DATA_DIR, "runs");

const env = (k: string) => process.env[k]?.trim() || undefined;
const num = (k: string, d: number) => (Number.isFinite(Number(env(k))) && env(k) ? Number(env(k)) : d);

export function loadConfig() {
  return {
    sarvam: { apiKey: env("SARVAM_API_KEY"), model: env("SARVAM_MODEL") ?? "sarvam-105b", timeoutS: num("SARVAM_TIMEOUT_S", 60) },
    repoPath: env("REPO_PATH") ? path.resolve(env("REPO_PATH")!) : undefined,
    slack: { token: env("SLACK_BOT_TOKEN"), channel: env("SLACK_CHANNEL_ID") },
    linear: { apiKey: env("LINEAR_API_KEY"), teamId: env("LINEAR_TEAM_ID") },
    posthog: { apiKey: env("POSTHOG_API_KEY"), projectId: env("POSTHOG_PROJECT_ID"), host: env("POSTHOG_HOST") ?? "https://us.posthog.com" },
    sentry: { token: env("SENTRY_AUTH_TOKEN"), org: env("SENTRY_ORG"), project: env("SENTRY_PROJECT"), host: env("SENTRY_HOST") ?? "https://sentry.io" },
    confidenceThreshold: num("CONFIDENCE_THRESHOLD", 0.6),
    httpTimeoutMs: num("HTTP_TIMEOUT_S", 15) * 1000,
    port: num("PORT", 3000),
    host: env("HOST") ?? "127.0.0.1",
    accessToken: env("ACCESS_TOKEN"),
    allowedOrigin: env("ALLOWED_ORIGIN"),
  };
}
export type Config = ReturnType<typeof loadConfig>;

/** Which integrations are configured. Never exposes secrets. */
export function integrationStatus(c: Config) {
  return {
    sarvam: !!c.sarvam.apiKey,
    repo: !!c.repoPath,
    posthog: !!(c.posthog.apiKey && c.posthog.projectId),
    sentry: !!(c.sentry.token && c.sentry.org && c.sentry.project),
    linear: !!c.linear.apiKey,
    slack: !!(c.slack.token && c.slack.channel),
  };
}
