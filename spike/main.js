// stem-workbench spike (step 1 of desktop-app-plan.md, issue #1) — THROWAWAY.
//
// THE QUESTION: can an Electron app capture the audio of an embedded
// WebContentsView while the machine's speakers stay silent?
//
// Shape under test (desktop-app-plan.md seed §7):
//   a host BrowserWindow page calls getDisplayMedia(); the main process answers
//   it with the VIEW's mainFrame for both audio and video.
//
// This process prints ONE json line (`SPIKE_RESULT {...}`) so a shell script can
// pair the in-renderer capture measurement with an EXTERNAL measurement of the
// audio device the app was routed to. It touches a ready-file at the instant
// each measurement window opens so the external recorder starts in lockstep
// instead of being lined up with a guessed sleep.
//
//   --page=local|youtube   which source the view loads (default local)
//   --url=URL              override the page URL
//   --variant=a|b|c|d|nocapture|silent
//        a          enableLocalEcho unset (the Electron default, false), view NOT muted
//        b          setAudioMuted(true) on the view
//        c          BOTH knobs moved: enableLocalEcho:true AND setAudioMuted(true)
//        d          enableLocalEcho:true, view NOT muted   — the can-it-lose control:
//                   Electron documents this as "local playback will NOT be muted",
//                   so the speaker meter MUST read high here, DURING a capture.
//        nocapture  view NOT muted, getDisplayMedia NEVER called — the positive
//                   control that proves the speaker meter can hear this app at all
//        silent     local page plays nothing, capture on — the negative control
//                   that proves the capture meter is not stuck high
//   --seconds=N            measurement window (default 4)
//   --nav=none|spa|reload  after window 1, navigate, then measure a SECOND window
//   --ready-file=P         touched when window 1 opens; P.2 when window 2 opens
//   --out=PATH             write the json here as well
import { app, BrowserWindow, WebContentsView, session } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const val = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit === undefined ? d : hit.slice(k.length + 3);
};

const PAGE     = val('page', 'local');
const VARIANT  = val('variant', 'a');
const SECONDS  = Number(val('seconds', 4));
const NAV      = val('nav', 'none');
const READY    = val('ready-file', '');
const OUT      = val('out', '');
const YT_URL   = val('url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
const CTX_RATE = Number(val('ctx-rate', 0));   // 0 = let the renderer choose

const KNOBS = {
  a:         { echo: false, mute: false, capture: true,  silent: false },
  b:         { echo: false, mute: true,  capture: true,  silent: false },
  c:         { echo: true,  mute: true,  capture: true,  silent: false },
  d:         { echo: true,  mute: false, capture: true,  silent: false },
  nocapture: { echo: false, mute: false, capture: false, silent: false },
  silent:    { echo: false, mute: false, capture: true,  silent: true  },
}[VARIANT];
if (!KNOBS) { console.error(`unknown --variant=${VARIANT}`); process.exit(2); }

// There is no human here to click play, and Chromium gates both
// AudioContext.resume() and HTMLMediaElement.play() on a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Keep every run's profile inside the (gitignored) out/ tree rather than in
// ~/.config/Electron, so a run cannot inherit state from an unrelated one.
app.setPath('userData', path.join(HERE, '..', 'out', 'userdata'));

const result = {
  ok: false,
  page: PAGE,
  variant: VARIANT,
  knobs: KNOBS,
  seconds: SECONDS,
  nav: NAV,
  ctxRate: CTX_RATE || null,
  url: null,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osType: os.type(),
  },
  env: { display: process.env.DISPLAY || null, pulseSink: process.env.PULSE_SINK || null },
  windows: [],
};

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  console.log('SPIKE_RESULT ' + JSON.stringify(result));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  app.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Everything the view reports about itself, sampled next to a measurement so the
// numbers and the flags describe the same instant.
function viewState(view) {
  return {
    isAudioMuted: view.webContents.isAudioMuted(),
    isCurrentlyAudible: view.webContents.isCurrentlyAudible(),
    url: view.webContents.getURL(),
  };
}

// What the SOURCE page thinks it is doing. For the local fixture this is our own
// <audio>; for YouTube it is the page's own <video>. Read-only, and only the
// transport values CONTRIBUTING.md L1 already allows (paused, currentTime,
// duration) plus the two mute/volume flags a "did it actually make sound"
// question cannot be answered without.
const PLAYER_PROBE = `(() => {
  const v = document.querySelector('video, audio');
  if (!v) return { element: null };
  return { element: v.tagName, paused: v.paused, currentTime: v.currentTime,
           duration: v.duration, muted: v.muted, volume: v.volume,
           readyState: v.readyState, ended: v.ended };
})()`;

async function waitForPlayback(view, label) {
  // Poll the transport instead of sleeping: a window measured while the page is
  // still buffering is a silence reading that means nothing.
  let last = null;
  for (let i = 0; i < 150; i++) {
    last = await view.webContents.executeJavaScript(PLAYER_PROBE).catch((e) => ({ error: String(e) }));
    if (last && last.element && !last.paused && last.currentTime > 0.3) return { ok: true, ...last };
    if (i === 20 && last && last.element && last.paused) {
      // Autoplay did not take. Press play WITH a user gesture, the way a person
      // would. (We never touch a media URL — L1.)
      await view.webContents.executeJavaScript(
        `document.querySelector('video, audio').play().then(()=>1,()=>0)`, true).catch(() => {});
    }
    await sleep(200);
  }
  return { ok: false, reason: `playback never started (${label})`, ...(last || {}) };
}

