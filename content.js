// Universal Adblock Spoof v6.1
// ════════════════════════════════════════════════════════════════════════════
// TRYB UNIWERSALNY: działa na każdej stronie (model "detekcja → reakcja").
//
//  • Warstwa LEKKA  — zawsze aktywna, bezpieczna: mocki ad-API + pasywne
//                     przechwyty znanych frameworków (WP/Piano). Nic nie usuwa.
//  • Warstwa CIĘŻKA — usuwanie ścian, ochrona DOM, odkrywanie treści. Odpala
//                     się DOPIERO gdy wykryta zostanie ściana adblock.
//
// Wyłączanie per domena/adres realizuje service worker przez excludeMatches —
// jeśli ten skrypt w ogóle się uruchomił, znaczy że strona NIE jest wyłączona.
// ════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Czy wykryto ścianę adblock. Dopóki false — warstwa ciężka śpi.
  var wallDetected = false;

  // ── komunikacja licznika (most ISOLATED-world: bridge.js) ──────────────────
  function reportRemoved() {
    try { window.postMessage({ source: 'adblock-spoof', type: 'removed' }, '*'); } catch (e) {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WARSTWA LEKKA — bezpieczna, zawsze aktywna
  // ══════════════════════════════════════════════════════════════════════════

  // ── WP FRAMEWORK INTERCEPT (pasywny — odpala się tylko na portalach WP) ─────
  // Script #0 ustawia window.WP = [] i pushuje funkcję:
  //   window.WP.push(function(){ window.WP.gaf.loadBunch(false, loadScript, TRUE) })
  // Hardcoded TRUE = "adblock wykryty". Wymuszamy hasAdblock=false.
  (function interceptWP() {
    var _wpArr = [];
    var _wpObj = null;

    function patchGaf(gaf) {
      if (!gaf || gaf.__patched__) return;
      gaf.__patched__ = true;
      var origLB = gaf.loadBunch;
      if (typeof origLB === 'function') {
        gaf.loadBunch = function (a, b, _hasAdblock) {
          return origLB.call(this, a, b, false);
        };
      }
    }

    var wpProxy = new Proxy(_wpArr, {
      set: function (target, prop, value) {
        if (prop === 'gaf') patchGaf(value);
        target[prop] = value;
        return true;
      },
      get: function (target, prop) { return target[prop]; }
    });

    try {
      Object.defineProperty(window, 'WP', {
        configurable: true,
        enumerable: true,
        get: function () { return _wpObj || wpProxy; },
        set: function (v) {
          if (v && typeof v === 'object') {
            // Obecność window.WP = znany framework → potraktuj jako sygnał ściany
            markWall();
            if (v.gaf) patchGaf(v.gaf);
            try {
              var origGafDesc = Object.getOwnPropertyDescriptor(v, 'gaf');
              var _gaf = (origGafDesc && origGafDesc.value) || v.gaf;
              Object.defineProperty(v, 'gaf', {
                configurable: true,
                enumerable: true,
                get: function () { return _gaf; },
                set: function (newGaf) { patchGaf(newGaf); _gaf = newGaf; }
              });
            } catch (e) {}
            if (Array.isArray(_wpArr) && _wpArr.length && v.push) {
              _wpArr.forEach(function (fn) { try { v.push(fn); } catch (e) {} });
              _wpArr.length = 0;
            }
            _wpObj = v;
            Object.defineProperty(window, 'WP', {
              configurable: true, enumerable: true, writable: true, value: v
            });
          }
        }
      });
    } catch (e) {}
  })();

  // ── __INIT_CONFIG__ INTERCEPT (pasywny — tylko portale WP go ustawiają) ─────
  var savedInitConfig = null;
  (function interceptInitConfig() {
    try {
      var _cfg = null;
      Object.defineProperty(window, '__INIT_CONFIG__', {
        configurable: true,
        enumerable: true,
        get: function () { return _cfg; },
        set: function (val) {
          _cfg = val;
          if (val && val.randomClasses) {
            savedInitConfig = val;
            markWall();
            setTimeout(applyWPScreeningCSS, 0);
          }
          // randvar: globalna funkcja chowająca content po każdym slocie gdy
          // hasAdblock=true. Blokujemy ją no-opem zanim Script #0 ją przypisze.
          if (val && val.randvar) {
            try {
              var rv = val.randvar;
              var noop = function () {};
              Object.defineProperty(window, rv, {
                get: function () { return noop; },
                set: function () { /* ignoruj próby nadpisania */ },
                configurable: false,
                enumerable: true
              });
            } catch (e) {}
          }
        }
      });
    } catch (e) {}
  })();

  // ── GOOGLETAG / ADSBYGOOGLE MOCK (nazwy ad-specyficzne, bezpieczne globalnie) ─
  function destroySlotsImpl() { return true; }

  function buildPubadsMock() {
    var m = {
      addEventListener: function () { return m; }, removeEventListener: function () { return m; },
      setTargeting: function () { return m; }, clearTargeting: function () { return m; },
      enableSingleRequest: function () { return m; }, collapseEmptyDivs: function () { return m; },
      enableLazyLoad: function () { return m; }, setCentering: function () { return m; },
      refresh: function () { return m; }, display: function () {},
      getSlots: function () { return []; }, getVersion: function () { return '202401'; },
      isInitialLoadDisabled: function () { return false; },
      getTargeting: function () { return []; }, getTargetingKeys: function () { return []; },
      clear: function () { return true; }
    };
    return m;
  }

  function installGoogletag() {
    if (!window.googletag) window.googletag = { cmd: [] };
    var gt = window.googletag;
    if (!gt.pubads || typeof gt.pubads !== 'function') {
      var pubads = buildPubadsMock();
      gt.pubads = function () { return pubads; };
      gt.apiReady = true;
      gt.pubadsReady = true;
      gt.enableServices = function () {};
      gt.display = function () {};
      gt.destroySlots = destroySlotsImpl;
      gt.defineSlot = function () {
        return { addService: function () { return {}; }, setTargeting: function () { return this; }, defineSizeMapping: function () { return this; } };
      };
      gt.defineOutOfPageSlot = function () { return { addService: function () { return {}; } }; };
      gt.sizeMapping = function () { return { addSize: function () { return this; }, build: function () { return []; } }; };
      var cmds = Array.isArray(gt.cmd) ? gt.cmd.slice() : [];
      gt.cmd = { push: function (fn) { try { fn(); } catch (e) {} } };
      cmds.forEach(function (fn) { try { if (typeof fn === 'function') fn(); } catch (e) {} });
    } else if (gt.destroySlots && !gt.destroySlots.toString().includes('return true')) {
      gt.destroySlots = destroySlotsImpl;
    }
  }

  installGoogletag();

  if (!window.adsbygoogle) window.adsbygoogle = [];
  if (!window.adsbygoogle.push) window.adsbygoogle.push = function () {};
  window.adsbygoogle.loaded = true;

  // ── LAZY PIANO SHIM (window.tp) ─────────────────────────────────────────────
  // Nie nadpisujemy tp bezwarunkowo (mogłoby psuć strony używające tej nazwy).
  // tp zachowuje się jak zwykła kolejka, a pełny mock włącza się dopiero gdy
  // ktoś użyje API Piano (push 'init'/'experience' albo tp.experience.execute).
  (function installLazyPiano() {
    var existing = window.tp;
    var realQueue = Array.isArray(existing) ? existing.slice() : [];
    var handlers = {};
    var activated = false;

    function fireHandler(name, params) {
      (handlers[name] || []).forEach(function (fn) { try { fn(params || {}); } catch (e) {} });
    }

    function looksLikePiano(args) {
      if (!Array.isArray(args)) return false;
      var m = args[0];
      return m === 'init' || m === 'addHandler' || m === 'setCustomVariable' ||
             m === 'setTags' || m === 'setAid' || m === 'experience';
    }

    var pianoMock = {
      push: function (args) {
        if (!Array.isArray(args)) return;
        var method = args[0], cb = args[1];
        if (method === 'init' && typeof cb === 'function') {
          markWall();
          setTimeout(function () { try { cb(); } catch (e) {} }, 0);
        } else if (method === 'addHandler' && typeof args[2] === 'function') {
          if (!handlers[cb]) handlers[cb] = [];
          handlers[cb].push(args[2]);
        }
      },
      experience: {
        execute: function () {
          markWall();
          setTimeout(function () {
            fireHandler('experienceExecute', { result: { accessList: [] } });
            if (wallDetected) revealArticleContent();
          }, 50);
        }
      },
      template: { show: function () {}, close: function () {} },
      offer: { startCheckout: function () {} },
      checkout: { startCheckout: function () {} },
      pianoId: { show: function () {}, logout: function () {}, isUserValid: function () { return false; } },
      user: { isUserValid: function () { return false; }, getProvider: function () { return {}; } }
    };

    function activate() {
      if (activated) return pianoMock;
      activated = true;
      try {
        Object.defineProperty(window, 'tp', {
          configurable: true, enumerable: true, writable: true, value: pianoMock
        });
      } catch (e) { window.tp = pianoMock; }
      realQueue.forEach(function (a) { try { pianoMock.push(a); } catch (e) {} });
      return pianoMock;
    }

    // Pasywna kolejka: zbiera pushe; aktywuje pełny mock dopiero gdy widać Piano.
    var passiveQueue = realQueue;
    passiveQueue.push = function (args) {
      if (looksLikePiano(args)) { activate(); return pianoMock.push(args); }
      return Array.prototype.push.call(this, args);
    };

    try {
      Object.defineProperty(window, 'tp', {
        configurable: true,
        enumerable: true,
        get: function () { return activated ? pianoMock : passiveQueue; },
        set: function (v) {
          // Strona ładuje prawdziwe Piano SDK i przypisuje tp → przejmujemy.
          if (v && (typeof v === 'object')) { activate(); }
        }
      });
    } catch (e) {}

    // Jeśli na stronie jest skrypt Piano/tinypass — aktywuj proaktywnie.
    try {
      if (document.querySelector('script[src*="tinypass"],script[src*="piano.io"],script[src*="cdn.tinypass"]')) {
        activate();
      }
    } catch (e) {}
  })();

  // ── FETCH / XHR INTERCEPT (dopasowanie po URL — bezpieczne globalnie) ────────
  var AD_PATTERNS = [
    '/ads/targeted', '/api/v1/ads', '/adcheck', '/adblock/check',
    'tinypass.com', 'piano.io', 'buy.piano.io'
  ];

  function pianoAccessResponse() {
    return JSON.stringify({
      code: 0,
      data: {
        access: true, granted_by_subscription: false, granted_by_access_token: false,
        granted_by_promotional: false, can_purchase: false, user_segment: 'anon',
        period_run_number: 0, show_recommendations: false
      }
    });
  }

  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
      if (AD_PATTERNS.some(function (p) { return url.indexOf(p) !== -1; })) {
        var body = (url.indexOf('tinypass.com') !== -1 || url.indexOf('piano.io') !== -1)
          ? pianoAccessResponse()
          : '{"ads":[],"status":"ok","adblock":false}';
        return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return _fetch.apply(window, arguments);
    };
  }

  var _xhrOpen = XMLHttpRequest.prototype.open;
  var _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) {
    this._surl = String(url || '');
    return _xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    if (self._surl && AD_PATTERNS.some(function (p) { return self._surl.indexOf(p) !== -1; })) {
      var fake = (self._surl.indexOf('tinypass.com') !== -1 || self._surl.indexOf('piano.io') !== -1)
        ? pianoAccessResponse()
        : '{"ads":[],"status":"ok","adblock":false}';
      Object.defineProperty(self, 'readyState', { get: function () { return 4; } });
      Object.defineProperty(self, 'status', { get: function () { return 200; } });
      Object.defineProperty(self, 'responseText', { get: function () { return fake; } });
      Object.defineProperty(self, 'response', { get: function () { return fake; } });
      setTimeout(function () {
        try { if (typeof self.onreadystatechange === 'function') self.onreadystatechange(); } catch (e) {}
        try { if (typeof self.onload === 'function') self.onload(); } catch (e) {}
      }, 10);
      return;
    }
    return _xhrSend.apply(this, arguments);
  };

  // ── BAIT SPOOF (getComputedStyle) — tylko ścisłe nazwy bait, bezpieczne ──────
  var BAIT = ['adsbox', 'adsbygoogle', 'pub_300x250', 'pub_728x90'];
  var _gcs = window.getComputedStyle;
  window.getComputedStyle = function (el, pseudo) {
    var style = _gcs.call(window, el, pseudo);
    if (el && el.className && typeof el.className === 'string') {
      var classes = el.className.split(/\s+/).concat([el.id || '']);
      if (classes.some(function (c) { return BAIT.indexOf(c) !== -1; })) {
        return new Proxy(style, {
          get: function (t, p) {
            if (p === 'display') return 'block';
            if (p === 'visibility') return 'visible';
            if (p === 'opacity') return '1';
            if (p === 'height') return '1px';
            var v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
          }
        });
      }
    }
    return style;
  };

  // ── DOM PROTECTION (pass-through dopóki !wallDetected) ──────────────────────
  // Gdy framework wykryje adblock, próbuje usunąć tekst artykułu z DOM.
  // Override'y są zainstalowane od startu, ale chronią dopiero po detekcji ściany.
  (function installDomProtection() {
    function isProtected(node) {
      if (!wallDetected) return false;
      if (!node || node.nodeType !== 1) return false;
      if (node.classList && node.classList.contains('wp-content-text-raw')) return true;
      if (node.querySelector && node.querySelector('.wp-content-text-raw')) return true;
      return false;
    }

    var _removeChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
      if (isProtected(child)) return child;
      return _removeChild.apply(this, arguments);
    };

    var _remove = Element.prototype.remove;
    Element.prototype.remove = function () {
      if (isProtected(this)) return;
      return _remove.apply(this, arguments);
    };

    var _innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (_innerHTMLDesc && _innerHTMLDesc.set) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        get: _innerHTMLDesc.get,
        set: function (val) {
          if (wallDetected && (val === '' || val === null) &&
              this.querySelector && this.querySelector('.wp-content-text-raw')) {
            return;
          }
          return _innerHTMLDesc.set.call(this, val);
        },
        configurable: true
      });
    }
  })();

  // ── GENERALIZOWANY KILLER ANTY-ADBLOCK SKRYPTÓW (bez listy hostów) ──────────
  // Neutralizuje inline <script> zawierające bardzo specyficzne nazwy funkcji
  // anty-adblockowych (np. Filmweb removeContentBecauseOfAdBlock).
  (function installScriptKiller() {
    var SCRIPT_SIGNATURES = ['removeContentBecauseOfAdBlock', 'AdblockDetector'];
    function killScript(node) {
      if (!node || node.tagName !== 'SCRIPT' || node.src) return false;
      var txt = node.textContent || '';
      if (node.id === 'qstsxq' ||
          SCRIPT_SIGNATURES.some(function (s) { return txt.indexOf(s) !== -1; })) {
        node.textContent = '';
        node.text = '';
        node.type = 'text/plain';
        markWall();
        return true;
      }
      return false;
    }
    try {
      document.querySelectorAll('script').forEach(killScript);
      var obs = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (node) {
            if (node.nodeType === 1) {
              if (killScript(node)) return;
              if (node.querySelectorAll) node.querySelectorAll('script').forEach(killScript);
            }
          });
        });
      });
      var t = document.documentElement || document;
      if (t) obs.observe(t, { childList: true, subtree: true });
      setTimeout(function () { try { obs.disconnect(); } catch (e) {} }, 30000);
    } catch (e) {}
  })();

  // ══════════════════════════════════════════════════════════════════════════
  // DETEKCJA ŚCIANY — decyduje kiedy włączyć warstwę ciężką
  // ══════════════════════════════════════════════════════════════════════════

  var TEXT_SIGNATURES = [
    // PL
    'wybierz adblocka', 'wyłącz adblock', 'wylacz adblock', 'wyłącz adblocka',
    'zauważyliśmy, że używasz', 'wyłącz blokowanie reklam', 'wylacz blokowanie reklam',
    'wyłącz blokad', 'jest jednak za darmo i utrzymuje', 'houston, mamy problem',
    'wspieraj bezpłatne treści', 'wspieraj bezplatne tresci',
    'wygląda na to, że blokujesz reklamy', 'wyglada na to, ze blokujesz reklamy',
    'to dzięki reklamom możesz czytać', 'to dzieki reklamom mozesz czytac',
    'aby zobaczyć zawartość tej strony', 'zezwól na wyświetlanie reklam',
    'dokończ czytanie artykułu', 'dokonz czytanie artykulu',
    'dzięki reklamom możesz korzystać', 'dzieki reklamom mozesz korzystac',
    'przejdź na wp.pl', 'dodaj nas do wyjątków', 'dodaj nas do wyjatkow',
    'wyłącz program blokujący', 'umieść naszą stronę na białej liście',
    // EN
    'using adblock', 'using an ad blocker', 'disable adblock', 'disable your ad blocker',
    'turn off your ad blocker', 'pause adblock', 'whitelist', 'whitelisting',
    'please disable', 'ad blocker detected', 'adblocker detected',
    'support us by disabling', 'add us to your whitelist', 'allowlist'
  ];

  // Selektory znanych ścian/frameworków
  var WALL_SELECTORS = [
    '[class*="adblock-wall"]', '[id*="adblock-wall"]',
    '[class*="adblock-modal"]', '[class*="adblock-overlay"]',
    '[class*="adblock-info"]', '[class*="AdBlockInfo"]', '[class*="adBlockInfo"]',
    '[class*="adblock-screen"]', '[class*="fc-ab-"]', '.fc-ab-root',
    '[class*="fc-dialog"]', '[id^="tp-"]', '[class*="tp-modal"]',
    '[class*="tp-backdrop"]', '[data-tp-id]'
  ];

  function textMatchesSignature(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetHeight < 50 || el.offsetWidth < 50) return false;
    var text = el.textContent || '';
    if (text.length > 5000) return false;
    var lower = text.toLowerCase();
    return TEXT_SIGNATURES.some(function (sig) { return lower.indexOf(sig) !== -1; });
  }

  function hasKnownWallObject() {
    if (savedInitConfig && savedInitConfig.randvar) return true;
    try { if (document.querySelector(WALL_SELECTORS.join(','))) return true; } catch (e) {}
    return false;
  }

  // Heurystyka overlay: pełnoekranowy fixed o wysokim z-index + blokada scrolla.
  function hasBlockingOverlay() {
    if (!document.body) return false;
    var scrollLocked = false;
    try {
      var bs = getComputedStyle(document.body);
      var hs = getComputedStyle(document.documentElement);
      scrollLocked = bs.overflow === 'hidden' || bs.overflowY === 'hidden' || hs.overflow === 'hidden';
    } catch (e) {}
    if (!scrollLocked) return false;

    var vw = window.innerWidth, vh = window.innerHeight;
    var candidates = document.querySelectorAll('body > div, body > section, body > aside, dialog');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      var z = parseInt(cs.zIndex) || 0;
      if (z < 1000) continue;
      var r = el.getBoundingClientRect();
      if (r.width >= vw * 0.6 && r.height >= vh * 0.6) return true;
    }
    return false;
  }

  function markWall() {
    if (wallDetected) return;
    wallDetected = true;
    // Włącz warstwę ciężką natychmiast i kilka razy później (idempotentnie).
    runHeavy();
    [50, 200, 600, 1500, 3000].forEach(function (t) { setTimeout(runHeavy, t); });
  }

  function detectWall() {
    if (wallDetected) return true;
    if (hasKnownWallObject()) { markWall(); return true; }
    if (hasBlockingOverlay()) { markWall(); return true; }
    // Sygnatury tekstowe — skan bezpośrednich dzieci body + dialogów
    var nodes = document.querySelectorAll('body > div, body > section, body > aside, dialog');
    for (var i = 0; i < nodes.length; i++) {
      if (textMatchesSignature(nodes[i])) { markWall(); return true; }
    }
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WARSTWA CIĘŻKA — usuwanie ścian, odkrywanie treści (tylko po detekcji)
  // ══════════════════════════════════════════════════════════════════════════

  function injectBaseCSS() {
    if (document.getElementById('fw-base-css')) return;
    var style = document.createElement('style');
    style.id = 'fw-base-css';
    style.textContent = [
      'body:not(.loading){overflow-y:auto!important}',
      'html{overflow:auto!important}',
      'div[class*="FilmCheaterSection"],div[class*="filmCheaterSection"]{display:none!important;height:0!important;min-height:0!important;visibility:hidden!important;position:absolute!important;top:-99999px!important;pointer-events:none!important}',
      '[class*="adblock-wall"],[id*="adblock-wall"],',
      '[class*="adblock-modal"],[class*="adblock-overlay"],',
      '[class*="adblock-info"],[class*="AdBlockInfo"],',
      '[class*="adBlockInfo"],[class*="adblock-screen"],',
      '.fc-ab-root,[class*="fc-dialog"],[class*="fc-ab-"]{display:none!important}',
      '[class*="plus-paywall"],[class*="article-locked"]{display:none!important}'
    ].join('');
    var target = document.head || document.documentElement;
    if (target) target.appendChild(style);
  }

  function applyWPScreeningCSS() {
    var cfg = savedInitConfig || window.__INIT_CONFIG__;
    if (!cfg || !cfg.randomClasses) return false;

    var SCREENING_KEYS = [
      'screeningWallpaper', 'screeningWallpaperSecondary',
      'fullPageScreeningWallpaper', 'panelPremiumScreeningWallpaper',
      // 'screeningContainer' celowo pominięty — to kontener treści artykułu.
      'slot15ScreeningWallpaper', 'slot16ScreeningWallpaper', 'slot17ScreeningWallpaper',
      'slot18ScreeningWallpaper', 'slot19ScreeningWallpaper', 'slot38ScreeningWallpaper',
      'slot39ScreeningWallpaper', 'slot40ScreeningWallpaper'
    ];
    var classes = SCREENING_KEYS.map(function (k) { return cfg.randomClasses[k]; }).filter(Boolean);
    if (!classes.length) return false;

    var existing = document.getElementById('fw-wp-screening');
    if (existing) existing.remove();
    var style = document.createElement('style');
    style.id = 'fw-wp-screening';
    style.textContent = classes.map(function (c) {
      return '.' + c + '{display:none!important;visibility:hidden!important}';
    }).join('');
    var target = document.head || document.documentElement;
    if (target) { target.appendChild(style); return true; }
    return false;
  }

  function revealArticleContent() {
    // Tylko realne kontenery artykułu (zawężone, by nie odkrywać menu/modali).
    var selectors = ['article', 'main', '[class*="article"]', '[class*="Article"]'];
    selectors.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (el) {
          var cs = window.getComputedStyle(el);
          if (cs.display === 'none' && el.style.display === 'none') el.style.display = '';
          if (cs.visibility === 'hidden' && el.style.visibility === 'hidden') el.style.visibility = '';
        });
      } catch (e) {}
    });
  }

  function looksLikeAdblockPopup(el) {
    if (!textMatchesSignature(el)) return false;
    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return false; }
    var z = parseInt(cs.zIndex) || 0;
    if (cs.position === 'fixed' || cs.position === 'absolute' || z >= 1000) return true;
    // Dopasowanie do struktury Piano (inline wall)
    try {
      if (el.matches && el.matches('[id^="tp-"],[class*="tp-"],[data-tp-id]')) return true;
    } catch (e) {}
    return false;
  }

  function removeAdblockPopups() {
    var candidates = document.querySelectorAll('body > div, body > section, body > aside');
    candidates.forEach(function (el) { if (looksLikeAdblockPopup(el)) { el.remove(); reportRemoved(); } });
    document.querySelectorAll('dialog').forEach(function (d) {
      if (looksLikeAdblockPopup(d)) { d.remove(); reportRemoved(); }
    });

    var pianoSelectors = [
      '[id^="tp-"]', '[class*="tp-backdrop"]', '[class*="tp-modal"]',
      '[class*="tp-container"]', '[class*="tp-iframe"]', 'div[data-tp-id]', 'div[class*="piano-"]'
    ];
    pianoSelectors.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (el) {
          if (looksLikeAdblockPopup(el)) { el.remove(); reportRemoved(); }
        });
      } catch (e) {}
    });

    var articleContainers = document.querySelectorAll('article, main, [class*="article"], [class*="content"]');
    articleContainers.forEach(function (container) {
      container.querySelectorAll('div, section').forEach(function (el) {
        if (el.parentElement === container && looksLikeAdblockPopup(el)) { el.remove(); reportRemoved(); }
      });
    });
  }

  function cleanGeneric() {
    document.querySelectorAll('div[class*="FilmCheaterSection"], div[class*="filmCheaterSection"]').forEach(function (el) {
      el.style.cssText = 'display:none!important;height:0!important;visibility:hidden!important;position:absolute!important;top:-99999px!important;pointer-events:none!important';
      if (!el.className.includes('isReady')) el.className = el.className + ' isReady';
    });

    try {
      var W = window.globals && window.globals.module && window.globals.module.WaitingModule;
      if (W && typeof W.setPartLoaded === 'function') {
        W.setPartLoaded('CHEATER_OVERLAY_SHOWN');
        W.setPartLoaded('FOOTER');
      }
    } catch (e) {}

    var ALWAYS = [
      '[class*="AdBlockInfo"]', '[class*="adBlockInfo"]',
      '[class*="adblock-wall-content"]', '.fc-ab-root', '[class*="fc-dialog"]'
    ];
    ALWAYS.forEach(function (sel) {
      try { document.querySelectorAll(sel).forEach(function (el) { el.remove(); reportRemoved(); }); } catch (e) {}
    });

    var SCROLL_BLOCK = ['no-scroll', 'noscroll', 'modal-open', 'overlay-open', 'scroll-lock', 'fc-ab-active'];
    if (document.body) {
      SCROLL_BLOCK.forEach(function (c) { document.body.classList.remove(c); });
      if (document.body.style.overflow === 'hidden') document.body.style.overflow = '';
      if (document.body.style.overflowY === 'hidden') document.body.style.overflowY = '';
    }
    if (document.documentElement) {
      SCROLL_BLOCK.forEach(function (c) { document.documentElement.classList.remove(c); });
      if (document.documentElement.style.overflow === 'hidden') document.documentElement.style.overflow = '';
    }
  }

  function runHeavy() {
    if (!wallDetected) return;
    injectBaseCSS();
    applyWPScreeningCSS();
    cleanGeneric();
    removeAdblockPopups();
    revealArticleContent();
    installGoogletag();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PĘTLA GŁÓWNA — tania detekcja, ciężkie akcje tylko po wykryciu
  // ══════════════════════════════════════════════════════════════════════════

  function tick() {
    detectWall();
    if (wallDetected) runHeavy();
  }

  function setup() {
    tick();
    var pending = false;
    var observer = new MutationObserver(function (mutations) {
      var hasAdded = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) { hasAdded = true; break; }
      }
      if (hasAdded && !pending) {
        pending = true;
        setTimeout(function () { tick(); pending = false; }, 200);
      }
    });
    var target = document.body || document.documentElement;
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  if (document.body) setup();
  else document.addEventListener('DOMContentLoaded', setup);

  document.addEventListener('DOMContentLoaded', function () {
    tick();
    [100, 300, 700, 1500, 3000].forEach(function (t) { setTimeout(tick, t); });
  });
  window.addEventListener('load', function () {
    tick();
    [500, 1500, 3000].forEach(function (t) { setTimeout(tick, t); });
  });

  // Interwał bezpieczeństwa — tylko przez pierwsze ~30s.
  var ticks = 0;
  var iv = setInterval(function () {
    tick();
    if (++ticks >= 20) clearInterval(iv);
  }, 1500);

})();
