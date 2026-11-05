#!/usr/bin/env node
// Browser baseline: startup, page loads, new tab, tab switch, memory and
// Speedometer 3.1. Merlin and Brave run in fresh, isolated test profiles,
// driven over DevTools. Dia runs in your own profile, driven by AppleScript
// in a test window that is closed afterwards (Dia needs onboarding and an
// account for a new profile). See docs/PERFORMANCE.md for the method and the
// baseline. Requires Node 22+ and a Mac left alone while it runs.
//
//   node scripts/benchmark_browsers.mjs --browser merlin-release --out /tmp/bench
//   node scripts/benchmark_browsers.mjs --browser brave --app "/path/Brave Browser.app" --out /tmp/bench
//   node scripts/summarize_benchmarks.mjs /tmp/bench
//
// --skip takes steps to leave out: startup, memory-idle, pageload-local,
// pageload-real, newtab, memory-tabs, real, speedometer. --arg passes an
// extra browser switch (repeatable); --name labels the result file.
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, access } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { CDP } from "./lib/cdp.mjs";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HERE = new URL(".", import.meta.url).pathname;
const REPO = resolve(HERE, "..");
const HOME = homedir();
const CHROMIUM = process.env.CHROMIUM_DIR || `${HOME}/chromium`;

const args = { skip: new Set(), extra: [] };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === "--browser") args.browser = process.argv[++i];
  else if (k === "--out") args.out = process.argv[++i];
  else if (k === "--app") args.app = resolve(process.argv[++i]);
  else if (k === "--arg") args.extra.push(process.argv[++i]);
  else if (k === "--name") args.name = process.argv[++i];
  else if (k === "--skip") process.argv[++i].split(",").forEach((s) => args.skip.add(s));
  else throw Error("unknown argument " + k);
}

const BROWSERS = {
  "merlin-release": { kind: "cdp", app: `${CHROMIUM}/src/out/Release/Merlin.app`, bin: "Merlin", merlin: true },
  "merlin-release-adblock": { kind: "cdp", app: `${CHROMIUM}/src/out/Release/Merlin.app`, bin: "Merlin", merlin: true, extra: ["--enable-features=MerlinAdblock"] },
  "merlin-dev": { kind: "cdp", app: `${CHROMIUM}/src/out/Modal/Merlin.app`, bin: "Merlin", merlin: true },
  brave: { kind: "cdp", app: "/Applications/Brave Browser.app", bin: "Brave Browser" },
  dia: { kind: "dia", app: "/Applications/Dia.app", bin: "Dia" },
};
const B = BROWSERS[args.browser];
if (!B || !args.out) throw Error("usage: --browser " + Object.keys(BROWSERS).join("|") + " --out dir [--app path]");
if (args.app) B.app = args.app;
B.extra = [...(B.extra || []), ...args.extra];
const NAME = args.name || args.browser;
const BIN = join(B.app, "Contents", "MacOS", B.bin);
await access(BIN);
await mkdir(args.out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), NAME, ...a);

