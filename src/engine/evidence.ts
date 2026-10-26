import type { Evidence, Report, Synthesis } from "../types.js";

/** Only place evidence IDs are minted. IDs come from actual tool output, never from the model. */
export class EvidenceStore {
  items: Evidence[] = [];
  add(d: Omit<Evidence, "id">): Evidence {
    const e = { ...d, id: `E${this.items.length + 1}` };
    this.items.push(e);
    return e;
  }
  get(id: string) { return this.items.find((e) => e.id === id); }
}

const norm = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");

export interface Validated { report: Report; abstain?: string }

/** Strip every model claim that is not backed by evidence collected in this investigation. */
export function validateSynthesis(s: Synthesis, store: EvidenceStore, threshold: number): Validated {
  const rejected: string[] = [];
  const keep = (kind: string, claims: Synthesis["facts"]) =>
    claims.flatMap((c) => {
      const ok = [...new Set(c.evidence)].filter((id) => store.get(id));
      const bad = c.evidence.filter((id) => !store.get(id));
      if (bad.length) rejected.push(`${kind} cited unknown evidence ${bad.join(",")}: "${c.text}"`);
      if (!ok.length) { if (!bad.length) rejected.push(`${kind} had no evidence: "${c.text}"`); return []; }
      return [{ text: c.text, evidence: ok }];
    });
  const facts = keep("fact", s.facts);
  const inferences = keep("inference", s.inferences);

  const codeRefs = s.codeRefs.filter((r) => {
    const ev = store.get(r.evidence);
    const ok = !!ev?.locations?.some((l) => norm(l.file) === norm(r.file) &&
      (r.line == null || l.from == null || (r.line >= l.from && r.line <= (l.to ?? l.from))));
    if (!ok) rejected.push(`code reference ${r.file}:${r.line ?? "?"} not shown in evidence ${r.evidence}`);
    return ok;
  });

  const report: Report = {
    rootCause: s.rootCause, facts, inferences, codeRefs, rejected,
    confidence: Math.max(0, Math.min(1, s.confidence - 0.1 * rejected.length)),
    unknowns: s.unknowns, recommendedFix: s.recommendedFix, nextStep: s.nextStep,
  };

  const cited = new Set([...facts, ...inferences].flatMap((c) => c.evidence));
  const hasToolEvidence = [...cited].some((id) => store.get(id)!.source !== "report");
  let abstain: string | undefined;
  if (s.status !== "DIAGNOSED") abstain = "The model could not establish a root cause from the evidence.";
  else if (!s.rootCause.trim()) abstain = "No root cause was stated.";
  else if (!facts.length) abstain = "No factual claim survived evidence validation.";
  else if (!hasToolEvidence) abstain = "The diagnosis is not supported by any retrieved evidence beyond the bug report itself.";
  else if (report.confidence < threshold)
    abstain = `Confidence ${report.confidence.toFixed(2)} is below the threshold ${threshold}.`;
  return { report, abstain };
}
