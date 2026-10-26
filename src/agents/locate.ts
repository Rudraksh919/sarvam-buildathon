import { z } from "zod";
import type { AiProvider } from "../ai/provider.js";
import type { CodeHit, RepoLike } from "../integrations/types.js";
import type { Profile } from "./mapper.js";

const SelectSchema = z.object({ files: z.array(z.object({ file: z.string(), reason: z.string().default("") })).default([]) });
const SELECT_SYSTEM = `You pick which source files to read first when investigating a bug. You get the bug report and candidate files (path, symbols, summary) from a pre-built repo map. Pick up to 5 files most likely to contain the cause. Only choose files from the list. Reply with ONLY JSON: {"files":[{"file":string,"reason":string}]}`;

/** Score map entries against search terms (path and symbols weigh more than summaries). */
export function rank(p: Profile, terms: string[]) {
  const ts = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 3))];
  return p.files
    .map((f) => {
      const path_ = f.file.toLowerCase(), sym = f.symbols.join(" ").toLowerCase(), sum = (f.summary ?? "").toLowerCase();
      const score = ts.reduce((s, t) => s + (path_.includes(t) ? 3 : 0) + (sym.includes(t) ? 3 : 0) + (sum.includes(t) ? 1 : 0), 0);
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.f.file.localeCompare(b.f.file));
}

/** RCA retrieval: use the repo map to choose files, then read only those (never the whole codebase). */
export async function locate(repo: RepoLike, p: Profile, ai: AiProvider, report: string, terms: string[]): Promise<{ hits: CodeHit[]; candidates: string[]; picked: string[] }> {
  const ranked = rank(p, terms).slice(0, 30);
  if (!ranked.length) return { hits: [], candidates: [], picked: [] };
  const known = new Set(ranked.map((r) => r.f.file));
  let picked: string[] = [];
  try {
    const list = ranked.map((r) => `${r.f.file} | ${r.f.symbols.slice(0, 8).join(", ")} | ${r.f.summary ?? ""}`).join("\n");
    const sel = await ai.json("select", SELECT_SYSTEM, `Bug report: ${report}\n\nCandidates:\n${list}`, SelectSchema);
    picked = [...new Set(sel.files.map((x) => x.file))].filter((f) => known.has(f)).slice(0, 5); // model can't invent paths
  } catch { /* fall back to heuristic ranking */ }
  if (!picked.length) picked = ranked.slice(0, 3).map((r) => r.f.file);
  const hits = await repo.search(terms, 5, picked);
  for (const f of picked) {
    // chosen on semantics but no literal term match: show the top of the file instead
    if (!hits.some((h) => h.file === f)) { const w = await repo.window(f, 1, 30); if (w) hits.push(w); }
  }
  return { hits, candidates: [...known], picked };
}
