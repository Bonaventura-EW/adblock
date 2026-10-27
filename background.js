// Universal Adblock Spoof — service worker
// ════════════════════════════════════════════════════════════════════════════
// Rejestruje content.js (MAIN world), bridge.js (ISOLATED world) i monitor
// pamięci (ISOLATED, tylko główna ramka) dynamicznie, dzięki czemu można je
// wyłączać per domena/adres przez excludeMatches.
// Liczy też usunięte ściany (removedCount) na podstawie wiadomości z bridge.js,
// mierzy RAM kart (popup + auto-pomiar co 5 min) i zmienia ikonę na czerwoną,
// gdy karta zużywa dużo pamięci.
// ════════════════════════════════════════════════════════════════════════════

// Brak memcheck.js (np. niepełna aktualizacja — skopiowane tylko stare pliki)
// nie może zabić całego service workera: rejestracja spoofu i licznik muszą
// działać dalej. Funkcje pamięci sprawdzają wtedy self.AdblockSpoofMem.
try {
  importScripts('memcheck.js');
} catch (e) {
  console.error('[Adblock Spoof] brak memcheck.js — funkcje pamięci wyłączone:', e);
}

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

  // Monitor pamięci rejestrowany OSOBNO (niżej): registerContentScripts jest
  // atomowe dla całej listy, więc brak monitor.js/memcheck.js blokował też
  // rejestrację spoofu i strona zostawała bez ochrony (v6.16).
  const monitor = {
    id: SCRIPT_IDS.monitor,
    js: ['memcheck.js', 'monitor.js'],
    matches: MATCHES,
    runAt: 'document_idle',
    allFrames: false,
    world: 'ISOLATED',
    persistAcrossSessions: true,
    excludeMatches
  };

  // Istniejące skrypty AKTUALIZUJEMY jednym atomowym updateContentScripts (bez
  // unregister+register), więc service worker nie może zginąć „w połowie" i
  // zostawić strony bez spoofu. Puste excludeMatches ([]) czyści wykluczenia.
  let existingIds = [];
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: Object.values(SCRIPT_IDS)
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

  try {
    if (existingIds.includes(monitor.id)) {
      await chrome.scripting.updateContentScripts([{ id: monitor.id, matches: MATCHES, excludeMatches }]);
    } else {
      await chrome.scripting.registerContentScripts([monitor]);
    }
  } catch (e) {
    console.warn('[Adblock Spoof] monitor pamięci niezarejestrowany:', e && e.message);
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
// (0 ok, 1 dużo, 2 bardzo dużo), ramMB/ramT z ostatniego pomiaru RAM oraz
// busy — strona nie odpowiedziała na pomiar (zablokowany wątek).
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
  const mem = self.AdblockSpoofMem;
  const ramLevel = st.ramMB != null && mem ? mem.levelOf('tabMB', st.ramMB) : 0;
  // Zawieszona karta (busy) to najgorszy przypadek — zawsze czerwono, znak „!".
  const level = Math.max(st.monitorLevel || 0, ramLevel, st.busy ? 2 : 0);
  let text = '';
  if (st.busy) text = '!';
  else if (ramLevel > 0) text = st.ramMB >= 1000 ? (st.ramMB / 1024).toFixed(1) + 'G' : String(st.ramMB);
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
  // Zrzut jest GLOBALNY — czeka na każdy proces. Jedna zawieszona karta
  // (np. WP w tle) blokowała go, a z nim pomiar KAŻDEJ karty do limitu 10 s
  // (v6.20: własny limit 3 s i czytelny powód).
  let dumpTimedOut = false;
  try {
    await rejectAfter(chrome.debugger.sendCommand(target, 'Tracing.start', {
      traceConfig: {
        includedCategories: ['disabled-by-default-memory-infra', 'disabled-by-default-devtools.timeline'],
        excludedCategories: ['*'],
        memoryDumpConfig: { triggers: [] }
      },
      transferMode: 'ReportEvents'
    }), 3000);
    try {
      await rejectAfter(chrome.debugger.sendCommand(target, 'Tracing.requestMemoryDump',
        { deterministic: false, levelOfDetail: 'background' }), 3000);
    } catch (e) {
      if (e.message !== 'timeout') throw e;
      dumpTimedOut = true;
    }
    await rejectAfter(chrome.debugger.sendCommand(target, 'Tracing.end'), 3000).catch(() => {});
    await Promise.race([completed, new Promise((r) => setTimeout(r, dumpTimedOut ? 1000 : 4000))]);
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
  if (!main || !(main.processId in footprint)) {
    throw new Error(dumpTimedOut
      ? 'zrzut pamięci nie zakończył się w 3 s — inna karta prawdopodobnie nie odpowiada (zawieszona)'
      : 'brak procesu karty w zrzucie pamięci');
  }

  const subPids = [...new Set(frames.map((f) => f.processId))]
    .filter((pid) => pid !== main.processId && pid in footprint);
  const subBytes = subPids.reduce((sum, pid) => sum + footprint[pid], 0);
  const allBytes = Object.values(footprint).reduce((sum, b) => sum + b, 0);

  // Podział na procesy (v6.24) — odpowiedź na „co zjada RAM". Ramka z innego
  // serwisu (reklama, śledzenie, osadzenie) dostaje własny proces, ok. 25–50 MB
  // każdy; na portalach WP to zwykle większość RAM-u karty. Serwis = dwa
  // ostatnie człony hosta ramki.
  const siteOfUrl = (u) => {
    try { const h = new URL(u).hostname; return h ? siteOf(h) : null; } catch (e) { return null; }
  };
  const procs = [main.processId, ...subPids].map((pid) => {
    const inProc = frames.filter((f) => f.processId === pid);
    return {
      MB: mb(footprint[pid]),
      main: pid === main.processId,
      frames: inProc.length,
      sites: [...new Set(inProc.map((f) => siteOfUrl(f.url)).filter(Boolean))].slice(0, 3)
    };
  }).sort((a, b) => b.MB - a.MB).slice(0, 15);

  return {
    tabMB: mb(footprint[main.processId] + subBytes),
    mainMB: mb(footprint[main.processId]),
    subframesMB: mb(subBytes),
    subframeProcs: subPids.length,
    procs,
    browserMB: mb(allBytes),
    browserProcs: Object.keys(footprint).length
  };
}

// Twardy limit całego pomiaru (v6.17): zawieszona komenda DevTools nie może
// trzymać podłączonego debuggera (pasek „debuguje" bez końca) ani blokować
// kolejnych pomiarów tej karty przez pendingMeasure.
const MEASURE_TIMEOUT_MS = 10000;

function measureTab(tabId) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(async () => {
      await chrome.debugger.detach({ tabId }).catch(() => {});
      resolve({ error: `Pomiar przerwany po ${MEASURE_TIMEOUT_MS / 1000} s — przeglądarka nie odpowiedziała.` });
    }, MEASURE_TIMEOUT_MS);
  });
  return Promise.race([measureTabNow(tabId), timeout]).finally(() => clearTimeout(timer));
}

