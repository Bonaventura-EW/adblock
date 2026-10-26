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

const mb = (b) => Math.round((b || 0) / 1048576);

// RAM procesów z globalnego zrzutu pamięci (memory-infra) — ta sama miara
// „private footprint", którą pokazuje Menedżer zadań. Procesy tej karty
// wskazuje zdarzenie TracingStartedInBrowser (ramki → processId).
async function memoryDump(target) {
  const events = [];
  let complete;
  const completed = new Promise((r) => { complete = r; });
  const onEvent = (source, method, params) => {
    if (source.tabId !== target.tabId) return;
    if (method === 'Tracing.dataCollected') events.push(...params.value);
    else if (method === 'Tracing.tracingComplete') complete();
  };
  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await chrome.debugger.sendCommand(target, 'Tracing.start', {
      traceConfig: {
        includedCategories: ['disabled-by-default-memory-infra', 'disabled-by-default-devtools.timeline'],
        excludedCategories: ['*'],
        memoryDumpConfig: { triggers: [] }
      },
      transferMode: 'ReportEvents'
    });
    await chrome.debugger.sendCommand(target, 'Tracing.requestMemoryDump',
      { deterministic: false, levelOfDetail: 'background' });
    await chrome.debugger.sendCommand(target, 'Tracing.end');
    await Promise.race([completed, new Promise((r) => setTimeout(r, 5000))]);
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
  }

  const footprint = {};
  events.forEach((e) => {
    const totals = e.ph === 'v' && e.args && e.args.dumps && e.args.dumps.process_totals;
    if (totals) footprint[e.pid] = parseInt(totals.private_footprint_bytes || totals.resident_set_bytes || '0', 16);
  });
  const started = events.find((e) => e.name === 'TracingStartedInBrowser');
  const frames = (started && started.args.data.frames) || [];
  const main = frames.find((f) => !f.parent);
  if (!main || !(main.processId in footprint)) throw new Error('brak procesu karty w zrzucie pamięci');

  const subPids = [...new Set(frames.map((f) => f.processId))]
    .filter((pid) => pid !== main.processId && pid in footprint);
  const subBytes = subPids.reduce((sum, pid) => sum + footprint[pid], 0);
  const allBytes = Object.values(footprint).reduce((sum, b) => sum + b, 0);
  return {
    tabMB: mb(footprint[main.processId] + subBytes),
    mainMB: mb(footprint[main.processId]),
    subframesMB: mb(subBytes),
    subframeProcs: subPids.length,
    browserMB: mb(allBytes),
    browserProcs: Object.keys(footprint).length
  };
}

// Dokładny pomiar przez protokół DevTools. Na czas pomiaru (i kilka sekund
// po nim) przeglądarka pokazuje pasek „rozszerzenie debuguje tę przeglądarkę".
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
    const result = {
      t: Date.now(),
      tabMB: null,
      jsHeapMB: mb(heap.usedSize),
      domHeapMB: mb(heap.embedderHeapUsedSize),
      buffersMB: mb(heap.backingStorageSize),
      nodes: m.Nodes,
      documents: m.Documents,
      frames: m.Frames,
      listeners: m.JSEventListeners
    };
    try {
      Object.assign(result, await memoryDump(target));
    } catch (e) {
      result.ramError = 'RAM karty niedostępny: ' + e.message;
    }
    return result;
  } catch (e) {
    return { error: 'Pomiar nieudany: ' + e.message };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

// Popup mierzy kartę przy każdym otwarciu. Świeży wynik (maxAgeMs) jest
// zwracany z pamięci, a równoległe prośby o tę samą kartę czekają na jeden
// pomiar — debugger da się podłączyć do karty tylko raz.
const lastMeasure = new Map();
const pendingMeasure = new Map();

function measureTabCached(tabId, maxAgeMs) {
  const last = lastMeasure.get(tabId);
  if (last && maxAgeMs && Date.now() - last.t < maxAgeMs) return Promise.resolve(last);
  if (pendingMeasure.has(tabId)) return pendingMeasure.get(tabId);
  const p = measureTab(tabId).then((res) => {
    pendingMeasure.delete(tabId);
    if (!res.error) lastMeasure.set(tabId, res);
    return res;
  });
  pendingMeasure.set(tabId, p);
  return p;
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
    measureTabCached(msg.tabId, msg.maxAgeMs).then(sendResponse);
    return true;
  }
  return false;
});
