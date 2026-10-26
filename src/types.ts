import { z } from "zod";

export type Source = "report" | "repo" | "posthog" | "sentry";
export type Outcome = "DIAGNOSED" | "NO_SESSION" | "NO_DIAGNOSIS" | "SKIPPED";

export interface Evidence {
  id: string; // stable: E1, E2, ... assigned by the EvidenceStore only
  source: Source;
  tool: string;
  synthetic: boolean; // true = fixture data, never retrieved from a real service
  summary: string;
  data: unknown; // raw tool output, preserved for audit
  /** code locations this evidence actually shows; used to validate model code references */
  locations?: { file: string; from?: number; to?: number }[];
}

export interface ToolCall {
  tool: string;
  args: unknown;
  status: "ok" | "empty" | "skipped" | "error";
  note?: string;
  evidenceIds: string[];
  ms: number;
}

export interface BugInput {
  text: string;
  userId?: string;
  from?: string;
  to?: string;
  diagnostics?: string;
  demo?: boolean;
}

// ---- Model output schemas (validated before use) ----
export const ExtractionSchema = z.object({
  isBug: z.boolean(),
  reason: z.string().default(""),
  title: z.string().default(""),
  summary: z.string().default(""),
  keywords: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  userId: z.string().nullish(),
  errorMessage: z.string().nullish(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const Claim = z.object({ text: z.string().min(1), evidence: z.array(z.string()).default([]) });
export const SynthesisSchema = z.object({
  status: z.enum(["DIAGNOSED", "NO_DIAGNOSIS"]),
  rootCause: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  facts: z.array(Claim).default([]),
  inferences: z.array(Claim).default([]),
  unknowns: z.array(z.string()).default([]),
  codeRefs: z
    .array(z.object({ file: z.string(), line: z.number().int().optional(), evidence: z.string() }))
    .default([]),
  recommendedFix: z.string().default(""),
  nextStep: z.string().default(""),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

export interface Report {
  rootCause: string;
  confidence: number;
  facts: { text: string; evidence: string[] }[];
  inferences: { text: string; evidence: string[] }[];
  unknowns: string[];
  codeRefs: { file: string; line?: number; evidence: string }[];
  recommendedFix: string;
  nextStep: string;
  rejected: string[]; // model claims dropped by validation, kept for audit
}

export interface RunRecord {
  id: string;
  status: "running" | "done" | "error";
  outcome?: Outcome;
  abstentionReason?: string;
  input: BugInput;
  mode: "demo" | "live";
  aiProvider: string;
  extraction?: Extraction;
  report?: Report;
  evidence: Evidence[];
  toolCalls: ToolCall[];
  progress: { step: string; at: string }[];
  startedAt: string;
  durationMs?: number;
  error?: string;
  linear?: { url: string; identifier: string; simulated?: boolean };
}
