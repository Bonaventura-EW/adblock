// Universal Adblock Spoof v6.11
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

  // Znacznik wersji — do potwierdzenia w konsoli, że ten kod jest aktywny:
  //   window.__adblockSpoof   →   "6.11"
  try { window.__adblockSpoof = '6.11'; } catch (e) {}

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
          // randvar: WP wywołuje window[randvar](el, slot, hasAdblock, ...) inline
          // po każdym slocie. Gdy hasAdblock=true, chowa slot (tekst I obrazki).
          // Nie robimy no-opa — wtedy obrazki i tekst też zostają schowane (bo
          // framework zakłada że randvar je "odblokuje"). Zamiast tego:
          // przechwytujemy przypisanie prawdziwej funkcji i zawsze wołamy ją z
          // hasAdblock=false → slots działają normalnie, tylko bez ścian.
          if (val && val.randvar) {
            try {
              var rv = val.randvar;
              var _realRv = null;
              var _rvPending = []; // wywołania zanim prawdziwa fn zostanie przypisana
              // Stabilny wrapper (jedna referencja — bez churnu GC przy każdym
              // odczycie):
              //  • wymusza hasAdblock=false,
              //  • KOLEJKUJE wczesne wywołania i odtwarza je po przypisaniu fn.
              // Bez kolejki pierwszy slot (zdjęcie wiodące) odpalał się przed
              // przypisaniem randvar → trafiał w no-op → obraz zostawał biały.
              var _rvWrapper = function () {
                var args = Array.prototype.slice.call(arguments);
                if (args.length > 2) args[2] = false; // hasAdblock=false
                if (_realRv) return _realRv.apply(this, args);
                _rvPending.push({ ctx: this, args: args });
              };
              Object.defineProperty(window, rv, {
                configurable: true,
                enumerable: true,
                get: function () { return _rvWrapper; },
                set: function (fn) {
                  if (typeof fn === 'function') {
                    _realRv = fn;
                    var queued = _rvPending;
                    _rvPending = [];
                    queued.forEach(function (c) {
                      try { _realRv.apply(c.ctx, c.args); } catch (e) {}
                    });
                  }
                }
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
    'tinypass.com', 'piano.io', 'buy.piano.io',
    'pagead2.googlesyndication.com/pagead/js/adsbygoogle'
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
      Object.defineProperty(self, 'responseURL', { get: function () { return self._surl; } });
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

  // ── FXMAG / NEXT.JS ADBLOCK DETECTION NEUTRALISER ────────────────────────
  // fxmag.pl uses two checks:
  //   1. getElementById("stndz-style") — element injected by uBlock's cosmetic
  //      filter engine. We remove it immediately so the check returns null.
  //   2. DetectByGoogleAd — injects <script src="…adsbygoogle.js">, reads
  //      onerror (blocked → adblock) and XHR responseURL (redirect → adblock).
  //      We override onerror→noop and fire onload so detection thinks it loaded.
  (function installFxmagNeutraliser() {
    function removeStndz() {
      var el = document.getElementById('stndz-style');
      if (el) el.parentNode.removeChild(el);
    }

    function patchAdsbyScript(node) {
      if (node.tagName !== 'SCRIPT') return;
      var src = node.src || node.getAttribute('src') || '';
      if (src.indexOf('adsbygoogle.js') === -1 && src.indexOf('pagead') === -1) return;
      node.onerror = null;
      Object.defineProperty(node, 'onerror', { set: function () {}, get: function () { return null; }, configurable: true });
      setTimeout(function () { try { if (typeof node.onload === 'function') node.onload(); } catch (e) {} }, 50);
    }

    try {
      removeStndz();
      var obs2 = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.id === 'stndz-style') { n.parentNode && n.parentNode.removeChild(n); return; }
            patchAdsbyScript(n);
            if (n.querySelectorAll) {
              n.querySelectorAll('script').forEach(patchAdsbyScript);
            }
          });
        });
      });
      var root2 = document.documentElement || document;
      if (root2) obs2.observe(root2, { childList: true, subtree: true });
      setTimeout(function () { try { obs2.disconnect(); } catch (e) {} }, 60000);
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
    // PL — fxmag
    'blokujesz reklamy', 'nie widzisz tej strony', 'korzystając z adblocka',
    'korzystajac z adblocka',
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
    '[class*="tp-backdrop"]', '[data-tp-id]',
    // toolkitspro adblock (np. fxmag.pl) — reszta klas modala jest haszowana
    // per-dzień (SHA256), ale ikona ostrzegawcza ma stałą, jawną nazwę.
    '[class*="adblock_new_icon"]'
  ];

  function textMatchesSignature(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetHeight < 50 || el.offsetWidth < 50) return false;
    // Ściana adblock to niewielki overlay. Ogromne kontenery (np. root aplikacji
    // React na wp.pl) pomijamy PRZED czytaniem textContent — samo `el.textContent`
    // skleja cały tekst poddrzewa w nowy string i przy skanach co mutację DOM
    // generowało setki MB śmieci na minutę.
    if (el.getElementsByTagName('*').length > 1500) return false;
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
      'slot3ScreeningWallpaper', 'slot15ScreeningWallpaper', 'slot16ScreeningWallpaper',
      'slot17ScreeningWallpaper', 'slot18ScreeningWallpaper', 'slot19ScreeningWallpaper',
      'slot38ScreeningWallpaper', 'slot39ScreeningWallpaper', 'slot40ScreeningWallpaper',
      'slot75ScreeningWallpaper', 'slot501ScreeningWallpaper'
    ];
    var classes = SCREENING_KEYS.map(function (k) { return cfg.randomClasses[k]; }).filter(Boolean);
    if (!classes.length) return false;

    var cssText = classes.map(function (c) {
      return '.' + c + '{display:none!important;visibility:hidden!important}';
    }).join('');
    var existing = document.getElementById('fw-wp-screening');
    if (existing) {
      // Styl już wstrzyknięty i aktualny — nie przebudowuj go przy każdym
      // przebiegu warstwy ciężkiej (churn DOM przy mutacjach co 200 ms).
      if (existing.textContent === cssText) return true;
      existing.remove();
    }
    var style = document.createElement('style');
    style.id = 'fw-wp-screening';
    style.textContent = cssText;
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
          // Najpierw tani warunek na styl inline — getComputedStyle wymusza
          // przeliczenie stylów, a odkrywamy tylko elementy schowane inline.
          var hiddenInline = el.style.display === 'none';
          var invisibleInline = el.style.visibility === 'hidden';
          if (!hiddenInline && !invisibleInline) return;
          var cs = window.getComputedStyle(el);
          if (cs.display === 'none' && hiddenInline) el.style.display = '';
          if (cs.visibility === 'hidden' && invisibleInline) el.style.visibility = '';
        });
      } catch (e) {}
    });
  }

  // Główne/treściowe zdjęcie WP (hero) bywa chowane przez framework inline:
  //   <img class="wp-media-image" style="...display:none!important">
  // Zdjęcie jest w pełni załadowane (complete + naturalWidth>0), tylko ukryte —
  // stan „odsłoń" nie wraca przy aktywnym adblocku. Co gorsza, WP potrafi ponownie
  // ustawić display:none PO naszym odsłonięciu, więc jednorazowe odkrycie nie
  // wystarcza — trzymamy TRWAŁY MutationObserver, który re-odsłania zdjęcie za
  // każdym razem, gdy zostanie znów schowane. Inline !important da się nadpisać
  // tylko inline'em (CSS by nie zadziałał).
  //
  // Tylko kontenery TREŚCI (nie ruszamy lazy-load poniżej ekranu ani reklam,
  // które się nie wczytały).
  var MEDIA_CONTAINER = '[data-mainmedia-photo], .article-img-placeholder, article figure, main figure';
  var MEDIA_IMG = '[data-mainmedia-photo] img, .article-img-placeholder img, article figure img, main figure img';

  function revealOneImg(img) {
    try {
      if (!img || img.tagName !== 'IMG' || !img.style) return;
      if (img.style.display !== 'none' && img.style.visibility !== 'hidden') return;
      if (!img.complete || !(img.naturalWidth > 0)) return; // jeszcze nie wczytane → zostaw loaderowi
      if (!img.closest || !img.closest(MEDIA_CONTAINER)) return;
      if (img.style.display === 'none') img.style.setProperty('display', 'block', 'important');
      if (img.style.visibility === 'hidden') img.style.setProperty('visibility', 'visible', 'important');
    } catch (e) {}
  }

  function revealMainMedia() {
    try {
      document.querySelectorAll(MEDIA_IMG).forEach(revealOneImg);
    } catch (e) {}
  }

  // Trwały obserwator re-odsłaniania zdjęć — ale ZAWĘŻONY do kontenerów
  // medialnych. Wersja z v6.5 nasłuchiwała zmian style/class na CAŁYM body
  // (subtree) — na portalach WP React przełącza klasy bez przerwy, więc
  // przeglądarka bez końca alokowała MutationRecordy dla całej strony
  // (jedna z przyczyn lawinowego wzrostu RAM). Teraz obserwujemy wyłącznie
  // poddrzewa kontenerów MEDIA_CONTAINER (małe <figure> itp.); nowe kontenery
  // dopinamy przy każdym przebiegu warstwy ciężkiej.
  var _mediaObserver = null;
  var _observedMedia = (typeof WeakSet === 'function') ? new WeakSet() : null;
  function installMediaReveal() {
    revealMainMedia();
    if (!_mediaObserver) {
      _mediaObserver = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes') {
            revealOneImg(m.target);
          } else if (m.type === 'childList') {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (!n || n.nodeType !== 1) continue;
              if (n.tagName === 'IMG') revealOneImg(n);
              else if (n.querySelectorAll) {
                try { n.querySelectorAll('img').forEach(revealOneImg); } catch (e) {}
              }
            }
          }
        }
      });
    }
    try {
      document.querySelectorAll(MEDIA_CONTAINER).forEach(function (container) {
        if (_observedMedia) {
          if (_observedMedia.has(container)) return;
          _observedMedia.add(container);
        }
        _mediaObserver.observe(container, {
          attributes: true, attributeFilter: ['style', 'class'],
          subtree: true, childList: true
        });
      });
    } catch (e) {}
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
      // Tylko bezpośrednie dzieci — pełny querySelectorAll('div, section') po
      // każdym kontenerze dawał O(n²) alokacji NodeList na stronach WP.
      for (var i = container.children.length - 1; i >= 0; i--) {
        var el = container.children[i];
        if ((el.tagName === 'DIV' || el.tagName === 'SECTION') && looksLikeAdblockPopup(el)) {
          el.remove(); reportRemoved();
        }
      }
    });
  }

  // ── toolkitspro adblock (fxmag.pl itp.) ─────────────────────────────────────
  // Modal renderuje się głęboko w drzewie React, a jego klasy są haszowane
  // per-dzień (SHA256) — nie da się ich celować selektorem. Jedyną stałą,
  // jawną klasą jest ikona `adblock_new_icon`. Od niej wspinamy się w górę do
  // nakładki (position:fixed, wysoki z-index) i usuwamy całą nakładkę.
  function removeMarkerOverlays() {
    var markers = document.querySelectorAll('[class*="adblock_new_icon"]');
    markers.forEach(function (marker) {
      var node = marker, overlay = null;
      for (var i = 0; node && node !== document.body && i < 12; i++) {
        var cs;
        try { cs = getComputedStyle(node); } catch (e) { cs = null; }
        if (cs && cs.position === 'fixed' && (parseInt(cs.zIndex) || 0) >= 1000) {
          overlay = node; // bierz najwyższego pasującego przodka
        }
        node = node.parentElement;
      }
      if (overlay) { overlay.remove(); reportRemoved(); }
      else if (marker.parentElement) { marker.remove(); reportRemoved(); }
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
    lastHeavyRun = Date.now();
    injectBaseCSS();
    applyWPScreeningCSS();
    cleanGeneric();
    removeAdblockPopups();
    removeMarkerOverlays();
    revealArticleContent();
    installMediaReveal();
    installGoogletag();
  }

  // Dławik warstwy ciężkiej: pełny skan strony maksymalnie raz na sekundę.
  // Bez tego na dynamicznych stronach (portale WP mutują DOM bez przerwy)
  // runHeavy odpalał się do 5×/s w nieskończoność → lawinowy wzrost RAM.
  var HEAVY_MIN_INTERVAL = 1000;
  var lastHeavyRun = 0;
  var heavyScheduled = false;
  function runHeavyThrottled() {
    if (!wallDetected) return;
    var wait = lastHeavyRun + HEAVY_MIN_INTERVAL - Date.now();
    if (wait > 0) {
      if (!heavyScheduled) {
        heavyScheduled = true;
        setTimeout(function () { heavyScheduled = false; runHeavy(); }, wait);
      }
      return;
    }
    runHeavy();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PĘTLA GŁÓWNA — tania detekcja, ciężkie akcje tylko po wykryciu
  // ══════════════════════════════════════════════════════════════════════════

  function tick() {
    detectWall();
    if (wallDetected) runHeavyThrottled();
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
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
      // Obserwator działa tylko przez pierwsze 3 minuty. Ściany adblock
      // pojawiają się najpóźniej ~20-30 s po wejściu (fxmag: 20 s), a bez
      // limitu skanowanie strony trwało bez końca na każdą mutację DOM.
      // Po odłączeniu detekcję nadal zapewniają przechwyty zdarzeniowe
      // (window.WP, __INIT_CONFIG__, Piano, script killer) — te są tanie.
      // Dodatkowo wolny tick rezerwowy co 15 s (tylko widoczna karta) —
      // dopina obserwatory zdjęć do kontenerów doładowanych infinite scrollem.
      setTimeout(function () {
        try { observer.disconnect(); } catch (e) {}
        setInterval(function () {
          if (document.visibilityState === 'hidden') return;
          tick();
        }, 15000);
      }, 180000);
    }
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