// Strona z zablokowanym wątkiem (zawieszona albo mieląca w kółko) nie odpowie
// na żadną komendę DevTools — pierwsza komenda ma krótki limit i od razu
// zgłaszamy „strona nie odpowiada" (v6.18), zamiast czekać 10 s.
const RENDERER_PROBE_MS = 2000;

function rejectAfter(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  })]).finally(() => clearTimeout(timer));
}

// Dokładny pomiar przez protokół DevTools. Na czas pomiaru (i kilka sekund
// po nim) przeglądarka pokazuje pasek „rozszerzenie debuguje tę przeglądarkę".
async function measureTabNow(tabId) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    return { error: 'Nie udało się podłączyć debuggera (otwarte DevTools?): ' + e.message };
  }
  try {
    let heap;
    try {
      heap = await rejectAfter(chrome.debugger.sendCommand(target, 'Runtime.getHeapUsage'), RENDERER_PROBE_MS);
    } catch (e) {
      if (e.message !== 'timeout') throw e;
      return { t: Date.now(), rendererBusy: true,
        error: 'Strona nie odpowiada — jej wątek jest zablokowany (zawieszona albo mieli w kółko).' };
    }
    await chrome.debugger.sendCommand(target, 'Performance.enable');
    const { metrics } = await chrome.debugger.sendCommand(target, 'Performance.getMetrics');
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
  if (diagnosing.has(tabId)) return Promise.resolve({ error: 'Trwa diagnoza tej karty — pomiar po jej zakończeniu.' });
  const last = lastMeasure.get(tabId);
  if (last && maxAgeMs && Date.now() - last.t < maxAgeMs) return Promise.resolve(last);
  if (pendingMeasure.has(tabId)) return pendingMeasure.get(tabId);
  const p = measureTab(tabId).then((res) => {
    pendingMeasure.delete(tabId);
    if (!res.error) lastMeasure.set(tabId, res);
    if (res.rendererBusy) updateTabState(tabId, { busy: true, ramT: res.t });
    else if (res.tabMB != null) updateTabState(tabId, { busy: false, ramMB: res.tabMB, ramT: res.t });
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
  if (!tab || !tab.active || !/^https?:/.test(tab.url || '') || diagnosing.has(tab.id)) return;
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

// ── Diagnoza: co obciąża / zawiesza stronę (v6.19) ─────────────────────────
// Na karcie, która JUŻ wisi, debuggera nie da się włączyć (Debugger.enable
// czeka na wątek strony). Dlatego diagnoza otwiera adres w NOWEJ karcie:
// podłącza debugger do pustej karty, włącza Debugger i ślad CPU (Tracing,
// kategoria v8.cpu_profiler — domena Profiler nie jest dostępna dla
// rozszerzeń), dopiero potem ładuje stronę i obserwuje ją do DIAG_SECONDS.
// Jeśli strona przestanie odpowiadać — „pauza" jak w DevTools i stos wywołań.
// Wynik (storage.session 'diagLast') trafia do popupu i do raportu.
const DIAG_SECONDS = 30;
const diagnosing = new Set();

// Popularne blokery — żeby w wyniku była nazwa zamiast samego ID.
const KNOWN_EXTENSIONS = {
  cjpalhdlnbpafiamejdnhcphjbkeiagm: 'uBlock Origin',
  ddkjiahejlhfcafbddmgiahcphecmpfh: 'uBlock Origin Lite',
  gighmmpiobklfepjocnamgkkbiglidom: 'AdBlock',
  cfhdojbkjhnklbpkdaibdccddilifddb: 'Adblock Plus',
  bgnkhhnnamicmpeenaelnjfhikgbkllg: 'AdGuard',
  mlomiejdfkolichcflejclcbmpeaniij: 'Ghostery'
};

// Czytelne źródło kodu: to rozszerzenie / inne rozszerzenie / host strony.
function describeSource(url, fn) {
  if (!url) return fn && /^\(.*\)$/.test(fn) ? fn : '(kod bez pliku)';
  const ext = /^chrome-extension:\/\/([a-p]{32})\/(.*)$/.exec(url);
  if (ext) {
    if (ext[1] === chrome.runtime.id) return 'TO ROZSZERZENIE (Universal Adblock Spoof): ' + ext[2];
    return 'rozszerzenie ' + (KNOWN_EXTENSIONS[ext[1]] || ext[1]) + ': ' + ext[2];
  }
  try {
    const u = new URL(url);
    // WP serwuje skrypty pod długimi, losowymi nazwami — skracamy plik do 40 znaków.
    const file = u.pathname.replace(/^.*\//, '');
    return u.host + '/…/' + (file.length > 40 ? file.slice(0, 40) + '…' : file);
  } catch (e) { return url.slice(0, 120); }
}

function siteOf(host) {
  if (/^\d+(\.\d+){3}$/.test(host)) return host; // adres IP — bez skracania
  return host.split('.').slice(-2).join('.');
}

// Karta do diagnozy powstaje w TYM SAMYM oknie, tuż obok badanej (v6.20).
// Bez windowId przeglądarka wybiera „ostatnio aktywne okno" — w Vivaldi bywa
// nim popup rozszerzenia i karta się nie otwierała. Błąd utworzenia karty
// wraca do popupu zamiast ginąć po cichu.
async function startDiagnosis(url, sourceTabId) {
  let source = null;
  try { source = await chrome.tabs.get(sourceTabId); } catch (e) { /* karta mogła zniknąć */ }
  const opts = { url: chrome.runtime.getURL('diag.html'), active: true };
  if (source) { opts.windowId = source.windowId; opts.index = source.index + 1; }
  const tab = await chrome.tabs.create(opts);
  diagnose(url, tab);
  return tab.id;
}

// Osobny proces dla karty diagnozy (v6.21). Przeglądarka dokłada nowe karty
// serwisu do jego istniejącego procesu — u użytkownika do procesu, który już
// wisiał, więc diagnoza kończyła się „timeout". Zawieszonego procesu
// rozszerzenie nie zabije (ani discard, ani zamknięcie karty, ani Page.crash),
// ale nagłówek Origin-Agent-Cluster daje stronie proces przypisany do
// originu, a nie do serwisu — do starego trafić nie może. Reguła DNR działa
// tylko w tej karcie i znika po diagnozie. Start z diag.html (proces
// rozszerzenia) zamiast about:blank, które też mogło trafić do starego procesu.
function isolateDiagTab(tabId) {
  return chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [{
      id: tabId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [{ header: 'Origin-Agent-Cluster', operation: 'set', value: '?1' }]
      },
      condition: { tabIds: [tabId], resourceTypes: ['main_frame', 'sub_frame'] }
    }]
  });
}

async function diagnose(url, tab) {
  const startedAt = Date.now();
  const result = { url: url.split(/[?#]/)[0], startedAt: new Date(startedAt).toISOString(), seconds: DIAG_SECONDS };
  const target = { tabId: tab.id };
  diagnosing.add(tab.id);

  const events = [];
  const scripts = {}; // scriptId → url (stos z pauzy podaje tylko scriptId dla skryptów inline)
  let traceDone, pausedResolve = null;
  const traceComplete = new Promise((r) => { traceDone = r; });
  const listener = (source, method, params) => {
    if (source.tabId !== tab.id) return;
    if (method === 'Tracing.dataCollected') events.push(...params.value);
    else if (method === 'Tracing.tracingComplete') traceDone();
    else if (method === 'Debugger.scriptParsed') scripts[params.scriptId] = params.url;
    else if (method === 'Debugger.paused') {
      // Nasza pauza → odbierz stos; każda inna (np. „debugger;" na stronie) → wznów.
      if (pausedResolve) { pausedResolve(params); pausedResolve = null; }
      else chrome.debugger.sendCommand(target, 'Debugger.resume').catch(() => {});
    }
  };
  chrome.debugger.onEvent.addListener(listener);
  const send = (method, params, ms) => rejectAfter(chrome.debugger.sendCommand(target, method, params), ms || 3000);
  // Nazwa kroku w błędzie — sam „timeout" nie mówił, co zawiodło.
  const step = (name, promise, ms) => rejectAfter(promise, ms || 3000)
    .catch((e) => { throw new Error(name + ': ' + e.message); });

  try {
    await chrome.storage.session.set({ diagLast: { state: 'running', url: result.url, startedAt } });
    await step('debugger.attach', chrome.debugger.attach(target, '1.3'), 5000);
    await step('Debugger.enable', chrome.debugger.sendCommand(target, 'Debugger.enable'));
    await step('Debugger.setBreakpointsActive',
      chrome.debugger.sendCommand(target, 'Debugger.setBreakpointsActive', { active: false }));
    await step('Tracing.start', chrome.debugger.sendCommand(target, 'Tracing.start', {
      traceConfig: { includedCategories: ['disabled-by-default-v8.cpu_profiler'], excludedCategories: ['*'] },
      transferMode: 'ReportEvents'
    }));
    await step('izolacja procesu (DNR)', isolateDiagTab(tab.id));
    await chrome.tabs.update(tab.id, { url });
    const loadedAt = Date.now();

    // Stos jak pauza w DevTools; zaraz potem wznawiamy stronę.
    const pauseStack = async () => {
      const paused = new Promise((r) => { pausedResolve = r; });
      await send('Debugger.pause', undefined, 2000).catch(() => {});
      const ev = await Promise.race([paused, new Promise((r) => setTimeout(() => r(null), 4000))]);
      pausedResolve = null;
      if (!ev) return null; // spóźniona pauza zostanie wznowiona przez listener
      await send('Debugger.resume').catch(() => {});
      return ev.callFrames.slice(0, 10).map((f) => ({
        fn: f.functionName || '(anonimowa)',
        src: describeSource(f.url || scripts[f.location.scriptId], f.functionName),
        line: f.location.lineNumber + 1,
        col: f.location.columnNumber + 1 // zminifikowane skrypty WP mają jedną linię
      }));
    };

    // Co 2 s „ping" z limitem 1,5 s. Brak odpowiedzi = przycięcie (stos, potem
    // obserwujemy dalej); zawieszenie (hung) = strona nie odpowiada do końca
    // obserwacji. Wcześniej jedno długie zadanie > 1,5 s wyglądało jak
    // zawieszenie (v6.21).
    const elapsedS = () => Math.round((Date.now() - loadedAt) / 1000);
    const freezes = [];
    let freeze = null;
    while (Date.now() - loadedAt < DIAG_SECONDS * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      const responds = await send('Runtime.evaluate', { expression: '1' }, 1500).then(() => true, () => false);
      if (responds) {
        if (freeze) { freeze.durationS = elapsedS() - freeze.atS; freeze = null; }
        continue;
      }
      if (!freeze) {
        freeze = { atS: elapsedS(), durationS: null, stacks: [] };
        if (freezes.length < 10) freezes.push(freeze);
      }
      if (freeze.stacks.length < 2) {
        const stack = await pauseStack();
        if (stack) freeze.stacks.push(stack);
      }
    }
    result.observedS = elapsedS();
    if (freezes.length) result.freezes = freezes;
    if (freeze) {
      result.hung = true;
      result.hungAfterS = freeze.atS;
      result.stack = freeze.stacks[0];
    } else if (freezes.length) {
      const longest = freezes.reduce((a, b) => (b.durationS > a.durationS ? b : a));
      result.stack = longest.stacks[0];
    }

    await send('Tracing.end', undefined, 5000).catch(() => {});
    await Promise.race([traceComplete, new Promise((r) => setTimeout(r, 8000))]);
    result.cpu = summarizeCpu(events, new URL(url).hostname);

    if (!result.hung) {
      try {
        Object.assign(result, { ram: await memoryDump(target) });
      } catch (e) {
        result.ramError = e.message; // RAM opcjonalny — np. inna karta wisi i blokuje zrzut
      }
    }
  } catch (e) {
    result.error = 'Diagnoza przerwana: ' + e.message;
  } finally {
    chrome.debugger.onEvent.removeListener(listener);
    await chrome.debugger.detach(target).catch(() => {});
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tab.id] }).catch(() => {});
    diagnosing.delete(tab.id);
    result.tabId = tab.id;
    await chrome.storage.session.set({ diagLast: { state: 'done', url: result.url, startedAt, result } })
      .catch(() => {});
  }
  return result;
}

// Profil CPU ze zdarzeń ProfileChunk: czas własny funkcji, zsumowany per
// źródło (plik). Liczymy tylko procesy, które wykonywały kod strony (ten sam
// serwis) albo tego rozszerzenia — ślad obejmuje też inne procesy.
function summarizeCpu(events, host) {
  const site = siteOf(host);
  const frames = {}; // pid:profileId:nodeId → callFrame
  const self = {};   // pid:profileId:nodeId → µs
  events.forEach((e) => {
    if (e.name !== 'ProfileChunk' || !e.args || !e.args.data) return;
    const d = e.args.data;
    const key = e.pid + ':' + e.id + ':';
    ((d.cpuProfile && d.cpuProfile.nodes) || []).forEach((n) => { frames[key + n.id] = n.callFrame; });
    ((d.cpuProfile && d.cpuProfile.samples) || []).forEach((sid, i) => {
      self[key + sid] = (self[key + sid] || 0) + ((d.timeDeltas && d.timeDeltas[i]) || 0);
    });
  });
  const pageProfiles = new Set();
  Object.keys(frames).forEach((k) => {
    const url = frames[k].url || '';
    let match = url.startsWith('chrome-extension://' + chrome.runtime.id);
    try { match = match || siteOf(new URL(url).hostname) === site; } catch (e) {}
    if (match) pageProfiles.add(k.split(':').slice(0, 2).join(':'));
  });
  const bySource = {}, byFn = {};
  let totalUs = 0, idleUs = 0;
  Object.keys(self).forEach((k) => {
    if (!pageProfiles.has(k.split(':').slice(0, 2).join(':'))) return;
    const cf = frames[k];
    if (!cf) return;
    const us = self[k];
    totalUs += us;
    if (cf.functionName === '(idle)') { idleUs += us; return; }
    const src = describeSource(cf.url, cf.functionName);
    bySource[src] = (bySource[src] || 0) + us;
    const fk = (cf.functionName || '(anonimowa)') + ' — ' + src;
    byFn[fk] = (byFn[fk] || 0) + us;
  });
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, us]) => ({ name: k, ms: Math.round(us / 1000) }));
  const own = Object.entries(bySource).filter(([k]) => k.startsWith('TO ROZSZERZENIE'))
    .reduce((s, [, us]) => s + us, 0);
  return {
    sampledMs: Math.round(totalUs / 1000),
    busyMs: Math.round((totalUs - idleUs) / 1000),
    thisExtensionMs: Math.round(own / 1000),
    topSources: top(bySource, 8),
    topFunctions: top(byFn, 10)
  };
}

