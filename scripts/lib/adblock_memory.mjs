// Native sampling is opt-in QA only. It uses Chromium's existing allocator
// profiler; it neither replaces an allocator nor enables metrics uploads.
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const heapFeature =
  "HeapProfilerReporting:stable-probability/1/nonstable-probability/1/browser-sampling-rate-bytes/4096/renderer-sampling-rate-bytes/4096/utility-sampling-rate-bytes/0/network-sampling-rate-bytes/0/gpu-sampling-rate-bytes/0";

export class NativeMemory {
  constructor(browser, output) {
    this.browser = browser;
    this.output = output;
    this.stacks = [];
    this.stackIds = new Map();
    this.snapshots = [];
  }

  encode(profile) {
    return {
      modules: profile.modules,
      samples: profile.samples.map(({ size, total, stack }) => {
        const key = JSON.stringify(stack);
        let id = this.stackIds.get(key);
        if (id === undefined) {
          id = this.stacks.length;
          this.stacks.push(stack);
          this.stackIds.set(key, id);
        }
        return [size, total, id];
      }),
    };
  }

  async browserSnapshot(label) {
    const { cdp, session } = this.browser;
    const { profile } = await cdp.call(
      "Memory.getBrowserSamplingProfile",
      {},
      session,
    );
    if (!profile.samples.length)
      throw Error("Native browser heap profiler did not start");
    const value = {
      label,
      elapsed_ms: performance.now() - this.browser.started,
      browser: this.encode(profile),
    };
    this.snapshots.push(value);
    return value;
  }

  async steady(label) {
    const { cdp } = this.browser;
    const { targetInfos } = await cdp.call("Target.getTargets");
    const renderers = [];
    for (const target of targetInfos.filter((t) => t.type === "page")) {
      const { sessionId } = await cdp.call("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      try {
        await cdp.call("HeapProfiler.collectGarbage", {}, sessionId);
        const { profile } = await cdp.call(
          "Memory.getAllTimeSamplingProfile",
          {},
          sessionId,
        );
        if (!profile.samples.length)
          throw Error("Native renderer heap profiler did not start");
        renderers.push({
          target: target.targetId,
          native: this.encode(profile),
          javascript: await cdp.call("Runtime.getHeapUsage", {}, sessionId),
          dom: await cdp.call("Memory.getDOMCounters", {}, sessionId),
        });
      } finally {
        await cdp.call("Target.detachFromTarget", { sessionId });
      }
    }
    const result = await this.browserSnapshot(label);
    result.renderers = renderers;
    result.memory_dump = await cdp.call("Tracing.requestMemoryDump", {
      levelOfDetail: "detailed",
      deterministic: true,
    });
    if (!result.memory_dump.success) throw Error("Memory dump failed");
    process.stdout.write(`Native memory checkpoint: ${label}\n`);
  }

  async replacements(page) {
    const { cdp, session, target } = this.browser;
    const { targetInfos } = await cdp.call("Target.getTargets");
    for (const item of targetInfos.filter(
      (t) => t.type === "page" && t.targetId !== target,
    ))
      await cdp.call("Target.closeTarget", { targetId: item.targetId });
    await page(this.browser, "clean", true);
    await sleep(2000);
    await this.steady("one_tab_after_closing_30");
    await cdp.call("Page.navigate", { url: "chrome://settings" }, session);
    const status = async () => {
      const { result, exceptionDetails } = await cdp.call(
        "Runtime.evaluate",
        {
          expression:
            "document.querySelector('#adblock-status')?.textContent || ''",
          returnByValue: true,
        },
        session,
      );
      return exceptionDetails ? "" : result.value;
    };
    for (let i = 0; i < 100 && !(await status()); ++i) await sleep(100);
    if (!(await status()).includes("ready"))
      throw Error("Settings protection status is not ready");
    for (let cycle = 0; cycle < 3; ++cycle) {
      for (const groups of [
        ["easylist", "easyprivacy", "ublock"],
        ["easylist", "easyprivacy", "ublock", "brave"],
      ]) {
        const before = await status();
        await cdp.call(
          "Runtime.evaluate",
          {
            expression: `chrome.send('setAdblockLists',[${JSON.stringify(groups)}])`,
          },
          session,
        );
        let installed = false;
        // Both configurations rebuild a complete candidate while the previous
        // evaluator remains live. Sample the actual browser's transient heap.
        const end = performance.now() + 90000;
        while (performance.now() < end) {
          await this.browserSnapshot(`replacement_${cycle}_${groups.length}`);
          const current = await status();
          if (current.includes("ready") && current !== before) {
            installed = true;
            break;
          }
          await sleep(100);
        }
        if (!installed) throw Error("Rules replacement did not complete");
        await sleep(1000);
        await this.browserSnapshot(`installed_${cycle}_${groups.length}`);
      }
    }
    await page(this.browser, "clean", true);
    for (let n = 0; n < 30; ++n) await page(this.browser, "clean", true);
    await sleep(2000);
    await this.steady("after_6_replacements_and_30_navigations");
  }

