export interface PhEvent { distinct_id: string; event: string; timestamp: string; properties?: Record<string, unknown> }
export interface SentryFrame { filename: string; function?: string; lineno?: number; context_line?: string }
export interface SentryIssue {
  id: string; title: string; userId?: string; count?: number; lastSeen?: string;
  frames: SentryFrame[]; breadcrumbs: { timestamp?: string; category?: string; message?: string }[];
}
export interface PostHogLike { events(q: { userId: string; from?: string; to?: string }): Promise<PhEvent[]> }
export interface SentryLike { issues(q: { userId?: string; text?: string }): Promise<SentryIssue[]> }
export interface CodeHit { file: string; startLine: number; endLine: number; line: number; text: string; terms: string[] }
export interface RepoLike {
  root: string;
  search(terms: string[], max?: number): Promise<CodeHit[]>;
  window(file: string, line: number, radius?: number): Promise<CodeHit | null>;
}
