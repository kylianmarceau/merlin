#!/usr/bin/env node
// Live, signed-out smoke probe. Results do not establish ad eligibility alone.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { CDP, deadline } from "./lib/cdp.mjs";
const options = {
  mode: "on",
  seconds: 90,
  url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  output: "/tmp/merlin-youtube-probe.json",
};
for (let i = 2; i < process.argv.length; ++i) {
  const key = process.argv[i];
  if (["--app", "--mode", "--url", "--output", "--seconds"].includes(key))
    options[key.slice(2)] = process.argv[++i];
  else if (key === "--private") options.private = true;
  else if (key === "--headful") options.headful = true;
  else if (key === "--reference") options.reference = true;
  else if (key === "--via-open") options.viaOpen = true;
  else throw Error("Unknown option: " + key);
}
if (
  !options.app ||
  !["on", "off"].includes(options.mode) ||
  !Number.isFinite(Number(options.seconds)) ||
  Number(options.seconds) < 10 ||
  Number(options.seconds) > 1800
)
  throw Error(
    "Usage: probe_adblock_youtube.mjs --app /path/Browser.app [--mode on|off] [--private] [--headful] [--reference] [--url URL] [--seconds 90] [--output file.json]",
  );
const url = new URL(options.url);
if (
  url.protocol !== "https:" ||
  !["www.youtube.com", "youtube.com"].includes(url.hostname)
)
  throw Error("Use an HTTPS YouTube URL");
const root = await mkdtemp(join(tmpdir(), "merlin-youtube-"));
const profile = join(root, "profile"),
  config = join(root, "config/modal_browser");
await mkdir(config, { recursive: true });
await mkdir(join(profile, "Default"), { recursive: true });
await writeFile(
  join(config, "config.toml"),
  "[options]\nmodal_browsing = false\nbrowserctl = false\nrestore_session = false\n",
);
await writeFile(
  join(profile, "Default/Preferences"),
  JSON.stringify({
    merlin: { adblock: { updates: false } },
    session: { restore_on_startup: 5 },
  }),
);
const args = [
  ...(options.headful ? [] : ["--headless"]),
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  `--user-data-dir=${profile}`,
  "--remote-debugging-port=0",
  "about:blank",
];
if (!options.reference)
  args.push(
    `--${options.mode === "on" ? "enable" : "disable"}-features=MerlinAdblock`,
  );
const binary = join(
  resolve(options.app),
  "Contents/MacOS",
  basename(options.app, ".app"),
);
if (options.viaOpen && !options.reference)
  throw Error("--via-open is restricted to the isolated reference browser");
