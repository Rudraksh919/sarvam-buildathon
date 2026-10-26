import { SarvamAIClient } from "sarvamai";
import type { ZodType } from "zod";

/** Narrow seam so tests can inject a scripted model. */
export interface AiProvider {
  name: string;
  /** Ask for JSON matching `schema`. Must throw if the output cannot be validated. */
  json<T>(task: "extract" | "synthesize", system: string, user: string, schema: ZodType<T>): Promise<T>;
}

/** Pull the first balanced JSON object out of model text (handles fences / reasoning prefix). */
export function extractJson(text: string): unknown {
  const s = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON object in model output");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { esc = c === "\\" && !esc; if (c === '"' && !esc) inStr = false; if (c !== "\\") esc = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in model output");
}

export class SarvamProvider implements AiProvider {
  name: string;
  private client: SarvamAIClient;
  constructor(apiKey: string, private model: string, private timeoutS: number) {
    this.name = `sarvam:${model}`;
    this.client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
  }

  async json<T>(_task: string, system: string, user: string, schema: ZodType<T>): Promise<T> {
    let feedback = "";
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.chat.completions(
        {
          model: this.model as "sarvam-105b",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user + feedback },
          ],
          temperature: 0.1,
          max_tokens: 12000, // reasoning tokens count against this; too low => empty content
          reasoning_effort: "low",
          response_format: { type: "json_object" },
        },
        { timeoutInSeconds: this.timeoutS, maxRetries: 2 },
      );
      const content = res.choices?.[0]?.message?.content ?? "";
      const finish = res.choices?.[0]?.finish_reason;
      try {
        return schema.parse(extractJson(content));
      } catch (e) {
        lastErr = new Error(`${String(e)} (finish_reason=${finish})`);
        feedback = `\n\nYour previous reply was invalid (${String(e).slice(0, 300)}). Reply with ONLY one valid JSON object matching the schema.`;
      }
    }
    throw new Error(`Sarvam returned unusable output: ${String(lastErr).slice(0, 300)}`);
  }
}
