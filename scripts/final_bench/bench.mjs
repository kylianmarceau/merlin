#!/usr/bin/env node
// Cross-browser benchmark: Merlin, Ardia, Dia, Brave, Zen, Arc.
// One harness drives every browser from outside, one at a time, rounds
// interleaved and rotated. Chromium browsers over DevTools (CDP), Zen over
// WebDriver BiDi. Process numbers come from proc_pid_rusage (probe.c) over
// every process of the instance (its tree plus anything running from inside
// its bundle).
//
//   node bench.mjs --out DIR [--browsers merlin,ardia,...] [--rounds 3]
//        [--suites launch,session,real,scale,energy,web]
//
// Results are appended as JSON lines to DIR/results.jsonl.
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { mkdir, writeFile, appendFile, rm, copyFile, access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { CDP } from "../lib/cdp.mjs";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = homedir();
const HERE = new URL(".", import.meta.url).pathname;

const args = { rounds: 3, launches: 2, browsers: "merlin,ardia,dia,brave,zen,arc", suites: "launch,session,real,scale,energy,web" };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, "");
  args[k] = process.argv[++i];
}
if (!args.out) throw Error("--out DIR required");
const OUT = resolve(args.out);
const WORK = join(OUT, "work");
await mkdir(WORK, { recursive: true });
const ROUNDS = Number(args.rounds), LAUNCHES = Number(args.launches);
const SUITES = new Set(args.suites.split(","));
const PROBE = args.probe || join(OUT, "probe");
const WINDOW_PROBE = join(OUT, "window_onscreen");
const VIDEO = args.video;
const MERLIN_APP = args.merlin;
const QUICK = args.quick === "1";
const IDLE_S = QUICK ? 30 : 60, SETTLED = !QUICK, RESTORE_TIMEOUT = QUICK ? 10000 : 30000;
const SUITE_DIR = args.suites_dir ? resolve(args.suites_dir) : null;
const MIME = { html: "text/html; charset=utf-8", js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript", css: "text/css", json: "application/json",
  wasm: "application/wasm", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", ico: "image/x-icon", webp: "image/webp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", txt: "text/plain", mp4: "video/mp4", webm: "video/webm", xml: "application/xml", map: "application/json", z: "application/octet-stream" };

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const median = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
async function record(row) { await appendFile(join(OUT, "results.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"); }

// ------------------------------------------------------------------ server
// beacons: {id, k, t (page epoch ms), recv (harness epoch ms)}
const beacons = [];
const beaconWaiters = new Set();
const PAGE_JS = `<script>
(()=>{const id=new URLSearchParams(location.search).get('id')||'none';
const b=(k,t)=>{try{fetch('/b?id='+encodeURIComponent(id)+'&k='+k+'&t='+t,{keepalive:true,cache:'no-store'})}catch(e){}};
try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.name==='first-contentful-paint')b('fcp',(performance.timeOrigin+e.startTime).toFixed(1))}).observe({type:'paint',buffered:true})}catch(e){}
addEventListener('load',()=>b('load',(performance.timeOrigin+performance.now()).toFixed(1)));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')requestAnimationFrame(()=>requestAnimationFrame(()=>b('vis',Date.now())))});
window.__lcp=null;try{new PerformanceObserver(l=>{const e=l.getEntries();window.__lcp=e[e.length-1].startTime}).observe({type:'largest-contentful-paint',buffered:true})}catch(e){}
})();</script>`;
const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
function benchPage() {
  // like Ardia's native-bench page: 60 boxes, 120 paragraphs, a 1 s timer
  const boxes = Array.from({ length: 60 }, (_, i) => `<div class=box style="background:hsl(${i * 6},60%,70%)">${i}</div>`).join("");
  const paras = Array.from({ length: 120 }, (_, i) => `<p>${i}. ${LOREM.repeat(2)}</p>`).join("");
  return `<!doctype html><meta charset=utf-8><title>Bench</title>${PAGE_JS}
<style>body{font:15px/1.45 -apple-system,sans-serif;margin:24px}.grid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px}.box{height:48px;border-radius:8px;display:grid;place-items:center}</style>
<h1>Benchmark page <span id=clock></span></h1><div class=grid>${boxes}</div>${paras}
<script>setInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleTimeString()},1000)</script>`;
}
function litePage() {
  return `<!doctype html><meta charset=utf-8><title>Lite</title>${PAGE_JS}<style>body{font:16px -apple-system;margin:40px}</style>
<h1>Light page</h1>${Array.from({ length: 20 }, (_, i) => `<p>${LOREM}</p>`).join("")}`;
}
function longPage() {
  return `<!doctype html><meta charset=utf-8><title>Long</title>${PAGE_JS}<style>body{font:16px/1.5 -apple-system;margin:0 auto;max-width:800px}
.card{margin:16px;padding:16px;border-radius:12px;background:linear-gradient(135deg,#eef,#fee);box-shadow:0 2px 8px #0002}</style>
${Array.from({ length: 400 }, (_, i) => `<div class=card><h3>Card ${i}</h3><p>${LOREM.repeat(3)}</p></div>`).join("")}`;
}
function videoPage() {
  return `<!doctype html><meta charset=utf-8><title>Video</title>${PAGE_JS}<style>body{margin:0;background:#000}video{width:100vw;height:100vh;object-fit:contain}</style>
<video src="/video.mp4" autoplay muted loop playsinline></video>`;
}
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const html = (body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(body); };
  switch (url.pathname) {
    case "/bench": return html(benchPage());
    case "/lite": return html(litePage());
    case "/long": return html(longPage());
    case "/video": return html(videoPage());
    case "/video.mp4": {
      const size = statSync(VIDEO).size;
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (range) {
        const start = Number(range[1]), end = range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
        return createReadStream(VIDEO, { start, end }).pipe(res);
      }
      res.writeHead(200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": size });
      return createReadStream(VIDEO).pipe(res);
    }
    case "/b": {
      beacons.push({ id: url.searchParams.get("id"), k: url.searchParams.get("k"), t: Number(url.searchParams.get("t")), recv: Date.now() });
      for (const w of beaconWaiters) w();
      res.writeHead(204, { "access-control-allow-origin": "*" }); return res.end();
    }
    case "/favicon.ico": res.writeHead(204); return res.end();
    default: {
      // local mirrors of Speedometer 3.1, JetStream 3.0 and MotionMark 1.3.2
      if (SUITE_DIR && url.pathname.startsWith("/suites/")) {
        let f = join(SUITE_DIR, decodeURIComponent(url.pathname.slice(8)));
        if (!f.startsWith(SUITE_DIR)) { res.writeHead(403); return res.end(); }
        try { if (statSync(f).isDirectory()) f = join(f, "index.html"); } catch {}
        try {
          const st = statSync(f);
          const ext = f.split(".").pop().toLowerCase();
          res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "content-length": st.size, "cache-control": "no-cache" });
          return createReadStream(f).pipe(res);
        } catch { appendFile(join(OUT, "404.log"), url.pathname + "\n").catch(() => {}); res.writeHead(404); return res.end(); }
      }
      res.writeHead(404); res.end();
    }
  }
});
await new Promise((r) => server.listen(9462, "127.0.0.1", r));
const LOCAL = "http://127.0.0.1:9462";
function waitBeacon(pred, ms = 30000) {
  return new Promise((resolve, reject) => {
    const check = () => { const b = beacons.find(pred); if (b) { beaconWaiters.delete(check); clearTimeout(timer); resolve(b); return true; } return false; };
    const timer = setTimeout(() => { beaconWaiters.delete(check); reject(Error("beacon timeout")); }, ms);
    if (!check()) beaconWaiters.add(check);
  });
}
let uid = 0;
const newId = (p) => `${p}-${Date.now().toString(36)}-${uid++}`;

