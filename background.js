// Universal Adblock Spoof — service worker
// ════════════════════════════════════════════════════════════════════════════
// Rejestruje content.js (MAIN world), bridge.js (ISOLATED world) i monitor
// pamięci (ISOLATED, tylko główna ramka) dynamicznie, dzięki czemu można je
// wyłączać per domena/adres przez excludeMatches.
// Liczy też usunięte ściany (removedCount) na podstawie wiadomości z bridge.js,
// mierzy RAM kart (popup + auto-pomiar co 5 min) i zmienia ikonę na czerwoną,
// gdy karta zużywa dużo pamięci.
// ════════════════════════════════════════════════════════════════════════════

importScripts('memcheck.js');

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

// Auto-pomiar RAM aktywnej karty (wyłączalny w popupie: storage.local.autoRam).
const RAM_ALARM = 'ram-check';
const AUTO_RAM_MS = 5 * 60000;

function ensureRamAlarm() {
  chrome.alarms.create(RAM_ALARM, { periodInMinutes: AUTO_RAM_MS / 60000 });
}

chrome.runtime.onInstalled.addListener(applyRegistration);
chrome.runtime.onStartup.addListener(applyRegistration);
chrome.runtime.onInstalled.addListener(ensureRamAlarm);
chrome.runtime.onStartup.addListener(ensureRamAlarm);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.disabledDomains || changes.disabledUrls)) {
    applyRegistration();
  }
});

// ── Pamięć karty ────────────────────────────────────────────────────────────
// Stan per karta w storage.session ('tm:<tabId>'): monitorLevel z monitor.js
// (0 ok, 1 dużo, 2 bardzo dużo) oraz ramMB/ramT z ostatniego pomiaru RAM.
// Ikona jest czerwona, gdy którykolwiek poziom ≥ 1; znaczek pokazuje MB (gdy
// RAM przekracza próg) albo „RAM" (gdy alarmują tylko tanie wskaźniki).
const BADGE_COLORS = { 1: '#c6a15c', 2: '#d93025' };
const ICONS = {
  normal: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  red: { 16: 'icons/icon16-red.png', 32: 'icons/icon32-red.png', 48: 'icons/icon48-red.png', 128: 'icons/icon128-red.png' }
};

const tabKey = (tabId) => 'tm:' + tabId;

async function getTabState(tabId) {
  return (await chrome.storage.session.get(tabKey(tabId)))[tabKey(tabId)] || {};
}

// Zapisy stanu jednej karty idą po kolei (monitor i pomiar mogą przyjść
// naraz, a read-modify-write nadpisałby jeden z nich).
const tabQueues = new Map();

function queueTab(tabId, fn) {
  const next = (tabQueues.get(tabId) || Promise.resolve()).then(fn).catch(() => {});
  tabQueues.set(tabId, next);
  return next;
}

function updateTabState(tabId, patch) {
  return queueTab(tabId, async () => {
    const st = Object.assign(await getTabState(tabId), patch);
    await chrome.storage.session.set({ [tabKey(tabId)]: st });
    renderTabIndicator(tabId, st);
  });
}

function renderTabIndicator(tabId, st) {
  const ramLevel = st.ramMB != null ? AdblockSpoofMem.levelOf('tabMB', st.ramMB) : 0;
  const level = Math.max(st.monitorLevel || 0, ramLevel);
  let text = '';
  if (ramLevel > 0) text = st.ramMB >= 1000 ? (st.ramMB / 1024).toFixed(1) + 'G' : String(st.ramMB);
  else if (level > 0) text = 'RAM';
  chrome.action.setIcon({ tabId, path: level > 0 ? ICONS.red : ICONS.normal }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (level > 0) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS[level] }).catch(() => {});
  }
}

// Nowa strona w karcie → stan i ikona od zera (wartości per karta nie
// resetują się same przy nawigacji).
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'loading') return;
  lastMeasure.delete(tabId);
  queueTab(tabId, async () => {
    await chrome.storage.session.remove(tabKey(tabId));
    renderTabIndicator(tabId, {});
  });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  lastMeasure.delete(tabId);
  queueTab(tabId, () => chrome.storage.session.remove(tabKey(tabId)))
    .then(() => tabQueues.delete(tabId));
});

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
    if (res.tabMB != null) updateTabState(tabId, { ramMB: res.tabMB, ramT: res.t });
    return res;
  });
  pendingMeasure.set(tabId, p);
  return p;
}

// Auto-pomiar: aktywna karta co 5 min oraz po przełączeniu na kartę, której
// ostatni pomiar jest starszy niż 5 min. Najwyżej jeden auto-pomiar na minutę,
// bo każdy pokazuje pasek „debuguje".
let lastAutoMeasure = 0;

async function autoMeasure(tab) {
  if (!tab || !tab.active || !/^https?:/.test(tab.url || '')) return;
  const { autoRam } = await chrome.storage.local.get('autoRam');
  if (autoRam === false) return;
  const st = await getTabState(tab.id);
  if (st.ramT && Date.now() - st.ramT < AUTO_RAM_MS - 10000) return;
  if (Date.now() - lastAutoMeasure < 60000) return;
  lastAutoMeasure = Date.now();
  await measureTabCached(tab.id, 0);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== RAM_ALARM) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  autoMeasure(tab);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  // Chwila zwłoki: przy szybkim przeskakiwaniu po kartach nic się nie mierzy.
  setTimeout(async () => {
    autoMeasure(await chrome.tabs.get(tabId).catch(() => null));
  }, 3000);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  // Licznik usuniętych ścian — wiadomości przychodzą z bridge.js.
  if (msg.type === 'adblock-spoof-removed') {
    chrome.storage.local.get(['removedCount'], (res) => {
      const next = (res.removedCount || 0) + 1;
      chrome.storage.local.set({ removedCount: next });
    });
  } else if (msg.type === 'adblock-spoof-mem-level' && sender.tab) {
    updateTabState(sender.tab.id, { monitorLevel: msg.level });
  } else if (msg.type === 'adblock-spoof-measure') {
    measureTabCached(msg.tabId, msg.maxAgeMs).then(sendResponse);
    return true;
  }
  return false;
});
