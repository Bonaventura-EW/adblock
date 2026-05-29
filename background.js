// Universal Adblock Spoof — service worker
// ════════════════════════════════════════════════════════════════════════════
// Rejestruje content.js (MAIN world) i bridge.js (ISOLATED world) dynamicznie,
// dzięki czemu można je wyłączać per domena/adres przez excludeMatches.
// Liczy też usunięte ściany (removedCount) na podstawie wiadomości z bridge.js.
// ════════════════════════════════════════════════════════════════════════════

const MATCHES = ['*://*/*'];

const SCRIPT_IDS = { main: 'spoof-main', bridge: 'spoof-bridge' };

// Buduje listę wzorców excludeMatches z wyłączonych domen i adresów.
function buildExcludeMatches(disabledDomains, disabledUrls) {
  const out = [];
  (disabledDomains || []).forEach((host) => {
    if (!host) return;
    out.push(`*://${host}/*`);
    out.push(`*://*.${host}/*`);
  });
  (disabledUrls || []).forEach((url) => {
    if (!url) return;
    try {
      const u = new URL(url);
      // Wzorzec z dokładną ścieżką (bez query/hash).
      out.push(`*://${u.host}${u.pathname}`);
    } catch (e) { /* pomiń nieprawidłowy URL */ }
  });
  return out;
}

async function applyRegistration() {
  let store = {};
  try {
    store = await chrome.storage.local.get(['disabledDomains', 'disabledUrls']);
  } catch (e) { /* brak storage → rejestruj wszędzie */ }

  const excludeMatches = buildExcludeMatches(store.disabledDomains, store.disabledUrls);

  const scripts = [
    {
      id: SCRIPT_IDS.main,
      js: ['content.js'],
      matches: MATCHES,
      runAt: 'document_start',
      allFrames: true,
      world: 'MAIN',
      persistAcrossSessions: true
    },
    {
      id: SCRIPT_IDS.bridge,
      js: ['bridge.js'],
      matches: MATCHES,
      runAt: 'document_start',
      allFrames: true,
      world: 'ISOLATED',
      persistAcrossSessions: true
    }
  ];
  if (excludeMatches.length) {
    scripts.forEach((s) => { s.excludeMatches = excludeMatches; });
  }

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [SCRIPT_IDS.main, SCRIPT_IDS.bridge]
    });
    if (existing && existing.length) {
      await chrome.scripting.unregisterContentScripts({
        ids: existing.map((s) => s.id)
      });
    }
    await chrome.scripting.registerContentScripts(scripts);
  } catch (e) {
    console.error('[Adblock Spoof] registration failed:', e);
  }
}

chrome.runtime.onInstalled.addListener(applyRegistration);
chrome.runtime.onStartup.addListener(applyRegistration);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.disabledDomains || changes.disabledUrls)) {
    applyRegistration();
  }
});

// Licznik usuniętych ścian — wiadomości przychodzą z bridge.js.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'adblock-spoof-removed') {
    chrome.storage.local.get(['removedCount'], (res) => {
      const next = (res.removedCount || 0) + 1;
      chrome.storage.local.set({ removedCount: next });
    });
  }
  return false;
});
