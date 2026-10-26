import type { RunRecord } from "../types.js";

/** Markdown body for a Linear issue. Flags synthetic evidence so fixtures are never mistaken for real data. */
export function linearIssue(run: RunRecord): { title: string; description: string } {
  const r = run.report!;
  const cite = (ids: string[]) => ids.map((i) => `\`${i}\``).join(" ");
  const synth = run.evidence.some((e) => e.synthetic);
  const L: string[] = [];
  if (synth) L.push("> ⚠️ Contains SYNTHETIC demo evidence (fixtures), not data from real services.\n");
  L.push(`**Bug report:** ${run.input.text}`, "", `## Probable root cause`, r.rootCause, "", `Confidence: ${(r.confidence * 100).toFixed(0)}%`, "");
  L.push("## Observed facts", ...r.facts.map((f) => `- ${f.text} ${cite(f.evidence)}`), "");
  if (r.inferences.length) L.push("## Inferences", ...r.inferences.map((f) => `- ${f.text} ${cite(f.evidence)}`), "");
  if (r.codeRefs.length) L.push("## Code references", ...r.codeRefs.map((c) => `- \`${c.file}${c.line ? ":" + c.line : ""}\` (${c.evidence})`), "");
  L.push("## Recommended fix", r.recommendedFix || "_none given_", "");
  if (r.unknowns.length) L.push("## Unknowns", ...r.unknowns.map((u) => `- ${u}`), "");
  L.push("## Evidence", ...run.evidence.filter((e) => e.source !== "report").map((e) => `- \`${e.id}\` [${e.source}${e.synthetic ? ", synthetic" : ""}] ${e.summary}`), "", `_Investigation ${run.id} · ${run.aiProvider}_`);
  return { title: `[Bug] ${run.extraction?.title || run.input.text.slice(0, 80)}`, description: L.join("\n") };
}