// ------------------------------------------------------------------ probes
async function probe(B, pid) {
  const { stdout } = await run(PROBE, [B.bundle, String(pid)], { maxBuffer: 1 << 24 });
  return JSON.parse(stdout);
}
function summarizeMemory(p) {
  const byKind = {};
  for (const x of p.processes) {
    const k = kindName(x.kind);
    byKind[k] = (byKind[k] || 0) + x.footprint / 1048576;
  }
  return {
    total_mb: +(p.processes.reduce((s, x) => s + x.footprint, 0) / 1048576).toFixed(1),
    resident_mb: +(p.processes.reduce((s, x) => s + x.resident, 0) / 1048576).toFixed(1),
    processes: p.processes.length,
    by_kind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, +v.toFixed(1)])),
  };
}
function kindName(k) {
  if (k === "browser") return "browser";
  if (k === "gpu-process" || k === "ff-gpu") return "gpu";
  if (k === "renderer" || k === "ff-tab") return "renderer";
  if (k === "utility" || k.startsWith("ff-")) return "utility";
  return k;
}
async function memory(B, pid) { return summarizeMemory(await probe(B, pid)); }
// CPU %, wakeups/s and CPU energy (mW) over `seconds`, every process.
async function activity(B, pid, seconds, during) {
  const a = await probe(B, pid);
  if (during) await during(seconds); else await sleep(seconds * 1000);
  const b = await probe(B, pid);
  const dt = (b.t - a.t) / 1000;
  const prev = new Map(a.processes.map((x) => [x.pid, x]));
  let cpu = 0, idlew = 0, intw = 0, nj = 0, written = 0;
  const byKind = {};
  for (const x of b.processes) {
    const p = prev.get(x.pid) || { cpu_ns: 0, idle_wakeups: 0, int_wakeups: 0, energy_nj: 0, disk_written: 0 };
    const d = { cpu: (x.cpu_ns - p.cpu_ns) / 1e9 / dt * 100, w: (x.idle_wakeups - p.idle_wakeups) / dt, e: (x.energy_nj - p.energy_nj) / dt / 1e6 };
    cpu += d.cpu; idlew += d.w; intw += (x.int_wakeups - p.int_wakeups) / dt; nj += d.e; written += x.disk_written - p.disk_written;
    const k = kindName(x.kind);
    const s = (byKind[k] ||= { cpu: 0, wakeups: 0, mw: 0 });
    s.cpu += d.cpu; s.wakeups += d.w; s.mw += d.e;
  }
  const r = (v, n = 2) => +v.toFixed(n);
  return { seconds: r(dt, 1), cpu_percent: r(cpu), idle_wakeups_per_s: r(idlew, 1), interrupt_wakeups_per_s: r(intw, 1), cpu_energy_mw: r(nj, 1),
    disk_written_kb_per_min: r(written / 1024 / dt * 60, 1),
    by_kind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { cpu: r(v.cpu), wakeups: r(v.wakeups, 1), mw: r(v.mw, 1) }])) };
}
async function windowShownAt(pid, ms = 20000) {
  const { stdout } = await run(WINDOW_PROBE, [String(pid), String(ms)]).catch(() => ({ stdout: "-1" }));
  const at = Number(stdout.trim());
  return at > 0 ? at : null;
}
async function pidsOf(bin) {
  const { stdout } = await run("pgrep", ["-f", `^${bin}( |$)`]).catch(() => ({ stdout: "" }));
  return stdout.split("\n").filter(Boolean).map(Number);
}
async function front(pid) {
  await run("osascript", ["-l", "JavaScript", "-e",
    `ObjC.import('AppKit');$.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).activateWithOptions(3)`]).catch(() => {});
}
async function hideApp(pid) {
  await run("osascript", ["-l", "JavaScript", "-e",
    `ObjC.import('AppKit');$.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).hide`]).catch(() => {});
}
async function unhideApp(pid) {
  await run("osascript", ["-l", "JavaScript", "-e",
    `ObjC.import('AppKit');$.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).unhide`]).catch(() => {});
}

