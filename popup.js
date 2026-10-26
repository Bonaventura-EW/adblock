// Universal Adblock Spoof — logika popupu
// Wyłączanie per domena / per adres (denylist w chrome.storage.local).

(function () {
  'use strict';

  const els = {
    host: document.getElementById('host'),
    status: document.getElementById('status'),
    controls: document.getElementById('controls'),
    domainHost: document.getElementById('domainHost'),
    domainToggle: document.getElementById('domainToggle'),
    urlToggle: document.getElementById('urlToggle'),
    hint: document.getElementById('hint'),
    count: document.getElementById('count'),
    reset: document.getElementById('reset'),
    mem: document.getElementById('mem'),
    memLevel: document.getElementById('memLevel'),
    memReasons: document.getElementById('memReasons'),
    memInfo: document.getElementById('memInfo'),
    memPrecise: document.getElementById('memPrecise'),
    measure: document.getElementById('measure'),
    autoRam: document.getElementById('autoRam'),
    ramMB: document.getElementById('ramMB'),
    ramDetail: document.getElementById('ramDetail'),
    tmBox: document.getElementById('tmBox'),
    tmMB: document.getElementById('tmMB'),
    copyReport: document.getElementById('copyReport'),
    saveReport: document.getElementById('saveReport'),
    reportNote: document.getElementById('reportNote')
  };

  // Numer wersji z manifestu — zawsze zgodny z zainstalowanym buildem.
  try {
    const v = chrome.runtime.getManifest().version;
    const el = document.getElementById('version');
    if (el) el.textContent = 'v' + v;
  } catch (e) {}

  let currentUrl = null;   // pełny URL bez query/hash
  let currentHost = null;  // hostname

  function normalizedUrl(u) {
    try {
      const x = new URL(u);
      return `${x.protocol}//${x.host}${x.pathname}`;
    } catch (e) { return null; }
  }

  function isWebUrl(u) {
    return /^https?:/i.test(u || '');
  }

  function showHint() { els.hint.classList.add('show'); }

  function setStatus(active) {
    els.status.textContent = active ? 'aktywne na tej stronie' : 'wyłączone na tej stronie';
    els.status.className = 'status ' + (active ? 'on' : 'off');
  }

  function refreshStatus(store) {
    const domains = store.disabledDomains || [];
    const urls = store.disabledUrls || [];
    const domainOff = domains.includes(currentHost);
    const urlOff = urls.includes(currentUrl);

    els.domainToggle.checked = !domainOff;
    els.urlToggle.checked = !urlOff;
    // Gdy cała domena wyłączona, per-adres nie ma znaczenia.
    els.urlToggle.disabled = domainOff;
    setStatus(!domainOff && !urlOff);
  }

  async function getStore() {
    return chrome.storage.local.get(['disabledDomains', 'disabledUrls', 'removedCount', 'autoRam']);
  }

  function toggleListMember(list, value, shouldContain) {
    const set = new Set(list || []);
    if (shouldContain) set.add(value); else set.delete(value);
    return Array.from(set);
  }

  async function init() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    const url = tab && tab.url;

    if (!isWebUrl(url)) {
      els.host.textContent = url || '(brak strony)';
      els.controls.innerHTML = '<div class="unsupported">Ta strona nie jest obsługiwana (tylko http/https).</div>';
      els.mem.style.display = 'none';
      const s = await getStore();
      els.count.textContent = s.removedCount || 0;
      return;
    }

    currentUrl = normalizedUrl(url);
    currentHost = new URL(url).hostname;
    els.host.textContent = currentHost;
    els.domainHost.textContent = currentHost;

    const store = await getStore();
    els.count.textContent = store.removedCount || 0;
    refreshStatus(store);
    els.autoRam.checked = store.autoRam !== false;

    memTabId = tab.id;
    missing = await missingFiles();
    if (missing.length) { showBrokenInstall(); return; }
    await loadMemory();
    await runMeasure(false);
  }

  // ── Pamięć tej karty ──────────────────────────────────────────────────────
  // Odczyt z monitor.js (tanie wskaźniki) + opcjonalny pomiar przez debugger
  // (background.js). Ocena i progi: memcheck.js.
  const LEVEL_LABELS = ['w normie', 'dużo', 'bardzo dużo'];
  let memTabId = null;
  let memSample = null;
  let memFirst = null;
  let memHistory = [];
  let lastPrecise = null;
  let measuring = null;
  let missing = [];
  let sampleError = null;

  // Pliki dodane w v6.15. Przy aktualizacji „nadpisz istniejące pliki" łatwo
  // ich nie skopiować — wtedy sekcja pamięci nie działała, a przyciski wisiały
  // na „Mierzę…" bez żadnego komunikatu (v6.16).
  const REQUIRED_FILES = ['memcheck.js', 'monitor.js', 'icons/icon16-red.png'];

  async function missingFiles() {
    const out = [];
    for (const f of REQUIRED_FILES) {
      try {
        const r = await fetch(chrome.runtime.getURL(f), { method: 'HEAD' });
        if (!r.ok) out.push(f);
      } catch (e) { out.push(f); }
    }
    if (typeof AdblockSpoofMem === 'undefined' && !out.includes('memcheck.js')) out.push('memcheck.js');
    return out;
  }

  function showBrokenInstall() {
    els.memLevel.textContent = 'błąd';
    els.memLevel.className = 'lvl l2';
    els.ramMB.textContent = '—';
    els.ramDetail.textContent = '';
    els.memInfo.textContent = '';
    addLine(els.memInfo, 'Niepełna instalacja — w folderze rozszerzenia brakuje: ' + missing.join(', ') + '.', 'r2');
    addLine(els.memInfo, 'Rozpakuj CAŁY plik ZIP do folderu rozszerzenia (z zastąpieniem plików) ' +
      'i kliknij „Odśwież" przy rozszerzeniu w vivaldi://extensions.');
    els.measure.disabled = true;
  }

  // Każde czekanie na inną część rozszerzenia ma limit — popup nigdy nie wisi.
  function withTimeout(promise, ms, what) {
    return Promise.race([promise, new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error(`${what} nie odpowiada (${ms / 1000} s)`)), ms);
    })]);
  }

  function addLine(parent, text, cls) {
    const el = document.createElement(parent === els.memReasons ? 'li' : 'div');
    if (cls) el.className = cls;
    el.textContent = text;
    parent.appendChild(el);
  }

  async function fetchSample(timeoutMs) {
    try {
      const res = await withTimeout(chrome.tabs.sendMessage(memTabId, { type: 'adblock-spoof-mem-now' }),
        timeoutMs || 3000, 'Monitor strony');
      if (res && res.error) throw new Error('Monitor strony: ' + res.error);
      memSample = res && res.sample;
      memFirst = res && res.first;
      memHistory = (res && res.history) || [];
      sampleError = null;
    } catch (e) {
      memSample = null; // monitor nie działa na tej karcie
      sampleError = (e && e.message) || String(e);
    }
  }

  async function loadMemory() {
    await fetchSample();
    renderMemory(null);
  }

  function renderMemory(precise) {
    try {
      renderMemoryUnsafe(precise);
    } catch (e) {
      els.memPrecise.textContent = '';
      addLine(els.memPrecise, 'Błąd popupu: ' + ((e && e.message) || e), 'r2');
    }
  }

  function renderMemoryUnsafe(precise) {
    const ev = AdblockSpoofMem.evaluate(memSample, memFirst, precise);
    const known = memSample || (precise && !precise.error);
    els.memLevel.textContent = known ? LEVEL_LABELS[ev.level] : 'brak danych';
    els.memLevel.className = 'lvl ' + (known ? 'l' + ev.level : 'na');

    els.memReasons.textContent = '';
    ev.reasons.forEach((r) => addLine(els.memReasons, r.text, 'r' + r.level));
    if (known && !ev.reasons.length) addLine(els.memReasons, 'Nic niepokojącego w tym, co da się zmierzyć.');

    els.memInfo.textContent = '';
    const s = memSample;
    if (!s) {
      const active = els.domainToggle.checked && els.urlToggle.checked;
      addLine(els.memInfo, active
        ? 'Brak danych z monitora — odśwież stronę (F5).'
        : 'Monitor nie działa, gdy rozszerzenie jest tu wyłączone. Użyj „Zmierz dokładnie".');
      if (active && sampleError && !/Receiving end does not exist|Could not establish connection/.test(sampleError)) {
        addLine(els.memInfo, sampleError, 'r2');
      }
    } else {
      addLine(els.memInfo, `Elementy DOM: ${s.elements} · ramki: ${s.iframes} · wideo: ${s.videos}`);
      addLine(els.memInfo, `Obrazki: ${s.images} (ok. ${s.imagesMB} MB po zdekodowaniu)`);
      const hosts = s.topHosts.map((h) => `${h[0]} (${h[1]})`).join(', ');
      addLine(els.memInfo, `Żądania: ${s.requests}` + (hosts ? `; najwięcej: ${hosts}` : ''));
      const h = s.heavy;
      addLine(els.memInfo, !h ? 'Warstwa ciężka rozszerzenia: brak danych'
        : h.wall ? `Warstwa ciężka rozszerzenia: aktywna — ${h.runs} przebiegów, ${h.ms} ms CPU`
          : 'Warstwa ciężka rozszerzenia: nieaktywna (brak ściany adblock)');
    }

    els.memPrecise.textContent = '';
    if (precise && precise.error) {
      addLine(els.memPrecise, precise.error, 'r2');
    } else if (precise) {
      addLine(els.memPrecise, `Sterta JS: ${precise.jsHeapMB} MB · obiekty DOM: ${precise.domHeapMB} MB · bufory: ${precise.buffersMB} MB`);
      addLine(els.memPrecise, `Węzły: ${precise.nodes} · dokumenty: ${precise.documents} · ramki: ${precise.frames} · nasłuchiwacze: ${precise.listeners}`);
      addLine(els.memPrecise, 'Sterta i węzły dotyczą procesu strony głównej.');
    }
    renderRam(precise, ev.level);
  }

  // Duża liczba „RAM tej karty" — ze zrzutu pamięci (background.js).
  function renderRam(precise, level) {
    els.ramDetail.textContent = '';
    const ok = precise && !precise.error && precise.tabMB != null;
    els.tmBox.hidden = !precise || ok; // pole ręczne tylko, gdy pomiar zawiódł
    if (!precise) {
      els.ramMB.textContent = '…';
      els.ramMB.className = 'ram-mb';
      addLine(els.ramDetail, 'Mierzę…');
      return;
    }
    if (!ok) {
      els.ramMB.textContent = '—';
      els.ramMB.className = 'ram-mb';
      addLine(els.ramDetail, precise.error || precise.ramError, 'r2');
      return;
    }
    els.ramMB.textContent = `${precise.tabMB} MB`;
    els.ramMB.className = 'ram-mb' + (level > 0 ? ' l' + level : '');
    const age = Math.round((Date.now() - precise.t) / 1000);
    addLine(els.ramDetail, `Proces strony: ${precise.mainMB} MB` +
      (precise.subframeProcs ? ` + ramki w osobnych procesach: ${precise.subframesMB} MB (${precise.subframeProcs})` : ''));
    addLine(els.ramDetail, `Cała przeglądarka: ${precise.browserMB} MB (${precise.browserProcs} procesów)` +
      (age >= 3 ? ` · pomiar sprzed ${age} s` : ''));
  }

  // force=false: wynik młodszy niż 20 s bierzemy z pamięci service workera
  // (ponowne otwarcie popupu nie podłącza debuggera od nowa).
  function runMeasure(force) {
    if (!measuring) {
      measuring = doMeasure(force).finally(() => { measuring = null; });
    }
    return measuring;
  }

  async function doMeasure(force) {
    els.measure.disabled = true;
    els.measure.textContent = 'Mierzę…';
    try {
      lastPrecise = await withTimeout(chrome.runtime.sendMessage({
        type: 'adblock-spoof-measure', tabId: memTabId, maxAgeMs: force ? 0 : 20000
      }), 15000, 'Service worker rozszerzenia');
    } catch (e) {
      lastPrecise = { error: 'Pomiar nieudany: ' + e.message };
    }
    lastPrecise = lastPrecise || { error: 'Pomiar nieudany (brak odpowiedzi service workera).' };
    try {
      await fetchSample();
      renderMemory(lastPrecise);
    } finally {
      els.measure.disabled = false;
      els.measure.textContent = 'Zmierz ponownie';
    }
  }

  els.measure.addEventListener('click', () => runMeasure(true));

  els.autoRam.addEventListener('change', () => {
    chrome.storage.local.set({ autoRam: els.autoRam.checked });
  });

  // ── Raport do analizy (schowek / plik .json) ──────────────────────────────
  // Bez długiego czekania: raport bierze to, co już jest (trwający pomiar
  // dostaje najwyżej 2,5 s), żeby kliknięcie od razu kopiowało.
  async function buildReport() {
    if (measuring) await Promise.race([measuring, new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
    if (!missing.length) await fetchSample(1500);
    const mem = typeof AdblockSpoofMem !== 'undefined' ? AdblockSpoofMem : null;
    const tm = parseInt(els.tmMB.value, 10);
    return {
      report: 'adblock-spoof-memory',
      version: chrome.runtime.getManifest().version,
      created: new Date().toISOString(),
      userAgent: navigator.userAgent,
      page: currentUrl, // bez query i hasha
      extensionActiveHere: els.domainToggle.checked && els.urlToggle.checked,
      taskManagerMB: Number.isFinite(tm) ? tm : null,
      missingFiles: missing,
      evaluation: mem ? mem.evaluate(memSample, memFirst, lastPrecise) : null,
      precise: lastPrecise,
      sample: memSample,
      first: memFirst,
      history: memHistory,
      limits: mem ? mem.LIMITS : null
    };
  }

  function showReportNote(text, ok) {
    els.reportNote.textContent = text;
    els.reportNote.className = 'mem-note' + (ok ? ' ok' : '');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Zapas: stary mechanizm kopiowania przez zaznaczenie.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  els.copyReport.addEventListener('click', async () => {
    try {
      const text = JSON.stringify(await buildReport(), null, 1);
      showReportNote((await copyText(text))
        ? 'Skopiowano raport — wklej go w czacie (Ctrl+V).'
        : 'Nie udało się skopiować — użyj „Pobierz .json".', true);
    } catch (e) {
      showReportNote('Błąd raportu: ' + ((e && e.message) || e));
    }
  });

  els.saveReport.addEventListener('click', async () => {
    let report;
    try { report = await buildReport(); } catch (e) {
      showReportNote('Błąd raportu: ' + ((e && e.message) || e));
      return;
    }
    const blob = new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `adblock-spoof-raport-${currentHost}-${report.created.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    showReportNote('Zapisano plik w Pobranych — dołącz go w czacie.', true);
  });

  // Po zmianie: poczekaj aż service worker potwierdzi zastosowanie rejestracji,
  // POTEM odśwież kartę — zmiana działa od razu i za każdym razem (bez ręcznego
  // F5). Popup zostaje otwarty, więc można przełączyć oba switche.
  async function applyAndReload() {
    let applied = false;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'reapply-registration' });
      applied = !!(res && res.ok);
    } catch (e) { /* SW mógł spać / brak odpowiedzi — pokażemy fallback */ }

    els.hint.textContent = applied
      ? 'Zastosowano — odświeżam tę stronę…'
      : 'Odśwież stronę (F5), aby zastosować zmianę.';
    showHint();

    if (!applied) return;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab && tab.id != null && isWebUrl(tab.url)) chrome.tabs.reload(tab.id);
    } catch (e) {}
  }

  els.domainToggle.addEventListener('change', async () => {
    const store = await getStore();
    const next = toggleListMember(store.disabledDomains, currentHost, !els.domainToggle.checked);
    await chrome.storage.local.set({ disabledDomains: next });
    refreshStatus(await getStore());
    await applyAndReload();
  });

  els.urlToggle.addEventListener('change', async () => {
    const store = await getStore();
    const next = toggleListMember(store.disabledUrls, currentUrl, !els.urlToggle.checked);
    await chrome.storage.local.set({ disabledUrls: next });
    refreshStatus(await getStore());
    await applyAndReload();
  });

  els.reset.addEventListener('click', async () => {
    await chrome.storage.local.set({ removedCount: 0 });
    els.count.textContent = '0';
  });

  init();
})();
