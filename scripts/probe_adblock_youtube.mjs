#!/usr/bin/env node
// Live playback probe. Results do not establish ad eligibility alone.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { CDP, deadline } from "./lib/cdp.mjs";
const options = {
  mode: "on",
  route: "direct",
  shortsSteps: 0,
  seconds: 90,
  url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  output: "/tmp/merlin-youtube-probe.json",
};
for (let i = 2; i < process.argv.length; ++i) {
  const key = process.argv[i];
  if (
    [
      "--app",
      "--mode",
      "--route",
      "--url",
      "--output",
      "--seconds",
      "--profile",
    ].includes(key)
  )
    options[key.slice(2)] = process.argv[++i];
  else if (key === "--private") options.private = true;
  else if (key === "--headful") options.headful = true;
  else if (key === "--wait-for-signin") options.waitForSignin = true;
  else if (key === "--no-controls") options.noControls = true;
  else if (key === "--stop-after-midroll") options.stopAfterMidroll = true;
  else if (key === "--autoplay") options.autoplay = true;
  else if (key === "--shorts-steps")
    options.shortsSteps = Number(process.argv[++i]);
  else if (key === "--reference") options.reference = true;
  else if (key === "--via-open") options.viaOpen = true;
  else throw Error("Unknown option: " + key);
}
if (
  !options.app ||
  !["on", "off"].includes(options.mode) ||
  !["direct", "spa", "shorts", "playlist", "embed"].includes(options.route) ||
  !Number.isFinite(Number(options.seconds)) ||
  Number(options.seconds) < 10 ||
  Number(options.seconds) > 1800 ||
  !Number.isInteger(options.shortsSteps) ||
  options.shortsSteps < 0 ||
  options.shortsSteps > 10
)
  throw Error(
    "Usage: probe_adblock_youtube.mjs --app /path/Browser.app [--mode on|off] [--route direct|spa|shorts|playlist|embed] [--autoplay] [--shorts-steps 3] [--private] [--headful] [--reference] [--url URL] [--seconds 90] [--output file.json] [--profile /isolated/test/profile --wait-for-signin]",
  );
if (
  options.waitForSignin &&
  (!options.headful || options.private || !options.profile)
)
  throw Error(
    "Interactive sign-in needs --headful --profile /isolated/test/profile and normal mode",
  );
if (
  options.stopAfterMidroll &&
  (options.mode !== "off" || options.route !== "direct")
)
  throw Error(
    "--stop-after-midroll requires an unprotected direct-watch control",
  );
const url = new URL(options.url);
if (
  url.protocol !== "https:" ||
  !["www.youtube.com", "youtube.com"].includes(url.hostname)
)
  throw Error("Use an HTTPS YouTube URL");
const root = await mkdtemp(join(tmpdir(), "merlin-youtube-"));
let embedServer,
  navigationUrl = options.url;
if (options.route === "embed") {
  const id = url.searchParams.get("v");
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
    throw Error("Embed route needs a watch video ID");
  embedServer = createHttpServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      `<!doctype html><title>Merlin embedding fixture</title><iframe style="width:95vw;height:85vh" src="https://www.youtube.com/embed/${id}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`,
    );
  });
  embedServer.listen(0, "127.0.0.1");
  await once(embedServer, "listening");
  navigationUrl = `http://127.0.0.1:${embedServer.address().port}/`;
}
const profile = options.profile
    ? resolve(options.profile)
    : join(root, "profile"),
  config = join(root, "config/modal_browser");
await mkdir(config, { recursive: true });
await mkdir(profile, { recursive: true, mode: 0o700 });
await chmod(profile, 0o700);
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
  { flag: "wx" },
).catch((error) => {
  if (error.code !== "EEXIST") throw error;
});
// Chromium treats port 0 as ChromeDriver-style automation. A windowed probe
// uses ordinary debugger attachment, without changing browser runtime features.
const debugPort = options.headful
  ? await new Promise((resolve, reject) => {
      const server = createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close((error) => (error ? reject(error) : resolve(port)));
      });
    })
  : 0;
