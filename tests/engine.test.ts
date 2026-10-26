import { describe, expect, it } from "vitest";
import path from "node:path";
import { investigate } from "../src/engine/investigate.js";
import type { Deps } from "../src/engine/investigate.js";
import { EvidenceStore, validateSynthesis } from "../src/engine/evidence.js";
import { extractJson } from "../src/ai/provider.js";
import type { AiProvider } from "../src/ai/provider.js";
import { Repo } from "../src/integrations/repo.js";
import { DemoPostHog } from "../src/integrations/posthog.js";
import { DemoSentry } from "../src/integrations/sentry.js";
import { DemoProvider } from "../fixtures/demo-provider.js";
import { DEMO_REPO } from "../src/config.js";
import { SynthesisSchema } from "../src/types.js";
import { linearIssue } from "../src/engine/report.js";

const demoDeps = (over: Partial<Deps> = {}): Deps => ({
  ai: new DemoProvider(), repo: new Repo(DEMO_REPO), posthog: new DemoPostHog(), sentry: new DemoSentry(),
  synthetic: { repo: true, posthog: true, sentry: true }, mode: "demo", confidenceThreshold: 0.6, ...over,
});

/** AI stub: fixed extraction + a caller-supplied synthesis. */
const stubAi = (synth: object, extract: object = { isBug: true, keywords: ["checkout"] }): AiProvider => ({
  name: "stub",
  json: async (task, _s, _u, schema) => schema.parse(task === "extract" ? extract : synth),
});

describe("investigation outcomes", () => {
  it("DIAGNOSED with validated evidence and code refs (demo flow)", async () => {
    const r = await investigate({ text: "Checkout keeps spinning after clicking pay", userId: "u_1042", demo: true }, demoDeps());
    expect(r.outcome).toBe("DIAGNOSED");
    expect(r.report!.facts.length).toBeGreaterThan(0);
    expect(r.report!.codeRefs[0]).toMatchObject({ file: "src/checkout/pay.ts", line: 10 });
    expect(r.evidence.filter((e) => e.source !== "report").every((e) => e.synthetic)).toBe(true);
    expect(r.toolCalls.map((t) => t.tool)).toEqual(expect.arrayContaining(["posthog.events", "sentry.issues", "repo.read", "repo.search"]));
    for (const f of r.report!.facts) for (const id of f.evidence) expect(r.evidence.some((e) => e.id === id)).toBe(true);
  });

  it("SKIPPED for non-bug messages", async () => {
    const r = await investigate({ text: "Thanks team, lunch at 1?" }, demoDeps());
    expect(r.outcome).toBe("SKIPPED");
    expect(r.toolCalls).toHaveLength(0);
  });

  it("NO_SESSION when the user has no events or errors", async () => {
    const r = await investigate({ text: "Checkout keeps spinning", userId: "u_9999" }, demoDeps());
    expect(r.outcome).toBe("NO_SESSION");
  });

  it("NO_DIAGNOSIS (abstains) when nothing is retrieved", async () => {
    const r = await investigate({ text: "The app feels kind of slow sometimes, not sure when." }, demoDeps());
    expect(r.outcome).toBe("NO_DIAGNOSIS");
    expect(r.abstentionReason).toMatch(/No evidence/);
  });

  it("abstains when the model hallucinates evidence ids", async () => {
    const ai = stubAi({ status: "DIAGNOSED", rootCause: "Made up", confidence: 0.95, facts: [{ text: "x", evidence: ["E99"] }] });
    const r = await investigate({ text: "Checkout keeps spinning", userId: "u_1042" }, demoDeps({ ai }));
    expect(r.outcome).toBe("NO_DIAGNOSIS");
    expect(r.report!.rejected.join()).toMatch(/E99/);
  });

  it("survives integration failures and records them", async () => {
    const sentry = { issues: async () => { throw new Error("boom 503"); } };
    const r = await investigate({ text: "Checkout keeps spinning", userId: "u_1042", demo: true }, demoDeps({ sentry }));
    expect(r.toolCalls.find((t) => t.tool === "sentry.issues")).toMatchObject({ status: "error", note: "boom 503" });
    expect(r.status).toBe("done");
  });

  it("reports unconfigured integrations as skipped, not queried", async () => {
    const r = await investigate({ text: "Checkout keeps spinning", userId: "u_1042" }, demoDeps({ posthog: undefined, sentry: undefined, synthetic: { repo: true, posthog: false, sentry: false } }));
    expect(r.toolCalls.find((t) => t.tool === "posthog.events")!.status).toBe("skipped");
    expect(r.evidence.some((e) => e.source === "posthog" || e.source === "sentry")).toBe(false);
  });

  it("AI failure becomes an explicit abstention with error status", async () => {
    const ai: AiProvider = { name: "bad", json: async () => { throw new Error("401"); } };
    const r = await investigate({ text: "x broke" }, demoDeps({ ai }));
    expect(r.outcome).toBe("NO_DIAGNOSIS");
    expect(r.status).toBe("error");
  });

  it("builds a Linear issue that flags synthetic evidence", async () => {
    const r = await investigate({ text: "Checkout keeps spinning", userId: "u_1042", demo: true }, demoDeps());
    const { description } = linearIssue(r);
    expect(description).toMatch(/SYNTHETIC/);
    expect(description).toMatch(/pay\.ts/);
  });
});