// Licznik usuniętych ścian — wiadomości przychodzą z bridge.js.
// Arkusz odsłaniający pilnowane zdjęcie (v6.23) — origin USER, bo tylko
// !important użytkownika wygrywa z inline display:none!important strony.
// Działa wyłącznie na elementy oznaczone przez content.js (revealViaUserCss).
const REVEAL_CSS = 'img[data-adblock-spoof-reveal]{display:block!important;visibility:visible!important}';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'adblock-spoof-reveal-css' && sender.tab) {
    chrome.scripting.insertCSS({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
      origin: 'USER',
      css: REVEAL_CSS
    }).catch(() => {});
    return false;
  }
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
  // Poziom z monitor.js → ikona i znaczek tej karty.
  if (msg && msg.type === 'adblock-spoof-mem-level' && sender.tab) {
    updateTabState(sender.tab.id, { monitorLevel: msg.level });
    return false;
  }
  // Diagnoza w nowej karcie — popup się wtedy zamknie, wynik czeka w diagLast.
  // Odpowiadamy dopiero po utworzeniu karty (albo z błędem).
  if (msg && msg.type === 'adblock-spoof-diagnose' && /^https?:/.test(msg.url || '')) {
    startDiagnosis(msg.url, msg.tabId).then(
      (tabId) => sendResponse({ started: true, tabId }),
      async (e) => {
        const error = 'Nie udało się otworzyć karty do diagnozy: ' + ((e && e.message) || e);
        await chrome.storage.session.set({ diagLast: { state: 'done', url: msg.url.split(/[?#]/)[0],
          startedAt: Date.now(), result: { error } } }).catch(() => {});
        sendResponse({ error });
      }
    );
    return true;
  }
  // Pomiar RAM karty dla popupu (maxAgeMs — wynik z pamięci, jeśli świeży).
  if (msg && msg.type === 'adblock-spoof-measure') {
    measureTabCached(msg.tabId, msg.maxAgeMs).then(sendResponse);
    return true;
  }
  return false;
});
