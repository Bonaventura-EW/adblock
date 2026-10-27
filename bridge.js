// Universal Adblock Spoof — most ISOLATED ↔ service worker
// ════════════════════════════════════════════════════════════════════════════
// content.js działa w świecie MAIN (bez dostępu do chrome.*), więc licznik
// usuniętych ścian i prośbę o arkusz odsłaniający zdjęcie przekazuje przez
// window.postMessage. Ten skrypt (ISOLATED) odbiera te wiadomości i
// forwarduje je do service workera.
// ════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== 'adblock-spoof') return;
    // removed — licznik ścian; reveal-css — arkusz odsłaniający pilnowane
    // zdjęcie (v6.23, content.js revealViaUserCss).
    var type = data.type === 'removed' ? 'adblock-spoof-removed'
      : data.type === 'reveal-css' ? 'adblock-spoof-reveal-css' : null;
    if (!type) return;
    try {
      var p = chrome.runtime.sendMessage({ type: type });
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* kontekst unieważniony (przeładowanie) — bez znaczenia */ }
  }, false);
})();
