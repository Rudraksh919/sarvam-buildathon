import { httpJson } from "../http.js";
import type { Config } from "../config.js";
import type { PhEvent, PostHogLike } from "./types.js";
import { DEMO_POSTHOG_EVENTS } from "../../fixtures/demo-data.js";

const SAFE_ID = /^[\w@.+:\-]{1,128}$/;
const SAFE_TS = /^[\d\-T:.Z+ ]{8,40}$/;

export class PostHog implements PostHogLike {
  constructor(private c: Config) {}
  async events({ userId, from, to }: { userId: string; from?: string; to?: string }): Promise<PhEvent[]> {
    if (!SAFE_ID.test(userId)) throw new Error("userId contains unsupported characters");
    if ((from && !SAFE_TS.test(from)) || (to && !SAFE_TS.test(to))) throw new Error("invalid time window");
    const { host, apiKey, projectId } = this.c.posthog;
    const where = [
      `(distinct_id = '${userId}' OR person.properties.email = '${userId}')`,
      from ? `timestamp >= toDateTime('${from}')` : `timestamp >= now() - INTERVAL 14 DAY`,
      to ? `timestamp <= toDateTime('${to}')` : "",
    ].filter(Boolean).join(" AND ");
    const body = { query: { kind: "HogQLQuery", query: `SELECT distinct_id, event, toString(timestamp), properties FROM events WHERE ${where} ORDER BY timestamp ASC LIMIT 80` } };
    const r = await httpJson<{ results: [string, string, string, string | object][] }>(`${host}/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: this.c.httpTimeoutMs,
    });
    return (r.results ?? []).map(([distinct_id, event, timestamp, props]) => ({
      distinct_id, event, timestamp, properties: typeof props === "string" ? safeParse(props) : (props as any),
    }));
  }
}
const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };

export class DemoPostHog implements PostHogLike {
  async events({ userId }: { userId: string }) { return DEMO_POSTHOG_EVENTS.filter((e) => e.distinct_id === userId); }
}