// ------------------------------------------------------------------ browsers
const CHROMIUM_FRESH = ["--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic",
  "--window-size=1280,800", "--window-position=40,80"];
const BROWSERS = {
  merlin: { name: "Merlin", app: MERLIN_APP, bin: "Merlin", proto: "cdp", fresh: true },
  ardia: { name: "Ardia", app: "/Applications/Ardia.app", bin: "Ardia", proto: "cdp", fresh: true },
  dia: { name: "Dia", app: "/Applications/Dia.app", bin: "Dia", proto: "cdp", fresh: false },
  brave: { name: "Brave", app: "/Applications/Brave Browser.app", bin: "Brave Browser", proto: "cdp", fresh: true },
  zen: { name: "Zen", app: "/Applications/Zen.app", bin: "zen", proto: "bidi", fresh: true },
  arc: { name: "Arc", app: "/Applications/Arc.app", bin: "Arc", proto: "cdp", fresh: false, sigterm: true },
};
for (const [key, B] of Object.entries(BROWSERS)) {
  B.key = key;
  B.bundle = B.app;
  B.binPath = join(B.app, "Contents/MacOS", B.bin);
}
let portSeq = 0;

class Driver {
  constructor(B) { this.B = B; }
  // Starts the browser through LaunchServices like a user would. `url` is the
  // link handed over by another app; without it the browser restores.
  async launch({ url, profile, restore }) {
    const B = this.B;
    this.profile = profile;
    this.port = 23000 + (portSeq++ % 2000);
    const before = new Set(await pidsOf(B.binPath));
    const env = [], argv = [];
    if (B.key === "merlin") {
      for (const d of ["xdg", "data", "wk"]) await mkdir(join(profile, d), { recursive: true });
      env.push(`XDG_CONFIG_HOME=${profile}/xdg`, `XDG_DATA_HOME=${profile}/data`, `MERLIN_WEBKIT_TEST_FOLDER=${profile}/wk`, `MODAL_BROWSER_SOCKET=${profile}/browserctl.sock`);
      argv.push(`--user-data-dir=${profile}/ud`, `--remote-debugging-port=${this.port}`, "--remote-allow-origins=*", ...CHROMIUM_FRESH);
      if (restore) argv.push("--restore-last-session");
    } else if (B.key === "brave") {
      argv.push(`--user-data-dir=${profile}/ud`, `--remote-debugging-port=${this.port}`, "--remote-allow-origins=*", ...CHROMIUM_FRESH);
      if (restore) argv.push("--restore-last-session");
    } else if (B.key === "ardia") {
      env.push(`ARDIA_DATA_DIR=${profile}/ud`, `ARDIA_REMOTE_DEBUGGING_PORT=${this.port}`);
      argv.push("--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic");
    } else if (B.key === "zen") {
      argv.push("-profile", `${profile}/ud`, "-no-remote", "--remote-debugging-port", String(this.port));
    } else { // dia, arc: the user's own profile
      argv.push(`--remote-debugging-port=${this.port}`, "--remote-allow-origins=*");
    }
    const openArgs = ["-n", "-a", B.app, ...env.flatMap((e) => ["--env", e])];
    if (!B.fresh) openArgs.splice(0, 1); // single-instance apps: plain open -a
    if (url) openArgs.push(url);
    openArgs.push("--args", ...argv);
    const t0 = Date.now();
    await run("open", openArgs);
    this.pid = undefined;
    for (let i = 0; i < 1000 && !this.pid; i++) {
      this.pid = (await pidsOf(B.binPath)).find((p) => !before.has(p));
      if (!this.pid) await sleep(10);
    }
    if (!this.pid) throw Error(`${B.name} did not start`);
    this.windowAt = windowShownAt(this.pid);
    await this.connect();
    return t0;
  }
  async connect() {
    const end = Date.now() + 60000;
    if (this.B.proto === "cdp") {
      let ws;
      while (!ws && Date.now() < end) {
        ws = await fetch(`http://127.0.0.1:${this.port}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl).catch(() => null);
        if (!ws) await sleep(50);
      }
      if (!ws) throw Error("no DevTools endpoint");
      this.cdp = await CDP.connect(ws);
      this.sessions = new Map();
    } else {
      while (Date.now() < end) {
        try { this.bidi = await Bidi.connect(`ws://127.0.0.1:${this.port}/session`); break; } catch { await sleep(100); }
      }
      if (!this.bidi) throw Error("no BiDi endpoint");
      await this.bidi.call("session.new", { capabilities: { alwaysMatch: { unhandledPromptBehavior: "ignore" } } });
    }
  }
  async tabs() {
    if (this.cdp) {
      const { targetInfos } = await this.cdp.call("Target.getTargets");
      return targetInfos.filter((t) => t.type === "page").map((t) => ({ id: t.targetId, url: t.url }));
    }
    const { contexts } = await this.bidi.call("browsingContext.getTree", { maxDepth: 0 });
    return contexts.map((c) => ({ id: c.context, url: c.url }));
  }
  async newTab(url, { window = false } = {}) {
    if (this.cdp) return (await this.cdp.call("Target.createTarget", { url, newWindow: window })).targetId;
    const { context } = await this.bidi.call("browsingContext.create", { type: window ? "window" : "tab" });
    this.bidi.call("browsingContext.navigate", { context, url, wait: "none" }).catch(() => {});
    return context;
  }
  async session(id) {
    if (!this.sessions.has(id)) {
      const { sessionId } = await this.cdp.call("Target.attachToTarget", { targetId: id, flatten: true });
      this.sessions.set(id, sessionId);
    }
    return this.sessions.get(id);
  }
  async eval(id, expression) {
    if (this.cdp) {
      const r = await this.cdp.call("Runtime.evaluate", { expression, returnByValue: true }, await this.session(id));
      return r.result?.value;
    }
    const r = await this.bidi.call("script.evaluate", { expression, target: { context: id }, awaitPromise: false, resultOwnership: "none" });
    return bidiValue(r.result);
  }
  async navigate(id, url) {
    if (this.cdp) return this.cdp.call("Page.navigate", { url }, await this.session(id));
    return this.bidi.call("browsingContext.navigate", { context: id, url, wait: "none" });
  }
  async activate(id) {
    if (this.cdp) return this.cdp.call("Target.activateTarget", { targetId: id });
    return this.bidi.call("browsingContext.activate", { context: id });
  }
  async close(id) {
    if (this.cdp) { await this.cdp.call("Target.closeTarget", { targetId: id }); this.sessions.delete(id); return; }
    await this.bidi.call("browsingContext.close", { context: id });
  }
  async windowOf(id) {
    if (!this.cdp) return null;
    return (await this.cdp.call("Browser.getWindowForTarget", { targetId: id }).catch(() => ({}))).windowId ?? null;
  }
  async wheel(id, dy) {
    if (this.cdp) {
      return this.cdp.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 400, y: 400, deltaX: 0, deltaY: dy }, await this.session(id));
    }
    return this.bidi.call("input.performActions", { context: id, actions: [{ type: "wheel", id: "w", actions: [{ type: "scroll", x: 400, y: 400, deltaX: 0, deltaY: dy, duration: 0 }] }] });
  }
  // Closes test tabs (127.0.0.1:9462 pages) so the user's own profile keeps only its own tabs.
  async closeTestTabs(keep) {
    for (const t of await this.tabs()) if (t.url.includes("127.0.0.1:9462") && t.id !== keep) await this.close(t.id).catch(() => {});
  }
  async quit() {
    const B = this.B, pid = this.pid;
    try {
      if (B.sigterm) process.kill(pid, "SIGTERM");
      else if (B.proto === "bidi") await run("osascript", ["-l", "JavaScript", "-e", `ObjC.import('AppKit');$.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).terminate`]);
      else if (this.cdp) await Promise.race([this.cdp.call("Browser.close"), sleep(3000)]);
      else await Promise.race([this.bidi.call("browser.close"), sleep(3000)]);
    } catch {}
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 200 && alive(); i++) await sleep(100);
    if (alive()) { log("force-killing", B.name); process.kill(pid, "SIGKILL"); }
    // wait for helpers too
    for (let i = 0; i < 100; i++) {
      const left = (await run("pgrep", ["-f", B.app + "/"]).catch(() => ({ stdout: "" }))).stdout.trim();
      if (!left) break;
      if (i === 99) await run("pkill", ["-9", "-f", B.app + "/"]).catch(() => {});
      await sleep(100);
    }
    this.cdp = this.bidi = null;
    await sleep(2000);
  }
}
function bidiValue(v) {
  if (!v) return undefined;
  if (v.type === "string" || v.type === "number" || v.type === "boolean") return v.value;
  if (v.type === "null" || v.type === "undefined") return null;
  return v.value;
}
class Bidi {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(Error("ws error"))); });
    return new Bidi(ws);
  }
  constructor(ws) {
    this.ws = ws; this.n = 1; this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.type === "error" ? p.reject(Error(m.error + ": " + m.message)) : p.resolve(m.result); }
    });
    ws.addEventListener("close", () => { for (const p of this.pending.values()) p.reject(Error("closed")); this.pending.clear(); });
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.n++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(Error(method + " timeout")); } }, 60000);
    });
  }
}