// ---------------------------------------------------------------- fixtures
const beacons = new Map(); // id -> epoch ms of onload beacon
const waiters = new Map();
const COLLECT = `<script>
window.__m={};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')
requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__m.visibleAt=Date.now()}))});
</script>`;
const para = (i) => `<p>Paragraph ${i}. ${"The quick brown fox jumps over the lazy dog. ".repeat(8)}</p>`;
function simplePage() {
  return `<!doctype html><meta charset=utf-8><title>Simple</title>${COLLECT}
<style>body{font:16px/1.5 -apple-system;max-width:720px;margin:40px auto}</style>
<h1>A simple article</h1><img src="/img?0" width=640 height=200>${Array.from({ length: 30 }, (_, i) => para(i)).join("")}`;
}
function heavyPage(q, port) {
  const other = `http://localhost:${port}`;
  const css = Array.from({ length: 6 }, (_, i) => `<link rel=stylesheet href="${i % 2 ? other : ""}/css?${i}-${q}">`).join("");
  const js = Array.from({ length: 30 }, (_, i) => `<script src="${i % 3 ? "" : other}/js?${i}-${q}"></script>`).join("");
  const cards = Array.from({ length: 300 }, (_, i) =>
    `<div class=card><img src="${i % 2 ? other : ""}/img?${i % 50}-${q}" width=48 height=48 loading=${i < 40 ? "eager" : "lazy"}>
<h3>Story ${i}</h3><p>${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(3)}</p><a href="#${i}">Read</a> <button>Save</button></div>`).join("");
  return `<!doctype html><meta charset=utf-8><title>Heavy</title>${COLLECT}${css}
<style>@font-face{font-family:F;src:url(/font?${q})}body{font-family:F,-apple-system;margin:0}
.card{display:grid;grid-template-columns:48px 1fr;gap:4px 12px;padding:8px 16px;border-bottom:1px solid #ddd}</style>
<header><h1>Heavy news page</h1></header><main>${cards}</main>${js}`;
}
const GIF = Buffer.concat([Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), Buffer.alloc(6144)]);
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const q = url.search.slice(1);
  const send = (type, body, delay = 0) =>
    setTimeout(() => { res.writeHead(200, { "content-type": type, "cache-control": "no-store", "access-control-allow-origin": "*" }); res.end(body); }, delay);
  const d = () => 5 + Math.floor(Math.random() * 25);
  switch (url.pathname) {
    case "/simple": return send("text/html", simplePage(), 20);
    case "/heavy": return send("text/html", heavyPage(q, port), 40);
    case "/launch":
      return send("text/html", `<!doctype html><title>Launch</title>${COLLECT}<h1>launch</h1>
<script>onload=()=>fetch('/beacon?${q}&t='+Date.now())</script>`);
    case "/beacon": {
      const id = url.searchParams.get("id");
      beacons.set(id, Number(url.searchParams.get("t")));
      waiters.get(id)?.();
      res.writeHead(204); return res.end();
    }
    case "/css": return send("text/css", `.c${q.replace(/\W/g, "")}{color:#333}/*${".".repeat(8192)}*/`, d());
    case "/js": return send("text/javascript",
      `(()=>{const e=performance.now()+4;let x=1;while(performance.now()<e)x=(x*31+7)%1000003;window.__w=(window.__w||0)+x})();`, d());
    case "/img": return send("image/gif", GIF, d());
    case "/font": return send("font/woff2", Buffer.alloc(16384), d());
    default: res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const LOCAL = `http://127.0.0.1:${port}`;
const waitBeacon = (id, ms = 90000) => new Promise((resolve, reject) => {
  if (beacons.has(id)) return resolve(beacons.get(id));
  const t = setTimeout(() => reject(Error("beacon timeout " + id)), ms);
  waiters.set(id, () => { clearTimeout(t); resolve(beacons.get(id)); });
});

// ---------------------------------------------------------------- page JS
const LCP_INSTALL = `(()=>{if(!window.__lcpObs){window.__lcpObs=1;try{new PerformanceObserver(l=>{const e=l.getEntries();window.__lcp=e[e.length-1].startTime}).observe({type:'largest-contentful-paint',buffered:true})}catch(e){}}return 1})()`;
const METRICS = `(()=>{const n=performance.getEntriesByType('navigation')[0]||{};const p=performance.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint');
return JSON.stringify({href:location.href,ready:document.readyState,origin:performance.timeOrigin,ttfb:n.responseStart,dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd,
fcp:p?p.startTime:null,lcp:window.__lcp??null,resources:performance.getEntriesByType('resource').length,visibleAt:(window.__m||{}).visibleAt??null})})()`;

// ---------------------------------------------------------------- drivers
async function treePids(root) {
  const { stdout } = await run("ps", ["-axo", "pid=,ppid="]);
  const kids = new Map();
  for (const line of stdout.trim().split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const out = [root];
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) || []));
  return out;
}
async function memory(root) {
  const pids = await treePids(root);
  const { stdout } = await run("python3", [`${REPO}/scripts/lib/process_footprint.py`, ...pids.map(String)]).catch(async () => {
    // a helper may exit between listing and reading; retry with live pids
    const live = (await treePids(root)).map(String);
    return run("python3", [`${REPO}/scripts/lib/process_footprint.py`, ...live]);
  });
  const j = JSON.parse(stdout);
  return { processes: j.processes.length, footprint_mb: +(j.total_bytes / 1048576).toFixed(1),
    resident_mb: +(j.processes.reduce((s, p) => s + p.resident_bytes, 0) / 1048576).toFixed(1) };
}

