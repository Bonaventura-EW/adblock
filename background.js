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

// Serializacja rejestracji — kolejne wywołania NIE nakładają się. Wcześniej dwa
// równoległe przebiegi (np. szybkie przełączenie obu switchy albo zdarzenie
// storage + wiadomość z popupu) robiły jednocześnie unregister/register → drugi
// rzucał „Duplicate/Nonexistent script ID", błąd był łykany, a przełącznik „raz
// działał, raz nie". Teraz każde wywołanie czeka na poprzednie (także po błędzie).
let _applyChain = Promise.resolve();
function applyRegistration() {
  _applyChain = _applyChain.then(doApplyRegistration, doApplyRegistration);
  return _applyChain;
}

async function doApplyRegistration() {
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
      persistAcrossSessions: true,
      excludeMatches
    },
    {
      id: SCRIPT_IDS.bridge,
      js: ['bridge.js'],
      matches: MATCHES,
      runAt: 'document_start',
      allFrames: true,
      world: 'ISOLATED',
      persistAcrossSessions: true,
      excludeMatches
    }
  ];

  // Istniejące skrypty AKTUALIZUJEMY jednym atomowym updateContentScripts (bez
  // unregister+register), więc service worker nie może zginąć „w połowie" i
  // zostawić strony bez spoofu. Puste excludeMatches ([]) czyści wykluczenia.
  let existingIds = [];
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [SCRIPT_IDS.main, SCRIPT_IDS.bridge]
    });
    existingIds = (existing || []).map((s) => s.id);
  } catch (e) { /* załóż, że nic nie jest zarejestrowane */ }

  const toUpdate = scripts
    .filter((s) => existingIds.includes(s.id))
    .map((s) => ({ id: s.id, matches: MATCHES, excludeMatches }));
  const toRegister = scripts.filter((s) => !existingIds.includes(s.id));

  try {
    if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
    if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister);
  } catch (e) {
    // Awaryjnie (np. niespójny rejestr): pełny reset i rejestracja od zera.
    console.warn('[Adblock Spoof] nietypowy stan rejestracji, pełny reset:', e && e.message);
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_IDS.main, SCRIPT_IDS.bridge] });
    } catch (e2) { /* mogło nie istnieć */ }
    try {
      await chrome.scripting.registerContentScripts(scripts);
    } catch (e3) {
      console.error('[Adblock Spoof] registration failed:', e3);
    }
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
    return false;
  }
  // Popup prosi o natychmiastowe zastosowanie zmiany i czeka na potwierdzenie,
  // zanim odświeży kartę — dzięki temu przeładowanie nie wyprzedza rejestracji.
  if (msg && msg.type === 'reapply-registration') {
    applyRegistration().then(
      () => { try { sendResponse({ ok: true }); } catch (e) {} },
      () => { try { sendResponse({ ok: false }); } catch (e) {} }
    );
    return true; // odpowiedź asynchroniczna — trzymaj port otwarty
  }
  return false;
});
