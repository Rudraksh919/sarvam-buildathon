import { parseArgs } from "node:util";
import { loadConfig, integrationStatus } from "./config.js";
import { runInvestigation, createIssueForRun } from "./app.js";
import { fetchMessages, replyInThread } from "./integrations/slack.js";
import { DEMO_SAMPLES } from "../fixtures/demo-data.js";
import type { RunRecord } from "./types.js";

const { values: a } = parseArgs({
  options: {
    text: { type: "string" }, user: { type: "string" }, from: { type: "string" }, to: { type: "string" },
    demo: { type: "boolean" }, sample: { type: "string" }, linear: { type: "boolean" }, "slack-once": { type: "boolean" },
  },
});

function print(r: RunRecord) {
  console.log(`\n[${r.mode}${r.evidence.some((e) => e.synthetic) ? ", SYNTHETIC evidence" : ""}] ${r.id}  ${r.outcome}  (${r.durationMs}ms, ${r.aiProvider})`);
  for (const t of r.toolCalls) console.log(`  tool ${t.tool}: ${t.status}${t.note ? ` (${t.note})` : ""} ${t.evidenceIds.join(",")}`);
  if (r.abstentionReason) console.log(`Abstained: ${r.abstentionReason}`);
  const p = r.report;
  if (p) {
    console.log(`Root cause (${(p.confidence * 100).toFixed(0)}%): ${p.rootCause}`);
    p.facts.forEach((f) => console.log(`  fact: ${f.text} [${f.evidence}]`));
    p.codeRefs.forEach((c) => console.log(`  code: ${c.file}:${c.line ?? "?"}`));
    console.log(`Fix: ${p.recommendedFix}`);
    if (p.unknowns.length) console.log(`Unknowns: ${p.unknowns.join("; ")}`);
    if (p.rejected.length) console.log(`Rejected model claims: ${p.rejected.length}`);
  }
}

function slackSummary(r: RunRecord) {
  if (r.outcome === "DIAGNOSED") return `Diagnosis (${(r.report!.confidence * 100).toFixed(0)}%): ${r.report!.rootCause}\nFix: ${r.report!.recommendedFix}\nRun ${r.id}`;
  return `${r.outcome}: ${r.abstentionReason ?? ""}`;
}

const cfg = loadConfig();
try {
  if (a["slack-once"]) {
    if (!integrationStatus(cfg).slack) throw new Error("Slack not configured (SLACK_BOT_TOKEN, SLACK_CHANNEL_ID)");
    for (const m of await fetchMessages(cfg)) {
      const r = await runInvestigation({ text: m.text }, cfg);
      print(r);
      if (r.outcome !== "SKIPPED") await replyInThread(cfg, m.ts, slackSummary(r));
    }
  } else {
    const sample = a.sample ? DEMO_SAMPLES[Number(a.sample)] : undefined;
    const text = a.text ?? sample?.text;
    if (!text) throw new Error('Usage: npm run start -- --text "Checkout keeps spinning" [--user id] [--demo | --sample 0-3] [--linear]');
    const r = await runInvestigation({ text, userId: a.user ?? sample?.userId, from: a.from, to: a.to, demo: a.demo || !!sample }, cfg);
    print(r);
    if (a.linear && r.outcome === "DIAGNOSED") console.log("Linear:", await createIssueForRun(r.id, cfg));
  }
} catch (e) {
  console.error(String((e as Error).message ?? e));
  process.exit(1);
}