class CdpDriver {
  async launch(url, profile) {
    this.profile = profile;
    await mkdir(profile, { recursive: true });
    const env = { ...process.env };
    if (B.merlin) {
      const cfg = join(profile, "xdg");
      await mkdir(join(cfg, "modal_browser"), { recursive: true });
      await copyFile(`${HOME}/.config/modal_browser/config.toml`, join(cfg, "modal_browser", "config.toml")).catch(() => {});
      env.XDG_CONFIG_HOME = cfg;
      env.MODAL_BROWSER_SOCKET = join(profile, "browserctl.sock");
    }
    await rm(join(profile, "DevToolsActivePort"), { force: true });
    const t0 = Date.now();
    this.proc = spawn(BIN, [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run",
      "--no-default-browser-check", "--use-mock-keychain", "--window-size=1440,900", "--window-position=40,40",
      ...(B.extra || []), url], { env, stdio: "ignore" });
    this.pid = this.proc.pid;
    let text;
    for (let i = 0; i < 600 && !text; i++) {
      text = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => null);
      if (!text) await sleep(50);
    }
    if (!text) throw Error("no DevTools port");
    const [p, path] = text.trim().split("\n");
    this.cdp = await CDP.connect(`ws://127.0.0.1:${p}${path}`);
    this.sessions = new Map();
    return t0;
  }
  async session(id) {
    if (!this.sessions.has(id)) {
      const { sessionId } = await this.cdp.call("Target.attachToTarget", { targetId: id, flatten: true });
      this.sessions.set(id, sessionId);
    }
    return this.sessions.get(id);
  }
  async tabs() {
    const { targetInfos } = await this.cdp.call("Target.getTargets");
    return targetInfos.filter((t) => t.type === "page");
  }
  async newTab(url) { return (await this.cdp.call("Target.createTarget", { url })).targetId; }
  async navigate(id, url) { await this.cdp.call("Page.navigate", { url }, await this.session(id)); }
  async eval(id, expression) {
    const r = await this.cdp.call("Runtime.evaluate", { expression, returnByValue: true }, await this.session(id));
    return r.result?.value;
  }
  async activate(id) { await this.cdp.call("Target.activateTarget", { targetId: id }); }
  async close(id) { await this.cdp.call("Target.closeTarget", { targetId: id }); this.sessions.delete(id); }
  async front() {
    await run("osascript", ["-l", "JavaScript", "-e",
      `ObjC.import('AppKit');$.NSRunningApplication.runningApplicationWithProcessIdentifier(${this.pid}).activateWithOptions(3)`]).catch(() => {});
  }
  async quit() {
    try { await this.cdp.call("Browser.close"); } catch {}
    for (let i = 0; i < 100 && this.proc.exitCode === null && this.proc.signalCode === null; i++) await sleep(100);
    if (this.proc.exitCode === null) this.proc.kill("SIGKILL");
    await sleep(1500);
  }
}

