// Universal Adblock Spoof — service worker
// ════════════════════════════════════════════════════════════════════════════
// Rejestruje content.js (MAIN world), bridge.js (ISOLATED world) i monitor
// pamięci (ISOLATED, tylko główna ramka) dynamicznie, dzięki czemu można je
// wyłączać per domena/adres przez excludeMatches.
// Liczy też usunięte ściany (removedCount) na podstawie wiadomości z bridge.js,
// ustawia znaczek „RAM" na ikonie i wykonuje dokładny pomiar pamięci karty.
// ════════════════════════════════════════════════════════════════════════════

const MATCHES = ['*://*/*'];

const SCRIPT_IDS = { main: 'spoof-main', bridge: 'spoof-bridge', monitor: 'spoof-monitor' };

// Dynamiczna reguła DNR: wyłączona domena → nasze przekierowania (rules.json)
// nie dotyczą żądań wysyłanych przez tę domenę.
const DISABLED_DOMAINS_RULE_ID = 1000;

// Wersja w podpowiedzi ikony (default_title w manifeście jest statyczny).
chrome.action.setTitle({ title: 'Universal Adblock Spoof v' + chrome.runtime.getManifest().version });

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
      // Wzorzec z dokładną ścieżką; drugi łapie ten sam adres z ?parametrami
      // (ścieżka we wzorcu dopasowania obejmuje też query). hostname bez
      // portu — „*://host:port/" jest odrzucany i psuł całą rejestrację.
      out.push(`*://${u.hostname}${u.pathname}`);
      out.push(`*://${u.hostname}${u.pathname}?*`);
    } catch (e) { /* pomiń nieprawidłowy URL */ }
  });
  return out;
}

async function applyDisabledDomainsRule(disabledDomains) {
  const domains = (disabledDomains || []).filter(Boolean);
  const rule = {
    id: DISABLED_DOMAINS_RULE_ID,
    priority: 10,
    action: { type: 'allow' },
    condition: { initiatorDomains: domains, resourceTypes: ['script', 'xmlhttprequest', 'other'] }
  };
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DISABLED_DOMAINS_RULE_ID],
      addRules: domains.length ? [rule] : []
    });
  } catch (e) {
    console.error('[Adblock Spoof] DNR update failed:', e);
  }
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
    },
    {
      id: SCRIPT_IDS.monitor,
      js: ['memcheck.js', 'monitor.js'],
      matches: MATCHES,
      runAt: 'document_idle',
      allFrames: false,
      world: 'ISOLATED',
      persistAcrossSessions: true
    }
  ];
  if (excludeMatches.length) {
    scripts.forEach((s) => { s.excludeMatches = excludeMatches; });
  }

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: Object.values(SCRIPT_IDS)
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

  await applyDisabledDomainsRule(store.disabledDomains);
}

chrome.runtime.onInstalled.addListener(applyRegistration);
chrome.runtime.onStartup.addListener(applyRegistration);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.disabledDomains || changes.disabledUrls)) {
    applyRegistration();
  }
});

// ── Pamięć karty ────────────────────────────────────────────────────────────
// Znaczek na ikonie: monitor.js wysyła poziom (0 ok, 1 dużo, 2 bardzo dużo).
const BADGE_COLORS = { 1: '#c6a15c', 2: '#d93025' };

function setMemBadge(tabId, level) {
  chrome.action.setBadgeText({ tabId, text: level > 0 ? 'RAM' : '' }).catch(() => {});
  if (level > 0) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS[level] }).catch(() => {});
  }
}

// Dokładny pomiar przez protokół DevTools. Na czas pomiaru przeglądarka
// pokazuje pasek „rozszerzenie debuguje tę przeglądarkę".
async function measureTab(tabId) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    return { error: 'Nie udało się podłączyć debuggera (otwarte DevTools?): ' + e.message };
  }
  try {
    await chrome.debugger.sendCommand(target, 'Performance.enable');
    const { metrics } = await chrome.debugger.sendCommand(target, 'Performance.getMetrics');
    const heap = await chrome.debugger.sendCommand(target, 'Runtime.getHeapUsage');
    const m = {};
    metrics.forEach((x) => { m[x.name] = x.value; });
    const mb = (b) => Math.round((b || 0) / 1048576);
    return {
      jsHeapMB: mb(heap.usedSize),
      domHeapMB: mb(heap.embedderHeapUsedSize),
      buffersMB: mb(heap.backingStorageSize),
      nodes: m.Nodes,
      documents: m.Documents,
      frames: m.Frames,
      listeners: m.JSEventListeners
    };
  } catch (e) {
    return { error: 'Pomiar nieudany: ' + e.message };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  // Licznik usuniętych ścian — wiadomości przychodzą z bridge.js.
  if (msg.type === 'adblock-spoof-removed') {
    chrome.storage.local.get(['removedCount'], (res) => {
      const next = (res.removedCount || 0) + 1;
      chrome.storage.local.set({ removedCount: next });
    });
  } else if (msg.type === 'adblock-spoof-mem-level' && sender.tab) {
    setMemBadge(sender.tab.id, msg.level);
  } else if (msg.type === 'adblock-spoof-measure') {
    measureTab(msg.tabId).then(sendResponse);
    return true;
  }
  return false;
});
