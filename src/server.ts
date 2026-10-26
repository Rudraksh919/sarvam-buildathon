import express from "express";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ROOT, integrationStatus, loadConfig } from "./config.js";
import { buildDeps, createIssueForRun, runInvestigation } from "./app.js";
import { listRuns, loadRun, newRunId } from "./engine/runs.js";
import { DEMO_SAMPLES } from "../fixtures/demo-data.js";

const cfg = loadConfig();
const app = express();
if (cfg.host !== "127.0.0.1" && cfg.host !== "localhost" && !cfg.accessToken) {
  console.error("Refusing to listen on a public interface without ACCESS_TOKEN set.");
  process.exit(1);
}

// CORS for a separately hosted frontend (e.g. Vercel). Only the configured origin is allowed.
app.use("/api", (req, res, next) => {
  if (cfg.allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", cfg.allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", (req, res, next) => {
  if (!cfg.accessToken) return next();
  const given = Buffer.from(req.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(cfg.accessToken);
  if (given.length === want.length && timingSafeEqual(given, want)) return next();
  res.status(401).json({ error: "Unauthorized: missing or wrong access token" });
});
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(ROOT, "public")));

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

app.get("/api/config", (_req, res) => res.json({ integrations: integrationStatus(cfg), samples: DEMO_SAMPLES, threshold: cfg.confidenceThreshold }));

app.post("/api/investigate", (req, res) => {
  const b = req.body ?? {};
  const text = str(b.text, 5000);
  if (!text) return void res.status(400).json({ error: "text is required" });
  const input = { text, userId: str(b.userId, 128), from: str(b.from, 40), to: str(b.to, 40), diagnostics: str(b.diagnostics, 5000), demo: !!b.demo };
  try { buildDeps(cfg, !!input.demo); } catch (e: any) { return void res.status(400).json({ error: e.message }); }
  // Run in the background; the client polls GET /api/runs/:id (saved after every step).
  const id = newRunId();
  runInvestigation(input, cfg, id).catch((e) => console.error("investigation crashed:", e));
  res.json({ id });
});

app.get("/api/runs", async (_req, res) => res.json((await listRuns()).map(({ evidence, toolCalls, report, ...r }) => ({ ...r, evidenceCount: evidence.length, confidence: report?.confidence }))));

app.get("/api/runs/:id", async (req, res) => {
  const r = await loadRun(req.params.id);
  r ? res.json(r) : res.status(404).json({ error: "not found" });
});

app.post("/api/runs/:id/linear", async (req, res) => {
  try {
    res.json(await createIssueForRun(req.params.id, cfg));
  } catch (e: any) {
    res.status(e.status ?? 502).json({ error: String(e.message ?? e), preview: e.preview });
  }
});

app.listen(cfg.port, cfg.host, () => console.log(`Bugsy listening on ${cfg.host}:${cfg.port}`));