// Dia: AppleScript. Tabs are addressed by "<windowId>:<tabId>" inside one test window.
const osa = async (script) => (await run("osascript", ["-e", script], { timeout: 120000 })).stdout.trim();
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
class DiaDriver {
  async launch(url) {
    const t0 = Date.now();
    await run("open", ["-a", B.app, url, "--args", "--enable-applescript-javascript"]);
    for (let i = 0; i < 300 && !this.pid; i++) {
      const { stdout } = await run("pgrep", ["-f", `^${BIN}( |$)`]).catch(() => ({ stdout: "" }));
      this.pid = Number(stdout.trim().split("\n")[0]) || undefined;
      if (!this.pid) await sleep(100);
    }
    return t0;
  }
  async ensureWindow() {
    if (this.win) return;
    const before = new Set((await osa(`tell application "Dia" to get id of every window`)).split(", "));
    await osa(`tell application "Dia" to make new window`);
    await sleep(1500);
    const after = (await osa(`tell application "Dia" to get id of every window`)).split(", ");
    this.win = after.find((w) => !before.has(w)) || after[0];
    this.initialTabs = (await osa(`tell application "Dia" to get id of every tab of window id "${this.win}"`)).split(", ").filter(Boolean);
  }
  async newTab(url) {
    await this.ensureWindow();
    const id = await osa(`tell application "Dia" to get id of (make new tab at end of tabs of window id "${this.win}" with properties {URL:"${esc(url)}"})`);
    return `${this.win}:${id}`;
  }
  ref(id) { const [w, t] = id.split(":"); return `tab id "${t}" of window id "${w}"`; }
  async navigate(id, url) { await osa(`tell application "Dia" to set URL of ${this.ref(id)} to "${esc(url)}"`); }
  async eval(id, js) {
    const out = await osa(`tell application "Dia" to execute ${this.ref(id)} javascript "${esc(js)}"`);
    if (out === "missing value") return null;
    try { return JSON.parse(out); } catch { return out; }
  }
  async activate(id) {
    const [w, t] = id.split(":");
    await osa(`tell application "Dia" to focus tab id "${t}" of window id "${w}"`);
  }
  async close(id) { await osa(`tell application "Dia" to close ${this.ref(id)}`); }
  async front() { await run("open", ["-a", B.app]); }
  async closeWindow() { if (this.win) await osa(`tell application "Dia" to close window id "${this.win}"`).catch(() => {}); this.win = null; }
  async quit() {
    for (let k = 0; k < 3; k++) {
      await osa(`tell application "Dia" to quit`).catch(() => {});
      for (let i = 0; i < 40; i++) {
        const { stdout } = await run("pgrep", ["-f", `^${BIN}( |$)`]).catch(() => ({ stdout: "" }));
        if (!stdout.trim()) { this.pid = undefined; await sleep(2000); return; }
        await sleep(250);
      }
    }
    throw Error("Dia did not quit");
  }
}

// ---------------------------------------------------------------- helpers
const result = { browser: NAME, app: B.app, switches: B.extra, started: new Date().toISOString(), errors: [] };
const median = (a) => { const s = [...a].filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
async function save() { await writeFile(join(args.out, `${NAME}.json`), JSON.stringify(result, null, 1)); }
async function step(name, fn) {
  if (args.skip.has(name)) return;
  log("==>", name);
  try { await fn(); } catch (e) { log("ERROR", name, e.message); result.errors.push({ step: name, error: e.message }); }
  await save();
}
async function waitLoaded(d, id, previousOrigin, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const m = JSON.parse((await d.eval(id, METRICS)) || "null");
      if (m && m.ready === "complete" && m.load > 0 && m.origin !== previousOrigin && !String(m.href).startsWith("about:")) return m;
    } catch {}
    await sleep(100);
  }
  throw Error("load timeout");
}
async function measureLoad(d, id, previousOrigin) {
  await waitLoaded(d, id, previousOrigin);
  await d.eval(id, LCP_INSTALL);
  await sleep(1200);
  return JSON.parse(await d.eval(id, METRICS));
}
const REAL = ["https://en.wikipedia.org/wiki/Web_browser", "https://github.com/rust-lang/rust", "https://www.bbc.com/news",
  "https://www.youtube.com/", "https://stackoverflow.com/questions", "https://news.ycombinator.com/",
  "https://www.reddit.com/r/programming/", "https://www.nytimes.com/", "https://www.amazon.com/",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript"];

const root = await mkdtemp(join(tmpdir(), `bench-${args.browser}-`));
const D = B.kind === "dia" ? new DiaDriver() : new CdpDriver();
const pidOf = () => D.pid;

// ---------------------------------------------------------------- 1 startup
await step("startup", async () => {
  if (B.kind === "dia") {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const id = `dia-${i}-${Date.now()}`;
      const t0 = await D.launch(`${LOCAL}/launch?id=${id}`);
      runs.push((await waitBeacon(id)) - t0);
      await sleep(3000);
      await D.quit();
    }
    result.startup = { note: "user's own profile, Dia not running before each launch", warm_ms: runs, warm_median_ms: median(runs) };
    return;
  }
  const cold = [], warm = [];
  const warmProfile = join(root, "warm");
  for (let i = 0; i < 5; i++) {
    const id = `cold-${i}`;
    const t0 = await D.launch(`${LOCAL}/launch?id=${id}`, join(root, `cold-${i}`));
    cold.push((await waitBeacon(id)) - t0);
    await sleep(2000); await D.quit();
  }
  for (let i = 0; i < 6; i++) {
    const id = `warm-${i}`;
    const t0 = await D.launch(`${LOCAL}/launch?id=${id}`, warmProfile);
    const ms = (await waitBeacon(id)) - t0;
    if (i > 0) warm.push(ms); // first launch creates the profile
    await sleep(2000); await D.quit();
  }
  result.startup = { cold_ms: cold, cold_median_ms: median(cold), warm_ms: warm, warm_median_ms: median(warm) };
});

