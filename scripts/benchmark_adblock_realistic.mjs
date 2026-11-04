#!/usr/bin/env node
// Paired on/off page-load measurements on realistic local pages. Unlike the
// inline "clean" fixture in benchmark_adblock.mjs, these pages load ~90
// subresources from two hosts while page scripts keep the main thread busy,
// which is where per-request blocker overhead shows up. Requires Node 22+.
//
//   node scripts/benchmark_adblock_realistic.mjs --app out/Modal/Merlin.app \
//     [--runs 8] [--output result.json] [--trace]
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir, cpus, release } from "node:os";
import { resolve, join, basename } from "node:path";
import { CDP, deadline } from "./lib/cdp.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const options = { runs: 8, loads: 3, output: "/tmp/merlin-adblock-realistic.json" };
for (let i = 2; i < process.argv.length; ++i) {
  const key = process.argv[i];
  if (key === "--app") options.app = resolve(process.argv[++i]);
  else if (key === "--output") options.output = resolve(process.argv[++i]);
  else if (key === "--runs") options.runs = Number(process.argv[++i]);
  else if (key === "--loads") options.loads = Number(process.argv[++i]);
  else if (key === "--trace") options.trace = true;
  else if (key === "--trace-categories") options.categories = process.argv[++i];
  else throw Error("Unknown argument: " + key);
}
if (!options.app) throw Error("Usage: benchmark_adblock_realistic.mjs --app /path/Merlin.app");
const binary = join(options.app, "Contents", "MacOS", basename(options.app, ".app"));
await access(binary);
const taskRoot = await mkdtemp(join(tmpdir(), "merlin-adblock-realistic-"));

// ---------------------------------------------------------------------------
// Fixture server. Every response is delayed slightly, as on a real network.
const IMAGE = Buffer.concat([
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  Buffer.alloc(2048),
]);
// Each first-party script keeps the main thread busy for ~4 ms, like real
// framework bootstrapping, while later resources are still being requested.
const busyScript = (i) =>
  Buffer.from(`(()=>{const end=performance.now()+4;let x=${i};while(performance.now()<end)x=(x*31+7)%1000003;window.__work=(window.__work||0)+x;})();`);
const STYLE = Buffer.from(".story{margin:8px 0}.thumb{width:48px;height:48px}" + "/*" + ".".repeat(4096) + "*/");
const FONT = Buffer.alloc(8192);
const AD = Buffer.from("window.__ads=(window.__ads||0)+1;");
const served = { requests: 0, ads: 0 };
let port;

function article(variant) {
  const sw = variant === "sw";
  const ads = variant === "ads";
  const origin = `http://news.fixture.test:${port}`;
  const cdn = `http://cdn.fixture.test:${port}`;
  const head = [];
  for (let i = 0; i < 6; ++i) head.push(`<link rel="stylesheet" href="${i < 4 ? origin : cdn}/static/style${i}.css">`);
  head.push(`<style>@font-face{font-family:F;src:url(${cdn}/static/font.woff2)}body{font-family:F,system-ui}</style>`);
  for (let i = 0; i < 12; ++i) head.push(`<script defer src="${i < 8 ? origin : cdn}/static/app${i}.js"></script>`);
  const stories = [];
  for (let i = 0; i < 300; ++i) {
    const host = i % 3 ? origin : cdn;
    const img = i < 60 ? `<img class="thumb media-${i % 9}" src="${host}/img/${i}.gif">` : "";
    stories.push(`<article class="story story-${i % 17} layout-${i % 5}" id="s${i}">${img}<h2 class="headline h-${i % 7}">Headline ${i}</h2><p class="summary text-${i % 11}">Summary text for story ${i}, with enough words to lay out a line or two.</p></article>`);
  }
  if (ads)
    for (let i = 0; i < 20; ++i)
      stories.push(`<script async src="http://ad.doubleclick.net:${port}/ad/${i}.js"></script><img src="http://ad.doubleclick.net:${port}/ad/${i}.gif">`);
  const register = sw
    ? `<script>window.fixtureControlled=!!navigator.serviceWorker.controller;if(!navigator.serviceWorker.controller)navigator.serviceWorker.register('/sw/sw.js',{scope:'/sw/'});</script>`
    : "";
  return Buffer.from(
    `<!doctype html><meta charset="utf-8"><title>News fixture</title>${head.join("")}${register}<main>${stories.join("")}</main>` +
      `<script>fetch('/api/comments').then(r=>r.text());window.fixtureComplete=new Promise(r=>addEventListener('load',()=>r(true),{once:true}));</script>`,
  );
}
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  const path = url.pathname.replace(/^\/sw(?=\/)/, "");
  let body, type;
  if (url.pathname === "/sw/sw.js") {
    body = Buffer.from("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('fetch',e=>e.respondWith(fetch(e.request)));");
    type = "application/javascript";
  } else if (path.startsWith("/ad/")) {
    ++served.ads;
    [body, type] = path.endsWith(".js") ? [AD, "application/javascript"] : [IMAGE, "image/gif"];
  } else if (path.startsWith("/img/")) [body, type] = [IMAGE, "image/gif"];
  else if (path.endsWith(".css")) [body, type] = [STYLE, "text/css"];
  else if (path.endsWith(".js")) [body, type] = [busyScript(path.length), "application/javascript"];
  else if (path.endsWith(".woff2")) [body, type] = [FONT, "font/woff2"];
  else if (path === "/api/comments") [body, type] = [Buffer.from("[]"), "application/json"];
  else {
    const variant = url.pathname.startsWith("/sw/") ? "sw" : url.searchParams.get("variant") || "clean";
    [body, type] = [article(variant), "text/html"];
  }
  ++served.requests;
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  setTimeout(() => res.end(body), type === "text/html" ? 0 : 5);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
port = server.address().port;

