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
    ver: document.getElementById('ver'),
    mem: document.getElementById('mem'),
    memLevel: document.getElementById('memLevel'),
    memReasons: document.getElementById('memReasons'),
    memInfo: document.getElementById('memInfo'),
    memPrecise: document.getElementById('memPrecise'),
    measure: document.getElementById('measure'),
    ramMB: document.getElementById('ramMB'),
    ramDetail: document.getElementById('ramDetail'),
    tmBox: document.getElementById('tmBox'),
    tmMB: document.getElementById('tmMB'),
    copyReport: document.getElementById('copyReport'),
    saveReport: document.getElementById('saveReport'),
    reportNote: document.getElementById('reportNote'),
    reset: document.getElementById('reset')
  };

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
    return chrome.storage.local.get(['disabledDomains', 'disabledUrls', 'removedCount']);
  }

  function toggleListMember(list, value, shouldContain) {
    const set = new Set(list || []);
    if (shouldContain) set.add(value); else set.delete(value);
    return Array.from(set);
  }

  async function init() {
    els.ver.textContent = 'v' + chrome.runtime.getManifest().version;
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

    memTabId = tab.id;
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

  function addLine(parent, text, cls) {
    const el = document.createElement(parent === els.memReasons ? 'li' : 'div');
    if (cls) el.className = cls;
    el.textContent = text;
    parent.appendChild(el);
  }

  async function fetchSample() {
    try {
      const res = await chrome.tabs.sendMessage(memTabId, { type: 'adblock-spoof-mem-now' });
      memSample = res && res.sample;
      memFirst = res && res.first;
      memHistory = (res && res.history) || [];
    } catch (e) {
      memSample = null; // monitor nie działa na tej karcie
    }
  }

  async function loadMemory() {
    await fetchSample();
    renderMemory(null);
  }

  function renderMemory(precise) {
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
      addLine(els.memInfo, els.domainToggle.checked && els.urlToggle.checked
        ? 'Brak danych z monitora — odśwież stronę (F5).'
        : 'Monitor nie działa, gdy rozszerzenie jest tu wyłączone. Użyj „Zmierz dokładnie".');
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
  async function runMeasure(force) {
    els.measure.disabled = true;
    els.measure.textContent = 'Mierzę…';
    try {
      lastPrecise = await chrome.runtime.sendMessage({
        type: 'adblock-spoof-measure', tabId: memTabId, maxAgeMs: force ? 0 : 20000
      });
    } catch (e) {
      lastPrecise = { error: 'Pomiar nieudany: ' + e.message };
    }
    lastPrecise = lastPrecise || { error: 'Pomiar nieudany.' };
    await fetchSample();
    renderMemory(lastPrecise);
    els.measure.disabled = false;
    els.measure.textContent = 'Zmierz ponownie';
  }

  els.measure.addEventListener('click', () => runMeasure(true));

  // ── Raport do analizy (schowek / plik .json) ──────────────────────────────
  async function buildReport() {
    if (!lastPrecise) await runMeasure(false);
    else { await fetchSample(); renderMemory(lastPrecise); }
    const tm = parseInt(els.tmMB.value, 10);
    return {
      report: 'adblock-spoof-memory',
      version: chrome.runtime.getManifest().version,
      created: new Date().toISOString(),
      userAgent: navigator.userAgent,
      page: currentUrl, // bez query i hasha
      extensionActiveHere: els.domainToggle.checked && els.urlToggle.checked,
      taskManagerMB: Number.isFinite(tm) ? tm : null,
      evaluation: AdblockSpoofMem.evaluate(memSample, memFirst, lastPrecise),
      precise: lastPrecise,
      sample: memSample,
      first: memFirst,
      history: memHistory,
      limits: AdblockSpoofMem.LIMITS
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
    const text = JSON.stringify(await buildReport(), null, 1);
    showReportNote((await copyText(text))
      ? 'Skopiowano raport — wklej go w czacie (Ctrl+V).'
      : 'Nie udało się skopiować — użyj „Pobierz .json".', true);
  });

  els.saveReport.addEventListener('click', async () => {
    const report = await buildReport();
    const blob = new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `adblock-spoof-raport-${currentHost}-${report.created.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    showReportNote('Zapisano plik w Pobranych — dołącz go w czacie.', true);
  });

  els.domainToggle.addEventListener('change', async () => {
    const store = await getStore();
    const next = toggleListMember(store.disabledDomains, currentHost, !els.domainToggle.checked);
    await chrome.storage.local.set({ disabledDomains: next });
    refreshStatus(await getStore());
    showHint();
  });

  els.urlToggle.addEventListener('change', async () => {
    const store = await getStore();
    const next = toggleListMember(store.disabledUrls, currentUrl, !els.urlToggle.checked);
    await chrome.storage.local.set({ disabledUrls: next });
    refreshStatus(await getStore());
    showHint();
  });

  els.reset.addEventListener('click', async () => {
    await chrome.storage.local.set({ removedCount: 0 });
    els.count.textContent = '0';
  });

  init();
})();