// main session for everything else
const mainProfile = join(root, "main");
if (B.kind === "dia") {
  const id = `main-${Date.now()}`;
  await D.launch(`${LOCAL}/launch?id=${id}`);
  await waitBeacon(id);
  await sleep(8000); // Dia restores its own windows
} else {
  // a first run creates the profile; measure on a second, warm launch
  const id0 = "main-init", id = "main";
  await D.launch(`${LOCAL}/launch?id=${id0}`, mainProfile); await waitBeacon(id0); await sleep(3000); await D.quit();
  await D.launch(`${LOCAL}/launch?id=${id}`, mainProfile); await waitBeacon(id);
  await sleep(3000);
}
await D.front();
result.memory = {};
await step("memory-idle", async () => {
  await sleep(15000);
  result.memory.idle = await memory(pidOf());
  log("idle", result.memory.idle);
});

// ---------------------------------------------------------------- 2 page loads
let tab;
await step("pageload-local", async () => {
  tab = await D.newTab(`${LOCAL}/simple?warmup`);
  await D.activate(tab); await D.front();
  let prev = (await waitLoaded(D, tab, null)).origin;
  const out = { simple: [], heavy: [] };
  for (let i = 0; i < 8; i++) {
    for (const kind of ["simple", "heavy"]) {
      await D.navigate(tab, `${LOCAL}/${kind}?r${i}`);
      const m = await measureLoad(D, tab, prev); prev = m.origin;
      out[kind].push(m);
    }
  }
  const sum = (a) => ({ fcp_ms: median(a.map((m) => m.fcp)), lcp_ms: median(a.map((m) => m.lcp)), dcl_ms: median(a.map((m) => m.dcl)), load_ms: median(a.map((m) => m.load)) });
  result.pageload_local = { simple: sum(out.simple), heavy: sum(out.heavy), raw: out };
  log("local", JSON.stringify({ simple: result.pageload_local.simple, heavy: result.pageload_local.heavy }));
});
await step("pageload-real", async () => {
  const out = {};
  let prev = null;
  for (let r = 0; r < 3; r++) {
    for (const url of REAL.slice(0, 6)) {
      try {
        await D.navigate(tab, url);
        const m = await measureLoad(D, tab, prev); prev = m.origin;
        (out[url] ||= []).push(m);
      } catch (e) { (out[url] ||= []).push({ error: e.message }); }
    }
  }
  result.pageload_real = Object.fromEntries(Object.entries(out).map(([u, a]) => [u, {
    fcp_ms: median(a.map((m) => m.fcp)), lcp_ms: median(a.map((m) => m.lcp)), load_ms: median(a.map((m) => m.load)), raw: a }]));
  log("real done");
});

