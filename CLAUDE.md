# Universal Adblock Spoof — CLAUDE.md

## Co to jest

Rozszerzenie MV3 (Manifest V3) do Vivaldi/Chromium. Cel: użytkownik ma adblock
(uBlock Origin), strony wykrywają to i zasłaniają treść ścianami „wyłącz
adblocka". Rozszerzenie oszukuje te detektory — strona myśli, że adblocka nie
ma, więc nie zasłania treści. Reklamy nadal blokuje uBlock.

Repozytorium: `Bonaventura-EW/adblock`, branch główny: `main`.
Dev branch: `claude/adoring-tesla-ObIvZ`.

## Architektura

### Model działania: „detekcja → reakcja"

1. **Warstwa lekka** (zawsze aktywna, bezpieczna) — mocki ad-API, pasywne
   przechwyty znanych frameworków. Nic nie usuwa ze strony.
2. **Warstwa ciężka** (tylko po wykryciu ściany) — usuwanie nakładek, ochrona
   DOM, odkrywanie ukrytej treści. Odpala się przez `markWall()`.

Zasada: na zwykłych stronach (banki, sklepy, social media) warstwa ciężka nigdy
się nie włącza.

### Pliki

```
manifest.json        MV3, host_permissions: *://*/* (uniwersalny)
content.js           rdzeń, world: MAIN, document_start, allFrames
background.js        service worker: dynamiczna rejestracja skryptów + licznik
bridge.js            world: ISOLATED — przekazuje postMessage → chrome.runtime
popup.html/popup.js  UI: toggle per domena/adres + licznik usuniętych ścian
rules/rules.json     7 reguł declarativeNetRequest (redirect ad-check → fake JSON, GPT)
fake-scripts/        oryginalne skrypty Google (gpt.js 112KB, pubads_impl.js 596KB)
icons/               16/32/48/128px PNG (neonowe zielone koło + żółty bolt)
scripts/lint.mjs     walidacja składni + JSON + zakresu (npm run lint)
package.json         "lint": "node scripts/lint.mjs"
README.md            dokumentacja dla użytkownika
```

### Dlaczego fake-scripts są PRAWDZIWYMI skryptami Google

