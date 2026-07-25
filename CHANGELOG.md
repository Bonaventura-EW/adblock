# Changelog

## v6.4 (2026-07-25)

### Naprawione
- **fxmag.pl** — ściana „Nie widzisz tej strony, bo blokujesz reklamy" znów
  pojawiała się po ~20 s. Strona zmieniła mechanizm: porzuciła stary
  `#stndz-style` + `DetectByGoogleAd`, a wdrożyła bibliotekę
  [`just-detect-adblock`](https://github.com/wmcmurray/just-detect-adblock).
  Dla Vivaldi/Chromium detekcja opiera się na teście „przynęty" (bait):
  - sprawdza **geometrię** wstrzykniętego `<div>` z klasami reklam
    (`offsetParent`, `offsetHeight`, `offsetWidth`, `offsetTop`, `offsetLeft`,
    `clientHeight`, `clientWidth`) — gdy uBlock ukryje przynętę, wszystkie = `0`/`null`,
  - sprawdza `getComputedStyle` przez **metodę** `getPropertyValue("display")`.

### Nowe (blok „BAIT SPOOF" w content.js)
- **Spoof geometrii** — `patchGeom()` nakłada gettery na `HTMLElement.prototype`
  i `Element.prototype`; dla elementów-przynęt zwraca wartości niezerowe, gdy
  realne wyszły `0`/`null`. Dla każdego innego elementu — oryginał (zero efektów
  ubocznych, potwierdzone testem w Chromium).
- **getComputedStyle** — Proxy obsługuje teraz również metodę `getPropertyValue()`
  (`display`/`visibility`/`opacity`/`height`/`width`), nie tylko dostęp przez
  właściwość. Wcześniej `just-detect-adblock` omijał nasz spoof, bo używa formy
  metody.
- Wspólny `isBaitEl()` — rozpoznaje przynętę po ściśle reklamowych klasach/id.

### Uwagi
- Ścieżka XHR biblioteki (`raw.githubusercontent.com/.../baits/…`) uruchamia się
  tylko w Brave/Operze — dla Vivaldi bez znaczenia, więc nietykana.
- Stary `installFxmagNeutraliser` pozostaje (nieszkodliwy, chroni inne strony).

---

## v6.3 (2026-06-02)

### Nowe
- **fxmag.pl**: neutralizacja dwutorowej detekcji adblocka:
  - Usuwanie elementu `#stndz-style` zaraz po wstawieniu do DOM (check 1 zwraca `null`).
  - Przechwyt skryptów `<script src="…adsbygoogle.js">`: `onerror` → no-op, `onload` odpalany ręcznie (check 2 myśli, że skrypt załadował się OK).
  - `responseURL` mock w interceptorze XHR — request URL nie wygląda na przekierowany.
  - `pagead2.googlesyndication.com/pagead/js/adsbygoogle` dodany do `AD_PATTERNS` (fetch-level block → fake response).
- Nowe sygnatury tekstowe PL: `'blokujesz reklamy'`, `'nie widzisz tej strony'`, `'korzystając z adblocka'`.

---

## v6.2 (2026-05-xx)

### Poprawki
- **wp.pl / finanse.wp.pl — znikające obrazki**: `__INIT_CONFIG__.randvar` był no-opem. WP wywołuje `randvar(el, slot, hasAdblock)` dla wszystkich slotów (tekst i obrazki) — no-op powodował, że sloty nigdy się nie otwierały. Teraz: przechwytujemy prawdziwą funkcję przez setter i wywołujemy ją z `hasAdblock=false` → sloty działają normalnie.

---

## v6.1 (2026-05-xx)

### Poprawki
- **Crash `fetch` na filmweb.pl** (`TypeError: Failed to execute 'fetch'`): w IIFE `'use strict'` wartość `this` = `undefined`. Naprawka: `_fetch.apply(window, arguments)` zamiast `_fetch.apply(this, arguments)`.
- `getComputedStyle` — analogicznie: `_gcs.call(window, el, pseudo)`.

---

## v6.0 (2026-05-xx)

### Architektura — tryb uniwersalny

Całkowite przepisanie z v5.1:

- **Model detekcja → reakcja**: warstwa lekka aktywna zawsze (bezpieczna), warstwa ciężka odpala się dopiero po wykryciu ściany.
- **Zakres `*://*/*`** zamiast listy ~30 portali. Per-domena/per-adres wyłączanie przez popup.
- **Trzy metody detekcji ściany**: sygnatury tekstowe (PL + EN), znane obiekty/selektory (WP/Piano), heurystyka overlay.
- **WP framework intercept** — Proxy na `window.WP`, patchuje `gaf.loadBunch` → `hasAdblock=false`.
- **`__INIT_CONFIG__` intercept** — pasywny setter; `randvar` wrapper.
- **Lazy Piano shim** — `window.tp` jako pasywna kolejka; pełny mock tylko przy wywołaniu Piano API.
- **Googletag / adsbygoogle mock** — bezpieczne globalnie.
- **Fetch/XHR intercept** — przechwyt wzorców URL ad-check.
- **Bait spoof** — `getComputedStyle` → `display:block` dla klas bait.
- **DOM protection** — pass-through do czasu wykrycia ściany, chroni `.wp-content-text-raw`.
- **Script killer** — neutralizuje inline `<script>` z `removeContentBecauseOfAdBlock` / `AdblockDetector`.
- **Service worker** (`background.js`) — dynamiczna rejestracja skryptów z `excludeMatches`.
- **Bridge** (`bridge.js`) — ISOLATED world, relay `postMessage` → `chrome.runtime.sendMessage`.
- **Popup** (`popup.html`/`popup.js`) — toggle per domena / per adres, licznik usuniętych ścian.
- Ikony (16/32/48/128px): neonowe zielone koło + żółty błyskawica.
- `scripts/lint.mjs` — walidacja składni JS + JSON + zakresu.
- `CLAUDE.md`, `README.md`, `CHANGELOG.md`.

### Usunięto
- `injected.js` — martwy plik (duplikat `content.js`, nic go nie ładowało).
- Statyczna lista portali z `host_permissions` i `content_scripts`.
- `revealArticleContent()`: usunięto zbyt szerokie selektory `[class*="content"]`, `[class*="body"]`.
- `looksLikeAdblockPopup()`: usunięto branch „inline ≥80×200 z sygnaturą".