// ------------------------------------------------------------------ profiles
// Fresh browsers: one template profile per browser that holds one test tab;
// each run starts from an APFS clone of it.
async function cloneDir(src, dst) { await rm(dst, { recursive: true, force: true }); await mkdir(join(dst, ".."), { recursive: true }); await run("cp", ["-cR", src, dst]); }
async function prepareTemplate(B) {
  const tpl = join(WORK, "templates", B.key);
  if (!B.fresh) return null;
  try { await access(join(tpl, ".ready")); return tpl; } catch {}
  await rm(tpl, { recursive: true, force: true });
  await mkdir(join(tpl, "ud"), { recursive: true });
  if (B.key === "zen") {
    await writeFile(join(tpl, "ud", "user.js"), [
      'user_pref("browser.shell.checkDefaultBrowser", false);', 'user_pref("zen.welcome-screen.seen", true);',
      'user_pref("browser.aboutwelcome.enabled", false);', 'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("app.update.enabled", false);', 'user_pref("app.update.auto", false);', 'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("browser.startup.page", 3);', 'user_pref("browser.sessionstore.resume_from_crash", true);',
      'user_pref("remote.prefs.recommended", false);', 'user_pref("browser.warnOnQuit", false);', 'user_pref("browser.warnOnQuitShortcut", false);',
      'user_pref("browser.tabs.warnOnClose", false);', 'user_pref("browser.sessionstore.warnOnQuit", false);', 'user_pref("zen.urlbar.open-on-startup", false);'].join("\n"));
  }
  if (B.key === "ardia") {
    await copyFile(`${HOME}/Library/Application Support/com.ardia.browser/onboarding.json`, join(tpl, "ud", "onboarding.json")).catch(() => {});
  }
  const d = new Driver(B);
  const id = "template";
  for (let pass = 0; pass < 2; pass++) { // second pass: the profile already exists
    await d.launch({ url: `${LOCAL}/bench?id=${id}`, profile: tpl });
    await sleep(8000);
    const tabs = await d.tabs();
    const keep = tabs.find((t) => t.url.includes("id=template"));
    for (const t of tabs) if (t !== keep && !t.url.startsWith("about:blank")) await d.close(t.id).catch(() => {});
    if (!keep) log("WARN template tab missing", B.name, tabs.map((t) => t.url));
    await sleep(pass ? 20000 : 3000);
    await d.quit();
  }
  if (B.key === "ardia") {
    // Ardia does not save a tab opened from another app into session.json
    // (Ardia's own harness edits its template session too): seed it.
    const f = join(tpl, "ud", "session.json");
    const s = JSON.parse(await readFile(f, "utf8"));
    s.tabs = s.tabs.slice(0, 1);
    Object.assign(s.tabs[0], { url: `${LOCAL}/bench?id=${id}`, title: "Bench" });
    for (const w of s.windows) { w.tabIds = [s.tabs[0].id]; w.frame = [40, 80, 1280, 800]; }
    await writeFile(f, JSON.stringify(s));
  }
  await writeFile(join(tpl, ".ready"), "");
  return tpl;
}
async function runProfile(B, label) {
  if (!B.fresh) return null;
  const dst = join(WORK, "runs", `${B.key}-${label}`);
  await cloneDir(join(WORK, "templates", B.key), dst);
  return dst;
}
async function dropProfile(p) { if (p) await rm(p, { recursive: true, force: true }).catch(() => {}); }