describe("validateSynthesis", () => {
  const store = () => {
    const s = new EvidenceStore();
    s.add({ source: "report", tool: "user_report", synthetic: false, summary: "r", data: {} });
    s.add({ source: "repo", tool: "repo.read", synthetic: false, summary: "a.ts", data: {}, locations: [{ file: "a.ts", from: 5, to: 15 }] });
    return s;
  };
  const syn = (o: object) => SynthesisSchema.parse({ status: "DIAGNOSED", rootCause: "c", confidence: 0.9, ...o });

  it("accepts supported claims", () => {
    const v = validateSynthesis(syn({ facts: [{ text: "f", evidence: ["E2"] }], codeRefs: [{ file: "a.ts", line: 7, evidence: "E2" }] }), store(), 0.6);
    expect(v.abstain).toBeUndefined();
    expect(v.report.codeRefs).toHaveLength(1);
  });
  it("drops code refs outside the evidence range", () => {
    const v = validateSynthesis(syn({ facts: [{ text: "f", evidence: ["E2"] }], codeRefs: [{ file: "a.ts", line: 99, evidence: "E2" }] }), store(), 0.6);
    expect(v.report.codeRefs).toHaveLength(0);
    expect(v.report.rejected).toHaveLength(1);
  });
  it("abstains when only the user report is cited", () => {
    expect(validateSynthesis(syn({ facts: [{ text: "f", evidence: ["E1"] }] }), store(), 0.6).abstain).toMatch(/beyond the bug report/);
  });
  it("abstains below the confidence threshold", () => {
    expect(validateSynthesis(syn({ confidence: 0.4, facts: [{ text: "f", evidence: ["E2"] }] }), store(), 0.6).abstain).toMatch(/below/);
  });
  it("abstains when the model says NO_DIAGNOSIS", () => {
    expect(validateSynthesis(syn({ status: "NO_DIAGNOSIS" }), store(), 0.6).abstain).toBeDefined();
  });
});

describe("repo safety", () => {
  const repo = new Repo(DEMO_REPO);
  it("blocks traversal, absolute paths and secrets", async () => {
    await expect(repo.safePath("../../package.json")).rejects.toThrow(/escapes/);
    await expect(repo.safePath(path.resolve("package.json"))).rejects.toThrow(/not allowed/);
    expect(await repo.window("../../package.json", 1)).toBeNull();
  });
  it("finds code by keyword", async () => {
    const hits = await repo.search(["paymentIntent"]);
    expect(hits[0].file.replace(/\\/g, "/")).toMatch(/checkout/);
  });
});

describe("extractJson", () => {
  it("handles fences, reasoning prefix and braces in strings", () => {
    expect(extractJson('<think>{no}</think>```json\n{"a":"}{","b":1}\n``` trailing')).toEqual({ a: "}{", b: 1 });
  });
  it("throws on garbage", () => expect(() => extractJson("nope")).toThrow());
});
