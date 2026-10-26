import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildProfile, extractSymbols, loadProfile, refreshProfile, slugFor } from "../src/agents/mapper.js";
import { locate, rank } from "../src/agents/locate.js";
import { Repo } from "../src/integrations/repo.js";
import { DemoProvider } from "../fixtures/demo-provider.js";
import { DEMO_REPO } from "../src/config.js";
import type { AiProvider } from "../src/ai/provider.js";

describe("bugsy skill (repo map)", () => {
  it("extracts symbols", () => {
    expect(extractSymbols("export async function handlePay() {}\nclass A {}\nexport const x = async () => 1;\ndef py_fn():")).toEqual(["handlePay", "A", "x", "py_fn"]);
  });

  it("builds, persists SKILL.md + profile.json, reloads and refreshes incrementally", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bugsy-"));
    const repo = new Repo(DEMO_REPO);
    const p = await buildProfile(repo, new DemoProvider(), undefined, tmp);
    expect(p.files.find((f) => f.file === "src/checkout/pay.ts")!.symbols).toContain("handlePay");
    const md = await fs.readFile(path.join(tmp, slugFor(DEMO_REPO), "SKILL.md"), "utf8");
    expect(md).toMatch(/^---\nname: bugsy-/);
    expect(md).toMatch(/handlePay/);
    expect((await loadProfile(DEMO_REPO, tmp))!.files.length).toBe(p.files.length);
    expect((await refreshProfile(repo, p, tmp)).changed).toBe(0);
  });

  it("locates files via the map; model picks are restricted to candidates", async () => {
    const repo = new Repo(DEMO_REPO);
    const p = await buildProfile(repo, new DemoProvider(), undefined, await fs.mkdtemp(path.join(os.tmpdir(), "bugsy-")));
    expect(rank(p, ["checkout"])[0].f.file).toMatch(/checkout/);
    const liar: AiProvider = { name: "liar", json: async (_t, _s, _u, schema) => schema.parse({ files: [{ file: "../../package.json" }, { file: "src/checkout/pay.ts" }] }) };
    const r = await locate(repo, p, liar, "checkout spins", ["checkout", "paymentIntent"]);
    expect(r.picked).toEqual(["src/checkout/pay.ts"]);
    expect(r.hits.every((h) => h.file.includes("checkout"))).toBe(true);
    expect((await locate(repo, p, liar, "x", ["zzzznothing"])).hits).toEqual([]);
  });
});