  async startTrace() {
    await this.browser.cdp.call("Tracing.start", {
      transferMode: "ReturnAsStream",
      traceConfig: {
        includedCategories: ["disabled-by-default-memory-infra"],
        memoryDumpConfig: { triggers: [] },
      },
    });
  }

  async refresh(page) {
    const { cdp, session } = this.browser;
    await cdp.call("Page.navigate", { url: "chrome://settings" }, session);
    const evaluate = async (expression) =>
      (
        await cdp.call(
          "Runtime.evaluate",
          { expression, returnByValue: true },
          session,
        )
      ).result.value;
    for (
      let i = 0;
      i < 100 &&
      !(await evaluate("!!document.querySelector('#adblock-refresh')"));
      ++i
    )
      await sleep(100);
    const started = await evaluate(
      "(()=>{const b=document.querySelector('#adblock-refresh');if(!b||b.disabled)return false;b.click();return true;})()",
    );
    if (!started) throw Error("Manual filter refresh control is unavailable");
    const end = performance.now() + 330000;
    let outcome;
    let samples = 0;
    while (performance.now() < end) {
      if (++samples > 256)
        throw Error(
          "Refresh exceeded the bounded native-sampling budget; retain this diagnostic and retry after the slow source recovers",
        );
      await this.browserSnapshot("network_refresh");
      const status = await evaluate(
        "document.querySelector('#adblock-update-status')?.textContent || ''",
      );
      if (
        /Filter lists updated|Selected lists are up to date|previous rules retained|could not be saved|checked recently/i.test(
          status,
        )
      ) {
        outcome = status;
        break;
      }
      await sleep(100);
    }
    if (!outcome)
      throw Error("Manual update did not report a terminal outcome");
    this.networkUpdate = {
      outcome,
      updated: outcome === "Filter lists updated",
    };
    const control = await page(this.browser, "heavy", false);
    if (control.ad_server_requests !== 0)
      throw Error("Protection failed after the manual refresh");
    this.networkUpdate.blocked_fixture_requests = control.blocked_requests;
    await page(this.browser, "clean", true);
    await sleep(2000);
    await this.steady("after_network_refresh");
    process.stdout.write(`Manual network refresh: ${outcome}\n`);
  }

  async finish() {
    const { cdp } = this.browser;
    const complete = once(cdp, "Tracing.tracingComplete");
    await cdp.call("Tracing.end");
    const [event] = await complete;
    const chunks = [];
    for (;;) {
      const part = await cdp.call("IO.read", { handle: event.stream });
      chunks.push(
        Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"),
      );
      if (part.eof) break;
    }
    await cdp.call("IO.close", { handle: event.stream });
    const path = this.output + ".memory.trace.json.gz";
    await writeFile(path, gzipSync(Buffer.concat(chunks)));
    return {
      sampling_interval_bytes: 4096,
      sample_tuple: ["allocation_size", "estimated_live_bytes", "stack_id"],
      stacks: this.stacks,
      snapshots: this.snapshots,
      trace: path,
      ...(this.networkUpdate ? { network_update: this.networkUpdate } : {}),
      limits: [
        "Poisson-sampled allocation estimates, not an exact byte counter.",
        "Native stacks attribute synchronous allocations; async DOM/V8 state is also measured via renderer heap totals and full memory-infra dumps.",
        "100 ms replacement sampling can miss shorter transient peaks; reported peaks are observed lower bounds.",
        "Six complete candidate rebuilds exercise the real install pipeline through list-group changes; this is not six network downloads.",
        "Profiling overhead is excluded from ordinary latency trials; local profiles and fixtures only.",
      ],
    };
  }
}