async function openWindow(n) {
  // Open the external (speaker-side) measurement at the same instant as the
  // internal (capture-side) one. A silence reading taken outside the window in
  // which the source was making sound is a pass for the wrong reason.
  if (READY) fs.writeFileSync(n === 1 ? READY : `${READY}.${n}`, String(Date.now()));
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 1200, height: 900, show: true });
    await win.loadFile(path.join(HERE, 'host.html'));

    const view = new WebContentsView();
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 260, width: 1200, height: 640 });

    // THE CAPTURE PATH UNDER TEST: one WebContents' frame answers a
    // getDisplayMedia call made by a DIFFERENT WebContents.
    //
    // enableLocalEcho is the knob Electron documents as "local playback of audio
    // will NOT be muted"; its default is false, i.e. Electron mutes the captured
    // frame's local output for you. Variants a/b leave it at the default,
    // variants c/d set it true.
    session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
      const streams = { video: view.webContents.mainFrame, audio: view.webContents.mainFrame };
      if (KNOBS.echo) streams.enableLocalEcho = true;
      result.handlerAnsweredWith = { video: 'view.mainFrame', audio: 'view.mainFrame',
                                     enableLocalEcho: KNOBS.echo ? true : '(unset — default false)' };
      cb(streams);
    });

    result.url = PAGE === 'youtube' ? YT_URL : `file://${path.join(HERE, 'fixture', 'player.html')}`;
    if (PAGE === 'youtube') await view.webContents.loadURL(YT_URL);
    else await view.webContents.loadFile(path.join(HERE, 'fixture', 'player.html'),
                                         KNOBS.silent ? { query: { silent: '1' } } : undefined);

    if (KNOBS.mute) view.webContents.setAudioMuted(true);
    result.viewAfterLoad = viewState(view);

    if (KNOBS.silent) {
      result.player = { started: false, note: 'negative control — the source was told not to play' };
    } else {
      result.player = await waitForPlayback(view, PAGE);
      if (!result.player.ok) {
        result.error = result.player.reason;
        // A run where the source never made a sound cannot carry ANY verdict:
        // both meters would read 0 and both would look like a pass.
        return finish(4);
      }
    }

    // Let the audio engine spin up and the output stream open before anything is
    // measured, so the window is not half warm-up.
    await sleep(1500);
    result.viewBeforeWindow1 = viewState(view);

    if (KNOBS.capture) {
      result.capture = await win.webContents.executeJavaScript(`window.spikeStart(${CTX_RATE})`, true);
      if (!result.capture.ok) { result.error = result.capture.reason; return finish(5); }
    } else {
      result.capture = { ok: false, reason: 'getDisplayMedia never called (--variant=nocapture)' };
    }

    await openWindow(1);
    if (KNOBS.capture) {
      result.windows.push(await win.webContents.executeJavaScript(`window.spikeMeasure(${SECONDS})`, true));
    } else {
      // Hold the app open for the same wall time so the external meter has
      // something to watch.
      await sleep(SECONDS * 1000 + 600);
      result.windows.push({ ok: false, reason: 'no capture in this variant' });
    }
    result.viewAfterWindow1 = viewState(view);
    result.playerAfterWindow1 = await view.webContents.executeJavaScript(PLAYER_PROBE).catch(() => null);

    if (NAV !== 'none') {
      result.navigation = { kind: NAV };
      if (NAV === 'reload') {
        const before = view.webContents.getURL();
        view.webContents.reload();
        await new Promise((r) => view.webContents.once('did-finish-load', r));
        result.navigation.from = before;
      } else {
        // SPA navigation: click a related video the way a person would. No URL
        // is fetched or parsed by us; the page navigates itself.
        result.navigation.clicked = await view.webContents.executeJavaScript(`(() => {
          const a = document.querySelector('ytd-compact-video-renderer a#thumbnail, yt-lockup-view-model a, a.ytp-videowall-still');
          if (!a) return { clicked: false, reason: 'no related-video link found' };
          const href = a.getAttribute('href');
          a.click();
          return { clicked: true, href };
        })()`, true).catch((e) => ({ clicked: false, reason: String(e) }));
      }
      await sleep(2500);
      result.navigation.player = await waitForPlayback(view, `${NAV} nav`);
      result.navigation.urlAfter = view.webContents.getURL();
      await sleep(1500);
      result.viewBeforeWindow2 = viewState(view);
      await openWindow(2);
      if (KNOBS.capture) {
        result.windows.push(await win.webContents.executeJavaScript(`window.spikeMeasure(${SECONDS})`, true));
      } else {
        await sleep(SECONDS * 1000 + 600);
        result.windows.push({ ok: false, reason: 'no capture in this variant' });
      }
      result.viewAfterWindow2 = viewState(view);
    }

    if (KNOBS.capture) result.trackAtEnd = await win.webContents.executeJavaScript('window.spikeStop()', true);
    result.ok = true;
    finish(0);
  } catch (err) {
    result.error = String((err && err.stack) || err);
    finish(1);
  }
});

// Never hang a run.
setTimeout(() => { result.error = 'spike timed out'; finish(3); }, (SECONDS * 2 + 120) * 1000);
