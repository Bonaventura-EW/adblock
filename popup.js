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
  }

  // ── Pamięć tej karty ──────────────────────────────────────────────────────
  // Odczyt z monitor.js (tanie wskaźniki) + opcjonalny pomiar przez debugger
  // (background.js). Ocena i progi: memcheck.js.
  const LEVEL_LABELS = ['w normie', 'dużo', 'bardzo dużo'];
  let memTabId = null;
  let memSample = null;
  let memFirst = null;

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
      addLine(els.memPrecise, 'Dotyczy procesu strony głównej — ramki z innych domen, GPU i dekodowane obrazki są liczone osobno.');
    }
  }

  els.measure.addEventListener('click', async () => {
    els.measure.disabled = true;
    els.measure.textContent = 'Mierzę…';
    let precise;
    try {
      precise = await chrome.runtime.sendMessage({ type: 'adblock-spoof-measure', tabId: memTabId });
    } catch (e) {
      precise = { error: 'Pomiar nieudany: ' + e.message };
    }
    await fetchSample();
    renderMemory(precise || { error: 'Pomiar nieudany.' });
    els.measure.disabled = false;
    els.measure.textContent = 'Zmierz ponownie';
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
