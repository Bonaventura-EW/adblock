'use strict';
// Spoof: rejestracja skryptów, ściany i przynęty, ochrona DOM, odsłanianie zdjęć.

const { VERSION, check, launch, responds, heavyStats } = require('../lib.cjs');

module.exports = [
  {
    name: 'rejestracja skryptów i spójny numer wersji',
    guards: 'v6.16 (monitor rejestrowany osobno); wersja w manifest.json = window.__adblockSpoof = tytuł ikony',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const reg = await b.sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
        const byId = Object.fromEntries(reg.map((s) => [s.id, s]));
        check(byId['spoof-main'] && byId['spoof-bridge'] && byId['spoof-monitor'],
          'zarejestrowane skrypty: ' + Object.keys(byId).join(', '));
        const main = byId['spoof-main'];
        check(main.world === 'MAIN' && main.runAt === 'document_start' && main.allFrames,
          `content.js: world=${main.world}, runAt=${main.runAt}, allFrames=${main.allFrames}`);
        const title = await b.sw.evaluate(() => chrome.action.getTitle({}));
        check(title.includes(VERSION), `tytuł ikony „${title}" bez wersji ${VERSION}`);
        const page = await b.ctx.newPage();
        await page.goto(site + '/big.html');
        const marker = await page.evaluate(() => window.__adblockSpoof);
        check(marker === VERSION, `window.__adblockSpoof = ${marker}, a manifest.json = ${VERSION}`);
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'ściany „wyłącz adblocka" i przynęty',
    guards: 'detekcja ściany + warstwa ciężka, bait spoof (v6.12), idempotentne style (v6.10)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/index.html');
        await page.waitForTimeout(4500);
        const styleBefore = await page.evaluate(() => {
          window.__styleRef = document.getElementById('fw-wp-screening');
          return !!window.__styleRef;
        });
        // Kolejne mutacje → kolejne przebiegi warstwy ciężkiej (style nie mogą się przebudować).
        await page.evaluate(() => { for (let i = 0; i < 5; i++) document.body.appendChild(document.createElement('i')); });
        await page.waitForTimeout(1500);
        const r = await page.evaluate(() => {
          const ex = (id) => !!document.getElementById(id);
          const disp = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'brak'; };
          return {
            popupRemoved: !ex('popup'), tinyKept: ex('tiny'), bigWrapKept: ex('wrap'),
            acKeep: ex('ac-keep'), acWallRemoved: !ex('ac-wall'), acSecRemoved: !ex('ac-sec'),
            acDeepKept: ex('ac-deep'), acSpanKept: ex('ac-span'),
            baitClass: getComputedStyle(document.getElementById('bait1')).display,
            baitIdOnly: getComputedStyle(document.getElementById('adsbox')).display,
            wpScreen: disp('wp-screen'),
            screeningStyleSameNode: document.getElementById('fw-wp-screening') === window.__styleRef,
            baseCss: ex('fw-base-css')
          };
        });
        const st = await heavyStats(page);
        check(st && st.wall, 'warstwa ciężka się nie włączyła (wall=false)');
        check(styleBefore, 'brak <style id="fw-wp-screening"> (ukrywanie losowych klas WP)');
        const expect = {
          popupRemoved: [true, 'nakładka „Zauważyliśmy, że używasz AdBlocka" usunięta'],
          tinyKept: [true, 'mały element 20×20 z sygnaturą zostaje'],
          bigWrapKept: [true, 'duży kontener treści z sygnaturą w tekście zostaje'],
          acKeep: [true, 'zwykły akapit artykułu zostaje'],
          acWallRemoved: [true, 'ściana wewnątrz artykułu usunięta'],
          acSecRemoved: [true, 'ściana <section> fixed usunięta'],
          acDeepKept: [true, 'zagnieżdżony element zostaje'],
          acSpanKept: [true, '<span> zostaje'],
          baitClass: ['block', 'przynęta .adsbox widoczna (getComputedStyle)'],
          baitIdOnly: ['block', 'przynęta #adsbox widoczna'],
          wpScreen: ['none', 'losowa klasa WP (screeningWallpaper) schowana'],
          screeningStyleSameNode: [true, '<style> WP nie przebudowany przy kolejnym przebiegu'],
          baseCss: [true, 'bazowy <style> ścian wstrzyknięty']
        };
        for (const [k, [want, what]] of Object.entries(expect)) {
          check(r[k] === want, `${what}: ${k}=${r[k]} (oczekiwano ${want})`);
        }
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'ochrona DOM: pętle czyszczące kontener się kończą',
    guards: 'v6.18 bezpiecznik mayRefuse (zawieszona karta przy while(firstChild) removeChild)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/protect.html');
        await page.waitForFunction(() => window.__result, null, { timeout: 30000 });
        const r = await page.evaluate(() => window.__result);
        for (const k of ['removeChildLoop', 'removeLoop', 'innerHTMLLoop']) {
          check(r[k].iterations <= 10, `${k}: ${r[k].iterations} obrotów pętli (bezpiecznik nie działa)`);
        }
        check(r.removeChildLoop.left === 0 && r.removeLoop.left === 0, 'kontener nie został wyczyszczony');
        check(r.singleRemovalBlocked.removeChild && r.singleRemovalBlocked.remove,
          'pojedyncze usunięcie treści artykułu przeszło (ochrona DOM nie działa)');
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'pilnowane zdjęcie: bez pętli i widoczne',
    guards: 'v6.22 mayReveal (pętla → RAM +2 GB/min), v6.23 arkusz USER (zdjęcie widoczne)',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/guarded-img.html', { waitUntil: 'load' });
        await page.waitForTimeout(4000);
        check(await responds(page, 2000), 'karta nie odpowiada — nieskończona pętla odsłaniania (v6.22)');
        const r = await page.evaluate(() => {
          const im = document.getElementById('im');
          return { inline: im.style.display, computed: getComputedStyle(im).display, height: im.offsetHeight };
        });
        const st = await heavyStats(page);
        check(st && st.revealGaveUp === 1, `revealGaveUp=${st && st.revealGaveUp} (oczekiwano 1)`);
        check(st.revealCss === 1, `revealCss=${st.revealCss} (oczekiwano 1 — arkusz USER)`);
        check(r.inline === 'none', `styl inline „${r.inline}" — strona powinna zostać przy „none" (bez przepychanki)`);
        check(r.computed === 'block' && r.height > 0, `zdjęcie niewidoczne: computed=${r.computed}, wysokość=${r.height}`);
        await page.waitForTimeout(3000);
        check(await responds(page, 2000), 'karta przestała odpowiadać po odsłonięciu arkuszem');
      } finally {
        await b.close();
      }
    }
  },

  {
    name: 'zwykłe „schowaj ponownie": odsłanianie jak dawniej',
    guards: 'v6.22/6.23 — bezpiecznik nie może psuć zwykłego odsłaniania zdjęcia WP',
    async run({ ext, site }) {
      const b = await launch(ext);
      try {
        const page = await b.ctx.newPage();
        await page.goto(site + '/rehide.html', { waitUntil: 'load' });
        await page.waitForTimeout(8500);
        const r = await page.evaluate(() => {
          const im = document.getElementById('im');
          return { inline: im.style.display, computed: getComputedStyle(im).display };
        });
        const st = await heavyStats(page);
        check(r.inline === 'block' && r.computed === 'block', `zdjęcie schowane: inline=${r.inline}, computed=${r.computed}`);
        check(st && st.revealGaveUp === 0 && st.revealCss === 0,
          `bezpiecznik zadziałał bez powodu: revealGaveUp=${st && st.revealGaveUp}, revealCss=${st && st.revealCss}`);
      } finally {
        await b.close();
      }
    }
  }
];