const proc = spawn(
  options.viaOpen ? "/usr/bin/open" : binary,
  options.viaOpen
    ? ["-n", "-a", resolve(options.app), "--args", ...args]
    : args,
  {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      MODAL_BROWSER_SOCKET: join(root, "control.sock"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let stderr = "";
proc.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-200000);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = {
  started: new Date().toISOString(),
  options,
  profile_directory: root,
  signed_in: false,
  headless: !options.headful,
  network: { requests: 0, blocked: 0, ad_responses: 0 },
  samples: [],
  valid: false,
};
let cdp, session;
async function evaluate(expression) {
  const answer = await cdp.call(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
      timeout: 5000,
    },
    session,
  );
  if (answer.exceptionDetails)
    throw Error(
      answer.exceptionDetails.text +
        ": " +
        JSON.stringify(answer.exceptionDetails.exception),
    );
  return answer.result.value;
}
const snapshot = `JSON.stringify((()=>{const v=document.querySelector('video'),p=document.querySelector('#movie_player'),r=globalThis.ytInitialPlayerResponse;
return {url:location.href,title:document.title,ad_showing:!!document.querySelector('.ad-showing'),
warning:[...document.querySelectorAll('ytd-enforcement-message-view-model,yt-playability-error-supported-renderers,.ytp-error-content-wrap')].map(e=>e.innerText.trim()).filter(Boolean).join(' ').slice(0,1000),
player_state:p?.getPlayerState?.(),video_id:p?.getVideoData?.()?.video_id,playability:r?.playabilityStatus?.status,playability_reason:r?.playabilityStatus?.reason,
ad_placements:r?.adPlacements?.length||0,player_ads:r?.playerAds?.length||0,ad_slots:r?.adSlots?.length||0,
video:v?{time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,ready_state:v.readyState,network_state:v.networkState,error:v.error?.code||null,buffered_end:v.buffered.length?v.buffered.end(v.buffered.length-1):null,source_kind:v.currentSrc.startsWith('blob:')?'blob':v.currentSrc?'remote':'none'}:null};})())`;
try {
  let endpoint;
  for (let i = 0; i < 300; ++i) {
    if (!options.viaOpen && proc.exitCode !== null)
      throw Error("Browser exited: " + proc.exitCode);
    try {
      const text = await readFile(join(profile, "DevToolsActivePort"), "utf8");
      const [port, path] = text.trim().split("\n");
      endpoint = `ws://127.0.0.1:${port}${path}`;
      break;
    } catch {}
    await sleep(100);
  }
  if (!endpoint) throw Error("DevTools endpoint unavailable");
  cdp = await CDP.connect(endpoint);
  result.version = await cdp.call("Browser.getVersion");
  let browserContextId;
  if (options.private)
    ({ browserContextId } = await cdp.call("Target.createBrowserContext", {
      disposeOnDetach: true,
    }));
  const { targetId } = await cdp.call("Target.createTarget", {
    url: "about:blank",
    ...(browserContextId ? { browserContextId } : {}),
  });
  ({ sessionId: session } = await cdp.call("Target.attachToTarget", {
    targetId,
    flatten: true,
  }));
  await cdp.call("Page.enable", {}, session);
  await cdp.call("Runtime.enable", {}, session);
  await cdp.call("Network.enable", {}, session);
  cdp.on("Network.requestWillBeSent", (_, sid) => {
    if (sid === session) ++result.network.requests;
  });
  cdp.on("Network.loadingFailed", (event, sid) => {
    if (sid !== session) return;
    result.network.failures ||= {};
    result.network.failures[event.errorText] =
      (result.network.failures[event.errorText] || 0) + 1;
    if (event.errorText === "net::ERR_BLOCKED_BY_CLIENT")
      ++result.network.blocked;
  });
  cdp.on("Network.responseReceived", (event, sid) => {
    if (
      sid === session &&
      (event.type === "Media" || /googlevideo\.com/.test(event.response.url))
    ) {
      result.network.media_status ||= {};
      const code = String(event.response.status);
      result.network.media_status[code] =
        (result.network.media_status[code] || 0) + 1;
    }
    if (
      sid === session &&
      /doubleclick\.net|googleadservices\.com|\/api\/stats\/ads|\/pagead\//.test(
        event.response.url,
      )
    )
      ++result.network.ad_responses;
  });
  await cdp.call("Page.navigate", { url: options.url }, session);
  for (let i = 0; i < 30; ++i) {
    await sleep(1000);
    await evaluate(
      `(()=>{const button=[...document.querySelectorAll('button')].find(e=>/^Reject all$/i.test(e.innerText.trim()));if(button)button.click();return true;})()`,
    ).catch(() => {});
    const sample = JSON.parse(await evaluate(snapshot));
    if (sample.video || sample.warning.trim()) {
      result.initial = sample;
      break;
    }
  }
  async function startPlayback() {
    const point =
      await evaluate(`(()=>{const v=document.querySelector('video');if(v)v.muted=true;
      if(!v||!v.paused)return null;
      const b=[...document.querySelectorAll('.ytp-large-play-button,.ytp-play-button')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
      if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if (point)
      for (const type of ["mousePressed", "mouseReleased"])
        await cdp.call(
          "Input.dispatchMouseEvent",
          { ...point, type, button: "left", clickCount: 1 },
          session,
        );
    await evaluate(
      `(()=>{const v=document.querySelector('video');if(v?.paused)document.querySelector('#movie_player')?.playVideo?.();return true;})()`,
    );
  }
  await startPlayback().catch(() => {});
  result.play_request = await evaluate(
    `(async()=>{const v=document.querySelector('video');if(!v)return 'no video';v.muted=true;try{await v.play();return 'playing';}catch(e){return e.name+': '+e.message;}})()`,
  ).catch((e) => e.message);
  for (let elapsed = 0; elapsed < Number(options.seconds); elapsed += 5) {
    await sleep(5000);
    if (elapsed > 0 && elapsed % 15 === 0)
      await startPlayback().catch(() => {});
    result.samples.push({
      elapsed: elapsed + 5,
      ...JSON.parse(await evaluate(snapshot)),
    });
    await writeFile(options.output, JSON.stringify(result, null, 2) + "\n");
  }
  result.seek = await evaluate(
    `(async()=>{const v=document.querySelector('video');if(!v||!Number.isFinite(v.duration)||document.querySelector('.ad-showing'))return 'unavailable';const before=v.currentTime;v.currentTime=Math.min(before+10,v.duration-1);return {before,target:v.currentTime};})()`,
  );
  await sleep(3000);
  result.after_seek = JSON.parse(await evaluate(snapshot));
  result.captions = await evaluate(
    `(()=>{const b=document.querySelector('.ytp-subtitles-button');if(!b)return 'unavailable';b.click();return {pressed:b.getAttribute('aria-pressed'),title:b.title};})()`,
  );
  result.fullscreen = await evaluate(
    `(async()=>{const v=document.querySelector('video');if(!v)return 'unavailable';try{await v.requestFullscreen();const active=!!document.fullscreenElement;await document.exitFullscreen();return active;}catch(e){return e.name+': '+e.message;}})()`,
  );
  result.picture_in_picture = await evaluate(
    `(async()=>{const v=document.querySelector('video');if(!v)return 'unavailable';try{await v.requestPictureInPicture();await document.exitPictureInPicture();return true;}catch(e){return e.name+': '+e.message;}})()`,
  );
  const screenshot = await cdp.call(
    "Page.captureScreenshot",
    { format: "png" },
    session,
  );
  result.screenshot = options.output + ".png";
  await writeFile(result.screenshot, Buffer.from(screenshot.data, "base64"));
  const playing = result.samples.filter(
    (sample) => sample.video?.ready_state >= 2 && !sample.video.paused,
  );
  result.initial_playback =
    playing.length >= 2 &&
    playing.at(-1).video.time - playing[0].video.time >= 5;
  const last = result.samples.at(-1);
  result.playback_passed = !!(
    result.initial_playback &&
    last?.video?.ready_state >= 2 &&
    !last.video.paused &&
    playing.length >= result.samples.length * 0.8
  );

  result.valid = true;
  if (!result.playback_passed) process.exitCode = 2;
  result.limitations = [
    `Signed-out ${options.headful ? "windowed" : "headless"} smoke probe; ad eligibility requires an observed unblocked control.`,
    "Fullscreen/PiP API results do not establish native window UI acceptance.",
    "SPA, playlist/autoplay, Shorts, third-party embeds and longer mid-roll checks need separate cases.",
  ];
} catch (error) {
  result.error = error.stack;
  if (cdp && session) {
    const screenshot = await cdp
      .call("Page.captureScreenshot", { format: "png" }, session)
      .catch(() => null);
    if (screenshot) {
      result.screenshot = options.output + ".png";
      await writeFile(
        result.screenshot,
        Buffer.from(screenshot.data, "base64"),
      );
    }
  }
  process.exitCode = 1;
} finally {
  result.finished = new Date().toISOString();
  await writeFile(options.output, JSON.stringify(result, null, 2) + "\n");
  await writeFile(join(root, "browser-stderr.log"), stderr);
  if (cdp) {
    await deadline(
      cdp.call("Browser.close"),
      5000,
      "Browser close timeout",
    ).catch(() => {});
    cdp.close();
  }
  if (proc.exitCode === null)
    await deadline(once(proc, "exit"), 5000, "Browser exit timeout").catch(() =>
      proc.kill("SIGTERM"),
    );
  process.stdout.write(
    JSON.stringify({
      output: options.output,
      valid: result.valid,
      playback_passed: result.playback_passed ?? false,
      error: result.error || null,
    }) + "\n",
  );
}
