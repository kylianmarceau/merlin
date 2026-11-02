#!/usr/bin/env node
// Paired, isolated on/off measurements. Requires Node 22+ (built-in WebSocket).
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { CDP, deadline } from "./lib/cdp.mjs";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir, cpus, totalmem, release } from "node:os";
import { resolve, join, basename } from "node:path";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const options = {
  runs: 10,
  output: "/tmp/merlin-adblock-benchmark.json",
  idle: 15,
  tabs: [1, 10, 30],
  trace: false,
};
for (let i = 2; i < process.argv.length; ++i) {
  const key = process.argv[i];
  if (key === "--app") options.app = resolve(process.argv[++i]);
  else if (key === "--output") options.output = resolve(process.argv[++i]);
  else if (key === "--runs") options.runs = Number(process.argv[++i]);
  else if (key === "--smoke")
    Object.assign(options, { runs: 1, idle: 1, tabs: [1, 3] });
  else if (key === "--trace") options.trace = true;
  else throw Error("Unknown argument: " + key);
}
if (!options.app || !Number.isInteger(options.runs) || options.runs < 1)
  throw Error(
    "Usage: benchmark_adblock.mjs --app /path/Merlin.app [--output result.json] [--runs 10] [--trace] [--smoke]",
  );
const binary = join(
  options.app,
  "Contents",
  "MacOS",
  basename(options.app, ".app"),
);
await access(binary);
const taskRoot = await mkdtemp(join(tmpdir(), "merlin-adblock-perf-"));
const data = {
  started: new Date().toISOString(),
  binary,
  options,
  machine: {
    platform: process.platform,
    arch: process.arch,
    os: release(),
    cpu: cpus()[0]?.model,
    memory_bytes: totalmem(),
  },
  trials: [],
  memory: [],
  valid: false,
};
const served = { requests: 0, bytes: 0, ad_requests: 0, ad_bytes: 0 };
let port;
const gif = Buffer.concat([
  Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  ),
  Buffer.alloc(65536),
]);
const script = Buffer.from(
  "/*" + ".".repeat(65536) + "*/\nwindow.fixtureAds=(window.fixtureAds||0)+1;",
);
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  let body,
    type = "text/html";
  if (url.pathname.startsWith("/ad/")) {
    body = url.pathname.endsWith(".js") ? script : gif;
    type = url.pathname.endsWith(".js")
      ? "application/javascript"
      : "image/gif";
    ++served.ad_requests;
    served.ad_bytes += body.length;
  } else {
    const heavy = url.pathname === "/heavy";
    const ads = heavy
      ? Array.from(
          { length: 32 },
          (_, i) =>
            `<script async src="http://ad.doubleclick.net:${port}/ad/${i}.js"></script><img src="http://ad.doubleclick.net:${port}/ad/${i}.gif">`,
        ).join("")
      : "";
    body = Buffer.from(
      `<!doctype html><meta charset="utf-8"><title>${heavy ? "Ad-heavy" : "Clean"} fixture</title><style>body{font:16px system-ui;margin:32px}.card{display:inline-block;padding:12px;border:1px solid #aaa}</style><h1>Local browser fixture</h1>${Array.from({ length: 100 }, (_, i) => '<div class="card">Content ' + i + "</div>").join("")}${ads}<script>window.fixtureComplete=new Promise(resolve=>addEventListener('load',()=>resolve(true),{once:true}));</script>`,
    );
  }
  ++served.requests;
  served.bytes += body.length;
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": url.pathname.startsWith("/ad/")
      ? "public,max-age=3600"
      : "no-store",
  });
  if (url.pathname.startsWith("/ad/")) setTimeout(() => res.end(body), 15);
  else res.end(body);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
port = server.address().port;
const fixture = (kind) => `http://127.0.0.1:${port}/${kind}`;

