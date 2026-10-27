'use strict';
// Pamięć karty: pomiar RAM, znaczek, zawieszona karta, zawieszona karta w tle.

const { check, sleep, launch, tabOf, openPopup } = require('../lib.cjs');

module.exports = [
  {
    name: 'pomiar RAM karty i znaczek „RAM" przy dużym DOM',
    guards: 'v6.15 (measureTab przez chrome.debugger, monitor + memcheck)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/index.html');
        await page.waitForTimeout(1000);
        const tab = await tabOf(b, page);
        const m = await b.sw.evaluate((id) => measureTabCached(id, 0), tab.id);
        check(!m.error && !m.ramError, 'pomiar się nie udał: ' + (m.error || m.ramError));
        check(m.tabMB > 0 && m.mainMB > 0 && m.jsHeapMB >= 0, 'pomiar bez RAM-u: ' + JSON.stringify(m));
        const big = await b.ctx.newPage();
        await big.goto(site + '/big.html');
        await big.waitForTimeout(2500);
        const badge = await b.sw.evaluate(async (id) => chrome.action.getBadgeText({ tabId: id }), (await tabOf(b, big)).id);
        check(badge === 'RAM', `znaczek przy 20 000 elementów: „${badge}" (oczekiwano „RAM")`);
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'zawieszona karta → „nie odpowiada", czerwona ikona z „!"',
    guards: 'v6.17 (limit 10 s pomiaru), v6.18 (próbka 2 s → rendererBusy)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        await b.sw.evaluate(() => {
          self.__icons = [];
          const si = chrome.action.setIcon.bind(chrome.action);
          chrome.action.setIcon = (d) => { self.__icons.push([d.tabId, d.path[16]]); return si(d); };
        });
        const page = await b.ctx.newPage();
        await page.goto(site + '/index.html');
        await page.waitForTimeout(1500);
        const tab = await tabOf(b, page);
        await page.evaluate(() => { setTimeout(() => { const s = Date.now(); while (Date.now() - s < 25000) {} }, 50); });
        await sleep(500);
        const t0 = Date.now();
        const pop = await openPopup(b, tab);
        await pop.waitForFunction(() => document.getElementById('measure').textContent === 'Zmierz ponownie', null, { timeout: 20000 });
        const s = (Date.now() - t0) / 1000;
        const level = await pop.textContent('#memLevel');
        check(level === 'nie odpowiada', `poziom „${level}" (oczekiwano „nie odpowiada")`);
        check(s < 12, `popup gotowy dopiero po ${s.toFixed(1)} s`);
        const bar = await b.sw.evaluate(async (id) => ({
          badge: await chrome.action.getBadgeText({ tabId: id }),
          icon: (self.__icons.filter((c) => c[0] === id).pop() || [])[1]
        }), tab.id);
        check(bar.badge === '!' && /-red\.png$/.test(bar.icon || ''), 'pasek narzędzi: ' + JSON.stringify(bar));
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'zawieszona karta w tle nie blokuje pomiaru innych kart',
    guards: 'v6.20 (limit 3 s na globalny zrzut pamięci)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const healthy = await b.ctx.newPage();
        await healthy.goto(site + '/index.html');
        const id = (await tabOf(b, healthy)).id;
        const hung = await b.ctx.newPage();
        await hung.goto(site + '/hang.html');
        await sleep(4000);
        await healthy.bringToFront();
        const t0 = Date.now();
        const m = await b.sw.evaluate((tabId) => measureTabCached(tabId, 0), id);
        const s = (Date.now() - t0) / 1000;
        check(s < 6, `pomiar zdrowej karty trwał ${s.toFixed(1)} s (zawieszona karta blokuje zrzut)`);
        check(m.tabMB > 0 || /inna karta/.test(m.ramError || ''), 'ani RAM-u, ani wyjaśnienia: ' + JSON.stringify(m));
      } finally {
        await b.close();
      }
    }
  }
];