// ------------------------------------------------------------------ suites
async function suiteLaunch(B, round) {
  for (let i = 0; i < LAUNCHES; i++) {
    // link handed over by another app
    {
      const profile = await runProfile(B, `link-${round}-${i}`);
      const d = new Driver(B);
      const id = newId("link");
      const t0 = await d.launch({ url: `${LOCAL}/bench?id=${id}`, profile });
      const fcp = await waitBeacon((b) => b.id === id && b.k === "fcp", 60000).catch(() => null);
      const win = await d.windowAt;
      await record({ browser: B.key, row: "launch-link", round, ms: fcp ? +(fcp.t - t0).toFixed(1) : null });
      await record({ browser: B.key, row: "launch-window", round, ms: win ? +(win - t0).toFixed(1) : null, via: "link" });
      log(B.name, "launch-link", fcp ? (fcp.t - t0).toFixed(0) : "x", "window", win ? (win - t0).toFixed(0) : "x");
      await sleep(3000);
      if (!B.fresh) await d.closeTestTabs();
      await d.quit();
      await dropProfile(profile);
    }
    // restore the previous session
    {
      const profile = await runProfile(B, `restore-${round}-${i}`);
      let d = new Driver(B);
      if (!B.fresh) { // leave one test tab active in the user's session, then quit
        await d.launch({ profile });
        await sleep(5000);
        const t = await openTab(d, "bench");
        await d.activate(t.tab).catch(() => {});
        await sleep(4000);
        await d.quit();
        d = new Driver(B);
      }
      const t0 = await d.launch({ profile, restore: true });
      const fcp = await waitBeacon((b) => b.k === "fcp" && b.recv >= t0 && (b.id === "template" || b.id.startsWith("bench")), RESTORE_TIMEOUT).catch(() => null);
      const win = await d.windowAt;
      await record({ browser: B.key, row: "launch-restore", round, ms: fcp ? +(fcp.t - t0).toFixed(1) : null });
      await record({ browser: B.key, row: "launch-window", round, ms: win ? +(win - t0).toFixed(1) : null, via: "restore" });
      log(B.name, "launch-restore", fcp ? (fcp.t - t0).toFixed(0) : "never", "window", win ? (win - t0).toFixed(0) : "x");
      await sleep(3000);
      if (!B.fresh) await d.closeTestTabs();
      await d.quit();
      await dropProfile(profile);
    }
  }
}

// Opens a test tab and waits for its first contentful paint; returns {id, ms}.
async function openTab(d, path, opts = {}) {
  const id = newId(path.replace(/\W/g, ""));
  const t0 = Date.now();
  const tab = await d.newTab(`${LOCAL}/${path}?id=${id}`, opts);
  const fcp = await waitBeacon((b) => b.id === id && b.k === "fcp", opts.timeout || 30000).catch(() => null);
  return { tab, id, ms: fcp ? fcp.t - t0 : null };
}
async function switchTo(d, t) {
  const t0 = Date.now();
  await d.activate(t.tab);
  const vis = await waitBeacon((b) => b.id === t.id && b.k === "vis" && b.recv >= t0, 5000).catch(() => null);
  return vis ? vis.t - t0 : null;
}