const args = [
  ...(options.headful ? [] : ["--headless"]),
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--mute-audio",
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${debugPort}`,
  "--remote-debugging-address=127.0.0.1",
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
function serializedResult() {
  return (
    JSON.stringify(
      result,
      (_key, value) => {
        if (typeof value !== "string" || !/^https?:\/\//.test(value))
          return value;
        try {
          const address = new URL(value),
            query = new URLSearchParams();
          // Keep public video/playlist routing, excluding tracking and challenge tokens.
          for (const key of ["v", "list", "index", "start_radio"])
            if (address.searchParams.has(key))
              query.set(key, address.searchParams.get(key));
          address.search = query.toString();
          address.hash = "";
          address.username = address.password = "";
          return address.href;
        } catch {
          return value;
        }
      },
      2,
    ) + "\n"
  );
}
let cdp, session, pageSession, schedulingWatch;
async function evaluate(expression) {
  // Shorts can retain an inactive watch-page video. Inspect the visible player.
  expression = expression.replaceAll(
    "document.querySelector('video')",
    "__merlinProbeVideo()",
  );
  const answer = await cdp.call(
    "Runtime.evaluate",
    {
      expression: `(()=>{const __merlinProbeVideo=()=>{const all=[...document.querySelectorAll('video')],visible=v=>{const r=v.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(v).visibility!=='hidden';};return all.find(v=>visible(v)&&!v.paused)||all.find(visible)||all[0];};return (${expression});})()`,
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
const snapshot = `JSON.stringify((()=>{const v=document.querySelector('video'),p=v?.closest('.html5-video-player')||document.querySelector('#movie_player'),r=globalThis.ytInitialPlayerResponse;
return {url:location.href,title:document.title,ad_showing:!!p?.classList.contains('ad-showing'),
warning:[...document.querySelectorAll('ytd-enforcement-message-view-model,yt-playability-error-supported-renderers,.ytp-error-content-wrap')].map(e=>e.innerText.trim()).filter(Boolean).join(' ').slice(0,1000),
player_state:p?.getPlayerState?.(),video_id:p?.getVideoData?.()?.video_id||new URL(location.href).searchParams.get('v')||(location.pathname.startsWith('/shorts/')?location.pathname.split('/')[2]:null),playability:r?.playabilityStatus?.status,playability_reason:r?.playabilityStatus?.reason,
ad_placements:r?.adPlacements?.length||0,player_ads:r?.playerAds?.length||0,ad_slots:r?.adSlots?.length||0,
video:v?{time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,ended:v.ended,ready_state:v.readyState,network_state:v.networkState,error:v.error?.code||null,buffered_end:v.buffered.length?v.buffered.end(v.buffered.length-1):null,source_kind:v.currentSrc.startsWith('blob:')?'blob':v.currentSrc?'remote':'none'}:null};})())`;
try {
  let endpoint;
  for (let i = 0; i < 300; ++i) {
    if (!options.viaOpen && proc.exitCode !== null)
      throw Error("Browser exited: " + proc.exitCode);
    try {
      if (debugPort) {
        const response = await fetch(
          `http://127.0.0.1:${debugPort}/json/version`,
          { signal: AbortSignal.timeout(1000) },
        );
        endpoint = (await response.json()).webSocketDebuggerUrl;
      } else {
        const text = await readFile(
          join(profile, "DevToolsActivePort"),
          "utf8",
        );
        const [port, path] = text.trim().split("\n");
        endpoint = `ws://127.0.0.1:${port}${path}`;
      }
      if (!endpoint) throw Error("Debugger endpoint not ready");
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
  pageSession = session;
  if (options.headful) await cdp.call("Target.activateTarget", { targetId });
  await cdp.call("Page.enable", {}, session);
  await cdp.call("Runtime.enable", {}, session);
  await cdp.call("Network.enable", {}, session);
  result.automation_controlled = await evaluate("navigator.webdriver");
  let resolveEmbed;
  const embedReady = new Promise((resolve) => {
    resolveEmbed = resolve;
  });
  const iframeSessions = new Map();
  const chooseEmbed = (sid, address) => {
    if (options.route !== "embed" || !/youtube\.com\/embed\//.test(address))
      return;
    const ready = iframeSessions.get(sid);
    if (ready)
      ready.then(
        () => resolveEmbed({ session: sid }),
        (error) => resolveEmbed({ error }),
      );
  };
  cdp.on("Target.attachedToTarget", (event) => {
    if (event.targetInfo.type !== "iframe") return;
    const sid = event.sessionId;
    const ready = Promise.all([
      cdp.call("Page.enable", {}, sid),
      cdp.call("Runtime.enable", {}, sid),
      cdp.call("Network.enable", {}, sid),
    ]);
    ready.catch(() => {});
    iframeSessions.set(sid, ready);
    chooseEmbed(sid, event.targetInfo.url);
  });
  cdp.on("Page.frameNavigated", (event, sid) =>
    chooseEmbed(sid, event.frame.url),
  );
  if (options.route === "embed")
    await cdp.call(
      "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      session,
    );
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
  if (options.waitForSignin) {
    await cdp.call(
      "Page.navigate",
      { url: "https://www.youtube.com/" },
      session,
    );
    process.stdout.write(
      "Sign in yourself in the isolated YouTube window. Do not send credentials to the assistant.\n",
    );
    const end = performance.now() + 60 * 60 * 1000;
    let loggedIn = false;
    while (performance.now() < end) {
      loggedIn = await evaluate(
        "globalThis.ytcfg?.get?.('LOGGED_IN') === true",
      ).catch(() => false);
      if (loggedIn) break;
      await sleep(1000);
    }
    if (!loggedIn)
      throw Error(
        "No signed-in YouTube session became available in the test window",
      );
    result.signed_in = true;
    result.account_condition =
      "User supplied isolated signed-in session; no credentials, identity or cookies collected. Non-Premium status must be confirmed by the user.";
  }
  await cdp.call("Page.navigate", { url: navigationUrl }, session);
  if (options.route === "embed") {
    const ready = await deadline(
      embedReady,
      45000,
      "Embedded player target did not attach",
    );
    if (ready.error) throw ready.error;
    session = ready.session;
    result.embedding_origin =
      "Isolated loopback HTTP page, cross-site YouTube iframe";
    result.network.scope = "Embedded target events after debugger attachment";
  }
  for (let i = 0; i < 30; ++i) {
    await sleep(1000);
    await evaluate(
      `(()=>{const button=[...document.querySelectorAll('button')].find(e=>/^Reject all$/i.test(e.innerText.trim()));if(button)button.click();return true;})()`,
    ).catch(() => {});
    try {
      const sample = JSON.parse(await evaluate(snapshot));
      if (sample.video || sample.warning.trim()) {
        result.initial = sample;
        break;
      }
    } catch {
      /* A new frame can attach before its first script context. */
    }
  }
  result.automation_controlled = await evaluate("navigator.webdriver");
  async function startPlayback() {
    const point =
      await evaluate(`(()=>{const v=document.querySelector('video');if(v)v.muted=true;
      if(!v||!v.paused)return null;
      const root=v.closest('.html5-video-player')||document;
      const b=[...root.querySelectorAll('.ytp-large-play-button,.ytp-play-button')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
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
  if (
    ["spa", "shorts", "playlist"].includes(options.route) &&
    !(options.route === "shorts" && result.initial?.url?.includes("/shorts/"))
  ) {
    await sleep(6000);
    result.pre_navigation = JSON.parse(await evaluate(snapshot));
    const source = await evaluate(
      `(()=>{globalThis.__merlinProbeDoc=crypto.randomUUID();return {marker:globalThis.__merlinProbeDoc,time_origin:performance.timeOrigin,url:location.href};})()`,
    );
    const point = await evaluate(`(()=>{
      const kind=${JSON.stringify(options.route)},current=new URL(location.href).searchParams.get('v');
      const link=[...document.querySelectorAll('a[href]')].find(a=>{const href=a.getAttribute('href'),r=a.getBoundingClientRect();if(!r.width||!r.height)return false;
        return kind==='shorts'?href.startsWith('/shorts/'):kind==='playlist'?href.startsWith('/watch?')&&href.includes('list='):href.startsWith('/watch?v=')&&new URL(a.href).searchParams.get('v')!==current;});
      if(!link)return null;link.scrollIntoView({block:'center'});const r=link.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,href:link.href};})()`);
    if (!point)
      throw Error(
        "Requested YouTube navigation link is unavailable: " + options.route,
      );
    for (const type of ["mousePressed", "mouseReleased"])
      await cdp.call(
        "Input.dispatchMouseEvent",
        { x: point.x, y: point.y, type, button: "left", clickCount: 1 },
        session,
      );
    for (let i = 0; i < 30; ++i) {
      await sleep(1000);
      const current = JSON.parse(await evaluate(snapshot));
      if (current.url !== source.url && current.video?.ready_state >= 2) break;
    }
    result.route_navigation = await evaluate(
      `({url:location.href,document_preserved:globalThis.__merlinProbeDoc===${JSON.stringify(source.marker)},time_origin_preserved:performance.timeOrigin===${source.time_origin},playlist_items:document.querySelectorAll('ytd-playlist-panel-video-renderer').length})`,
    );
    result.route_navigation.clicked_url = point.href;
    await startPlayback().catch(() => {});
  }
  let lastTick = Date.now();
  schedulingWatch = setInterval(() => {
    const now = Date.now();
    if (now - lastTick > 15000)
      (result.scheduling_gaps ??= []).push({
        at: new Date(now).toISOString(),
        gap_ms: now - lastTick,
      });
    lastTick = now;
  }, 1000);
  for (let elapsed = 0; elapsed < Number(options.seconds); elapsed += 5) {
    await sleep(5000);
    if (elapsed > 0 && elapsed % 15 === 0)
      await startPlayback().catch(() => {});
    result.samples.push({
      elapsed: elapsed + 5,
      ...JSON.parse(await evaluate(snapshot)),
    });
    const current = result.samples.at(-1);
    if (current.ad_showing && !result.midroll_observed) {
      let watched;
      const video = new URL(current.url).searchParams.get("v");
      for (let i = result.samples.length - 2; video && i >= 0; --i) {
        const sample = result.samples[i];
        if (new URL(sample.url).searchParams.get("v") !== video) break;
        if (
          !sample.ad_showing &&
          !sample.warning &&
          sample.video?.time >= 120
        ) {
          watched = sample;
          break;
        }
      }
      if (watched)
        result.midroll_observed = {
          elapsed_seconds: current.elapsed,
          content_time_before_ad: watched.video.time,
          watch_url: current.url,
          criterion:
            "Ad-showing sample after >=120 seconds of content in the same watch URL, without an intervening navigation",
        };
    }
    await writeFile(options.output, serializedResult());
    if (options.stopAfterMidroll && result.midroll_observed) break;
  }
  if (options.route === "shorts" && options.shortsSteps) {
    result.shorts_steps = [];
    for (let step = 0; step < options.shortsSteps; ++step) {
      const before = JSON.parse(await evaluate(snapshot));
      const clicked = await evaluate(
        `(()=>{const button=[...document.querySelectorAll('button')].find(b=>/next video/i.test(b.getAttribute('aria-label')||b.title||''));if(!button)return false;button.click();return true;})()`,
      );
      const entry = {
        clicked,
        source_video: before.video_id,
        samples: [],
        passed: false,
      };
      if (clicked)
        for (let tick = 0; tick < 8; ++tick) {
          await sleep(1000);
          entry.samples.push(JSON.parse(await evaluate(snapshot)));
        }
      const last = entry.samples.at(-1);
      entry.passed = !!(
        last?.video_id &&
        last.video_id !== before.video_id &&
        last.video?.ready_state >= 2 &&
        !last.video.paused &&
        !last.warning
      );
      result.shorts_steps.push(entry);
      await writeFile(options.output, serializedResult());
      if (!entry.passed) break;
    }
  }
  if (!options.noControls) {
    result.seek = await evaluate(
      `(async()=>{const v=document.querySelector('video');if(!v||!Number.isFinite(v.duration)||document.querySelector('.ad-showing'))return 'unavailable';const before=v.currentTime;v.currentTime=Math.min(before+10,v.duration-1);return {before,target:v.currentTime};})()`,
    );
    await sleep(3000);
    result.after_seek = JSON.parse(await evaluate(snapshot));
    result.captions = await evaluate(
      `(async()=>{const v=document.querySelector('video'),p=v?.closest('.html5-video-player'),b=p?.querySelector('.ytp-subtitles-button');if(!b)return 'unavailable';const before=b.getAttribute('aria-pressed');b.click();await new Promise(r=>setTimeout(r,1000));const toggled=b.getAttribute('aria-pressed')!==before,tracks=(p?.getOption?.('captions','tracklist')||[]).slice(0,50).map(t=>({language:t.languageCode,kind:t.kind}));if(tracks.length&&b.getAttribute('aria-pressed')!=='true'){b.click();await new Promise(r=>setTimeout(r,1000));}return {before,toggled,pressed:b.getAttribute('aria-pressed'),disabled:b.disabled||b.getAttribute('aria-disabled')==='true',tracks,selected_language:p?.getOption?.('captions','track')?.languageCode||null,captions_rendered:!!document.querySelector('.caption-window .ytp-caption-segment')?.textContent.trim()};})()`,
    );
    if (options.headful) await cdp.call("Target.activateTarget", { targetId });
    result.fullscreen = await evaluate(
      `(async()=>{const v=document.querySelector('video');if(!v)return 'unavailable';try{await v.requestFullscreen();const active=!!document.fullscreenElement;await document.exitFullscreen();return active;}catch(e){return e.name+': '+e.message;}})()`,
    );
    result.picture_in_picture = await evaluate(
      `(async()=>{const v=document.querySelector('video');if(!v)return 'unavailable';try{await v.requestPictureInPicture();await document.exitPictureInPicture();return true;}catch(e){return e.name+': '+e.message;}})()`,
    );
  } else
    result.player_controls =
      "Skipped explicitly; covered by a separate foreground controls case";
  if (options.autoplay) {
    const before = JSON.parse(await evaluate(snapshot));
    const attempted = await evaluate(
      `(()=>{const v=document.querySelector('video');if(!v||!Number.isFinite(v.duration)||v.duration<5||document.querySelector('.ad-showing'))return false;v.currentTime=v.duration-2;return true;})()`,
    );
    result.autoplay = {
      attempted,
      source_video: before.video_id,
      passed: false,
    };
    if (attempted) {
      for (let i = 0; i < 60; ++i) {
        await sleep(1000);
        const current = JSON.parse(await evaluate(snapshot));
        if (
          current.video_id !== before.video_id &&
          current.video?.ready_state >= 2 &&
          !current.video.paused &&
          !current.ad_showing
        ) {
          result.autoplay.passed = true;
          result.autoplay.destination = current;
          break;
        }
      }
    }
  }
  const screenshot = await cdp.call(
    "Page.captureScreenshot",
    { format: "png" },
    pageSession,
  );
  result.screenshot = options.output + ".png";
  await writeFile(result.screenshot, Buffer.from(screenshot.data, "base64"));
  const playing = result.samples.filter(
    (sample) => sample.video?.ready_state >= 2 && !sample.video.paused,
  );
  const content = playing.filter((sample) => !sample.ad_showing);
  let contentProgress = 0;
  for (let i = 1; i < content.length; ++i) {
    const previous = content[i - 1],
      current = content[i];
    if (previous.video_id !== current.video_id) continue;
    let delta = current.video.time - previous.video.time;
    if (
      delta < 0 &&
      previous.video.duration &&
      previous.video.time > previous.video.duration * 0.75 &&
      current.video.time < previous.video.duration * 0.25
    )
      delta += previous.video.duration;
    if (delta > 0) contentProgress += delta;
  }
  result.content_progress_seconds = contentProgress;
  result.initial_playback = content.length >= 2 && contentProgress >= 5;
  const last = result.samples.at(-1);
  result.playback_passed = !!(
    result.initial_playback &&
    !last?.warning &&
    (last?.video?.ended ||
      (last?.video?.ready_state >= 2 &&
        !last.video.paused &&
        playing.length >= result.samples.length * 0.8))
  );
  result.observed_ad_samples =
    result.samples.filter((sample) => sample.ad_showing).length +
    (result.pre_navigation?.ad_showing ? 1 : 0) +
    (result.shorts_steps || []).reduce(
      (n, step) =>
        n + step.samples.filter((sample) => sample.ad_showing).length,
      0,
    );
  result.ad_free_observed = result.observed_ad_samples === 0;
  const route = result.route_navigation;
  result.route_passed =
    options.route === "spa"
      ? !!(
          route?.document_preserved &&
          route.time_origin_preserved &&
          last?.video_id !== result.pre_navigation?.video_id
        )
      : options.route === "shorts"
        ? !!last?.url?.includes("/shorts/")
        : options.route === "playlist"
          ? !!(route?.url?.includes("list=") && route.playlist_items > 1)
          : true;
  result.acceptance_passed =
    result.playback_passed &&
    result.route_passed &&
    (!options.shortsSteps ||
      (result.shorts_steps?.length === options.shortsSteps &&
        result.shorts_steps.every((step) => step.passed))) &&
    (!options.autoplay || result.autoplay?.passed) &&
    (!options.stopAfterMidroll || !!result.midroll_observed) &&
    (options.mode === "off" || result.ad_free_observed);

  if (result.scheduling_gaps?.length)
    throw Error(
      "Playback observation interrupted by system suspension or a >15 s host scheduling gap",
    );
  result.valid = true;
  if (!result.acceptance_passed) process.exitCode = 2;
  result.limitations = [
    `${result.signed_in ? "Signed-in" : "Signed-out"} ${options.headful ? "windowed" : "headless"} smoke probe; ad eligibility requires an observed unblocked control.`,
    "Fullscreen/PiP API results do not establish native window UI acceptance.",
    "Only the selected route/observation duration is covered; signed-in sessions and observed mid-roll eligibility need separate evidence.",
  ];
} catch (error) {
  result.error = error.stack;
  if (cdp && session) {
    const screenshot = await cdp
      .call("Page.captureScreenshot", { format: "png" }, pageSession || session)
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
  clearInterval(schedulingWatch);
  result.finished = new Date().toISOString();
  await writeFile(options.output, serializedResult());
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
  embedServer?.closeAllConnections();
  embedServer?.close();
  process.stdout.write(
    JSON.stringify({
      output: options.output,
      valid: result.valid,
      playback_passed: result.playback_passed ?? false,
      acceptance_passed: result.acceptance_passed ?? false,
      error: result.error || null,
    }) + "\n",
  );
}
