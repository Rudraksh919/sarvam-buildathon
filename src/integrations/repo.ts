import fs from "node:fs/promises";
import path from "node:path";
import type { CodeHit, RepoLike } from "./types.js";

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "runs", "coverage", ".venv", "__pycache__"]);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|php|cs|vue|svelte|sql|json|ya?ml|md)$/i;
const SECRET_FILE = /(^|[\\/])(\.env.*|.*\.(pem|key)|id_rsa.*)$/i;

export class Repo implements RepoLike {
  root: string;
  constructor(root: string) { this.root = path.resolve(root); }

  /** Resolve a repo-relative path; throws if it escapes the root (incl. via symlinks) or targets secrets. */
  async safePath(rel: string): Promise<string> {
    if (path.isAbsolute(rel) || rel.includes("\0")) throw new Error(`path not allowed: ${rel}`);
    const full = path.resolve(this.root, rel);
    const realRoot = await fs.realpath(this.root);
    const real = await fs.realpath(full);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`path escapes repository: ${rel}`);
    if (SECRET_FILE.test(rel)) throw new Error(`secret file not readable: ${rel}`);
    return real;
  }

  private async *walk(dir: string): AsyncGenerator<string> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink() || SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* this.walk(p);
      else if (TEXT.test(e.name) && !SECRET_FILE.test(e.name)) yield p;
    }
  }

  async window(file: string, line: number, radius = 5): Promise<CodeHit | null> {
    let real: string;
    try { real = await this.safePath(file); } catch { return null; }
    const st = await fs.stat(real);
    if (!st.isFile() || st.size > 400_000) return null;
    const lines = (await fs.readFile(real, "utf8")).split(/\r?\n/);
    if (line < 1 || line > lines.length) return null;
    const startLine = Math.max(1, line - radius), endLine = Math.min(lines.length, line + radius);
    const text = lines.slice(startLine - 1, endLine).map((l, i) => `${startLine + i}: ${l}`).join("\n");
    return { file: file.split(path.sep).join("/"), startLine, endLine, line, text, terms: [] };
  }

  // ponytail: linear scan of up to 3000 files; add an index if repos get huge.
  async search(terms: string[], max = 4): Promise<CodeHit[]> {
    const ts = [...new Set(terms.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3))];
    if (!ts.length) return [];
    const scored: { file: string; line: number; terms: Set<string>; n: number }[] = [];
    let files = 0;
    for await (const abs of this.walk(this.root)) {
      if (++files > 3000) break;
      const st = await fs.stat(abs);
      if (st.size > 400_000) continue;
      const lines = (await fs.readFile(abs, "utf8")).split(/\r?\n/);
      const hit = new Set<string>();
      let best = { line: 0, n: 0 };
      lines.forEach((l, i) => {
        const low = l.toLowerCase();
        const m = ts.filter((t) => low.includes(t));
        m.forEach((t) => hit.add(t));
        if (m.length > best.n) best = { line: i + 1, n: m.length };
      });
      if (hit.size) scored.push({ file: path.relative(this.root, abs), line: best.line, terms: hit, n: hit.size });
    }
    scored.sort((a, b) => b.n - a.n || a.file.localeCompare(b.file));
    const out: CodeHit[] = [];
    for (const s of scored.slice(0, max)) {
      const w = await this.window(s.file, s.line, 20);
      if (w) out.push({ ...w, terms: [...s.terms] });
    }
    return out;
  }
}
