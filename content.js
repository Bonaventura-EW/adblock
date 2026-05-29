// Universal Adblock Spoof v4.2
// Działa TYLKO na polskich portalach informacyjnych — nie psuje innych stron
// (Facebook, Twitter, Instagram itp.)

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // SCOPE GUARD — działaj tylko na docelowych portalach
  // ══════════════════════════════════════════════════════════════

  var TARGET_HOSTS = [
    'onet.pl', 'money.pl', 'wp.pl', 'o2.pl',
    'sportowefakty.wp.pl', 'businessinsider.com.pl',
    'abczdrowie.pl', 'kurierlubelski.pl',
    'dziennikzachodni.pl', 'gazetakrakowska.pl',
    'filmweb.pl',
    // Portale WP Holding (osobne domeny, nie subdomeny wp.pl)
    'jastrzabpost.pl', 'parenting.pl', 'pudelek.pl',
    'teleshow.pl', 'autokult.pl', 'benchmark.pl',
    'polygamia.pl', 'gry-online.pl',
    // Polska Press / inne polskie portale można dodać tutaj
    'naszemiasto.pl', 'gazeta.pl', 'rmf24.pl', 'tvn24.pl',
    'interia.pl', 'fakt.pl', 'gazetaprawna.pl', 'parkiet.com',
    // Onet/RingPublishing portale motoryzacyjne
    'auto-swiat.pl',
  ];

  var hostname = location.hostname.toLowerCase();
  var inScope = TARGET_HOSTS.some(function(h) {
    return hostname === h || hostname.endsWith('.' + h);
  });

  if (!inScope) return; // EXIT - nie ruszamy obcych stron


  // ══════════════════════════════════════════════════════════════
  // OD TEGO MOMENTU - tylko na polskich portalach informacyjnych
  // ══════════════════════════════════════════════════════════════

  // Przechwyć __INIT_CONFIG__ tylko gdy WP/Money (te go używają)
  var savedInitConfig = null;
  var isWPGroup = [
    'money.pl', 'wp.pl', 'o2.pl', 'sportowefakty.wp.pl', 'abczdrowie.pl',
    // WP Holding portale z osobnymi domenami - używają tego samego __INIT_CONFIG__
    'jastrzabpost.pl', 'parenting.pl', 'pudelek.pl',
    'teleshow.pl', 'autokult.pl', 'benchmark.pl',
    'polygamia.pl', 'gry-online.pl',
  ].some(function(h) { return hostname === h || hostname.endsWith('.' + h); });

  if (isWPGroup) {
    try {
      var _cfg = null;
      
  // ── WP FRAMEWORK INTERCEPT ─────────────────────────────────────────────────
  // Script #0 ustawia window.WP = [] i pushuje funkcję:
  //   window.WP.push(function(){ window.WP.gaf.loadBunch(false, loadScript, TRUE) })
  // Hardcoded TRUE = "adblock wykryty". Framework usuwa elementy artykułu.
  // Rozwiązanie: przechwytujemy window.WP i jego gaf.loadBunch.
  (function interceptWP() {
    var _wpArr = [];   // kolejka push-ów z Script #0
    var _wpObj = null; // prawdziwy obiekt WP (z gofer.js)

    function patchGaf(gaf) {
      if (!gaf || gaf.__patched__) return;
      gaf.__patched__ = true;

      // loadBunch(loadDeferred, callback, hasAdblock)
      // Zawsze przekazuj false jako hasAdblock
      var origLB = gaf.loadBunch;
      if (typeof origLB === 'function') {
        gaf.loadBunch = function(a, b, _hasAdblock) {
          return origLB.call(this, a, b, false);
        };
      }
    }

    // Proxy-like object that acts as array (for Script #0's WP.push calls)
    // and intercepts gaf assignment (for ad.min.js's WP.gaf = ... assignment)
    var wpProxy = new Proxy(_wpArr, {
      set: function(target, prop, value) {
        if (prop === 'gaf') {
          patchGaf(value);
        }
        target[prop] = value;
        return true;
      },
      get: function(target, prop) {
        return target[prop];
      }
    });

    // Intercept window.WP assignment
    Object.defineProperty(window, 'WP', {
      configurable: true,
      enumerable: true,
      get: function() {
        return _wpObj || wpProxy;
      },
      set: function(v) {
        if (v && typeof v === 'object') {
          // gofer.js sets the real WP object
          // Patch gaf if already attached
          if (v.gaf) patchGaf(v.gaf);
          
          // Watch for future gaf attachment
          try {
            var origGafDesc = Object.getOwnPropertyDescriptor(v, 'gaf');
            var _gaf = (origGafDesc && origGafDesc.value) || v.gaf;
            Object.defineProperty(v, 'gaf', {
              configurable: true,
              enumerable: true,
              get: function() { return _gaf; },
              set: function(newGaf) {
                patchGaf(newGaf);
                _gaf = newGaf;
              }
            });
          } catch(e) {}

          // Re-run any queued pushes with the real WP object
          if (Array.isArray(_wpArr) && _wpArr.length && v.push) {
            _wpArr.forEach(function(fn) { try { v.push(fn); } catch(e) {} });
            _wpArr.length = 0;
          }
          _wpObj = v;
          
          // Replace the defineProperty with a simple writable so gofer can work
          Object.defineProperty(window, 'WP', {
            configurable: true, enumerable: true, writable: true, value: v
          });
        }
      }
    });
  })();

  // ── PROTECTION: prevent removal of article text elements ──────────────────
  // Gdy WP framework wykryje adblock, próbuje usunąć .wp-content-text-raw
  // z DOM. Blokujemy to na poziomie DOM API.
  (function protectArticleElements() {
    // Sprawdź czy element jest lub zawiera tekst artykułu
    function isProtected(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.classList && node.classList.contains('wp-content-text-raw')) return true;
      // Chroń też kontenery zawierające tekst artykułu
      if (node.querySelector && node.querySelector('.wp-content-text-raw')) return true;
      return false;
    }

    // Override Node.removeChild
    var _removeChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function(child) {
      if (isProtected(child)) return child; // Blokuj usunięcie
      return _removeChild.apply(this, arguments);
    };

    // Override Element.remove
    var _remove = Element.prototype.remove;
    Element.prototype.remove = function() {
      if (isProtected(this)) return; // Blokuj usunięcie siebie
      return _remove.apply(this, arguments);
    };

    // Override Element.innerHTML setter (WP może wyczyścić kontener)
    var _innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (_innerHTMLDesc && _innerHTMLDesc.set) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        get: _innerHTMLDesc.get,
        set: function(val) {
          // Jeśli próbujemy wyczyścić kontener z artykułem — blokuj
          if ((val === '' || val === null) && this.querySelector && this.querySelector('.wp-content-text-raw')) {
            return;
          }
          return _innerHTMLDesc.set.call(this, val);
        },
        configurable: true
      });
    }
  })();


  // Gdyby WP framework zdążył usunąć elementy zanim nasz patch zadziała,
  // przywracamy je po załadowaniu DOM.
  (function mutationFallback() {
    var saved = []; // {el, parent, nextSib}

    // Zapisz elementy gdy się pojawią
    var obs = new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        // Zapisz elementy artykułu które zostały dodane
        m.addedNodes.forEach(function(n) {
          if (n.nodeType !== 1) return;
          var els = n.classList && n.classList.contains('wp-content-text-raw')
            ? [n] : Array.from(n.querySelectorAll ? n.querySelectorAll('.wp-content-text-raw') : []);
          els.forEach(function(el) {
            if (!saved.find(function(s) { return s.el === el; })) {
              saved.push({ el: el, parent: el.parentElement, nextSib: el.nextSibling });
            }
          });
        });
      });
    });
    try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch(e) {}

    // Po załadowaniu DOM: przywróć usunięte elementy
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        saved.forEach(function(item) {
          if (!item.el.isConnected && item.parent && item.parent.isConnected) {
            if (item.nextSib && item.nextSib.isConnected) {
              item.parent.insertBefore(item.el, item.nextSib);
            } else {
              item.parent.appendChild(item.el);
            }
          }
        });
        obs.disconnect();
      }, 500);
    });
  })();


  Object.defineProperty(window, '__INIT_CONFIG__', {
        configurable: true,
        get: function() { return _cfg; },
        set: function(val) {
          _cfg = val;
          if (val && val.randomClasses) {
            savedInitConfig = val;
            setTimeout(applyWPScreeningCSS, 0);
          }
          // KLUCZOWE: randvar to nazwa globalnej funkcji wywoływanej inline
          // po każdym paragrafie/slocie: window[randvar](element, slot, hasAdblock, ...)
          // Gdy hasAdblock=true, chowa otaczający content.
          // Mockujemy ją SYNCHRONICZNIE zanim pierwsze inline skrypty zdążą ją wywołać.
          if (val && val.randvar) {
            try {
              var rv = val.randvar;
              // KLUCZOWE: Script #0 najpierw ustawia __INIT_CONFIG__.randvar,
              // a POTEM w tym samym skrypcie przypisuje window[randvar] = funkcja.
              // Musimy zablokować to nadpisanie ZANIM Script #0 to zrobi.
              // Używamy Object.defineProperty z configurable:false żeby zablokować
              // każde późniejsze przypisanie window[randvar] = cokolwiek.
              var noop = function() {};
              Object.defineProperty(window, rv, {
                get: function() { return noop; },
                set: function() { /* celowo ignoruj próby nadpisania */ },
                configurable: false,
                enumerable: true,
              });
            } catch(e) {}
          }
        }
      });
    } catch(e) {}
  }

  // ── BAZOWY CSS ──────────────────────────────────────────────
  // FILMWEB SABOTAGE: usuń <script id="qstsxq"> zanim się wykona
  // Ten skrypt zawiera AdblockDetector i removeContentBecauseOfAdBlock
  // który usuwa sekcje (Obsada, Recenzje, Opis, Galeria, Forum itp.) po wykryciu adblock.
  // MutationObserver złapie dodanie skryptu i wyczyści jego treść zanim się odpali.
  if (hostname === 'filmweb.pl' || hostname.endsWith('.filmweb.pl')) {
    try {
      var killScript = function(node) {
        if (node.tagName === 'SCRIPT' && node.id === 'qstsxq') {
          node.textContent = '';
          node.text = '';
          node.type = 'text/plain'; // przeglądarka pominie wykonanie
          return true;
        }
        return false;
      };
      
      // Przeskanuj już istniejące (gdyby kod był wcześniej w HTML)
      var existing = document.querySelectorAll('script#qstsxq');
      existing.forEach(killScript);
      
      // MutationObserver dla nowych <script> dodawanych do DOM
      var killObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          m.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) {
              if (killScript(node)) return;
              // Sprawdź też dzieci
              if (node.querySelectorAll) {
                node.querySelectorAll('script#qstsxq').forEach(killScript);
              }
            }
          });
        });
      });
      var observeTarget = document.documentElement || document;
      if (observeTarget) {
        killObserver.observe(observeTarget, { childList: true, subtree: true });
      }
      
      // Zatrzymaj observer po 30s gdy strona jest już załadowana
      setTimeout(function() { try { killObserver.disconnect(); } catch(e) {} }, 30000);
    } catch(e) {}
  }

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
      '[class*="plus-paywall"],[class*="article-locked"]{display:none!important}',
    ].join('');
    var target = document.head || document.documentElement;
    if (target) target.appendChild(style);
  }

  function applyWPScreeningCSS() {
    if (!isWPGroup) return false;
    var cfg = savedInitConfig || window.__INIT_CONFIG__;
    if (!cfg || !cfg.randomClasses) return false;

    var SCREENING_KEYS = [
      'screeningWallpaper', 'screeningWallpaperSecondary',
      'fullPageScreeningWallpaper', 'panelPremiumScreeningWallpaper',
      // 'screeningContainer' - CELOWO POMINIĘTY: to kontener treści artykułu,
      // ukrycie go powoduje zniknięcie całej zawartości strony (patrz: wp.pl)
      'slot15ScreeningWallpaper', 'slot16ScreeningWallpaper',
      'slot17ScreeningWallpaper', 'slot18ScreeningWallpaper',
      'slot19ScreeningWallpaper', 'slot38ScreeningWallpaper',
      'slot39ScreeningWallpaper', 'slot40ScreeningWallpaper',
    ];

    var classes = SCREENING_KEYS
      .map(function(k){ return cfg.randomClasses[k]; })
      .filter(Boolean);
    if (!classes.length) return false;

    var existing = document.getElementById('fw-wp-screening');
    if (existing) existing.remove();
    var style = document.createElement('style');
    style.id = 'fw-wp-screening';
    style.textContent = classes.map(function(c){
      return '.'+c+'{display:none!important;visibility:hidden!important}';
    }).join('');
    var target = document.head || document.documentElement;
    if (target) { target.appendChild(style); return true; }
    return false;
  }

  injectBaseCSS();

  // Polling tylko jeśli WP/Money
  if (isWPGroup) {
    var pollTicks = 0;
    var pollIv = setInterval(function() {
      if (window.__INIT_CONFIG__ && window.__INIT_CONFIG__.randomClasses) {
        savedInitConfig = window.__INIT_CONFIG__;
        applyWPScreeningCSS();
        clearInterval(pollIv);
      }
      if (++pollTicks > 50) clearInterval(pollIv);
    }, 50);
  }


  // ══════════════════════════════════════════════════════════════
  // SPOOF API - tylko dla polskich portali
  // ══════════════════════════════════════════════════════════════

  function destroySlotsImpl(slots) {
    var slotsById = { clear: function(){} }; slotsById.clear(); return true;
  }

  function buildPubadsMock() {
    var m = {
      addEventListener: function(){return m;}, removeEventListener: function(){return m;},
      setTargeting: function(){return m;}, clearTargeting: function(){return m;},
      enableSingleRequest: function(){return m;}, collapseEmptyDivs: function(){return m;},
      enableLazyLoad: function(){return m;}, setCentering: function(){return m;},
      refresh: function(){return m;}, display: function(){},
      getSlots: function(){return [];}, getVersion: function(){return '202401';},
      isInitialLoadDisabled: function(){return false;},
      getTargeting: function(){return [];}, getTargetingKeys: function(){return [];},
      clear: function(){return true;},
    };
    return m;
  }

  function installGoogletag() {
    if (!window.googletag) window.googletag = { cmd: [] };
    var gt = window.googletag;
    if (!gt.pubads || typeof gt.pubads !== 'function') {
      var pubads = buildPubadsMock();
      gt.pubads      = function(){ return pubads; };
      gt.apiReady    = true;
      gt.pubadsReady = true;
      gt.enableServices = function(){};
      gt.display     = function(){};
      gt.destroySlots = destroySlotsImpl;
      gt.defineSlot  = function(){ return { addService: function(){return{};}, setTargeting: function(){return this;}, defineSizeMapping: function(){return this;} }; };
      gt.defineOutOfPageSlot = function(){ return { addService: function(){return{};} }; };
      gt.sizeMapping = function(){ return { addSize: function(){return this;}, build: function(){return [];} }; };
      var cmds = Array.isArray(gt.cmd) ? gt.cmd.slice() : [];
      gt.cmd = { push: function(fn){ try { fn(); } catch(e){} } };
      cmds.forEach(function(fn){ try { if(typeof fn==='function') fn(); } catch(e){} });
    } else if (gt.destroySlots && !gt.destroySlots.toString().includes('slotsById.clear')) {
      gt.destroySlots = destroySlotsImpl;
    }
  }

  installGoogletag();

  // ── PIANO SDK (window.tp) MOCK ────────────────────────────────
  // Piano chowa body artykułu domyślnie i odkrywa go po weryfikacji dostępu.
  // Gdy uBlock blokuje Piano CDN, SDK nigdy się nie ładuje → treść zostaje ukryta.
  // Rozwiązanie: mockujemy window.tp PRZED załadowaniem SDK,
  // przechwytując kolejkę tp.push([]) i uruchamiając callbacki init z fałszywym SDK.
  (function installPianoMock() {
    var queue = Array.isArray(window.tp) ? window.tp.slice() : [];

    // Handlery zarejestrowane przez stronę (np. 'showOffer', 'experienceExecute')
    var handlers = {};

    function fireHandler(name, params) {
      var list = handlers[name] || [];
      list.forEach(function(fn) { try { fn(params || {}); } catch(e) {} });
    }

    var piano = {
      push: function(args) {
        if (!Array.isArray(args)) return;
        var method = args[0], cb = args[1];
        if (method === 'init' && typeof cb === 'function') {
          // Uruchom init callback - strona wywołuje tu tp.experience.execute()
          setTimeout(function() { try { cb(); } catch(e) {} }, 0);
        } else if (method === 'addHandler' && typeof args[2] === 'function') {
          // Zbierz handlery strony ale NIE odpalam ich (nie pokazujemy ścian)
          if (!handlers[cb]) handlers[cb] = [];
          handlers[cb].push(args[2]);
        }
        // setCustomVariable, setTags itp. - ignoruj
      },
      experience: {
        execute: function() {
          // Piano normalnie sprawdziłoby tutaj dostęp i albo pokazało paywall
          // albo odkryło treść. My udajemy że dostęp jest przyznany.
          setTimeout(function() {
            // Wyzwól 'experienceExecute' z wynikiem "brak ściany"
            fireHandler('experienceExecute', { result: { accessList: [] } });
            // Odkryj treść artykułu (na wypadek gdyby Piano ją schowało)
            revealArticleContent();
          }, 50);
        }
      },
      template: {
        show: function() {},  // Blokuj wyświetlanie szablonów (paywall/adblock wall)
        close: function() {}
      },
      offer:    { startCheckout: function() {} },
      checkout: { startCheckout: function() {} },
      pianoId:  { show: function() {}, logout: function() {}, isUserValid: function() { return false; } },
      user: {
        isUserValid: function() { return false; },
        getProvider: function() { return {}; }
      }
    };

    window.tp = piano;

    // Obsłuż komendy już wklejone do kolejki przed naszym mockiem
    queue.forEach(function(args) { try { piano.push(args); } catch(e) {} });
  })();

  // Odkrywanie treści artykułu gdy Piano schowało go przez adblock
  function revealArticleContent() {
    // WP/Piano chowa body artykułu ustawiając display:none lub visibility:hidden
    // na kontenerze main, article lub ich bezpośrednich dzieciach.
    var selectors = [
      'article', 'main', '[class*="article"]', '[class*="Article"]',
      '[class*="content"]', '[class*="Content"]',
      '[class*="body"]', '[class*="Body"]',
    ];
    selectors.forEach(function(sel) {
      try {
        document.querySelectorAll(sel).forEach(function(el) {
          var cs = window.getComputedStyle(el);
          // Odkryj tylko elementy schowane przez script (nie te schowane przez CSS autora)
          if (cs.display === 'none' && el.style.display === 'none') {
            el.style.display = '';
          }
          if (cs.visibility === 'hidden' && el.style.visibility === 'hidden') {
            el.style.visibility = '';
          }
        });
      } catch(e) {}
    });
  }

  // Fetch & XHR intercept TYLKO dla AD endpointów Filmweb i podobnych
  // + Piano/tinypass API (access check musi zwrócić "brak ściany reklamowej")
  var AD_PATTERNS = [
    '/ads/targeted', '/api/v1/ads', '/adcheck', '/adblock/check',
    'tinypass.com', 'piano.io', 'buy.piano.io',
  ];

  // Odpowiedź Piano access/check z brakiem walls/ścian
  function pianoAccessResponse() {
    return JSON.stringify({
      code: 0,
      data: {
        access: true,
        granted_by_subscription: false,
        granted_by_access_token: false,
        granted_by_promotional: false,
        can_purchase: false,
        user_segment: 'anon',
        period_run_number: 0,
        show_recommendations: false
      }
    });
  }

  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input==='string' ? input : (input && input.url ? input.url : String(input));
    if (AD_PATTERNS.some(function(p){ return url.indexOf(p)!==-1; })) {
      var body = (url.indexOf('tinypass.com') !== -1 || url.indexOf('piano.io') !== -1)
        ? pianoAccessResponse()
        : '{"ads":[],"status":"ok","adblock":false}';
      return Promise.resolve(new Response(body,
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ));
    }
    return _fetch.apply(this, arguments);
  };

  var _xhrOpen = XMLHttpRequest.prototype.open;
  var _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, url) {
    this._surl = String(url||'');
    return _xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    var self = this;
    if (self._surl && AD_PATTERNS.some(function(p){ return self._surl.indexOf(p)!==-1; })) {
      var fake = (self._surl.indexOf('tinypass.com') !== -1 || self._surl.indexOf('piano.io') !== -1)
        ? pianoAccessResponse()
        : '{"ads":[],"status":"ok","adblock":false}';
      Object.defineProperty(self, 'readyState',   {get:function(){return 4;}});
      Object.defineProperty(self, 'status',       {get:function(){return 200;}});
      Object.defineProperty(self, 'responseText', {get:function(){return fake;}});
      Object.defineProperty(self, 'response',     {get:function(){return fake;}});
      setTimeout(function(){
        try { if(typeof self.onreadystatechange==='function') self.onreadystatechange(); } catch(e){}
        try { if(typeof self.onload==='function') self.onload(); } catch(e){}
      }, 10);
      return;
    }
    return _xhrSend.apply(this, arguments);
  };

  // Bait spoof - tylko ścisłe klasy ad-bait, NIE łap "ad" w środku innych słów
  // Sprawdzaj WHOLE WORD match żeby nie złapać 'header-ad', 'header_ad' itp. które są zwykłe
  var BAIT = ['adsbox','adsbygoogle','pub_300x250','pub_728x90'];
  var _gcs = window.getComputedStyle;
  window.getComputedStyle = function(el, pseudo) {
    var style = _gcs.call(this, el, pseudo);
    if (el && el.className && typeof el.className === 'string') {
      var cls = el.className, id = el.id||'';
      // EXACT match na nazwę bait klasy
      var classes = cls.split(/\s+/).concat([id]);
      if (classes.some(function(c){ return BAIT.indexOf(c) !== -1; })) {
        return new Proxy(style, { get: function(t,p) {
          if (p==='display') return 'block';
          if (p==='visibility') return 'visible';
          if (p==='opacity') return '1';
          if (p==='height') return '1px';
          var v = t[p]; return typeof v==='function' ? v.bind(t) : v;
        }});
      }
    }
    return style;
  };

  if (!window.adsbygoogle) window.adsbygoogle = [];
  if (!window.adsbygoogle.push) window.adsbygoogle.push = function(){};
  window.adsbygoogle.loaded = true;


  // ══════════════════════════════════════════════════════════════
  // POPUP REMOVAL - tekst-based signatures
  // ══════════════════════════════════════════════════════════════

  // Wszystkie sygnatury lowercase - porównujemy po toLowerCase()
  var TEXT_SIGNATURES = [
    'wybierz adblocka',
    'wyłącz adblock',
    'wylacz adblock',
    'zauważyliśmy, że używasz',
    'wyłącz blokowanie reklam',
    'wylacz blokowanie reklam',
    'wyłącz blokad',
    'jest jednak za darmo i utrzymuje',
    'houston, mamy problem',
    'wspieraj bezpłatne treści',
    'wspieraj bezplatne tresci',
    'wygląda na to, że blokujesz reklamy',
    'wyglada na to, ze blokujesz reklamy',
    'to dzięki reklamom możesz czytać',
    'to dzieki reklamom mozesz czytac',
    'aby zobaczyć zawartość tej strony',
    'zezwól na wyświetlanie reklam',
    'wyłącz adblocka',
    'dokończ czytanie artykułu',
    'dokonz czytanie artykulu',
    'dzięki reklamom możesz korzystać',
    'dzieki reklamom mozesz korzystac',
    'przejdź na wp.pl',
    'using adblock',
    'using an ad blocker',
  ];

  function looksLikeAdblockPopup(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetHeight < 50 || el.offsetWidth < 50) return false;
    var text = el.textContent || '';
    if (text.length > 5000) return false;
    var lower = text.toLowerCase();
    var hasSignature = TEXT_SIGNATURES.some(function(sig) {
      return lower.indexOf(sig) !== -1;
    });
    if (!hasSignature) return false;

    // Piano templates są często inline (position: static/relative), nie tylko fixed/absolute
    // Wystarczy że tekst pasuje do sygnatury i element ma sensowny rozmiar
    var cs;
    try { cs = getComputedStyle(el); } catch(e) { return false; }
    var pos = cs.position;
    var z = parseInt(cs.zIndex) || 0;
    // Akceptuj: fixed/absolute (klasyczne overlaye) LUB inline z tekstem adblock
    if (pos === 'fixed' || pos === 'absolute' || z >= 1000) return true;
    // Inline Piano template: ma sygnaturę + nie jest miniaturowym widgetem
    if (el.offsetHeight >= 80 && el.offsetWidth >= 200) return true;
    return false;
  }

  function removeAdblockPopups() {
    // Klasyczne overlaye: bezpośrednie dzieci body
    var candidates = document.querySelectorAll('body > div, body > section, body > aside');
    candidates.forEach(function(el) {
      if (looksLikeAdblockPopup(el)) el.remove();
    });
    document.querySelectorAll('dialog').forEach(function(d) {
      if (looksLikeAdblockPopup(d)) d.remove();
    });

    // Piano templates: mogą być wstrzyknięte głębiej w DOM (np. w article, main)
    // Szukamy po Piano-specyficznych klasach/atrybutach
    var pianoSelectors = [
      '[id^="tp-"]', '[class*="tp-backdrop"]', '[class*="tp-modal"]',
      '[class*="tp-container"]', '[class*="tp-iframe"]',
      'div[data-tp-id]', 'div[class*="piano-"]',
    ];
    pianoSelectors.forEach(function(sel) {
      try {
        document.querySelectorAll(sel).forEach(function(el) {
          if (looksLikeAdblockPopup(el)) el.remove();
        });
      } catch(e) {}
    });

    // Szukaj inline Piano wall w kontenerze artykułu (jastrzabpost.pl pattern)
    var articleContainers = document.querySelectorAll('article, main, [class*="article"], [class*="content"]');
    articleContainers.forEach(function(container) {
      container.querySelectorAll('div, section').forEach(function(el) {
        // Tylko bezpośrednie dzieci kontenera żeby nie rekurencyjnie skanować
        if (el.parentElement === container && looksLikeAdblockPopup(el)) {
          el.remove();
        }
      });
    });
  }

  function cleanGeneric() {
    // Zamiast usuwać FilmCheaterSection całkowicie, ZACHOWAJ element ale ukryj go
    // (usunięcie może powodować błędy w hydratacji frameworka)
    document.querySelectorAll('div[class*="FilmCheaterSection"], div[class*="filmCheaterSection"]').forEach(function(el) {
      el.style.cssText = 'display:none!important;height:0!important;visibility:hidden!important;position:absolute!important;top:-99999px!important;pointer-events:none!important';
      // Dodaj klasę isReady żeby framework myślał że sekcja się wyrenderowała
      if (!el.className.includes('isReady')) {
        el.className = el.className + ' isReady';
      }
    });
    
    // FILMWEB: WaitingModule - sygnalizuj że "cheater overlay" jest gotowy
    // Filmweb używa kolejki part-loading; sekcje (Obsada, Recenzje, Galeria itp.)
    // czekają na setPartLoaded("CHEATER_OVERLAY_SHOWN") zanim się wyrenderują.
    // Gdy ukrywamy popup, ten sygnał nigdy nie przychodzi → sekcje nie ładują się.
    try {
      var W = window.globals && window.globals.module && window.globals.module.WaitingModule;
      if (W && typeof W.setPartLoaded === 'function') {
        W.setPartLoaded('CHEATER_OVERLAY_SHOWN');
        W.setPartLoaded('FOOTER');
      }
    } catch(e) {}

    // Pozostałe selektory - usuń całkowicie
    var ALWAYS = [
      '[class*="AdBlockInfo"]', '[class*="adBlockInfo"]',
      '[class*="adblock-wall-content"]', '.fc-ab-root',
      '[class*="fc-dialog"]',
    ];
    ALWAYS.forEach(function(sel){
      try { document.querySelectorAll(sel).forEach(function(el){ el.remove(); }); } catch(e){}
    });

    var SCROLL_BLOCK = ['no-scroll','noscroll','modal-open','overlay-open','scroll-lock','fc-ab-active'];
    if (document.body) {
      SCROLL_BLOCK.forEach(function(c){ document.body.classList.remove(c); });
      if (document.body.style.overflow === 'hidden') document.body.style.overflow = '';
      if (document.body.style.overflowY === 'hidden') document.body.style.overflowY = '';
    }
    if (document.documentElement) {
      SCROLL_BLOCK.forEach(function(c){ document.documentElement.classList.remove(c); });
      if (document.documentElement.style.overflow === 'hidden') document.documentElement.style.overflow = '';
    }
  }

  // ── GŁÓWNA PĘTLA ─────────────────────────────────────────────
  function runAll() {
    applyWPScreeningCSS();
    cleanGeneric();
    removeAdblockPopups();
    installGoogletag();
  }

  function setup() {
    runAll();
    // MutationObserver - z debounce żeby nie spowalniać strony
    var pending = false;
    var observer = new MutationObserver(function(mutations) {
      var hasAdded = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) { hasAdded = true; break; }
      }
      if (hasAdded && !pending) {
        pending = true;
        // Throttle - max raz na 200ms
        setTimeout(function() { runAll(); pending = false; }, 200);
      }
    });
    var target = document.body || document.documentElement;
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  if (document.body) setup();
  else document.addEventListener('DOMContentLoaded', setup);

  document.addEventListener('DOMContentLoaded', function() {
    runAll();
    [100, 300, 700, 1500, 3000].forEach(function(t){ setTimeout(runAll, t); });
  });
  window.addEventListener('load', function() {
    runAll();
    [500, 1500, 3000].forEach(function(t){ setTimeout(runAll, t); });
  });

  // Interwał bezpieczeństwa - tylko przez pierwsze 30s
  var ticks = 0;
  var iv = setInterval(function() {
    runAll();
    if (++ticks >= 20) clearInterval(iv); // STOP po 20s, nie nadpisuj w nieskończoność
  }, 1500);

})();