// ---------------------------------------------------------------- 3 new tab, tab switch, memory growth
await step("newtab", async () => {
  const withUrl = [];
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    const id = await D.newTab(`${LOCAL}/simple?nt${i}`);
    const m = await waitLoaded(D, id, null);
    withUrl.push(m.origin + m.load - t0);
    await D.close(id);
    await sleep(500);
  }
  result.newtab = { url_to_load_ms: withUrl, url_to_load_median_ms: median(withUrl) };
  if (B.kind === "dia") {
    const oh = [];
    for (let i = 0; i < 8; i++) { const t = Date.now(); await osa(`tell application "Dia" to get name`); oh.push(Date.now() - t); }
    result.applescript_overhead_ms = { ms: oh, median_ms: median(oh) };
  }
  if (B.kind === "cdp") {
    const ntp = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const id = await D.newTab("chrome://newtab/");
      await waitLoaded(D, id, null).catch(() => null);
      const m = JSON.parse(await D.eval(id, METRICS));
      ntp.push(m.load ? m.origin + m.load - t0 : null);
      result.newtab.ntp_href = m.href;
      await D.close(id); await sleep(500);
    }
    result.newtab.ntp_to_load_ms = ntp;
    result.newtab.ntp_median_ms = median(ntp);
  }
  log("newtab", JSON.stringify(result.newtab));
});

const opened = [];
await step("memory-tabs", async () => {
  const openHeavy = async (n) => {
    for (let i = 0; i < n; i++) {
      const id = await D.newTab(`${LOCAL}/heavy?tab${opened.length}`);
      opened.push(id);
      await waitLoaded(D, id, null).catch(() => {});
    }
  };
  await D.front();
  await openHeavy(9);
  await sleep(20000);
  result.memory.tabs10 = await memory(pidOf()); log("10 tabs", result.memory.tabs10);
  // tab switch: activate each background tab and wait for its first frame
  const sw = [];
  for (let i = 0; i < 10; i++) {
    const id = opened[(i * 3) % opened.length];
    const before = Date.now();
    await D.activate(id);
    let vis = null;
    for (let k = 0; k < 50 && !vis; k++) {
      const m = JSON.parse(await D.eval(id, METRICS));
      if (m.visibleAt && m.visibleAt >= before) vis = m.visibleAt;
      else await sleep(20);
    }
    sw.push(vis ? vis - before : null);
    await sleep(400);
  }
  result.tab_switch = { ms: sw, median_ms: median(sw) };
  log("switch", JSON.stringify(result.tab_switch));
  await openHeavy(20);
  await sleep(25000);
  result.memory.tabs30 = await memory(pidOf()); log("30 tabs", result.memory.tabs30);
  for (const id of opened.splice(0)) await D.close(id).catch(() => {});
  await sleep(30000);
  result.memory.after_close = await memory(pidOf()); log("after close", result.memory.after_close);
});

await step("real", async () => {
  await D.front();
  for (const url of REAL) {
    const id = await D.newTab(url);
    opened.push(id);
    await waitLoaded(D, id, null, 45000).catch(() => {});
  }
  await sleep(30000);
  result.memory.real10 = await memory(pidOf()); log("10 real sites", result.memory.real10);
  for (const id of opened.splice(0)) await D.close(id).catch(() => {});
  await sleep(5000);
});

// ---------------------------------------------------------------- 4 Speedometer
await step("speedometer", async () => {
  const id = await D.newTab("https://browserbench.org/Speedometer3.1/?startAutomatically=true");
  await D.activate(id); await D.front();
  const end = Date.now() + 20 * 60000;
  let score = null;
  while (!score && Date.now() < end) {
    await sleep(10000);
    await D.front();
    score = await D.eval(id, `(()=>{const r=document.querySelector('#result-number');return location.hash.includes('summary')&&r&&r.textContent.trim()?r.textContent.trim():''})()`).catch(() => "");
  }
  if (!score) throw Error("Speedometer did not finish");
  result.speedometer = { score: Number(score), raw: score };
  log("speedometer", score);
  await D.close(id).catch(() => {});
});

result.finished = new Date().toISOString();
await save();
if (B.kind === "dia") { await D.closeWindow(); await D.quit(); } else { await D.quit(); await rm(root, { recursive: true, force: true }); }
server.close();
log("done");
process.exit(0);