async function suiteSession(B, round) {
  const profile = await runProfile(B, `session-${round}`);
  const d = new Driver(B);
  let main;
  let t0;
  if (B.fresh) {
    t0 = await d.launch({ profile, restore: true });
    await waitBeacon((b) => b.k === "fcp" && b.recv >= t0 && b.id === "template", 30000).catch(() => null);
    const tabs = await d.tabs();
    const mt = tabs.find((t) => t.url.includes("id=template"));
    main = { tab: mt?.id, id: "template" };
  } else {
    const id = newId("session");
    t0 = await d.launch({ url: `${LOCAL}/bench?id=${id}`, profile });
    await waitBeacon((b) => b.id === id && b.k === "fcp", 60000).catch(() => null);
    const tabs = await d.tabs();
    main = { tab: tabs.find((t) => t.url.includes(id))?.id, id };
  }
  const loadedAt = Date.now();
  await front(d.pid);
  const userTabs = (await d.tabs()).filter((t) => !t.url.includes("127.0.0.1:9462")).length;
  const rec = (row, v) => record({ browser: B.key, row, round, ...v });
  try {
    await sleep(Math.max(0, t0 + 30000 - Date.now()));
    const m1 = await memory(B, d.pid); await rec("memory-1", { mb: m1.total_mb, detail: m1, other_pages: userTabs });
    log(B.name, "memory-1", m1.total_mb, "procs", m1.processes);
    const i1 = await activity(B, d.pid, IDLE_S); await rec("idle-1", i1);
    log(B.name, "idle-1", i1.cpu_percent, "%", i1.idle_wakeups_per_s, "w/s", i1.cpu_energy_mw, "mW");
    if (SETTLED) await sleep(Math.max(0, loadedAt + 120000 - Date.now()));
    if (SETTLED) { const i1s = await activity(B, d.pid, IDLE_S); await rec("idle-1-settled", i1s);
    log(B.name, "idle-1-settled", i1s.cpu_percent, "%", i1s.idle_wakeups_per_s, "w/s"); }

    const opened = [];
    for (let i = 0; i < 9; i++) opened.push(await openTab(d, "bench"));
    await sleep(10000);
    const m10 = await memory(B, d.pid); await rec("memory-10", { mb: m10.total_mb, detail: m10 });
    log(B.name, "memory-10", m10.total_mb);
    for (let i = 0; i < 10; i++) opened.push(await openTab(d, "bench"));
    const lastLoad = Date.now();
    await sleep(15000);
    const m20 = await memory(B, d.pid); await rec("memory-20", { mb: m20.total_mb, detail: m20 });
    log(B.name, "memory-20", m20.total_mb, "procs", m20.processes);
    const i20 = await activity(B, d.pid, IDLE_S); await rec("idle-20", i20);
    log(B.name, "idle-20", i20.cpu_percent, "%", i20.idle_wakeups_per_s, "w/s");
    if (SETTLED) await sleep(Math.max(0, lastLoad + 120000 - Date.now()));
    if (SETTLED) { const i20s = await activity(B, d.pid, IDLE_S); await rec("idle-20-settled", i20s);
    log(B.name, "idle-20-settled", i20s.cpu_percent, "%", i20s.idle_wakeups_per_s, "w/s"); }

    // tab switch: activate 16 of the 20 tabs in turn
    await front(d.pid);
    const all = [main, ...opened].filter((t) => t.tab);
    const sw = [];
    for (let i = 0; i < 16; i++) {
      const t = all[(i * 7 + 3) % all.length];
      sw.push(await switchTo(d, t));
      await sleep(400);
    }
    await rec("switch", { ms: median(sw), samples: sw.map((x) => x && +x.toFixed(1)) });
    log(B.name, "switch", median(sw)?.toFixed(1), sw.filter((x) => x == null).length, "missed");

    // back to one tab
    await d.activate(main.tab).catch(() => {});
    for (const t of opened) await d.close(t.tab).catch(() => {});
    await sleep(30000);
    const mb = await memory(B, d.pid); await rec("memory-closed", { mb: mb.total_mb, detail: mb });
    log(B.name, "memory back to 1", mb.total_mb);

    // new tab -> first paint
    const nt = [];
    for (let i = 0; i < 5; i++) {
      const t = await openTab(d, "bench");
      nt.push(t.ms);
      await sleep(1000);
      await d.close(t.tab).catch(() => {});
      await sleep(1000);
    }
    await rec("newtab", { ms: median(nt), samples: nt.map((x) => x && +x.toFixed(1)) });
    log(B.name, "newtab", median(nt)?.toFixed(1));

    // new window -> first paint
    const nw = []; let notes = null;
    const mainWin = await d.windowOf(main.tab);
    for (let i = 0; i < 5; i++) {
      try {
        const t = await openTab(d, "bench", { window: true });
        const w = await d.windowOf(t.tab);
        if (d.cdp && (w == null || w === mainWin)) { notes = "no new window opened"; nw.push(null); }
        else nw.push(t.ms);
        await sleep(1000);
        await d.close(t.tab).catch(() => {});
        await sleep(1500);
      } catch (e) { notes = e.message; nw.push(null); break; }
    }
    await rec("newwindow", { ms: median(nw), samples: nw.map((x) => x && +x.toFixed(1)), notes });
    log(B.name, "newwindow", median(nw)?.toFixed(1), notes || "");
  } finally {
    if (!B.fresh) await d.closeTestTabs().catch(() => {});
    await d.quit();
    await dropProfile(profile);
  }
}

