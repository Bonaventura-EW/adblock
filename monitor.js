// Universal Adblock Spoof — monitor pamięci karty
// ════════════════════════════════════════════════════════════════════════════
// ISOLATED world, tylko główna ramka. Co 30 s zbiera tanie wskaźniki zużycia
// pamięci (memcheck.js), trzyma historię z ostatniej godziny (do raportu) i
// wysyła do service workera wyłącznie zmianę poziomu (znaczek „RAM" na ikonie).
// Popup pyta o bieżący odczyt przez chrome.tabs.sendMessage; dopiero wtedy
// prosi content.js (MAIN) o statystyki warstwy ciężkiej — postMessage widoczny
// dla strony leci tylko na żądanie.
// ════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
  var SAMPLE_MS = 30000;
  var HISTORY_MAX = 120; // 1 h przy odczycie co 30 s — do raportu z popupu
  var PAGE_ID = Math.random().toString(36).slice(2);

  var first = null;
  var sentLevel = -1;
  var history = [];

  // Liczba żądań per host (Resource Timing; rozmiary dla obcych domen są
  // ukryte przez przeglądarkę, liczba żądań nie).
  var requests = 0;
  var hostCounts = {};
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        requests++;
        var h;
        try { h = new URL(e.name).host; } catch (x) { return; }
        hostCounts[h] = (hostCounts[h] || 0) + 1;
      });
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {}

  function topHosts(n) {
    return Object.keys(hostCounts)
      .map(function (h) { return [h, hostCounts[h]]; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, n);
  }

  // Szacunek pamięci zdekodowanych obrazków: szerokość × wysokość × 4 B.
  function imageStats() {
    var imgs = document.images, n = 0, px = 0;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.complete && im.naturalWidth) { n++; px += im.naturalWidth * im.naturalHeight; }
    }
    return { n: n, mb: Math.round(px * 4 / 1048576) };
  }

  function sample() {
    var img = imageStats();
    return {
      pageId: PAGE_ID,
      t: Date.now(),
      elements: document.getElementsByTagName('*').length,
      iframes: document.getElementsByTagName('iframe').length,
      videos: document.getElementsByTagName('video').length,
      images: img.n,
      imagesMB: img.mb,
      requests: requests,
      topHosts: topHosts(5)
    };
  }

  function tick() {
    var s = sample();
    if (!first) first = s;
    history.push({ t: s.t, elements: s.elements, iframes: s.iframes, videos: s.videos,
      images: s.images, imagesMB: s.imagesMB, requests: s.requests });
    if (history.length > HISTORY_MAX) history.shift();
    var level = AdblockSpoofMem.evaluate(s, first).level;
    if (level !== sentLevel) {
      sentLevel = level;
      try {
        var p = chrome.runtime.sendMessage({ type: 'adblock-spoof-mem-level', level: level });
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* kontekst rozszerzenia unieważniony (przeładowanie) */ }
    }
  }

  // Statystyki warstwy ciężkiej z content.js (MAIN world).
  function requestHeavyStats(cb) {
    var done = false;
    function onMsg(event) {
      if (event.source !== window) return;
      var d = event.data;
      if (!d || d.source !== 'adblock-spoof' || d.type !== 'stats') return;
      finish({ wall: !!d.wall, runs: d.runs, ms: Math.round(d.ms) });
    }
    function finish(v) {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      cb(v);
    }
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'adblock-spoof', type: 'stats-req' }, '*');
    setTimeout(function () { finish(null); }, 300);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'adblock-spoof-mem-now') return false;
    requestHeavyStats(function (heavy) {
      // Zawsze odpowiedz — bez sendResponse popup czekałby w nieskończoność.
      try {
        var s = sample();
        s.heavy = heavy;
        sendResponse({ sample: s, first: first, history: history });
      } catch (e) {
        sendResponse({ error: String((e && e.message) || e) });
      }
    });
    return true;
  });

  tick();
  setInterval(tick, SAMPLE_MS);
})();