// ---------------------------------------------------------------------------
async function launch(mode, profile) {
  await mkdir(join(profile, "Default"), { recursive: true });
  const config = join(taskRoot, "config");
  await mkdir(join(config, "modal_browser"), { recursive: true });
  await writeFile(join(config, "modal_browser", "config.toml"),
    "[options]\nmodal_browsing=false\nbrowserctl=false\nrestore_session=false\n");
  const proc = spawn(binary, [
    `--user-data-dir=${profile}`, "--headless", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--no-proxy-server", "--remote-debugging-port=0",
    `--modal-browser-socket=${join(profile, "control.sock")}`,
    "--host-resolver-rules=MAP news.fixture.test 127.0.0.1, MAP cdn.fixture.test 127.0.0.1, MAP ad.doubleclick.net 127.0.0.1",
    // Plain http fixtures need this to register a service worker.
    `--unsafely-treat-insecure-origin-as-secure=http://news.fixture.test:${port}`,
    `--${mode === "on" ? "enable" : "disable"}-features=MerlinAdblock`,
    "about:blank",
  ], { env: { ...process.env, XDG_CONFIG_HOME: config }, stdio: ["ignore", "ignore", "ignore"] });
  const browser = { proc };
  const until = performance.now() + 60000;
  let endpoint;
  while (!endpoint && performance.now() < until) {
    if (proc.exitCode !== null) throw Error("Browser exited during startup");
    try {
      const [debugPort, wsPath] = String(await readFile(join(profile, "DevToolsActivePort"))).trim().split("\n");
      endpoint = `ws://127.0.0.1:${debugPort}${wsPath}`;
    } catch { await sleep(20); }
  }
  if (!endpoint) {
    proc.kill("SIGKILL");
    throw Error("DevTools port did not become ready");
  }
  browser.cdp = await CDP.connect(endpoint);
  const { targetInfos } = await browser.cdp.call("Target.getTargets");
  const target = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await browser.cdp.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  browser.session = sessionId;
  await browser.cdp.call("Page.enable", {}, sessionId);
  await browser.cdp.call("Network.enable", {}, sessionId);
  await browser.cdp.call("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
  data.browser_version ??= await browser.cdp.call("Browser.getVersion");
  return browser;
}
async function stop(browser) {
  if (browser.proc.exitCode === null) {
    const exited = once(browser.proc, "exit");
    try { await deadline(Promise.race([browser.cdp.call("Browser.close"), exited]), 10000, "close"); } catch {}
    try { await deadline(exited, 10000, "exit"); } catch { browser.proc.kill("SIGKILL"); await exited; }
  }
  browser.cdp?.close();
  await sleep(300);
}
async function evaluate(browser, expression) {
  const result = await browser.cdp.call("Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true }, browser.session);
  if (result.exceptionDetails) throw Error("Evaluation failed: " + expression.slice(0, 60));
  return result.result.value;
}
async function load(browser, variant) {
  const url = variant === "sw"
    ? `http://news.fixture.test:${port}/sw/article?run=${Date.now()}`
    : `http://news.fixture.test:${port}/article?variant=${variant}&run=${Date.now()}`;
  const before = served.ads;
  const result = await browser.cdp.call("Page.navigate", { url }, browser.session);
  if (result.errorText) throw Error(result.errorText);
  const until = performance.now() + 30000;
  while (performance.now() < until) {
    try {
      if ((await evaluate(browser, "window.fixtureComplete?.then(()=>document.readyState)")) === "complete") break;
    } catch {}
    await sleep(10);
  }
  // Allow the trailing comments fetch and paint entries to settle.
  await sleep(50);
  const value = await evaluate(browser, `(()=>{
    const n=performance.getEntriesByType('navigation')[0];
    const paint=Object.fromEntries(performance.getEntriesByType('paint').map(e=>[e.name,e.startTime]));
    const res=performance.getEntriesByType('resource');
    // Time from Blink starting a fetch to the request being sent: throttles
    // and other pre-send work show up here.
    const stall=res.map(r=>r.requestStart>0?r.requestStart-r.startTime:null).filter(v=>v!==null);
    const total=res.map(r=>r.responseEnd-r.startTime);
    const median=a=>{if(!a.length)return null;a=[...a].sort((x,y)=>x-y);return a[Math.floor(a.length/2)]};
    return {load:n.loadEventEnd,dcl:n.domContentLoadedEventEnd,fcp:paint['first-contentful-paint']??null,
      resources:res.length,stall_median:median(stall),resource_median:median(total),
      controlled:!!navigator.serviceWorker?.controller};
  })()`);
  return { ...value, ad_server_requests: served.ads - before };
}
async function trace(browser, variant, mode) {
  await browser.cdp.call("Tracing.start", { categories: options.categories ?? "loading", transferMode: "ReturnAsStream" });
  await load(browser, variant);
  await sleep(1000);
  const completed = once(browser.cdp, "Tracing.tracingComplete");
  await browser.cdp.call("Tracing.end");
  const [result] = await completed;
  const chunks = [];
  for (;;) {
    const part = await browser.cdp.call("IO.read", { handle: result.stream });
    chunks.push(Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"));
    if (part.eof) break;
  }
  const path = options.output.replace(/\.json$/, "") + `-${variant}-${mode}.trace.json`;
  await writeFile(path, Buffer.concat(chunks));
  (data.traces ??= []).push({ variant, mode, path });
}

const data = {
  started: new Date().toISOString(),
  binary,
  options,
  machine: { platform: process.platform, arch: process.arch, os: release(), cpu: cpus()[0]?.model },
  harness_sha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"),
  trials: [],
};
const variants = ["clean", "ads", "sw"];
try {
  for (let pair = 0; pair < options.runs; ++pair) {
    for (const mode of pair % 2 ? ["on", "off"] : ["off", "on"]) {
      const profile = join(taskRoot, `p${pair}-${mode}`);
      let browser;
      for (let attempt = 0; !browser; ++attempt) {
        try {
          browser = await launch(mode, profile);
        } catch (error) {
          // A rare headless startup stall is a harness failure, not a trial.
          (data.launch_retries ??= []).push({ pair, mode, error: String(error) });
          await rm(profile, { recursive: true, force: true });
          if (attempt >= 2) throw error;
        }
      }
      try {
        // Let startup work (engine load) finish so only page loads are measured.
        await sleep(1500);
        for (const variant of variants) {
          // Discarded warmup; for "sw" it also installs and activates the worker.
          await load(browser, variant);
          if (variant === "sw") {
            await evaluate(browser, "navigator.serviceWorker.ready.then(()=>true)");
            await load(browser, variant);
          }
          for (let i = 0; i < options.loads; ++i) {
            const value = await load(browser, variant);
            if (variant === "sw" && !value.controlled) throw Error("Service worker did not control the page");
            data.trials.push({ pair, mode, variant, ...value });
          }
        }
        if (options.trace && pair === 0) for (const variant of variants) await trace(browser, variant, mode);
      } finally {
        await stop(browser);
        await rm(profile, { recursive: true, force: true });
      }
    }
  }
  const pct = (values, q) => {
    const s = [...values].sort((a, b) => a - b), at = (s.length - 1) * q, lo = Math.floor(at);
    return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
  };
  data.summary = {};
  for (const variant of variants) {
    const row = (data.summary[variant] = {});
    for (const metric of ["load", "dcl", "fcp", "stall_median", "resource_median", "ad_server_requests"]) {
      row[metric] = {};
      for (const mode of ["off", "on"]) {
        const values = data.trials.filter((t) => t.variant === variant && t.mode === mode && t[metric] !== null).map((t) => t[metric]);
        row[metric][mode] = { n: values.length, median: +pct(values, 0.5).toFixed(2), p95: +pct(values, 0.95).toFixed(2) };
      }
      row[metric].median_delta = +(row[metric].on.median - row[metric].off.median).toFixed(2);
    }
  }
  data.valid = true;
  console.log(JSON.stringify(data.summary, null, 1));
} finally {
  data.finished = new Date().toISOString();
  await writeFile(options.output, JSON.stringify(data, null, 1));
  server.close();
  await rm(taskRoot, { recursive: true, force: true });
}
