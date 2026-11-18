// Prints Markdown tables from the JSON files benchmark_browsers.mjs writes.
//
//   node scripts/summarize_benchmarks.mjs <results-dir>
import { readFile, readdir } from "node:fs/promises";
const dir = process.argv[2];
if (!dir) throw Error("usage: summarize_benchmarks.mjs <results-dir>");
const order = ["merlin-release", "merlin-engine-only", "merlin-dev", "brave", "dia", "merlin-release-adblock"];
const R = {};
for (const f of await readdir(dir)) if (f.endsWith(".json")) {
  const j = JSON.parse(await readFile(dir + "/" + f, "utf8"));
  if (j.browser && Array.isArray(j.errors)) R[j.browser] = j; // skip other JSON (probe output)
}
const names = [...order.filter((n) => R[n]), ...Object.keys(R).filter((n) => !order.includes(n)).sort()];
const median = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const f0 = (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"));
const row = (label, fn) => `| ${label} | ${names.map((n) => { try { return fn(R[n]); } catch { return "–"; } }).join(" | ")} |`;
const head = (t) => `\n### ${t}\n\n| | ${names.join(" | ")} |\n|---|${names.map(() => "---:").join("|")}|`;
const oh = (r) => r.applescript_overhead_ms?.median_ms ?? 0;
const out = [];
out.push(head("Startup (launch to first page loaded, ms)"));
out.push(row("New profile", (r) => f0(r.startup?.cold_median_ms)));
out.push(row("Existing profile", (r) => f0(r.startup?.warm_median_ms)));
out.push(row("Existing profile, to window on screen", (r) => f0(r.startup?.window_median_ms)));
out.push(head("Memory (physical footprint of all browser processes, MB)"));
for (const [k, l] of [["idle", "Idle, start page"], ["tabs10", "10 heavy local tabs"], ["tabs30", "30 heavy local tabs"], ["after_close", "After closing them"], ["real10", "10 real sites"]])
  out.push(row(l, (r) => f0(r.memory?.[k]?.footprint_mb)));
out.push(row("Per extra tab (10→30)", (r) => f0((r.memory.tabs30.footprint_mb - r.memory.tabs10.footprint_mb) / 20)));
out.push(row("Processes at 30 tabs", (r) => f0(r.memory?.tabs30?.processes)));
out.push(row("100 light tabs", (r) => f0(r.memory?.tabs100?.footprint_mb)));
out.push(row("Browser process, idle", (r) => f0(r.idle?.by_kind?.browser?.footprint_mb)));
out.push(head("Idle (30 s after settling, all processes)"));
out.push(row("CPU %", (r) => r.idle ? r.idle.cpu_percent.toFixed(1) : "–"));
out.push(row("Wakeups per second", (r) => r.idle ? r.idle.wakeups_per_s.toFixed(1) : "–"));
out.push(head("Local test pages (median ms from navigation start)"));
out.push(row("Simple: first paint", (r) => f0(r.pageload_local.simple.fcp_ms)));
out.push(row("Simple: load", (r) => f0(r.pageload_local.simple.load_ms)));
out.push(row("Heavy: first paint", (r) => f0(r.pageload_local.heavy.fcp_ms)));
out.push(row("Heavy: largest paint", (r) => f0(r.pageload_local.heavy.lcp_ms)));
out.push(row("Heavy: load", (r) => f0(r.pageload_local.heavy.load_ms)));
const sites = [...new Set(names.flatMap((n) => Object.keys(R[n].pageload_real || {})))];
out.push(head("Real sites: largest paint (median of 3, ms)"));
for (const s of sites) out.push(row(s.replace(/^https:\/\/(www\.)?/, ""), (r) => f0(r.pageload_real[s]?.lcp_ms)));
out.push(row("**Median across sites**", (r) => f0(median(sites.map((s) => r.pageload_real[s]?.lcp_ms)))));
out.push(head("Real sites: load event (median of 3, ms)"));
for (const s of sites) out.push(row(s.replace(/^https:\/\/(www\.)?/, ""), (r) => f0(r.pageload_real[s]?.load_ms)));
out.push(row("**Median across sites**", (r) => f0(median(sites.map((s) => r.pageload_real[s]?.load_ms)))));
out.push(head("Tabs (median ms)"));
out.push(row("New tab with a page, to loaded", (r) => f0(r.newtab.url_to_load_median_ms - oh(r))));
out.push(row("New tab page, to loaded", (r) => f0(r.newtab.ntp_median_ms)));
out.push(row("Switch to a background tab, to first frame", (r) => r.tab_switch.median_ms == null ? "not measurable" : f0(r.tab_switch.median_ms - oh(r))));
out.push(row("Switch, to page view in the window (Merlin)", (r) => f0(r.tab_switch.shown_median_ms)));
out.push(row("Switch at 100 tabs, to first frame", (r) => f0(r.tab_switch_100?.median_ms)));
out.push(row("Switch at 100 tabs, to page view (Merlin)", (r) => f0(r.tab_switch_100?.shown_median_ms)));
out.push(head("Responsiveness"));
out.push(row("Speedometer 3.1 (higher is better)", (r) => (r.speedometer_runs ? r.speedometer_runs.join(", ") : r.speedometer?.score ?? "–")));
out.push("\nErrors: " + (names.map((n) => R[n].errors.length ? `${n}: ${R[n].errors.map((e) => e.step + " (" + e.error + ")").join(", ")}` : "").filter(Boolean).join("; ") || "none"));
out.push("Dia AppleScript overhead subtracted from its tab timings: " + f0(R.dia ? oh(R.dia) : null) + " ms");
console.log(out.join("\n"));
