#!/usr/bin/env node
// Interleaved A/B of two Merlin builds on tab switching and idle, from outside.
//
//   node ab_switch.mjs DIR [base,new,new,base]
//
// DIR holds base/Merlin.app and new/Merlin.app (both re-signed APFS clones
// under io.github.kylianmarceau.merlin.bench, never Merlin's own bundle ID)
// and probe (cc -O2 -o DIR/probe scripts/final_bench/probe.c). Each run: 11
// tabs of the bench page, 30 s idle, 30 s of one switch a second, then 100
// tabs, 30 s idle and 30 s of switching among 12 of them. Rows go to
// DIR/results.jsonl; AB_TRACE=1 also writes the shell's timing trace
// (snapshot-commit, event-parse) to DIR/trace-<variant>-<run>.txt.
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile, rm, readFile, appendFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { CDP } from "../lib/cdp.mjs";
const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = realpathSync(process.argv[2]);
const ORDER = (process.argv[3] || "base,new,new,base").split(",");
const OUT = join(W, "results.jsonl");
const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ";
const boxes = Array.from({ length: 60 }, (_, i) => `<div style="display:inline-block;width:80px;height:40px;margin:4px;background:hsl(${i * 6},60%,70%)">${i}</div>`).join("");
const paras = Array.from({ length: 120 }, (_, i) => `<p>${i}. ${LOREM.repeat(2)}</p>`).join("");
const PAGE = (id) => `<!doctype html><title>Bench ${id}</title><div id=clock></div>${boxes}${paras}<script>setInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleTimeString()},1000)</script>`;
const server = createServer((req, res) => {
  if (req.url.startsWith("/favicon")) { res.writeHead(204); return res.end(); }
  const id = new URL(req.url, "http://x").searchParams.get("id");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE(id));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/page`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function one(variant, runNo) {
  const APP = join(W, variant, "Merlin.app");
  const PROFILE = join(W, "profiles", `${variant}-${runNo}`);
  await rm(PROFILE, { recursive: true, force: true });
  for (const d of ["xdg", "data", "wk", "ud"]) await mkdir(join(PROFILE, d), { recursive: true });
  await run("defaults", ["delete", "io.github.kylianmarceau.merlin.bench"]).catch(() => {});
  const trace = join(PROFILE, "trace.txt");
  const port = 26000 + Math.floor(Math.random() * 1000);
  const env = [`XDG_CONFIG_HOME=${PROFILE}/xdg`, `XDG_DATA_HOME=${PROFILE}/data`, `MERLIN_WEBKIT_TEST_FOLDER=${PROFILE}/wk`, `MODAL_BROWSER_SOCKET=${PROFILE}/browserctl.sock`].concat(process.env.AB_TRACE ? [`MERLIN_STARTUP_TRACE=${trace}`] : []);
  const argv = [`--user-data-dir=${PROFILE}/ud`, `--remote-debugging-port=${port}`, "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--window-size=1280,800", "--window-position=40,80"];
  await run("open", ["-n", "-a", APP, ...env.flatMap((e) => ["--env", e]), `${base}?id=0`, "--args", ...argv]);
  let pid;
  for (let i = 0; i < 500 && !pid; i++) { const { stdout } = await run("pgrep", ["-f", `^${APP}/Contents/MacOS/Merlin( |$)`]).catch(() => ({ stdout: "" })); pid = Number(stdout.trim().split("\n")[0]) || undefined; if (!pid) await sleep(20); }
  if (!pid) throw Error("no Merlin pid for " + APP);
  console.log("pid", pid);
  let ws;
  for (let i = 0; i < 600 && !ws; i++) { ws = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl).catch(() => null); if (!ws) await sleep(100); }
  const cdp = await CDP.connect(ws);
  const probe = async () => JSON.parse((await run(join(W, "probe"), [APP, String(pid)], { maxBuffer: 1 << 24 })).stdout);
  const targets = async () => (await cdp.call("Target.getTargets")).targetInfos.filter((t) => t.type === "page" && t.url.startsWith(base));
  const traceMark = async (label) => appendFile(trace, `#mark ${label}\n`).catch(() => {});
  async function measure(label, seconds, during) {
    await traceMark(label + ":start");
    const a = await probe();
    if (during) await during(seconds); else await sleep(seconds * 1000);
    const b = await probe();
    await traceMark(label + ":end");
    const dt = (b.t - a.t) / 1000, prev = new Map(a.processes.map((x) => [x.pid, x])), k = {};
    for (const x of b.processes) {
      const p = prev.get(x.pid) || { cpu_ns: 0, energy_nj: 0, int_wakeups: 0, disk_written: 0 };
      const kind = x.kind === "browser" ? "browser" : x.kind === "renderer" ? "renderer" : x.kind === "gpu-process" ? "gpu" : "utility";
      const s = (k[kind] ||= { cpu: 0, mw: 0, w: 0 });
      s.cpu += (x.cpu_ns - p.cpu_ns) / 1e9 / dt * 100; s.mw += (x.energy_nj - p.energy_nj) / dt / 1e6; s.w += (x.int_wakeups - p.int_wakeups) / dt;
    }
    for (const v of Object.values(k)) for (const f of ["cpu", "mw", "w"]) v[f] = +v[f].toFixed(2);
    const row = { variant, run: runNo, label, seconds: +dt.toFixed(1), byKind: k };
    log(JSON.stringify(row));
    await appendFile(OUT, JSON.stringify(row) + "\n");
  }
  const switching = (list) => async (s) => { for (let i = 0; i < s; i++) { await cdp.call("Target.activateTarget", { targetId: list[i % list.length].targetId }).catch(() => {}); await sleep(1000); } };
  await sleep(6000);
  const early = join(PROFILE, "early.txt");
  await run("sample", [String(pid), "2", "-mayDie", "-file", early]).catch(() => {});
  const earlyText = await readFile(early, "utf8").catch(() => "");
  const { stdout: helpers } = await run("pgrep", ["-lf", `${APP}/`]).catch(() => ({ stdout: "" }));
  const profiled = helpers.split("\n").filter((l) => l.includes("--start-stack-profiler")).length;
  await appendFile(OUT, JSON.stringify({ variant, run: runNo, label: "early-helpers", helpersWithStackProfiler: profiled }) + "\n");
  await appendFile(OUT, JSON.stringify({ variant, run: runNo, label: "early-threads", sampled: earlyText.length > 0, stackProfilerThread: earlyText.includes("StackSamplingProfiler") }) + "\n");
  for (let i = 1; i < 11; i++) { await cdp.call("Target.createTarget", { url: `${base}?id=${i}`, background: true }); await sleep(150); }
  await sleep(20000);
  await measure("t11-idle", 30);
  await measure("t11-switch", 30, switching(await targets()));
  for (let i = 11; i < 100; i++) { await cdp.call("Target.createTarget", { url: `${base}?id=${i}`, background: true }); await sleep(80); }
  await sleep(30000);
  await measure("t100-idle", 30);
  await measure("t100-switch", 30, switching((await targets()).slice(0, 12)));
  // Threads: is the stack sampling profiler running?
  const sampled = join(PROFILE, "threads.txt");
  await run("sample", [String(pid), "1", "-mayDie", "-file", sampled]).catch(() => {});
  const threads = await readFile(sampled, "utf8").catch(() => "");
  const { stdout: psargs } = await run("ps", ["-o", "args=", "-p", String(pid)]).catch(() => ({ stdout: "" }));
  await appendFile(OUT, JSON.stringify({ variant, run: runNo, label: "threads", stackProfilerThread: threads.includes("StackSamplingProfiler"), disableSwitch: psargs.includes("--disable-stack-profiler") }) + "\n");
  await cdp.call("Browser.close").catch(() => {});
  await sleep(4000);
  await run("pkill", ["-9", "-f", `${APP}/`]).catch(() => {});
  await sleep(2000);
  await run("cp", [trace, join(W, `trace-${variant}-${runNo}.txt`)]).catch(() => {});
  await rm(PROFILE, { recursive: true, force: true });
}
let n = 0;
for (const v of ORDER) await one(v, n++);
await run("defaults", ["delete", "io.github.kylianmarceau.merlin.bench"]).catch(() => {});
server.close();
log("done");
process.exit(0);
