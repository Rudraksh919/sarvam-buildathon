import { DEMO_REPO, integrationStatus, loadConfig } from "./config.js";
import type { Config } from "./config.js";
import { SarvamProvider } from "./ai/provider.js";
import type { AiProvider } from "./ai/provider.js";
import { DemoProvider } from "../fixtures/demo-provider.js";
import { DemoPostHog, PostHog } from "./integrations/posthog.js";
import { DemoSentry, Sentry } from "./integrations/sentry.js";
import { Repo } from "./integrations/repo.js";
import { createLinearIssue } from "./integrations/linear.js";
import { investigate } from "./engine/investigate.js";
import type { Deps } from "./engine/investigate.js";
import { linearIssue } from "./engine/report.js";
import { loadRun, saveRun } from "./engine/runs.js";
import type { BugInput, RunRecord } from "./types.js";

export function buildDeps(cfg: Config, demo: boolean, ai?: AiProvider): Deps {
  const st = integrationStatus(cfg);
  const provider = ai ?? (st.sarvam ? new SarvamProvider(cfg.sarvam.apiKey!, cfg.sarvam.model, cfg.sarvam.timeoutS) : demo ? new DemoProvider() : null);
  if (!provider) throw new Error("SARVAM_API_KEY is not set. Run `npm run setup` or use demo mode.");
  const base = { ai: provider, confidenceThreshold: cfg.confidenceThreshold, mode: demo ? "demo" as const : "live" as const };
  if (demo) {
    return { ...base, repo: new Repo(DEMO_REPO), posthog: new DemoPostHog(), sentry: new DemoSentry(), synthetic: { repo: true, posthog: true, sentry: true } };
  }
  return {
    ...base,
    repo: cfg.repoPath ? new Repo(cfg.repoPath) : undefined,
    posthog: st.posthog ? new PostHog(cfg) : undefined,
    sentry: st.sentry ? new Sentry(cfg) : undefined,
    synthetic: { repo: false, posthog: false, sentry: false },
  };
}

export async function runInvestigation(input: BugInput, cfg = loadConfig(), runId?: string): Promise<RunRecord> {
  const deps = buildDeps(cfg, !!input.demo);
  return investigate(input, { ...deps, runId, onUpdate: saveRun });
}

export async function createIssueForRun(id: string, cfg = loadConfig()) {
  const run = await loadRun(id);
  if (!run) throw Object.assign(new Error("Run not found"), { status: 404 });
  if (run.outcome !== "DIAGNOSED" || !run.report) throw Object.assign(new Error("Only DIAGNOSED investigations can be filed"), { status: 400 });
  if (run.linear) return run.linear;
  const { title, description } = linearIssue(run);
  if (!cfg.linear.apiKey) throw Object.assign(new Error("Linear is not configured (set LINEAR_API_KEY). Nothing was sent."), { status: 503, preview: description });
  const issue = await createLinearIssue(cfg, title, description);
  run.linear = issue;
  await saveRun(run);
  return issue;
}