const REAL = ["https://en.wikipedia.org/wiki/Web_browser", "https://github.com/rust-lang/rust", "https://www.bbc.com/news",
  "https://www.youtube.com/", "https://stackoverflow.com/questions", "https://news.ycombinator.com/",
  "https://www.reddit.com/r/programming/", "https://www.nytimes.com/", "https://www.amazon.com/",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript"];
const METRICS = `(()=>{const n=performance.getEntriesByType('navigation')[0]||{};const p=performance.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint');
return JSON.stringify({href:location.href,ready:document.readyState,ttfb:n.responseStart||null,dcl:n.domContentLoadedEventEnd||null,load:n.loadEventEnd||null,fcp:p?p.startTime:null})})()`;
const LCP = `(()=>new Promise(r=>{let v=null;try{new PerformanceObserver(l=>{const e=l.getEntries();v=e[e.length-1].startTime}).observe({type:'largest-contentful-paint',buffered:true})}catch(e){}setTimeout(()=>r(v),300)}))()`;

async function suiteReal(B, round) {
  const profile = await runProfile(B, `real-${round}`);
  const d = new Driver(B);
  const t0 = await d.launch({ profile, restore: true, url: B.fresh ? undefined : `${LOCAL}/lite?id=${newId("real")}` });
  await sleep(8000);
  await front(d.pid);
  const opened = [];
  const loads = {};
  try {
    for (const url of REAL) {
      const tab = await d.newTab(url);
      opened.push(tab);
      await d.activate(tab).catch(() => {});
      const end = Date.now() + 30000;
      let m = null;
      while (Date.now() < end) {
        try { m = JSON.parse((await d.eval(tab, METRICS)) || "null"); } catch { m = null; }
        if (m && m.ready === "complete" && m.load > 0 && !String(m.href).startsWith("about:")) break;
        await sleep(200);
      }
      let lcp = null;
      if (d.cdp) { try { const r = await d.cdp.call("Runtime.evaluate", { expression: LCP, awaitPromise: true, returnByValue: true }, await d.session(tab)); lcp = r.result?.value ?? null; } catch {} }
      else { try { const r = await d.bidi.call("script.evaluate", { expression: LCP, target: { context: tab }, awaitPromise: true }); lcp = bidiValue(r.result); } catch {} }
      loads[url] = m ? { fcp: m.fcp && +m.fcp.toFixed(0), lcp: lcp && +lcp.toFixed(0), dcl: m.dcl && +m.dcl.toFixed(0), load: m.load && +m.load.toFixed(0), complete: m.ready === "complete" } : null;
      log(B.name, "real", url, JSON.stringify(loads[url]));
    }
    await sleep(30000);
    const mem = await memory(B, d.pid);
    await record({ browser: B.key, row: "memory-real-10", round, mb: mem.total_mb, detail: mem, loads });
    log(B.name, "memory-real-10", mem.total_mb, "procs", mem.processes);
    if (!QUICK) { const act = await activity(B, d.pid, 60);
    await record({ browser: B.key, row: "idle-real-10", round, ...act });
    log(B.name, "idle-real-10", act.cpu_percent, "%", act.cpu_energy_mw, "mW"); }
    for (const t of opened) await d.close(t).catch(() => {});
    await sleep(30000);
    const back = await memory(B, d.pid);
    await record({ browser: B.key, row: "memory-real-closed", round, mb: back.total_mb, detail: back });
    log(B.name, "memory after closing real sites", back.total_mb);
  } finally {
    if (!B.fresh) await d.closeTestTabs().catch(() => {});
    await d.quit();
    await dropProfile(profile);
  }
}

async function suiteScale(B, round) {
  const profile = await runProfile(B, `scale-${round}`);
  const d = new Driver(B);
  await d.launch({ profile, restore: true, url: B.fresh ? undefined : `${LOCAL}/lite?id=${newId("scale")}` });
  await sleep(5000);
  await front(d.pid);
  const opened = [];
  try {
    for (let i = 0; i < 50; i++) opened.push(await openTab(d, "lite", { timeout: 15000 }));
    await sleep(20000);
    const mem = await memory(B, d.pid);
    await record({ browser: B.key, row: "memory-50", round, mb: mem.total_mb, detail: mem });
    log(B.name, "memory-50", mem.total_mb, "procs", mem.processes);
    const sw = [];
    for (let i = 0; i < 12; i++) { sw.push(await switchTo(d, opened[(i * 13 + 5) % opened.length])); await sleep(400); }
    await record({ browser: B.key, row: "switch-50", round, ms: median(sw), samples: sw.map((x) => x && +x.toFixed(1)) });
    log(B.name, "switch-50", median(sw)?.toFixed(1));
    const t0 = Date.now();
    for (const t of opened) await d.close(t.tab).catch(() => {});
    await record({ browser: B.key, row: "close-50", round, ms: Date.now() - t0 });
  } finally {
    if (!B.fresh) await d.closeTestTabs().catch(() => {});
    await d.quit();
    await dropProfile(profile);
  }
}

// CPU energy (rusage ri_energy_nj) with 11 tabs in five phases, like Ardia's power rows.
async function suiteEnergy(B, round) {
  const profile = await runProfile(B, `energy-${round}`);
  const d = new Driver(B);
  await d.launch({ profile, restore: true, url: B.fresh ? undefined : `${LOCAL}/lite?id=${newId("energy")}` });
  await sleep(5000);
  await front(d.pid);
  const tabs = [];
  try {
    for (let i = 0; i < 8; i++) tabs.push(await openTab(d, "bench"));
    const long = await openTab(d, "long");
    const video = await openTab(d, "video");
    const idleTab = await openTab(d, "lite");
    const S = 45;
    const phase = async (name, fn) => {
      const a = await activity(B, d.pid, S, fn);
      await record({ browser: B.key, row: `energy-${name}`, round, ...a });
      log(B.name, `energy-${name}`, a.cpu_energy_mw, "mW", a.cpu_percent, "%");
    };
    await switchTo(d, idleTab); await sleep(20000);
    await phase("idle-visible");
    await hideApp(d.pid); await sleep(10000);
    await phase("idle-hidden");
    await unhideApp(d.pid); await front(d.pid); await sleep(2000);
    await switchTo(d, long); await sleep(3000);
    await phase("scroll", async (s) => {
      const end = Date.now() + s * 1000; let i = 0;
      while (Date.now() < end) { await d.wheel(long.tab, (Math.floor(i / 120) % 2 ? -1 : 1) * 40).catch(() => {}); i++; await sleep(16); }
    });
    await switchTo(d, video); await sleep(3000);
    const playing = await d.eval(video.tab, "(()=>{const v=document.querySelector('video');v.play();return !v.paused&&v.readyState>=2})()").catch(() => null);
    await phase("video");
    await record({ browser: B.key, row: "energy-video-check", round, playing });
    await phase("switch", async (s) => {
      const end = Date.now() + s * 1000; let i = 0;
      while (Date.now() < end) { await d.activate(tabs[i++ % tabs.length].tab).catch(() => {}); await sleep(1000); }
    });
  } finally {
    if (!B.fresh) await d.closeTestTabs().catch(() => {});
    await d.quit();
    await dropProfile(profile);
  }
}

const WEB = {
  speedometer: { url: `${LOCAL}/suites/speedometer/?startAutomatically=true`, minutes: 25,
    done: `(()=>{const r=document.querySelector('#result-number');return location.hash.includes('summary')&&r&&r.textContent.trim()?r.textContent.trim()+' ± '+(document.querySelector('#confidence-number')?.textContent||''):''})()` },
  jetstream: { url: `${LOCAL}/suites/jetstream/?startAutomatically=true`, minutes: 30,
    done: `(()=>{const r=document.querySelector('#result-summary.done .score');return r?r.textContent.trim():''})()` },
  motionmark: { url: `${LOCAL}/suites/motionmark/MotionMark/`, minutes: 25,
    start: `(()=>{const b=document.querySelector('#start-button');if(b&&!b.disabled&&window.benchmarkController){benchmarkController.startBenchmark();return true}return false})()`,
    done: `(()=>{const r=document.querySelector('#results .score');const c=document.querySelector('#results .confidence');return r&&r.textContent.trim()&&document.body.classList.contains('showing-results')||r&&r.textContent.trim()?r.textContent.trim()+' '+(c?c.textContent.trim():''):''})()` },
};
async function suiteWeb(B, round, which) {
  const profile = await runProfile(B, `web-${which}-${round}`);
  const d = new Driver(B);
  await d.launch({ profile, restore: true, url: B.fresh ? undefined : `${LOCAL}/lite?id=${newId("web")}` });
  await sleep(5000);
  await front(d.pid);
  const W = WEB[which];
  let tab;
  try {
    tab = await d.newTab(W.url);
    await d.activate(tab);
    await front(d.pid);
    if (W.start) {
      let ok = false;
      for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await d.eval(tab, W.start).catch(() => false); }
      if (!ok) throw Error("could not start " + which);
    }
    const end = Date.now() + W.minutes * 60000;
    let score = "";
    while (!score && Date.now() < end) {
      await sleep(10000);
      await front(d.pid);
      score = await d.eval(tab, W.done).catch(() => "");
    }
    await record({ browser: B.key, row: which, round, score: score ? parseFloat(score) : null, raw: score || "timeout" });
    log(B.name, which, score || "TIMEOUT");
  } finally {
    if (tab) await d.close(tab).catch(() => {});
    if (!B.fresh) await d.closeTestTabs().catch(() => {});
    await d.quit();
    await dropProfile(profile);
  }
}

