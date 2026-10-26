// Universal Adblock Spoof — ocena zużycia pamięci karty
// ════════════════════════════════════════════════════════════════════════════
// Wspólne dla monitor.js (ISOLATED world), popup.js i background.js (próg RAM
// dla czerwonej ikony). Monitor nie widzi
// prawdziwego RAM-u (chrome.processes działa tylko w kanale Dev, a
// performance.memory jest zaokrąglane i odświeżane rzadko), więc ocenia tanie
// wskaźniki: rozmiar DOM, ramki, obrazki, wideo, wzrost w czasie. Pomiar przez
// debugger (popup) dokłada RAM karty ze zrzutu pamięci przeglądarki oraz
// sterty JS i DOM strony głównej.
// ════════════════════════════════════════════════════════════════════════════

var AdblockSpoofMem = (function () {
  'use strict';

  // [poziom 1 „dużo", poziom 2 „bardzo dużo"]. Typowa strona WP z uBlockiem:
  // 1–8 tys. elementów, kilka–20 ramek, sterta JS 15–40 MB.
  var LIMITS = {
    tabMB: [500, 1000],
    elements: [15000, 40000],
    iframes: [25, 60],
    imagesMB: [150, 400],
    videos: [3, 8],
    jsHeapMB: [150, 400],
    domHeapMB: [100, 300],
    listeners: [20000, 60000]
  };

  function levelOf(key, value) {
    var l = LIMITS[key];
    if (typeof value !== 'number') return 0;
    return value >= l[1] ? 2 : value >= l[0] ? 1 : 0;
  }

  // sample  — bieżący odczyt z monitor.js,
  // first   — pierwszy odczyt na tej stronie (do wykrywania wzrostu),
  // precise — wynik pomiaru przez debugger (opcjonalny).
  function evaluate(sample, first, precise) {
    var reasons = [];
    function add(level, text) { if (level > 0) reasons.push({ level: level, text: text }); }

    if (sample) {
      add(levelOf('elements', sample.elements),
        'Bardzo duży DOM: ' + sample.elements + ' elementów (np. doładowywane artykuły lub komentarze).');
      add(levelOf('iframes', sample.iframes),
        'Dużo ramek (iframe): ' + sample.iframes + ' — reklamy i osadzenia, każda ma własną pamięć, często osobny proces.');
      add(levelOf('imagesMB', sample.imagesMB),
        'Obrazki: ok. ' + sample.imagesMB + ' MB po zdekodowaniu (' + sample.images + ' szt.).');
      add(levelOf('videos', sample.videos),
        'Odtwarzacze wideo: ' + sample.videos + '.');

      if (first && first.pageId === sample.pageId) {
        var min = Math.round((sample.t - first.t) / 60000);
        if (min >= 2 && sample.elements > first.elements * 2 && sample.elements - first.elements > 5000) {
          add(1, 'DOM rośnie: ' + first.elements + ' → ' + sample.elements + ' elementów w ' + min +
            ' min (doładowywanie treści albo wyciek na stronie).');
        }
      }

      // Własna praca rozszerzenia — sygnał tylko, gdy jest jej naprawdę dużo.
      if (sample.heavy && sample.heavy.ms > 5000) {
        add(1, 'Rozszerzenie dużo pracuje na tej stronie: ' + sample.heavy.runs + ' przebiegów warstwy ciężkiej, ' +
          (sample.heavy.ms / 1000).toFixed(1) + ' s CPU.');
      }
    }

    if (precise && precise.rendererBusy) {
      add(2, 'Strona nie odpowiada — jej wątek jest zablokowany (zawieszona albo mieli w kółko). ' +
        'Tak wygląda karta, która zjada CPU i RAM; sprawdź ją w Menedżerze zadań (Shift+Esc).');
    }

    if (precise && !precise.error) {
      add(levelOf('tabMB', precise.tabMB), 'Karta zużywa ' + precise.tabMB + ' MB RAM (proces strony ' +
        precise.mainMB + ' MB + ramki w osobnych procesach ' + precise.subframesMB + ' MB).');
      add(levelOf('jsHeapMB', precise.jsHeapMB), 'Sterta JS strony: ' + precise.jsHeapMB + ' MB.');
      add(levelOf('domHeapMB', precise.domHeapMB), 'Obiekty DOM (Blink): ' + precise.domHeapMB + ' MB.');
      add(levelOf('listeners', precise.listeners), 'Nasłuchiwacze zdarzeń JS: ' + precise.listeners + '.');
    }

    reasons.sort(function (a, b) { return b.level - a.level; });
    var level = reasons.reduce(function (m, r) { return Math.max(m, r.level); }, 0);
    return { level: level, reasons: reasons };
  }

  return { LIMITS: LIMITS, levelOf: levelOf, evaluate: evaluate };
})();
