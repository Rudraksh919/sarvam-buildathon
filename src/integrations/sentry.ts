import { httpJson } from "../http.js";
import type { Config } from "../config.js";
import type { SentryIssue, SentryLike } from "./types.js";
import { DEMO_SENTRY_ISSUES } from "../../fixtures/demo-data.js";

export class Sentry implements SentryLike {
  constructor(private c: Config) {}
  async issues({ userId, text }: { userId?: string; text?: string }): Promise<SentryIssue[]> {
    const { host, token, org, project } = this.c.sentry;
    const h = { Authorization: `Bearer ${token}` };
    const t = this.c.httpTimeoutMs;
    const query = userId ? `user.id:"${userId.replace(/"/g, "")}"` : (text ?? "").replace(/["\\]/g, " ").slice(0, 200);
    if (!query.trim()) return [];
    const list = await httpJson<any[]>(
      `${host}/api/0/projects/${org}/${project}/issues/?statsPeriod=14d&limit=3&query=${encodeURIComponent(query)}`,
      { headers: h, timeoutMs: t },
    );
    const out: SentryIssue[] = [];
    for (const i of list.slice(0, 3)) {
      const ev = await httpJson<any>(`${host}/api/0/issues/${i.id}/events/latest/`, { headers: h, timeoutMs: t });
      const entries: any[] = ev.entries ?? [];
      const exc = entries.find((e) => e.type === "exception")?.data?.values?.at(-1);
      const frames = ((exc?.stacktrace?.frames ?? []) as any[]).filter((f) => f.inApp !== false).slice(-6)
        .map((f) => ({ filename: f.filename ?? f.absPath, function: f.function, lineno: f.lineNo, context_line: f.context?.find((c: any) => c[0] === f.lineNo)?.[1] }));
      const crumbs = (entries.find((e) => e.type === "breadcrumbs")?.data?.values ?? []).slice(-10)
        .map((b: any) => ({ timestamp: b.timestamp, category: b.category, message: b.message }));
      out.push({ id: String(i.id), title: i.title, userId, count: Number(i.count), lastSeen: i.lastSeen, frames, breadcrumbs: crumbs });
    }
    return out;
  }
}

export class DemoSentry implements SentryLike {
  async issues({ userId, text }: { userId?: string; text?: string }) {
    const words = (text ?? "").toLowerCase().match(/[a-z]{5,}/g) ?? [];
    return DEMO_SENTRY_ISSUES.filter((i) => (userId ? i.userId === userId : words.some((w) => i.title.toLowerCase().includes(w))));
  }
}
