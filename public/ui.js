// API access: same-origin by default; on Vercel, config.js sets window.API_BASE to the Render URL.
// The access token is typed by the user and kept in localStorage (never baked into the bundle).
export async function api(path, opts = {}) {
  const base = (window.API_BASE || "").replace(//$/, "");
  const call = () => fetch(base + path, { ...opts, headers: { ...(opts.headers || {}), ...(localStorage.token ? { Authorization: "Bearer " + localStorage.token } : {}) } });
  let res = await call();
  if (res.status === 401) {
    const t = prompt("Access token required:");
    if (t) { localStorage.token = t.trim(); res = await call(); }
  }
  return res;
}

// Shared rendering. All dynamic text goes through textContent (no innerHTML) so evidence data can't inject markup.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const COLORS = { DIAGNOSED: "ok", NO_SESSION: "warn", NO_DIAGNOSIS: "warn", SKIPPED: "mute" };
const EXPLAIN = {
  DIAGNOSED: "Root cause established from evidence.",
  NO_SESSION: "The relevant user/session could not be located.",
  NO_DIAGNOSIS: "Abstained: no reliable root cause could be established.",
  SKIPPED: "Not a valid bug report; nothing was investigated.",
};
export const badge = (t, cls = "mute") => h("span", { class: `badge ${cls}` }, t);

export function renderRun(run, { onLinear } = {}) {
  const root = h("div", { class: "run" });
  const synth = run.evidence.some((e) => e.synthetic);
  root.append(h("div", { class: "meta" },
    badge(run.mode === "demo" ? "DEMO MODE" : "LIVE", run.mode === "demo" ? "warn" : "ok"),
    synth && badge("SYNTHETIC EVIDENCE – fixture data, no real service was queried", "warn"),
    badge(`AI: ${run.aiProvider}`), badge(`${run.durationMs ?? "…"} ms`), badge(new Date(run.startedAt).toLocaleString())));

  if (run.status === "running") {
    root.append(h("ol", { class: "steps" }, run.progress.map((p, i) => h("li", { class: i === run.progress.length - 1 ? "now" : "" }, p.step))));
    return root;
  }
  if (run.error) root.append(h("div", { class: "err" }, `Error: ${run.error}`));

  root.append(h("div", { class: `banner ${COLORS[run.outcome] ?? "mute"}` },
    h("b", {}, run.outcome), " — ", EXPLAIN[run.outcome] ?? "",
    run.report && h("span", { class: "conf" }, ` Confidence ${(run.report.confidence * 100).toFixed(0)}%`)));
  if (run.abstentionReason) root.append(h("p", { class: "abstain" }, "Why: ", run.abstentionReason));

  const r = run.report;
  const chips = (ids) => ids.map((id) => h("a", { class: "chip", href: `#ev-${run.id}-${id}` }, id));
  if (r) {
    if (run.outcome === "DIAGNOSED") root.append(h("h3", {}, "Probable root cause"), h("p", { class: "cause" }, r.rootCause));
    if (r.facts.length) root.append(h("h3", {}, "Observed facts"), h("ul", {}, r.facts.map((f) => h("li", {}, f.text, " ", chips(f.evidence)))));
    if (r.inferences.length) root.append(h("h3", {}, "Inferences (reasoning over facts)"), h("ul", {}, r.inferences.map((f) => h("li", {}, f.text, " ", chips(f.evidence)))));
    if (r.codeRefs.length) root.append(h("h3", {}, "Source code references"), h("ul", {}, r.codeRefs.map((c) => h("li", {}, h("code", {}, `${c.file}${c.line ? ":" + c.line : ""}`), " ", chips([c.evidence])))));
    if (r.recommendedFix) root.append(h("h3", {}, "Recommended fix"), h("p", {}, r.recommendedFix));
    if (r.nextStep) root.append(h("h3", {}, "Next debugging step"), h("p", {}, r.nextStep));
    if (r.unknowns.length) root.append(h("h3", {}, "Missing information / unresolved questions"), h("ul", {}, r.unknowns.map((u) => h("li", {}, u))));
    if (r.rejected.length) root.append(h("details", {}, h("summary", {}, `${r.rejected.length} model claim(s) rejected by validation`), h("ul", {}, r.rejected.map((u) => h("li", {}, u)))));
  }

  if (run.outcome === "DIAGNOSED" && onLinear) {
    const out = h("span", { class: "linout" });
    if (run.linear) out.append(h("a", { href: run.linear.url, target: "_blank", rel: "noreferrer" }, `Linear ${run.linear.identifier}`));
    else root.append(h("button", { onclick: async (e) => {
      e.target.disabled = true; out.textContent = "Creating…";
      const res = await api(`/api/runs/${run.id}/linear`, { method: "POST" });
      const j = await res.json();
      out.textContent = "";
      if (res.ok) out.append(h("a", { href: j.url, target: "_blank", rel: "noreferrer" }, `Created ${j.identifier}`));
      else { out.append(h("span", { class: "err" }, j.error)); if (j.preview) out.append(h("details", {}, h("summary", {}, "Issue preview (not sent)"), h("pre", {}, j.preview))); e.target.disabled = false; }
    } }, "Create Linear issue"));
    root.append(out);
  } else if (run.linear) root.append(h("p", {}, h("a", { href: run.linear.url, target: "_blank", rel: "noreferrer" }, `Linear ${run.linear.identifier}`)));

  root.append(h("h3", {}, "Evidence"));
  for (const e of run.evidence) {
    root.append(h("details", { class: "ev", id: `ev-${run.id}-${e.id}` },
      h("summary", {}, h("b", {}, e.id), " ", badge(e.source), e.synthetic ? badge("synthetic", "warn") : e.source === "report" ? badge("user input") : badge("retrieved", "ok"), " ", e.summary),
      h("pre", {}, JSON.stringify(e.data, null, 2))));
  }
  root.append(h("h3", {}, "Tool calls"), h("table", {}, h("tr", {}, ["tool", "status", "evidence", "ms", "note"].map((t) => h("th", {}, t))),
    run.toolCalls.map((t) => h("tr", {}, h("td", {}, t.tool), h("td", { class: `st-${t.status}` }, t.status), h("td", {}, t.evidenceIds.join(", ")), h("td", {}, t.ms), h("td", {}, t.note ?? "")))));
  return root;
}
