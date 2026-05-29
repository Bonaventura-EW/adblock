// Universal Adblock Spoof — most ISOLATED ↔ service worker
// ════════════════════════════════════════════════════════════════════════════
// content.js działa w świecie MAIN (bez dostępu do chrome.*), więc licznik
// usuniętych ścian przekazuje przez window.postMessage. Ten skrypt (ISOLATED)
// odbiera te wiadomości i forwarduje je do service workera.
// ════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== 'adblock-spoof' || data.type !== 'removed') return;
    try {
      chrome.runtime.sendMessage({ type: 'adblock-spoof-removed' });
    } catch (e) { /* SW może być uśpiony — bez znaczenia */ }
  }, false);
})();
