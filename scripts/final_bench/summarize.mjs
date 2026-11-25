#!/usr/bin/env node
// Turns results.jsonl from bench.mjs into Markdown tables (median (min–max, n)).
//   node summarize.mjs DIR/results.jsonl > tables.md
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ORDER = (process.argv[3] || "merlin,ardia,dia,brave,zen,arc").split(",");
const NAMES = { merlin: "Merlin", ardia: "Ardia", dia: "Dia", brave: "Brave", zen: "Zen", arc: "Arc" };
const sorted = (a) => a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y);
const median = (a) => { const s = sorted(a); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (v, d) => v == null ? "—" : (Math.abs(v) >= 100 && d < 2 ? Math.round(v).toLocaleString("en-US") : v.toFixed(d));

function cell(values, d, { lowerBetter = true } = {}) {
  const s = sorted(values);
  const missing = values.length - s.length;
  if (!s.length) return values.length ? "never" : "—";
  const m = median(s);
  let out = `${fmt(m, d)}`;
  if (s.length > 1) out += ` (${fmt(s[0], d)}–${fmt(s[s.length - 1], d)}, n=${s.length})`;
  if (missing) out += ` +${missing} never`;
  return out;
}
function bestOf(values) { return median(values); }
function table(title, defs, note) {
  const out = [`| ${title} | ${ORDER.map((b) => NAMES[b]).join(" | ")} |`, `|---|${ORDER.map(() => "---").join("|")}|`];
  for (const def of defs) {
    const vals = ORDER.map((b) => def.get(rows.filter((r) => r.browser === b && r.row === def.row && (!def.filter || def.filter(r)))));
    const meds = vals.map((v) => bestOf(v));
    const present = meds.filter((m) => m != null);
    const best = present.length ? (def.higher ? Math.max(...present) : Math.min(...present)) : null;
    const cells = vals.map((v, i) => { const c = cell(v, def.d ?? 0); return meds[i] != null && meds[i] === best && present.length > 1 ? `**${c}**` : c; });
    out.push(`| ${def.label} | ${cells.join(" | ")} |`);
  }
  if (note) out.push("", note);
  return out.join("\n");
}
const v = (k) => (rs) => rs.map((r) => r[k]);
const kindOf = (kind, k) => (rs) => rs.map((r) => r.by_kind?.[kind]?.[k] ?? (r.by_kind ? 0 : null));
const memKind = (kind) => (rs) => rs.map((r) => r.detail?.by_kind?.[kind] ?? (r.detail ? 0 : null));

const sections = [];
sections.push(table("Startup and responsiveness (ms, lower is better)", [
  { label: "Cold launch → window on screen", row: "launch-window", get: v("ms") },
  { label: "Cold launch → page painted (link from another app)", row: "launch-link", get: v("ms") },
  { label: "Cold launch → restored tab painted", row: "launch-restore", get: v("ms") },
  { label: "New tab → first paint", row: "newtab", get: v("ms"), d: 1 },
  { label: "Tab switch → shown (20 tabs)", row: "switch", get: (rs) => rs.flatMap((r) => r.samples), d: 1 },
  { label: "Tab switch → shown (50 tabs)", row: "switch-50", get: (rs) => rs.flatMap((r) => r.samples), d: 1 },
  { label: "New window → first paint", row: "newwindow", get: v("ms"), d: 1 },
]));
sections.push(table("Memory, all processes, MB (lower is better)", [
  { label: "1 tab", row: "memory-1", get: v("mb") },
  { label: "10 tabs", row: "memory-10", get: v("mb") },
  { label: "20 tabs", row: "memory-20", get: v("mb") },
  { label: "Back to 1 tab after 20", row: "memory-closed", get: v("mb") },
  { label: "50 light tabs", row: "memory-50", get: v("mb") },
  { label: "10 real websites", row: "memory-real-10", get: v("mb") },
  { label: "Back to 1 tab after 10 real sites", row: "memory-real-closed", get: v("mb") },
]));
sections.push(table("Processes running", [
  { label: "1 tab", row: "memory-1", get: (rs) => rs.map((r) => r.detail?.processes) },
  { label: "20 tabs", row: "memory-20", get: (rs) => rs.map((r) => r.detail?.processes) },
  { label: "10 real websites", row: "memory-real-10", get: (rs) => rs.map((r) => r.detail?.processes) },
]));
sections.push(table("Memory by process kind, MB", [
  { label: "1 tab: browser", row: "memory-1", get: memKind("browser") },
  { label: "1 tab: GPU", row: "memory-1", get: memKind("gpu") },
  { label: "1 tab: renderers", row: "memory-1", get: memKind("renderer") },
  { label: "1 tab: utility/other", row: "memory-1", get: (rs) => rs.map((r) => r.detail ? Object.entries(r.detail.by_kind).filter(([k]) => !["browser", "gpu", "renderer"].includes(k)).reduce((s, [, x]) => s + x, 0) : null) },
  { label: "20 tabs: browser", row: "memory-20", get: memKind("browser") },
  { label: "20 tabs: GPU", row: "memory-20", get: memKind("gpu") },
  { label: "20 tabs: renderers", row: "memory-20", get: memKind("renderer") },
]));
sections.push(table("Idle CPU, % of one core (lower is better)", [
  { label: "1 tab", row: "idle-1", get: v("cpu_percent"), d: 2 },
  { label: "1 tab, settled", row: "idle-1-settled", get: v("cpu_percent"), d: 2 },
  { label: "20 tabs", row: "idle-20", get: v("cpu_percent"), d: 2 },
  { label: "20 tabs, settled", row: "idle-20-settled", get: v("cpu_percent"), d: 2 },
  { label: "10 real websites", row: "idle-real-10", get: v("cpu_percent"), d: 2 },
]));
sections.push(table("Idle wakeups per second (lower is better)", [
  { label: "1 tab", row: "idle-1", get: v("idle_wakeups_per_s"), d: 1 },
  { label: "1 tab, settled", row: "idle-1-settled", get: v("idle_wakeups_per_s"), d: 1 },
  { label: "20 tabs", row: "idle-20", get: v("idle_wakeups_per_s"), d: 1 },
  { label: "20 tabs, settled", row: "idle-20-settled", get: v("idle_wakeups_per_s"), d: 1 },
  { label: "10 real websites", row: "idle-real-10", get: v("idle_wakeups_per_s"), d: 1 },
]));
sections.push(table("Idle CPU energy, mW (lower is better)", [
  { label: "1 tab", row: "idle-1", get: v("cpu_energy_mw"), d: 1 },
  { label: "1 tab, settled", row: "idle-1-settled", get: v("cpu_energy_mw"), d: 1 },
  { label: "20 tabs", row: "idle-20", get: v("cpu_energy_mw"), d: 1 },
  { label: "20 tabs, settled", row: "idle-20-settled", get: v("cpu_energy_mw"), d: 1 },
  { label: "10 real websites", row: "idle-real-10", get: v("cpu_energy_mw"), d: 1 },
]));
sections.push(table("CPU energy with 11 tabs open, mW (lower is better)", [
  { label: "Idle, window in view", row: "energy-idle-visible", get: v("cpu_energy_mw"), d: 1 },
  { label: "Idle, app hidden", row: "energy-idle-hidden", get: v("cpu_energy_mw"), d: 1 },
  { label: "Scrolling", row: "energy-scroll", get: v("cpu_energy_mw"), d: 1 },
  { label: "Playing a 1080p video", row: "energy-video", get: v("cpu_energy_mw"), d: 1 },
  { label: "Switching tabs (1/s)", row: "energy-switch", get: v("cpu_energy_mw"), d: 1 },
]));
sections.push(table("CPU use with 11 tabs open, % of one core", [
  { label: "Idle, window in view", row: "energy-idle-visible", get: v("cpu_percent"), d: 2 },
  { label: "Idle, app hidden", row: "energy-idle-hidden", get: v("cpu_percent"), d: 2 },
  { label: "Scrolling", row: "energy-scroll", get: v("cpu_percent"), d: 1 },
  { label: "Playing a 1080p video", row: "energy-video", get: v("cpu_percent"), d: 1 },
  { label: "Switching tabs (1/s)", row: "energy-switch", get: v("cpu_percent"), d: 1 },
]));
sections.push(table("Web benchmarks (higher is better)", [
  { label: "Speedometer 3.1", row: "speedometer", get: v("score"), d: 1, higher: true },
  { label: "JetStream 3.0", row: "jetstream", get: v("score"), d: 1, higher: true },
  { label: "MotionMark 1.3.2", row: "motionmark", get: v("score"), d: 1, higher: true },
]));

// real-site load timings
const REAL = [...new Set(rows.filter((r) => r.row === "memory-real-10").flatMap((r) => Object.keys(r.loads || {})))];
if (REAL.length) {
  const out = [`| Real-site first load: FCP / load (ms) | ${ORDER.map((b) => NAMES[b]).join(" | ")} |`, `|---|${ORDER.map(() => "---").join("|")}|`];
  for (const u of REAL) {
    out.push(`| ${u.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "")} | ${ORDER.map((b) => {
      const r = rows.find((x) => x.browser === b && x.row === "memory-real-10");
      const l = r?.loads?.[u];
      return l ? `${l.fcp ?? "—"} / ${l.load ?? "—"}` : "—";
    }).join(" | ")} |`);
  }
  const med = (k) => ORDER.map((b) => { const r = rows.find((x) => x.browser === b && x.row === "memory-real-10"); return r ? median(Object.values(r.loads || {}).map((l) => l?.[k])) : null; });
  out.push(`| **Median FCP / LCP / load** | ${ORDER.map((_, i) => `${fmt(med("fcp")[i], 0)} / ${fmt(med("lcp")[i], 0)} / ${fmt(med("load")[i], 0)}`).join(" | ")} |`);
  sections.push(out.join("\n"));
}
const errs = rows.filter((r) => r.row === "error");
if (errs.length) sections.push("Errors:\n" + errs.map((e) => `- ${e.browser} ${e.suite}: ${e.error}`).join("\n"));
const notes = rows.filter((r) => (r.row === "newwindow" && r.notes) || r.row === "energy-video-check");
if (notes.length) sections.push("Notes:\n" + notes.map((e) => `- ${e.browser} ${e.row}: ${e.notes ?? JSON.stringify(e.playing)}`).join("\n"));
console.log(sections.join("\n\n"));
