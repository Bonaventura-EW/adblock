'use strict';
// Popup: przełączniki, wyłączanie domeny/adresu, raport.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { VERSION, check, launch, tabOf, openPopup, injected } = require('../lib.cjs');

module.exports = [
  {
    name: 'przełączniki popupu reagują na kliknięcie w „pigułkę"',
    guards: 'v6.14 (<label class="slider" for>) — wcześniej klik w przełącznik nic nie robił',
    async run({ ext }) {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
        // popup.html z podstawionym chrome.* (bez rozszerzenia) — test samego UI.
        await page.addInitScript(() => {
          const store = { disabledDomains: [], disabledUrls: [], removedCount: 47 };
          window.__sets = [];
          window.chrome = {
            tabs: { query: async () => [{ id: 1, url: 'https://wiadomosci.wp.pl/artykul-123a?x=1' }], sendMessage: async () => null },
            runtime: { getManifest: () => ({ version: '9.9' }), sendMessage: async () => null, lastError: null },
            storage: {
              local: { get: async () => JSON.parse(JSON.stringify(store)), set: async (o) => { window.__sets.push(o); Object.assign(store, o); } },
              session: { get: async () => ({}) }
            }
          };
        });
        await page.goto('file://' + path.join(ext, 'popup.html'));
        await page.waitForTimeout(400);
        const st = () => page.evaluate(() => ({
          domain: document.getElementById('domainToggle').checked,
          url: document.getElementById('urlToggle').checked,
          sets: window.__sets.length,
          status: document.getElementById('status').textContent
        }));
        let s = await st();
        check(s.domain && s.url && s.status === 'aktywne na tej stronie', 'stan początkowy: ' + JSON.stringify(s));
        await page.click('#domainToggle + .slider', { force: true });
        await page.waitForTimeout(250);
        s = await st();
        check(!s.domain && s.sets === 1 && s.status === 'wyłączone na tej stronie', 'klik w przełącznik domeny: ' + JSON.stringify(s));
        await page.click('#domainToggle + .slider', { force: true });
        await page.waitForTimeout(250);
        check((await st()).domain, 'drugi klik nie włączył domeny z powrotem');
        await page.click('#urlToggle + .slider', { force: true });
        await page.waitForTimeout(250);
        check(!(await st()).url, 'klik w przełącznik adresu nic nie zmienił');
        await page.click('label[for=urlToggle]');
        await page.waitForTimeout(250);
        check((await st()).url, 'klik w opis przełącznika adresu nic nie zmienił');
        const ver = await page.evaluate(() => document.getElementById('version').textContent);
        check(ver === 'v9.9', `badge wersji „${ver}" (oczekiwano v9.9 z manifestu)`);
        await page.click('#reset');
        await page.waitForTimeout(250);
        const count = await page.evaluate(() => document.getElementById('count').textContent);
        check(count === '0', `licznik po resecie: ${count}`);
      } finally {
        await browser.close();
      }
    }
  },

  {
    name: 'wyłączanie domeny i adresu (także z ?query)',
    guards: 'v6.13 (serializowana rejestracja), v6.15 (hostname bez portu, ścieżka?*, reguła DNR allow id 1000)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const big = await b.ctx.newPage();
        await big.goto(site + '/big.html');
        await big.waitForTimeout(800);
        check(await injected(big), 'content.js nie działa na stronie testowej');

        let pop = await openPopup(b, await tabOf(b, big));
        await pop.click('#domainToggle + .slider', { force: true });
        await pop.waitForTimeout(1500);
        await pop.close();
        const rules = await b.sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
        check(rules.some((r) => r.id === 1000), 'brak reguły DNR allow (id 1000) dla wyłączonej domeny');
        await big.reload();
        await big.waitForTimeout(800);
        check(!(await injected(big)), 'po wyłączeniu domeny content.js dalej działa');

        pop = await openPopup(b, await tabOf(b, big));
        await pop.click('#domainToggle + .slider', { force: true });
        await pop.waitForTimeout(1500);
        await pop.close();
        await big.reload();
        await big.waitForTimeout(800);
        check(await injected(big), 'po ponownym włączeniu domeny content.js nie działa');

        const q = await b.ctx.newPage();
        await q.goto(site + '/big.html?x=1');
        await q.waitForTimeout(500);
        pop = await openPopup(b, await tabOf(b, q));
        await pop.click('#urlToggle + .slider', { force: true });
        await pop.waitForTimeout(1500);
        await pop.close();
        await q.reload();
        await q.waitForTimeout(800);
        check(!(await injected(q)), 'wyłączenie adresu nie objęło wariantu z ?query');
        await q.goto(site + '/index.html');
        await q.waitForTimeout(800);
        check(await injected(q), 'wyłączenie jednego adresu wyłączyło też inny');
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'raport: „Kopiuj raport" i „Pobierz .json"',
    guards: 'v6.15–v6.23 — format raportu, który użytkownik wkleja do analizy',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/index.html');
        await page.waitForTimeout(2500);
        const pop = await openPopup(b, await tabOf(b, page));
        await pop.click('#copyReport');
        await pop.waitForFunction(() => window.__copied, null, { timeout: 8000 }).catch(() => {});
        const text = await pop.evaluate(() => window.__copied);
        check(text, 'nic nie trafiło do schowka');
        const rep = JSON.parse(text);
        check(rep.report === 'adblock-spoof-memory', 'zły typ raportu: ' + rep.report);
        check(rep.version === VERSION, `wersja w raporcie ${rep.version}, manifest ${VERSION}`);
        check(rep.page === site + '/index.html' && rep.extensionActiveHere === true, `page=${rep.page}, active=${rep.extensionActiveHere}`);
        check(Array.isArray(rep.missingFiles) && rep.missingFiles.length === 0, 'brakujące pliki: ' + JSON.stringify(rep.missingFiles));
        check(Array.isArray(rep.history) && rep.limits && rep.limits.tabMB, 'brak history/limits');
        const h = rep.sample && rep.sample.heavy;
        check(h && h.wall === true && 'revealGaveUp' in h && 'revealCss' in h, 'sample.heavy niepełne: ' + JSON.stringify(h));
        const [dl] = await Promise.all([pop.waitForEvent('download', { timeout: 10000 }), pop.click('#saveReport')]);
        const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
        check(saved.report === 'adblock-spoof-memory' && /\.json$/.test(dl.suggestedFilename()), 'zły plik .json: ' + dl.suggestedFilename());
        check(!(pop.__errors || []).length, 'błędy JS w popupie: ' + (pop.__errors || []).join('; '));
      } finally {
        await b.close();
      }
    }
  }
];
