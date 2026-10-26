import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DATA_DIR } from "../config.js";
import type { AiProvider } from "../ai/provider.js";
import type { RepoLike } from "../integrations/types.js";

export interface FileEntry { file: string; size: number; mtimeMs: number; symbols: string[]; summary?: string }
export interface Profile { root: string; name: string; createdAt: string; updatedAt: string; files: FileEntry[] }

const SKILLS_DIR = path.join(DATA_DIR, "skills");
const SYMBOL_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|def|func|fn|struct)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|[A-Za-z_$][\w$]*\s*=>)/gm;

export const extractSymbols = (src: string): string[] => {
  const out = new Set<string>();
  for (const m of src.matchAll(SYMBOL_RE)) out.add(m[1] ?? m[2]);
  return [...out].slice(0, 40);
};

export const slugFor = (root: string) => {
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repo";
  return `bugsy-${base}-${createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 6)}`;
};
const dirFor = (root: string, skillsDir = SKILLS_DIR) => path.join(skillsDir, slugFor(root));

const SummarySchema = z.object({ summaries: z.array(z.object({ file: z.string(), summary: z.string() })).default([]) });
const MAP_SYSTEM = `You document a code repository for a bug investigator. For each file given (path, symbols, head of file), write ONE short sentence (<=18 words) saying what it does and what kind of bugs could live there. Use only what is shown. Reply with ONLY JSON: {"summaries":[{"file":string,"summary":string}]}`;

async function entry(repo: RepoLike, f: { file: string; size: number; mtimeMs: number }): Promise<FileEntry> {
  let symbols: string[] = [];
  try { symbols = extractSymbols(await repo.read(f.file)); } catch { /* unreadable: keep path only */ }
  return { ...f, symbols };
}

/** MAPPER AGENT: scan the whole repo once, summarize files with the model, persist as a "bugsy skill". */
export async function buildProfile(repo: RepoLike, ai: AiProvider, onProgress?: (m: string) => void, skillsDir = SKILLS_DIR): Promise<Profile> {
  const listed = await repo.list();
  onProgress?.(`Mapping ${listed.length} files`);
  const files: FileEntry[] = [];
  for (let i = 0; i < listed.length; i += 25) files.push(...(await Promise.all(listed.slice(i, i + 25).map((f) => entry(repo, f)))));

  // ponytail: summarize at most 300 files (largest-symbol files first); the rest keep path+symbols only.
  const toSummarize = files.filter((f) => f.symbols.length).sort((a, b) => b.symbols.length - a.symbols.length).slice(0, 300);
  const batches: FileEntry[][] = [];
  for (let i = 0; i < toSummarize.length; i += 20) batches.push(toSummarize.slice(i, i + 20));
  const byFile = new Map(files.map((f) => [f.file, f]));
  for (let i = 0; i < batches.length; i += 4) {
    await Promise.all(batches.slice(i, i + 4).map(async (batch) => {
      try {
        const body = (await Promise.all(batch.map(async (f) => `### ${f.file}\nsymbols: ${f.symbols.slice(0, 12).join(", ")}\n${(await repo.read(f.file)).slice(0, 500)}`))).join("\n\n");
        const r = await ai.json("map", MAP_SYSTEM, body, SummarySchema);
        for (const s of r.summaries) { const e = byFile.get(s.file); if (e) e.summary = s.summary.slice(0, 200); }
      } catch { /* summaries are an optimization; heuristics still work */ }
    }));
    onProgress?.(`Summarized ${Math.min(toSummarize.length, (i + 4) * 20)}/${toSummarize.length} files`);
  }
  const now = new Date().toISOString();
  const profile: Profile = { root: path.resolve(repo.root), name: path.basename(repo.root), createdAt: now, updatedAt: now, files };
  await saveProfile(profile, skillsDir);
  return profile;
}

/** Cheap refresh: re-extract symbols only for files whose size/mtime changed; drop deleted files. */
export async function refreshProfile(repo: RepoLike, p: Profile, skillsDir = SKILLS_DIR): Promise<{ profile: Profile; changed: number }> {
  const listed = await repo.list();
  const old = new Map(p.files.map((f) => [f.file, f]));
  let changed = old.size - listed.filter((f) => old.has(f.file)).length; // deletions
  const files: FileEntry[] = [];
  for (const f of listed) {
    const o = old.get(f.file);
    if (o && o.size === f.size && o.mtimeMs === f.mtimeMs) files.push(o);
    else { files.push({ ...(await entry(repo, f)), summary: o?.summary }); changed++; }
  }
  if (!changed) return { profile: p, changed: 0 };
  const profile = { ...p, files, updatedAt: new Date().toISOString() };
  await saveProfile(profile, skillsDir);
  return { profile, changed };
}

export async function loadProfile(root: string, skillsDir = SKILLS_DIR): Promise<Profile | null> {
  try { return JSON.parse(await fs.readFile(path.join(dirFor(root, skillsDir), "profile.json"), "utf8")); } catch { return null; }
}

/** Writes skills/<slug>/profile.json (machine) and SKILL.md (readable, Claude-Code-skill compatible). */
export async function saveProfile(p: Profile, skillsDir = SKILLS_DIR) {
  const dir = dirFor(p.root, skillsDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "profile.json"), JSON.stringify(p));
  const byDir = new Map<string, FileEntry[]>();
  for (const f of p.files) byDir.set(path.posix.dirname(f.file), [...(byDir.get(path.posix.dirname(f.file)) ?? []), f]);
  const md = [
    "---",
    `name: ${slugFor(p.root)}`,
    `description: Bugsy's map of the ${p.name} repository (${p.files.length} files). Use it to find which files and symbols to inspect when investigating a bug in ${p.name}.`,
    "---",
    `# Bugsy map of ${p.name}`,
    `Generated ${p.updatedAt}. Auto-maintained by Bugsy; edits are overwritten when files change.`,
    "",
    ...[...byDir.entries()].sort().flatMap(([d, fs_]) => [
      `## ${d}/`,
      ...fs_.sort((a, b) => a.file.localeCompare(b.file)).map((f) => `- \`${f.file}\`${f.summary ? ` — ${f.summary}` : ""}${f.symbols.length ? ` [${f.symbols.slice(0, 8).join(", ")}]` : ""}`),
      "",
    ]),
  ].join("\n");
  await fs.writeFile(path.join(dir, "SKILL.md"), md);
}