function cpuSeconds(value) {
  const [days, clock] = value.includes("-") ? value.split("-") : ["0", value];
  const parts = clock.split(":").map(Number);
  return Number(days) * 86400 + parts.reduce((n, x) => n * 60 + x, 0);
}
async function processTree(root) {
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,rss=,time="]);
  const children = new Map(),
    rows = new Map();
  for (const line of stdout.trim().split("\n")) {
    const [pid, ppid, rss, cpu] = line.trim().split(/\s+/);
    rows.set(Number(pid), { rss: Number(rss) * 1024, cpu: cpuSeconds(cpu) });
    const set = children.get(Number(ppid)) || [];
    set.push(Number(pid));
    children.set(Number(ppid), set);
  }
  if (!rows.has(root))
    throw Error("Browser exited; refusing an invalid zero-memory sample");
  const stack = [root];
  let rss = 0,
    cpu = 0,
    count = 0;
  while (stack.length) {
    const pid = stack.pop(),
      row = rows.get(pid);
    if (!row) continue;
    rss += row.rss;
    cpu += row.cpu;
    ++count;
    stack.push(...(children.get(pid) || []));
  }
  if (!rss) throw Error("Invalid empty process tree");
  return { rss_bytes: rss, cpu_seconds: cpu, processes: count };
}
async function stop(browser) {
  if (browser.proc.exitCode === null) {
    const exited = once(browser.proc, "exit");
    if (browser.cdp) {
      try {
        await deadline(
          Promise.race([browser.cdp.call("Browser.close"), exited]),
          10000,
          "Browser close timeout",
        );
      } catch {}
    } else browser.proc.kill("SIGTERM");
    try {
      await deadline(exited, 10000, "Browser exit timeout");
    } catch {
      browser.proc.kill("SIGKILL");
      await exited;
    }
  }
  browser.cdp?.close();
  await sleep(500);
}
async function launch(mode, profile) {
  await rm(join(profile, "DevToolsActivePort"), { force: true });
  const config = join(taskRoot, "config");
  await mkdir(join(config, "modal_browser"), { recursive: true });
  await writeFile(
    join(config, "modal_browser", "config.toml"),
    "[options]\nmodal_browsing=false\nbrowserctl=false\nrestore_session=false\n",
  );
  const started = performance.now();
  const proc = spawn(
    binary,
    [
      `--user-data-dir=${profile}`,
      "--headless",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--no-proxy-server",
      "--remote-debugging-port=0",
      `--modal-browser-socket=${join(taskRoot, "control.sock")}`,
      "--host-resolver-rules=MAP page.fixture.test 127.0.0.1, MAP ad.doubleclick.net 127.0.0.1",
      `--${mode === "on" ? "enable" : "disable"}-features=MerlinAdblock`,
      "about:blank",
    ],
    {
      env: { ...process.env, XDG_CONFIG_HOME: config },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const browser = { proc, started };
  proc.stderr.on("data", (chunk) => {
    browser.stderr = ((browser.stderr || "") + chunk).slice(-1024 * 1024);
  });
  try {
    let endpoint;
    const deadline = performance.now() + 60000;
    while (performance.now() < deadline) {
      if (proc.exitCode !== null) throw Error("Browser exited during startup");
      try {
        const [debugPort, path] = String(
          await readFile(join(profile, "DevToolsActivePort")),
        )
          .trim()
          .split("\n");
        endpoint = `ws://127.0.0.1:${debugPort}${path}`;
        break;
      } catch {
        await sleep(20);
      }
    }
    if (!endpoint) throw Error("DevTools port did not become ready");
    browser.cdp = await CDP.connect(endpoint);
    const { targetInfos } = await browser.cdp.call("Target.getTargets");
    const pages = targetInfos.filter((t) => t.type === "page");
    if (!pages.length) throw Error("No startup page");
    const selected =
      pages.find((page) => page.url === "about:blank") || pages[0];
    for (const page of pages)
      if (page !== selected)
        await browser.cdp.call("Target.closeTarget", {
          targetId: page.targetId,
        });
    (data.startup_pages ??= []).push({ mode, count: pages.length });
    browser.target = selected.targetId;
    const { sessionId } = await browser.cdp.call("Target.attachToTarget", {
      targetId: browser.target,
      flatten: true,
    });
    browser.session = sessionId;
    await browser.cdp.call("Page.enable", {}, sessionId);
    await browser.cdp.call("Network.enable", {}, sessionId);
    browser.cdp.on("Network.loadingFailed", (event, session) => {
      if (session !== sessionId) return;
      (data.diagnostics ??= []).push({
        mode,
        error: event.errorText,
        blockedReason: event.blockedReason,
      });
    });
    await browser.cdp.call("Performance.enable", {}, sessionId);
    return browser;
  } catch (error) {
    data.browser_stderr = browser.stderr;
    await stop(browser);
    throw error;
  }
}
async function page(browser, kind, cache) {
  const { cdp, session: sessionId } = browser;
  await cdp.call(
    "Network.setCacheDisabled",
    { cacheDisabled: !cache },
    sessionId,
  );
  if (!cache) await cdp.call("Network.clearBrowserCache", {}, sessionId);
  const before = { ...served },
    cpuBefore = await processTree(browser.proc.pid);
  let transferred = 0,
    blocked = 0,
    failures = 0;
  const finished = (p, s) => {
    if (s === sessionId) transferred += p.encodedDataLength || 0;
  };
  const failed = (p, s) => {
    if (s === sessionId) {
      ++failures;
      if (p.errorText === "net::ERR_BLOCKED_BY_CLIENT") ++blocked;
    }
  };
  cdp.on("Network.loadingFinished", finished);
  cdp.on("Network.loadingFailed", failed);
  const started = performance.now();
  try {
    const result = await cdp.call(
      "Page.navigate",
      { url: fixture(kind) + "?run=" + Date.now() },
      sessionId,
    );
    if (result.errorText) throw Error(result.errorText);
    let ready = false;
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      const result = await cdp.call(
        "Runtime.evaluate",
        {
          expression: "window.fixtureComplete?.then(()=>document.readyState)",
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (result.exceptionDetails) throw Error("Fixture script failed");
      if (result.result.value === "complete") {
        ready = true;
        break;
      }
      await sleep(10);
    }
    if (!ready) throw Error("Fixture never became ready");
    const wall = performance.now() - started;
    const metrics = await cdp.call(
      "Runtime.evaluate",
      {
        expression:
          'JSON.stringify(performance.getEntriesByType("navigation")[0]?.toJSON())',
        returnByValue: true,
      },
      sessionId,
    );
    const cpuAfter = await processTree(browser.proc.pid);
    return {
      kind,
      cache,
      wall_ms: wall,
      navigation: JSON.parse(metrics.result.value),
      transferred_bytes: transferred,
      blocked_requests: blocked,
      failed_requests: failures,
      server_requests: served.requests - before.requests,
      server_bytes: served.bytes - before.bytes,
      ad_server_requests: served.ad_requests - before.ad_requests,
      ad_server_bytes: served.ad_bytes - before.ad_bytes,
      cpu_seconds: cpuAfter.cpu_seconds - cpuBefore.cpu_seconds,
      rss_bytes: cpuAfter.rss_bytes,
    };
  } finally {
    cdp.off("Network.loadingFinished", finished);
    cdp.off("Network.loadingFailed", failed);
  }
}
async function recordTrace(browser, mode) {
  const { cdp } = browser;
  await cdp.call("Tracing.start", {
    categories: "loading",
    transferMode: "ReturnAsStream",
  });
  await page(browser, "heavy", false);
  // Include the first bounded cosmetic scan and idle ticks. Traces are kept
  // separate from page-load timing and memory samples.
  await sleep(1500);
  const completed = once(cdp, "Tracing.tracingComplete");
  await cdp.call("Tracing.end");
  const [result] = await completed;
  const chunks = [];
  for (;;) {
    const part = await cdp.call("IO.read", { handle: result.stream });
    chunks.push(Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"));
    if (part.eof) break;
  }
  await cdp.call("IO.close", { handle: result.stream });
  const path =
    options.output.replace(/\.json$/, "") + "-" + mode + ".trace.json";
  await writeFile(path, Buffer.concat(chunks));
  (data.traces ??= []).push({
    mode,
    path,
    scope:
      "Separate local ad-heavy run; excluded from timing and memory trials",
  });
}
const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b),
    position = (sorted.length - 1) * q,
    index = Math.floor(position);
  return (
    sorted[index] +
    (sorted[Math.min(index + 1, sorted.length - 1)] - sorted[index]) *
      (position - index)
  );
};
function summarize() {
  const result = {};
  for (const label of [
    "first_launch",
    "warm_launch",
    "clean_uncached",
    "clean_cached",
    "heavy_uncached",
    "heavy_cached",
  ]) {
    result[label] = {};
    for (const mode of ["off", "on"]) {
      const values = data.trials
        .filter((t) => t.mode === mode && t.label === label)
        .map((t) => t.elapsed_ms);
      result[label][mode] = {
        n: values.length,
        median_ms: percentile(values, 0.5),
        p95_ms: percentile(values, 0.95),
      };
    }
    result[label].median_delta_ms =
      result[label].on.median_ms - result[label].off.median_ms;
    result[label].median_regression_percent =
      (100 * result[label].median_delta_ms) / result[label].off.median_ms;
    result[label].p95_regression_percent =
      100 * (result[label].on.p95_ms / result[label].off.p95_ms - 1);
  }
  return result;
}
try {
  const lastProfiles = {};
  for (let pair = 0; pair < options.runs; ++pair) {
    for (const mode of pair % 2 ? ["on", "off"] : ["off", "on"]) {
      const profile = join(taskRoot, `pair-${pair}-${mode}`);
      lastProfiles[mode] = profile;
      await mkdir(join(profile, "Default"), { recursive: true });
      await writeFile(
        join(profile, "Default", "Preferences"),
        JSON.stringify({
          merlin: { adblock: { updates: false } },
          session: { restore_on_startup: 5 },
          profile: { exit_type: "Normal", exited_cleanly: true },
        }),
      );
      for (const [phase, label] of [
        ["first", "first_launch"],
        ["warm", "warm_launch"],
      ]) {
        const browser = await launch(mode, profile);
        try {
          const measurement = await page(browser, "clean", false);
          data.trials.push({
            pair,
            mode,
            label,
            elapsed_ms: performance.now() - browser.started,
            measurement,
          });
          if (phase === "warm") {
            for (const kind of ["clean", "heavy"])
              for (const cache of [false, true]) {
                const measurement = await page(browser, kind, cache);
                if (
                  kind === "heavy" &&
                  !cache &&
                  mode === "off" &&
                  measurement.ad_server_requests !== 64
                )
                  throw Error(
                    "Ad-heavy control is invalid: expected 64 local ad resources, got " +
                      measurement.ad_server_requests,
                  );
                if (
                  kind === "heavy" &&
                  mode === "on" &&
                  measurement.ad_server_requests !== 0
                )
                  throw Error(
                    "Default filter lists did not block the local ad-heavy fixture",
                  );
                data.trials.push({
                  pair,
                  mode,
                  label: kind + "_" + (cache ? "cached" : "uncached"),
                  elapsed_ms: measurement.wall_ms,
                  measurement,
                });
              }
          }
        } finally {
          await stop(browser);
        }
      }
      await writeFile(options.output, JSON.stringify(data, null, 2) + "\n");
      process.stdout.write(
        `Pair ${pair + 1}/${options.runs}, ${mode} complete\n`,
      );
    }
  }
  if (options.trace)
    for (const mode of ["off", "on"]) {
      const browser = await launch(mode, lastProfiles[mode]);
      try {
        await recordTrace(browser, mode);
      } finally {
        await stop(browser);
      }
    }
  for (const mode of ["off", "on"]) {
    // Memory uses a clean-only profile, so restored ad-heavy pages and their
    // decoded resources cannot contaminate the blocker overhead comparison.
    const profile = join(taskRoot, `memory-${mode}`);
    await mkdir(join(profile, "Default"), { recursive: true });
    await writeFile(
      join(profile, "Default", "Preferences"),
      JSON.stringify({
        merlin: { adblock: { updates: false } },
        session: { restore_on_startup: 5 },
      }),
    );
    const primer = await launch(mode, profile);
    try {
      await page(primer, "clean", true);
    } finally {
      await stop(primer);
    }
    const browser = await launch(mode, profile);
    try {
      await page(browser, "clean", true);
      let current = 1;
      for (const tabs of options.tabs) {
        while (current < tabs) {
          await browser.cdp.call("Target.createTarget", {
            url: fixture("clean") + "?tab=" + current,
          });
          ++current;
        }
        await sleep(options.idle * 1000);
        const first = await processTree(browser.proc.pid);
        await sleep(options.idle * 1000);
        const last = await processTree(browser.proc.pid);
        const { targetInfos } = await browser.cdp.call("Target.getTargets");
        const pages = targetInfos.filter((t) => t.type === "page");
        if (pages.length !== tabs) throw Error("Invalid live-tab sample");
        data.memory.push({
          mode,
          tabs,
          ...last,
          idle_cpu_seconds: last.cpu_seconds - first.cpu_seconds,
          idle_interval_seconds: options.idle,
        });
      }
    } finally {
      await stop(browser);
    }
  }
  data.summary = summarize();
  data.percentile_method = "R7 linear interpolation";
  data.valid = true;
  data.qualification =
    "Development measurement until explicitly run against the distribution build and all gates reviewed";
  data.finished = new Date().toISOString();
  await writeFile(options.output, JSON.stringify(data, null, 2) + "\n");
  process.stdout.write(`Saved ${options.output}\n`);
} catch (error) {
  data.server_totals = { ...served };
  data.error = error.stack;
  await writeFile(options.output, JSON.stringify(data, null, 2) + "\n");
  process.stderr.write(
    error.stack + "\nProfiles retained at " + taskRoot + "\n",
  );
  process.exitCode = 1;
} finally {
  await new Promise((r) => server.close(r));
  if (data.valid) await rm(taskRoot, { recursive: true, force: true });
}