`gpt.js` i `pubads_impl.js` to oryginalne pliki Google Publisher Tag, serwowane
lokalnie. Gdy uBlock blokuje je z sieci, strona przez nasze przekierowanie (reguła
#5, #6, #7) nadal „widzi" załadowane GPT → detektor nie zgłasza braku adblocka.
**Nie zastępuj ich stubami** — zepsuje to spoof.

### Komunikacja między warstwami

```
content.js (MAIN)
  └─ window.postMessage({source:'adblock-spoof', type:'removed'})
       └─ bridge.js (ISOLATED) odbiera i forwaduje:
            └─ chrome.runtime.sendMessage({type:'adblock-spoof-removed'})
                 └─ background.js inkrementuje storage.local.removedCount
```

### Wyłączanie per domena/adres

`background.js` czyta `storage.local.disabledDomains[]` i `disabledUrls[]`,
buduje `excludeMatches` i re-rejestruje content.js + bridge.js dynamicznie przez
`chrome.scripting`. Odpalane przy `onInstalled`, `onStartup`,
`storage.onChanged`.

## Kluczowe mechanizmy w content.js

### Warstwa lekka (zawsze)

- **WP framework intercept**: Proxy na `window.WP`, patchuje `gaf.loadBunch` aby
  zawsze przekazywać `hasAdblock=false`. Obecność `window.WP` = automatycznie
  wywołuje `markWall()`.
- **`__INIT_CONFIG__` intercept**: pasywny setter; gdy strona ustawia `randvar`
  (losowa nazwa funkcji chowającej treść po każdym slocie), mockujemy ją no-opem
  z `configurable:false`. Wykrycie = `markWall()`.
- **Lazy Piano shim**: `window.tp` jako pasywna kolejka; pełny mock aktywuje się
  dopiero gdy strona wywołuje Piano API (`init`, `experience`). Nie psuje stron
  używających `window.tp` do czegoś innego.
- **googletag / adsbygoogle**: mock od startu (nazwy czysto ad-specyficzne,
  bezpieczne globalnie).
- **fetch/XHR intercept**: przechwytuje wzorce URL (`/adblock/check`,
  `tinypass.com`, `piano.io` itp.) i zwraca fałszywy JSON `{"adblock":false}`.
- **Bait spoof**: `getComputedStyle` zwraca `display:block` dla elementów z
  klasami `adsbox`, `adsbygoogle`, `pub_300x250`, `pub_728x90`.
- **DOM protection**: `Node.removeChild` / `Element.remove` / `innerHTML` setter
  w trybie pass-through dopóki `!wallDetected`; aktywna ochrona `.wp-content-text-raw`.
- **Script killer**: neutralizuje inline `<script>` zawierające
  `removeContentBecauseOfAdBlock` lub `AdblockDetector`.

### Detekcja ściany (`detectWall()`)

Trzy metody (wystarczy jedna):
1. **Sygnatury tekstowe** — tablica `TEXT_SIGNATURES` (PL + EN), skan elementów
   `body > div/section/aside` + `dialog`.
2. **Znane obiekty/selektory** — `savedInitConfig.randvar`, `WALL_SELECTORS`
   (klasy `fc-ab-*`, `adblock-wall`, `AdBlockInfo`, `[id^="tp-"]`, `[data-tp-id]`).
3. **Heurystyka overlay** — `position:fixed` + `z-index≥1000` + pokrywa ≥60%
   viewportu + `body/html overflow:hidden`.

### Warstwa ciężka (po `markWall()`)

- `injectBaseCSS()` — dodaje `<style>` ukrywający znane klasy ścian.
- `applyWPScreeningCSS()` — ukrywa losowe klasy z `__INIT_CONFIG__.randomClasses`
  (screeningWallpaper, slot*ScreeningWallpaper, itd.). `screeningContainer`
  celowo pominięty — to kontener treści artykułu.
- `cleanGeneric()` — usuwa `FilmCheaterSection`, `AdBlockInfo`, odblokowuje
  scroll. Filmweb: sygnalizuje `WaitingModule.setPartLoaded('CHEATER_OVERLAY_SHOWN')`.
- `removeAdblockPopups()` — usuwa elementy z sygnaturą tekstową AND
  (fixed/absolute/z-index≥1000 OR selektor Piano).
- `revealArticleContent()` — odkrywa `article`, `main`, `[class*="article"]`,
  `[class*="Article"]` jeśli schowane inline przez skrypt (nie przez CSS autora).
- `revealMainMedia()` (v6.4) — WP czasem chowa GŁÓWNE zdjęcie (hero) wstrzykując
  na `<img class="wp-media-image">` inline `display:none!important` (obok
  `width/height:100%;object-fit:cover`), a stan „odsłoń" nie wraca przy aktywnym
  adblocku. Odkrywamy tylko **załadowane** zdjęcia (`complete && naturalWidth>0`)
  w kontenerach treści (`[data-mainmedia-photo]`, `.article-img-placeholder`,
  `article/main figure`, `article img.wp-media-image`) — niezaładowane lazy-obrazki
  zostawiamy loaderowi, nie ruszamy reklam.

### fxmag.pl (v6.3) — Next.js/React, dwutorowa detekcja

Kod w chunk `7015-beda8594e24d46d9.js`:

```javascript
// Check 1 — element #stndz-style wstrzyknięty przez uBlock cosmetic engine
null !== document.getElementById("stndz-style") ? e(true) : DetectByGoogleAd(cb)

// Check 2 — DetectByGoogleAd
script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
script.onerror = () => e(true);   // skrypt zablokowany → adblock
xhr.onload = () => e(xhr.responseURL !== url); // redirect → adblock
```

Ściana pojawia się z 20-sekundowym opóźnieniem (`setTimeout(show, 20000)`).

**Nasze neutralizacje (content.js `installFxmagNeutraliser`):**
- MutationObserver usuwa `#stndz-style` natychmiast po pojawieniu się w DOM.
- MutationObserver przechwytuje `<script src="…adsbygoogle.js">`: `onerror` → no-op, `onload` wywoływane ręcznie.
- XHR interceptor: `responseURL` mockowany jako `self._surl` (nie wygląda na redirect).
- `pagead2.googlesyndication.com/pagead/js/adsbygoogle` dodany do `AD_PATTERNS` (fetch-level).

## Zakres i ograniczenia

- **Paywalle serwerowe** (np. Onet po X akapitach) — rozszerzenie ich NIE obchodzi.
  Jeśli tekst nie istnieje w HTML, nie ma czego odkrywać.
- **Shadow DOM** — część nowoczesnych ścian renderuje się w shadow root,
  niewidoczna dla querySelectorAll. Nieobsługiwane (przyszłe ulepszenie).
- Rozszerzenie działa tylko na `http://` i `https://`. Strony spoza listy nie
  wychodzą na `excludeMatches` — wyłączanie działa tylko dla znanych wzorców.

## Wersjonowanie i paczki ZIP

- Numer wersji: `manifest.json` → `version`, nagłówek `content.js`.
- Pliki ZIP do instalacji manualnej w Vivaldi: `adblock-vivaldi-vX.Y.zip`
  (X.Y = numer wersji, np. `adblock-vivaldi-v6.0.zip`).
- ZIP zawiera tylko pliki potrzebne do zainstalowania rozszerzenia (bez
  `scripts/`, `README.md`, `package.json`, `CLAUDE.md`, `_metadata/`).

## Jak dodać obsługę nowej strony

Nie dodaje się domen — rozszerzenie jest uniwersalne. Jeśli ściana się
prześlizgnie:
1. Sprawdź czy ściana jest w HTML (`Ctrl+U` + `Ctrl+F` po tekście po ścianie).
2. Jeśli tak: dodaj sygnaturę tekstową do `TEXT_SIGNATURES` lub selektor do
   `WALL_SELECTORS` w `content.js`.
3. Jeśli to specyficzny framework: dodaj logikę w warstwie lekkiej (pasywny
   przechwyt globalnego obiektu).
4. `npm run lint` → przeładuj rozszerzenie.

## Instalacja w Vivaldi (tryb dewelopera)

1. `vivaldi://extensions` → Tryb dewelopera (ON)
2. Wczytaj rozpakowane → wskaż folder z `manifest.json`
3. Po aktualizacji: kliknij Odśwież przy rozszerzeniu

## Walidacja

```bash
npm run lint   # node --check na .js + JSON + zakres *://*/*
```
