'use strict';
// „Diagnozuj (30 s)": zawieszenie, przycięcia, błędy w popupie, wspólny proces.
// Każda diagnoza obserwuje stronę 30 s — te testy trwają najdłużej.

const { check, sleep, launch, tabOf, openPopup, rawLaunch, runDiagnosis } = require('../lib.cjs');

const diagLines = (pop) => pop.evaluate(() => [...document.querySelectorAll('#diagInfo div')].map((d) => d.textContent));

module.exports = [
  {
    name: 'diagnoza: zawieszona strona → stos funkcji, która blokuje',
    guards: 'v6.19 (diagnoza), v6.20 (karta obok badanej), v6.21 (kolumna, sprzątanie reguły DNR)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/index.html');
        const src = await tabOf(b, page);
        const { result: r, diagTabId, rulesLeft } = await runDiagnosis(b, site + '/loop.html', src.id);
        check(r, 'diagnoza nie zakończyła się w 120 s');
        check(!r.error, 'błąd diagnozy: ' + r.error);
        check(r.hung === true, 'nie wykryto zawieszenia: ' + JSON.stringify({ hung: r.hung, freezes: r.freezes }));
        const top = (r.stack || [])[0];
        check(top && top.fn === 'busyLoop' && top.col > 0, 'stos: ' + JSON.stringify(r.stack));
        check(r.cpu && r.cpu.busyMs > 1000, 'profil CPU pusty: ' + JSON.stringify(r.cpu));
        check(rulesLeft === 0, `po diagnozie zostało ${rulesLeft} reguł sesyjnych DNR (izolacja procesu)`);
        const tabs = await b.sw.evaluate(() => chrome.tabs.query({}));
        const diag = tabs.find((t) => t.id === diagTabId);
        check(diag && diag.windowId === src.windowId && diag.index === src.index + 1, 'karta diagnozy nie obok badanej');
        const pop = await openPopup(b, src);
        const lines = (await diagLines(pop)).join(' | ');
        check(/ZAWIESIŁA SIĘ/.test(lines) && /busyLoop/.test(lines), 'popup: ' + lines);
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'diagnoza: przycięcia to nie zawieszenie',
    guards: 'v6.21 (freezes[] vs hung)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/index.html');
        const { result: r } = await runDiagnosis(b, site + '/freeze.html', (await tabOf(b, page)).id);
        check(r && !r.error, 'błąd diagnozy: ' + (r && r.error));
        check(!r.hung, 'przycięcia uznane za zawieszenie');
        check(r.freezes && r.freezes.length >= 1 && r.freezes.every((f) => typeof f.durationS === 'number'),
          'nie zapisano przycięć: ' + JSON.stringify(r.freezes));
        check(r.stack && r.stack[0].fn === 'longTask', 'stos przycięcia: ' + JSON.stringify(r.stack));
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'diagnoza: błąd otwarcia karty i stary stan „trwa" w popupie',
    guards: 'v6.20 (błąd widoczny zamiast ciszy; „trwa" > 120 s = przerwana)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/index.html');
        const tab = await tabOf(b, page);
        await b.sw.evaluate(() => {
          self.__tc = chrome.tabs.create;
          chrome.tabs.create = async () => { throw new Error('symulowany błąd Vivaldi'); };
        });
        let pop = await openPopup(b, tab);
        await pop.click('#diagnose');
        await pop.waitForTimeout(1500);
        let lines = (await diagLines(pop)).join(' | ');
        check(/Nie udało się otworzyć karty do diagnozy: symulowany błąd Vivaldi/.test(lines), 'popup: ' + lines);
        check(await pop.evaluate(() => !document.getElementById('diagnose').disabled), 'przycisk został wyłączony po błędzie');
        await pop.close();
        await b.sw.evaluate(() => { chrome.tabs.create = self.__tc; });
        await b.sw.evaluate(() => chrome.storage.session.set({ diagLast: { state: 'running', url: 'x', startedAt: Date.now() - 200000 } }));
        pop = await openPopup(b, tab);
        lines = (await diagLines(pop)).join(' | ');
        check(/nie zakończyła się/.test(lines), 'stary stan „trwa": ' + lines);
        check(await pop.evaluate(() => !document.getElementById('diagnose').disabled), 'przycisk zablokowany przez stary stan');
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'diagnoza przy zawieszonej karcie we wspólnym procesie',
    guards: 'v6.21 (Origin-Agent-Cluster + start z diag.html; wcześniej „Diagnoza przerwana: timeout")',
    async run({ ext, site }) {
      // --process-per-site odtwarza Vivaldi, który dokłada karty serwisu do
      // istniejącego (tu: zawieszonego) procesu. Bez Playwrighta na kartach.
      const h = await rawLaunch(ext, ['--process-per-site']);
      try {
        const r = await h.sw(`
          const src = await chrome.tabs.create({ url: ${JSON.stringify(site + '/hang.html')}, active: true });
          await new Promise((r) => setTimeout(r, 4000));
          await chrome.storage.session.remove('diagLast');
          await startDiagnosis(${JSON.stringify(site + '/loop.html')}, src.id);
          for (let i = 0; i < 120; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            const d = (await chrome.storage.session.get('diagLast')).diagLast;
            if (d && d.state === 'done') return d.result;
          }
          return null;`);
        check(r, 'diagnoza nie zakończyła się w 120 s');
        check(!r.error, 'błąd diagnozy: ' + r.error);
        check(r.stack && r.stack[0] && r.stack[0].fn === 'busyLoop',
          'brak stosu — karta diagnozy trafiła do zawieszonego procesu: ' + JSON.stringify(r.stack));
      } finally {
        h.close();
        await sleep(300);
      }
    }
  }
];
