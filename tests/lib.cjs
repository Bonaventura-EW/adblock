'use strict';
// Wspólne narzędzia testów (npm test).
//  • buildExtension() — kopia rozszerzenia z tych samych plików co ZIP
//    (scripts/extension-files.mjs), więc testujemy dokładnie to, co dostaje
//    użytkownik;
//  • startServer() — lokalny serwer stron z tests/site (bez sieci);
//  • launch() — Chromium (Playwright) z wczytanym rozszerzeniem;
//  • rawLaunch() — Chromium bez Playwrighta na kartach (sterujemy tylko
//    service workerem przez CDP) — potrzebne, gdy Playwright podłączony do
//    każdej karty zmienia zachowanie (np. przy discard albo flagach procesów).

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const NAME = 'Universal Adblock Spoof';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CheckError extends Error {}
function check(cond, msg) {
  if (!cond) throw new CheckError(msg);
}

async function buildExtension() {
  const files = await import(pathToFileURL(path.join(ROOT, 'scripts', 'extension-files.mjs')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoof-ext-'));
  for (const f of files.EXTENSION_FILES) {
    fs.cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
  }
  return dir;
}

function startServer() {
  const dir = path.join(__dirname, 'site');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, path.normalize(name));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close()
  })));
}

// Chromium z rozszerzeniem. Auto-pomiar RAM wyłączony (autoRam: false), żeby
// nie podłączał debuggera w trakcie testów.
async function launch(ext, { extraArgs = [] } = {}) {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'spoof-udd-'));
  const ctx = await chromium.launchPersistentContext(udd, {
    channel: 'chromium', headless: true, locale: 'pl-PL', acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...extraArgs]
  });
  const close = async () => {
    await ctx.close().catch(() => {});
    fs.rmSync(udd, { recursive: true, force: true });
  };
  try {
    let sw = null;
    for (let i = 0; i < 60 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) {
        if ((await w.evaluate(() => chrome.runtime.getManifest().name).catch(() => '')) === NAME) sw = w;
      }
      if (!sw) await sleep(200);
    }
    check(sw, 'service worker rozszerzenia nie wystartował');
    for (let i = 0; i < 60; i++) {
      if ((await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length >= 3) break;
      await sleep(200);
    }
    await sw.evaluate(() => chrome.storage.local.set({ autoRam: false }));
    return { ctx, sw, extId: new URL(sw.url()).host, close };
  } catch (e) {
    await close();
    throw e;
  }
}

// Karta przeglądarki odpowiadająca stronie Playwrighta.
async function tabOf(b, page) {
  const url = page.url();
  const tab = (await b.sw.evaluate(() => chrome.tabs.query({}))).find((t) => t.url === url);
  check(tab, 'nie znaleziono karty ' + url);
  return tab;
}

// Popup „przypięty" do wskazanej karty (chrome.tabs.query podmienione), ze
// schowkiem przechwytywanym do window.__copied.
async function openPopup(b, tab) {
  const pop = await b.ctx.newPage();
  await pop.addInitScript((t) => {
    chrome.tabs.query = async () => [t];
    window.__copied = null;
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (txt) => { window.__copied = txt; return orig(txt).catch(() => {}); };
  }, tab);
  pop.on('pageerror', (e) => { pop.__errors = (pop.__errors || []).concat(e.message); });
  await pop.setViewportSize({ width: 320, height: 900 });
  await pop.goto(`chrome-extension://${b.extId}/popup.html`);
  await pop.waitForTimeout(1200);
  return pop;
}

// Czy wątek strony odpowiada (w zawieszonej karcie evaluate nie wraca).
function responds(page, ms = 1500) {
  return Promise.race([page.evaluate(() => true).catch(() => false), sleep(ms).then(() => false)]);
}

// Statystyki warstwy ciężkiej content.js (to samo, co monitor dołącza do raportu).
function heavyStats(page) {
  return Promise.race([page.evaluate(() => new Promise((resolve) => {
    const on = (e) => {
      if (e.source !== window || !e.data || e.data.source !== 'adblock-spoof' || e.data.type !== 'stats') return;
      window.removeEventListener('message', on);
      resolve(e.data);
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'adblock-spoof', type: 'stats-req' }, '*');
    setTimeout(() => resolve(null), 500);
  })), sleep(2000).then(() => null)]);
}

// Czy content.js działa na stronie (podmieniony getComputedStyle).
function injected(page) {
  return page.evaluate(() => !/\[native code\]/.test(window.getComputedStyle.toString()));
}

// ── Chromium bez Playwrighta na kartach ─────────────────────────────────────
async function rawLaunch(ext, extraArgs = []) {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'spoof-raw-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(chromium.executablePath(), ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`,
    `--user-data-dir=${udd}`, `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run',
    ...extraArgs, 'about:blank'], { stdio: 'ignore' });
  const close = () => {
    try { proc.kill(); } catch (e) {}
    setTimeout(() => fs.rmSync(udd, { recursive: true, force: true }), 500);
  };
  const connect = async (t) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = {};
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    };
    const send = (method, params) => new Promise((resolve) => {
      const i = ++id;
      pending[i] = resolve;
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    // Wykonuje ciało funkcji async w service workerze i zwraca wynik (JSON).
    const sw = async (body) => {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result && r.result.result && r.result.result.value;
    };
    return { ws, sw };
  };
  try {
    for (let i = 0; i < 60; i++) {
      await sleep(300);
      let list = [];
      try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch (e) { continue; }
      for (const t of list.filter((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://'))) {
        try {
          const c = await connect(t);
          const who = await Promise.race([c.sw('return chrome.runtime.getManifest().name + "|" + typeof chrome.storage'), sleep(1500)]);
          if (who === NAME + '|object') {
            await c.sw('await chrome.storage.local.set({ autoRam: false });');
            return { sw: c.sw, close: () => { try { c.ws.close(); } catch (e) {} close(); } };
          }
          c.ws.close();
        } catch (e) { /* inny worker albo jeszcze nie gotowy */ }
      }
    }
    throw new CheckError('service worker rozszerzenia nie wystartował (rawLaunch)');
  } catch (e) {
    close();
    throw e;
  }
}

// Diagnoza uruchomiona prosto z service workera; czeka na wynik (diagLast).
async function runDiagnosis(b, url, sourceTabId) {
  return b.sw.evaluate(async ({ url, id }) => {
    await chrome.storage.session.remove('diagLast');
    const diagTabId = await startDiagnosis(url, id);
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const d = (await chrome.storage.session.get('diagLast')).diagLast;
      if (d && d.state === 'done') {
        return { result: d.result, diagTabId, rulesLeft: (await chrome.declarativeNetRequest.getSessionRules()).length };
      }
    }
    return { result: null, diagTabId };
  }, { url, id: sourceTabId });
}

module.exports = {
  ROOT, VERSION, sleep, check, CheckError, buildExtension, startServer, launch, tabOf, openPopup,
  responds, heavyStats, injected, rawLaunch, runDiagnosis
};
