import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { RUNS_DIR } from "../config.js";
import type { RunRecord } from "../types.js";

const ID_RE = /^[\w-]{6,60}$/;
export const newRunId = () => `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;

export async function saveRun(r: RunRecord, dir = RUNS_DIR) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${r.id}.json`), JSON.stringify(r, null, 2));
}

export async function loadRun(id: string, dir = RUNS_DIR): Promise<RunRecord | null> {
  if (!ID_RE.test(id)) return null;
  try { return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), "utf8")); } catch { return null; }
}

export async function listRuns(dir = RUNS_DIR): Promise<RunRecord[]> {
  let names: string[] = [];
  try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json")); } catch { return []; }
  const runs = await Promise.all(names.map((n) => loadRun(n.slice(0, -5), dir)));
  return runs.filter((r): r is RunRecord => !!r).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
