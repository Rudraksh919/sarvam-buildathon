import { ExtractionSchema, SynthesisSchema } from "../types.js";
import type { BugInput, Evidence, Extraction, Outcome, RunRecord, ToolCall } from "../types.js";
import type { AiProvider } from "../ai/provider.js";
import { EXTRACT_SYSTEM, SYNTH_SYSTEM } from "../ai/prompts.js";
import type { PostHogLike, RepoLike, SentryLike } from "../integrations/types.js";
import { EvidenceStore, validateSynthesis } from "./evidence.js";
import { newRunId } from "./runs.js";

export interface Deps {
  ai: AiProvider;
  repo?: RepoLike;
  posthog?: PostHogLike;
  sentry?: SentryLike;
  /** which sources serve fixture data */
  synthetic: { repo: boolean; posthog: boolean; sentry: boolean };
  mode: "demo" | "live";
  confidenceThreshold: number;
  runId?: string;
  onUpdate?: (run: RunRecord) => void | Promise<void>;
}

const clip = (v: unknown, n = 1500) => { const s = typeof v === "string" ? v : JSON.stringify(v, null, 1); return s.length > n ? s.slice(0, n) + "…[truncated]" : s; };

export async function investigate(input: BugInput, d: Deps): Promise<RunRecord> {
  const t0 = Date.now();
  const store = new EvidenceStore();
  const run: RunRecord = {
    id: d.runId ?? newRunId(), status: "running", input, mode: d.mode, aiProvider: d.ai.name,
    evidence: store.items, toolCalls: [], progress: [], startedAt: new Date(t0).toISOString(),
  };
  const push = async (step?: string) => {
    if (step) run.progress.push({ step, at: new Date().toISOString() });
    run.durationMs = Date.now() - t0;
    await d.onUpdate?.(run);
  };
  const finish = async (outcome: Outcome, reason?: string) => {
    run.outcome = outcome; run.abstentionReason = outcome === "DIAGNOSED" ? undefined : reason;
    run.status = run.status === "error" ? "error" : "done";
    await push(`Finished: ${outcome}`);
    return run;
  };
  /** Run one tool, record the call, convert drafts into evidence, never throw. */
  async function tool<T>(name: string, args: unknown, fn: (() => Promise<T>) | null, toDrafts: (r: T) => Omit<Evidence, "id">[], skipNote = "not configured"): Promise<{ ran: boolean; ok: boolean; n: number }> {
    const started = Date.now();
    const call: ToolCall = { tool: name, args, status: "skipped", evidenceIds: [], ms: 0 };
    run.toolCalls.push(call);
    if (!fn) { call.note = skipNote; return { ran: false, ok: false, n: 0 }; }
    try {
      const ev = toDrafts(await fn()).map((x) => store.add(x));
      call.evidenceIds = ev.map((e) => e.id);
      call.status = ev.length ? "ok" : "empty";
      return { ran: true, ok: true, n: ev.length };
    } catch (e) {
      call.status = "error"; call.note = String((e as Error).message ?? e);
      return { ran: true, ok: false, n: 0 };
    } finally { call.ms = Date.now() - started; }
  }

  try {
    await push("Recording bug report");
    store.add({ source: "report", tool: "user_report", synthetic: false, summary: "Bug report as submitted", data: { text: input.text, userId: input.userId, from: input.from, to: input.to, diagnostics: input.diagnostics } });

    await push("Parsing and classifying report");
    let ex: Extraction;
    try {
      ex = await d.ai.json("extract", EXTRACT_SYSTEM, `Report: ${input.text}\nUser id: ${input.userId ?? "(none)"}${input.diagnostics ? `\nDiagnostics: ${clip(input.diagnostics, 1500)}` : ""}`, ExtractionSchema);
    } catch (e) {
      run.error = String((e as Error).message);
      run.status = "error";
      return finish("NO_DIAGNOSIS", `AI parsing failed: ${run.error}`);
    }
    run.extraction = ex;
    if (!ex.isBug) return finish("SKIPPED", ex.reason || "Message is not a bug report.");

    // Only trust a model-extracted user id if it literally appears in the user's text.
    const userId = input.userId || (ex.userId && input.text.includes(ex.userId) ? ex.userId : undefined);
    const raw = [...ex.symbols, ...ex.keywords, ...(ex.errorMessage ? [ex.errorMessage] : [])];
    // Models often return phrases; code search needs single tokens too.
    const terms = [...new Set(raw.flatMap((t) => [t, ...t.split(/[^w$]+/).filter((w) => w.length >= 4)]))];

    let sessionSources = 0, sessionHits = 0;
    if (userId) {
      await push("Looking up user events (PostHog)");
      const r = await tool("posthog.events", { userId, from: input.from, to: input.to }, d.posthog ? () => d.posthog!.events({ userId, from: input.from, to: input.to }) : null,
        (evs) => evs.length ? [{ source: "posthog", tool: "posthog.events", synthetic: d.synthetic.posthog,
          summary: `${evs.length} events for ${userId}: ${evs.map((e) => e.event).join(" → ")}`, data: evs }] : []);
      if (r.ok) { sessionSources++; sessionHits += r.n; }
    }
    await push("Checking exceptions (Sentry)");
    const sr = await tool("sentry.issues", { userId, text: ex.errorMessage ?? terms.join(" ") }, d.sentry ? () => d.sentry!.issues({ userId, text: ex.errorMessage ?? terms.join(" ") }) : null,
      (issues) => issues.map((i) => ({
        source: "sentry" as const, tool: "sentry.issues", synthetic: d.synthetic.sentry,
        summary: `${i.title} (${i.count ?? "?"}x, last ${i.lastSeen ?? "?"}) at ${i.frames.map((f) => `${f.filename}:${f.lineno}`).join(" <- ") || "no frames"}`,
        data: i,
        locations: i.frames.filter((f) => f.filename).map((f) => ({ file: f.filename, from: f.lineno, to: f.lineno })),
      })));
    if (userId && sr.ok) { sessionSources++; sessionHits += sr.n; }

    if (userId && sessionSources > 0 && sessionHits === 0) {
      return finish("NO_SESSION", `No PostHog events or Sentry issues were found for user "${userId}"${input.from ? " in the given window" : ""}.`);
    }

    // Follow leads: stack frames first, then keyword search.
    await push("Inspecting source code");
    const seen = new Set<string>();
    const addCode = (h: { file: string; startLine: number; endLine: number; text: string; terms: string[] }, via: string) => {
      const key = `${h.file}:${h.startLine}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ source: "repo" as const, tool: via, synthetic: d.synthetic.repo,
        summary: `${h.file}:${h.startLine}-${h.endLine}`, data: { file: h.file, startLine: h.startLine, endLine: h.endLine, code: h.text, matched: h.terms },
        locations: [{ file: h.file, from: h.startLine, to: h.endLine }] }];
    };
    const frames = store.items.filter((e) => e.source === "sentry").flatMap((e) => (e.data as any).frames as { filename: string; lineno?: number }[]);
    for (const f of frames.slice(0, 4)) {
      if (!f.filename || !f.lineno) continue;
      await tool("repo.read", { file: f.filename, line: f.lineno }, d.repo ? () => d.repo!.window(f.filename, f.lineno!, 5) : null,
        (h) => (h ? addCode(h, "repo.read") : []));
    }
    await tool("repo.search", { terms }, d.repo ? () => d.repo!.search(terms, 4) : null, (hits) => hits.flatMap((h) => addCode(h, "repo.search")));

    const gathered = store.items.filter((e) => e.source !== "report");
    if (!gathered.length) {
      run.report = undefined;
      return finish("NO_DIAGNOSIS", "No evidence was retrieved from any source (repository, PostHog, Sentry), so no reliable diagnosis is possible. Add context such as a user id, time window, error text, or configure more integrations.");
    }

    await push("Synthesizing diagnosis");
    const evText = store.items.map((e) => `${e.id} [${e.source}${e.synthetic ? " synthetic" : ""}] ${e.summary}\n${clip(e.data, e.source === "repo" ? 5000 : 1500)}`).join("\n\n");
    let syn;
    try {
      syn = await d.ai.json("synthesize", SYNTH_SYSTEM, `Bug report: ${input.text}\n\nEVIDENCE:\n${evText}`, SynthesisSchema);
    } catch (e) {
      run.error = String((e as Error).message); run.status = "error";
      return finish("NO_DIAGNOSIS", `AI synthesis failed: ${run.error}`);
    }
    await push("Validating evidence references");
    const { report, abstain } = validateSynthesis(syn, store, d.confidenceThreshold);
    run.report = report;
    if (abstain) return finish("NO_DIAGNOSIS", abstain);
    return finish("DIAGNOSED");
  } catch (e) {
    run.status = "error"; run.error = String((e as Error).message ?? e);
    return finish("NO_DIAGNOSIS", `Unexpected failure: ${run.error}`);
  }
}