// ------------------------------------------------------------------ main
const order = args.browsers.split(",");
for (const k of order) {
  const B = BROWSERS[k];
  if (!B) throw Error("unknown browser " + k);
  await access(B.binPath);
  if ((await pidsOf(B.binPath)).length) throw Error(`${B.name} is already running; quit it first`);
}
await record({ row: "meta", browsers: Object.fromEntries(order.map((k) => [k, BROWSERS[k].app])), rounds: ROUNDS, launches: LAUNCHES, suites: [...SUITES] });
for (const k of order) { log("template", k); await prepareTemplate(BROWSERS[k]); }

async function guarded(B, name, fn) {
  try { await fn(); } catch (e) {
    log("ERROR", B.name, name, e.stack || e.message);
    await record({ browser: B.key, row: "error", suite: name, error: String(e.message) });
    await run("pkill", ["-9", "-f", B.app + "/"]).catch(() => {});
    await sleep(3000);
  }
}
const rotate = (a, n) => a.map((_, i) => a[(i + n) % a.length]);
for (let round = 0; round < ROUNDS; round++) {
  for (const k of rotate(order, round)) {
    const B = BROWSERS[k];
    if (SUITES.has("launch")) await guarded(B, "launch", () => suiteLaunch(B, round));
    if (SUITES.has("session")) await guarded(B, "session", () => suiteSession(B, round));
  }
}
// once-per-browser suites (twice for Speedometer)
const ONCE = [];
if (SUITES.has("real")) ONCE.push(["real", (B, r) => suiteReal(B, r)]);
if (SUITES.has("scale")) ONCE.push(["scale", (B, r) => suiteScale(B, r)]);
if (SUITES.has("energy")) ONCE.push(["energy", (B, r) => suiteEnergy(B, r)]);
if (SUITES.has("web")) {
  const webs = (args.web || "speedometer,jetstream,motionmark,speedometer").split(",");
  webs.forEach((w, n) => ONCE.push([w, (B) => suiteWeb(B, webs.slice(0, n).filter((x) => x === w).length, w)]));
}
for (let i = 0; i < ONCE.length; i++) {
  const [name, fn] = ONCE[i];
  for (const k of rotate(order, i)) await guarded(BROWSERS[k], name, () => fn(BROWSERS[k], 0));
}
await record({ row: "done" });
server.close();
log("all done");
process.exit(0);
