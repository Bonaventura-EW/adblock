'use strict';
// Pomiar RAM na PRAWDZIWEJ stronie (wymaga sieci; nie wchodzi do npm test).
// Tak porównujemy „z rozszerzeniem / bez" przy zgłoszeniach „zjada RAM".
//
//   node tests/tools/wp-bench.cjs <url> [sekundy=120] [rozszerzenia=spoof]
//
// rozszerzenia: lista po przecinku — „spoof" (bieżące z repo), ścieżki do
// rozpakowanych rozszerzeń (np. uBlock Origin Lite, AdBlock) albo „none".
// Przewija stronę przez pierwsze SCROLL_STOP s (domyślnie 20), potem karta
// stoi jak otwarta w tle. Co ~10 s: PSS wszystkich procesów przeglądarki,
// sterta JS, węzły DOM, ramki. Wynik: JSON na stdout.

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildExtension, sleep } = require('../lib.cjs');

// Suma PSS (MB) procesów przeglądarki używającej tego profilu (Linux, /proc).
function browserPssMB(udd) {
  const procs = {};
  for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      procs[pid] = { ppid, cmd: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8') };
    } catch (e) { /* proces zniknął */ }
  }
  const set = new Set(Object.keys(procs).filter((p) => procs[p].cmd.includes(udd) && !procs[p].cmd.includes('--type=')));
  for (let grew = true; grew;) {
    grew = false;
    for (const p of Object.keys(procs)) {
      if (!set.has(p) && set.has(String(procs[p].ppid))) { set.add(p); grew = true; }
    }
  }
  let kb = 0;
  const byType = {};
  for (const p of set) {
    try {
      const m = /Pss:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/smaps_rollup`, 'utf8'));
      const v = m ? Number(m[1]) : 0;
      kb += v;
      const t = (/--type=([a-z-]+)/.exec(procs[p].cmd) || [, 'browser'])[1] + (/--extension-process/.test(procs[p].cmd) ? '-ext' : '');
      byType[t] = (byType[t] || 0) + v;
    } catch (e) {}
  }
  for (const k of Object.keys(byType)) byType[k] = Math.round(byType[k] / 1024);
  return { totalMB: Math.round(kb / 1024), byType };
}

(async () => {
  const [url, secsArg = '120', extArg = 'spoof'] = process.argv.slice(2);
  if (!url) {
    console.error('Użycie: node tests/tools/wp-bench.cjs <url> [sekundy] [spoof,/ścieżka/innego|none]');
    process.exit(2);
  }
  const secs = Number(secsArg);
  const scrollStop = Number(process.env.SCROLL_STOP || 20);
  let built = null;
  const exts = extArg === 'none' ? [] : await Promise.all(extArg.split(',').map(async (e) => {
    if (e !== 'spoof') return path.resolve(e);
    built = await buildExtension();
    return built;
  }));
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'spoof-bench-'));
  const args = ['--no-sandbox'];
  if (exts.length) args.push(`--disable-extensions-except=${exts.join(',')}`, `--load-extension=${exts.join(',')}`);
  const ctx = await chromium.launchPersistentContext(udd, {
    channel: 'chromium', headless: true, args, viewport: { width: 1366, height: 900 }, locale: 'pl-PL'
  });
  if (exts.length) await sleep(4000); // blokery potrzebują chwili na reguły
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { // zgoda RODO
    await page.locator('button', { hasText: /akceptuj/i }).first().click({ timeout: 8000 });
  } catch (e) {}

  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const samples = [];
  const t0 = Date.now();
  let y = 0;
  while ((Date.now() - t0) / 1000 < secs) {
    if ((Date.now() - t0) / 1000 < scrollStop) y += 700;
    await page.evaluate((yy) => window.scrollTo(0, yy), y).catch(() => {});
    await page.waitForTimeout(2000);
    const el = Math.round((Date.now() - t0) / 1000);
    if (el % 10 < 2) {
      const m = await Promise.race([metrics(), sleep(3000).then(() => null)]);
      samples.push(m
        ? { t: el, pssMB: browserPssMB(udd).totalMB, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, frames: m.Frames }
        : { t: el, pssMB: browserPssMB(udd).totalMB, note: 'strona nie odpowiada' });
    }
  }
  const out = { url, secs, extensions: extArg, pss: browserPssMB(udd), samples };
  console.log(JSON.stringify(out));
  console.error(samples.map((s) => `${s.t}s:${s.pssMB}MB`).join(' '));
  await ctx.close();
  fs.rmSync(udd, { recursive: true, force: true });
  if (built) fs.rmSync(built, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
