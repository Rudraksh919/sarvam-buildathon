import { httpJson } from "../http.js";
import type { Config } from "../config.js";

const call = (c: Config, method: string, body: object | null, qs = "") =>
  httpJson<any>(`https://slack.com/api/${method}${qs}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${c.slack.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: c.httpTimeoutMs,
  }).then((r) => { if (!r.ok) throw new Error(`Slack: ${r.error}`); return r; });

/** Recent human messages without replies in the configured channel (oldest first). */
export async function fetchMessages(c: Config, limit = 10): Promise<{ ts: string; text: string }[]> {
  const r = await call(c, "conversations.history", null, `?channel=${c.slack.channel}&limit=${limit}`);
  return (r.messages as any[]).filter((m) => m.text && !m.bot_id && !m.subtype && !m.reply_count).reverse();
}

export async function replyInThread(c: Config, ts: string, text: string) {
  await call(c, "chat.postMessage", { channel: c.slack.channel, thread_ts: ts, text });
}
