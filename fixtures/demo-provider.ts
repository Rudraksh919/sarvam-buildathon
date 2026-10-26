import type { ZodType } from "zod";
import type { AiProvider } from "../src/ai/provider.js";

/**
 * Scripted stand-in used ONLY in demo mode when no Sarvam key is configured.
 * It is not an AI model: it applies fixed rules and is labelled as such in every run record.
 */
export class DemoProvider implements AiProvider {
  name = "demo-scripted (NOT an AI model)";
  async json<T>(task: string, _system: string, user: string, schema: ZodType<T>): Promise<T> {
    if (task === "extract") {
      const m = user.match(/Report:\s*([\s\S]*?)(?:\nUser id:|$)/);
      const text = (m?.[1] ?? user).trim();
      const isBug = /spin|crash|error|fail|broken|slow|stuck|doesn'?t work|bug/i.test(text);
      const kw = [...new Set(text.toLowerCase().match(/[a-z]{5,}/g) ?? [])].slice(0, 6);
      return schema.parse({ isBug, reason: isBug ? "" : "No broken behaviour described", title: text.slice(0, 80), summary: text, keywords: kw, symbols: [] });
    }
    // synthesize: look for the pay.ts evidence ids in the prompt
    const find = (re: RegExp) => user.match(re)?.[1];
    const code = find(/(E\d+) \[repo[^\]]*\][^\n]*pay\.ts/);
    const sentry = find(/(E\d+) \[sentry[^\]]*\]/);
    const ph = find(/(E\d+) \[posthog[^\]]*\]/);
    if (!code || !sentry) {
      return schema.parse({ status: "NO_DIAGNOSIS", confidence: 0.1, unknowns: ["No exception or implicating source code was found"], nextStep: "Provide a user id, time window or error text." });
    }
    return schema.parse({
      status: "DIAGNOSED",
      rootCause: "handlePay dereferences order.paymentIntent.id, but createOrder returns no paymentIntent for fully-discounted carts (total 0). The TypeError is thrown before setSpinner(false), so the spinner never stops.",
      confidence: 0.9,
      facts: [
        { text: "A TypeError 'reading id of undefined' was thrown at src/checkout/pay.ts:10 in handlePay.", evidence: [sentry] },
        { text: "pay.ts reads intent.id with no guard and only resets the spinner on the success path.", evidence: [code] },
        ...(ph ? [{ text: "The user applied a 100% coupon, clicked pay with cart_total 0, then an exception fired.", evidence: [ph] }] : []),
      ],
      inferences: [{ text: "A zero-total order has no paymentIntent, so intent is undefined.", evidence: [code, sentry] }],
      unknowns: ["Whether other zero-total flows (gift cards) hit the same path"],
      codeRefs: [{ file: "src/checkout/pay.ts", line: 10, evidence: code }],
      recommendedFix: "Skip confirmPayment when order.total === 0 (or intent is undefined) and wrap the handler in try/finally so setSpinner(false) always runs.",
      nextStep: "Add a regression test for a fully-discounted cart.",
    });
  }
}
