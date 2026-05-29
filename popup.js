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
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    const url = tab && tab.url;

    if (!isWebUrl(url)) {
      els.host.textContent = url || '(brak strony)';
      els.controls.innerHTML = '<div class="unsupported">Ta strona nie jest obsługiwana (tylko http/https).</div>';
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
  }

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
