# Universal Adblock Spoof — CLAUDE.md

## Co to jest

Rozszerzenie MV3 (Manifest V3) do Vivaldi/Chromium. Cel: użytkownik ma adblock
(uBlock Origin), strony wykrywają to i zasłaniają treść ścianami „wyłącz
adblocka". Rozszerzenie oszukuje te detektory — strona myśli, że adblocka nie
ma, więc nie zasłania treści. Reklamy nadal blokuje uBlock.

Repozytorium: `Bonaventura-EW/adblock`, branch główny: `main`.

### Zasady pracy z gałęziami (lekcja z porządków przy v6.10/6.11)

- **`main` jest jedynym źródłem prawdy** — zawiera pełną, liniową historię wersji.
- Nową pracę ZAWSZE zaczynaj od aktualnego `origin/main` (`git fetch origin main`
  najpierw!). W przeszłości równoległe sesje tworzyły gałęzie od przestarzałych
  baz → zdublowane numery wersji (dwa różne „v6.4"–„v6.6") i rozjazd historii.
- Po scaleniu do `main` usuń gałąź roboczą. Nie zostawiaj osieroconych gałęzi.
- Zainstalowaną u użytkownika wersję potwierdza `window.__adblockSpoof` w konsoli
  lub badge wersji w popupie.

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
                     + badge wersji (z chrome.runtime.getManifest().version)
rules/rules.json     7 reguł declarativeNetRequest (redirect ad-check → fake JSON, GPT)
fake-scripts/        oryginalne skrypty Google (gpt.js 112KB, pubads_impl.js 596KB)
icons/               16/32/48/128px PNG (neonowe zielone koło + żółty bolt)
scripts/lint.mjs     walidacja składni + JSON + zakresu (npm run lint)
scripts/build-zip.mjs budowa paczki instalacyjnej (npm run build)
package.json         "lint" + "build"
CHANGELOG.md         pełna historia wersji (CO i DLACZEGO)
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
- **`__INIT_CONFIG__` intercept**: pasywny setter; wykrycie = `markWall()`.
  `randvar` (losowa nazwa funkcji wywoływanej inline po każdym slocie) dostaje
  stabilny wrapper, który wymusza `args[2]=false` (hasAdblock/withPlaceholder)
  i **kolejkuje wywołania sprzed przypisania prawdziwej funkcji**, odtwarzając
  je po przypisaniu (v6.11) — bez kolejki pierwszy slot (zdjęcie wiodące)
  trafiał w no-op i obraz zostawał biały. NIE robić z randvar czystego no-opa —
  sloty (tekst i obrazki) nigdy by się nie odsłoniły (lekcja z v6.2).
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
- `revealMainMedia()` + `installMediaReveal()` (v6.4–6.5, zawężone w v6.10) — WP
  czasem chowa GŁÓWNE zdjęcie (hero) wstrzykując na `<img class="wp-media-image">`
  inline `display:none!important` i potrafi je schować PONOWNIE po naszym
  odsłonięciu, więc trzymamy trwały MutationObserver re-odsłaniający. Obserwator
  jest podpięty TYLKO pod kontenery `MEDIA_CONTAINER` (małe `<figure>` itp.) —
  NIGDY pod całe `body` z `attributes:true` (przyczyna wycieku RAM, patrz niżej).
  Odkrywamy tylko **załadowane** zdjęcia (`complete && naturalWidth>0`);
  niezaładowane lazy-obrazki zostawiamy loaderowi, nie ruszamy reklam.
- `removeMarkerOverlays()` (v6.11) — ściany toolkitspro (np. fxmag.pl) mają klasy
  haszowane per-dzień; stała jest tylko ikona `adblock_new_icon`. Od niej
  wspinamy się do nakładki `position:fixed` z `z-index≥1000` i usuwamy ją całą.

### Budżet wydajności i pamięci (v6.10) — NIE COFAĆ tych zasad

Na portalach WP `window.WP` włącza warstwę ciężką od razu, a DOM mutuje tam
bez przerwy — bez limitów rozszerzenie zjadało RAM do absurdalnych rozmiarów
(zgłoszenie użytkownika przy v6.9). Obowiązujące zasady:

- `runHeavy()` wyłącznie przez dławik `runHeavyThrottled()` — max 1 przebieg/s.
- Główny MutationObserver żyje 3 minuty; potem wolny tick rezerwowy co 15 s
  (tylko `visibilityState === 'visible'`). Detekcję po tym czasie zapewniają
  przechwyty zdarzeniowe (WP, `__INIT_CONFIG__`, Piano, script killer).
- `textMatchesSignature()` pomija elementy o >1500 potomków PRZED odczytem
  `textContent` (odczyt na root React = sklejenie całego tekstu strony w string).
- Style wstrzykiwane idempotentnie (nie przebudowywać `<style>` bez zmiany treści).
- Skany po dzieciach kontenerów zamiast `querySelectorAll` po całych poddrzewach.
- Nowe MutationObservery: zawsze z ograniczonym zakresem (konkretne elementy,
  nie `body` z `subtree+attributes`) albo z ograniczonym czasem życia.

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
- **Ściana w playerze wideo WP** („Wyłącz AdBlocka, aby obejrzeć materiał") —
  NIEOBSŁUGIWANA, świadomie (v6.6–6.9). Decyzję podejmuje `window.WP.crux.sealed()`
  spięty z potokiem impresji reklamowych; wszystkie punkty zaczepienia są
  zamknięte w closure modułów webpacka, `crux` jest `Object.frozen`, a
  `WP.crux` non-configurable. Bez wpuszczenia reklam nie da się tego wiarygodnie
  oszukać — próby (mock IMA, poller crux) wycofano w v6.9. Szczegóły w
  CHANGELOG v6.6–v6.9. Nie podejmuj kolejnych prób bez nowych ustaleń.
- **Shadow DOM** — część nowoczesnych ścian renderuje się w shadow root,
  niewidoczna dla querySelectorAll. Nieobsługiwane (przyszłe ulepszenie).
- Rozszerzenie działa tylko na `http://` i `https://`. Strony spoza listy nie
  wychodzą na `excludeMatches` — wyłączanie działa tylko dla znanych wzorców.

## Wersjonowanie i paczki ZIP

- Numer wersji: `manifest.json` → `version`, nagłówek `content.js`.
- Pliki ZIP do instalacji manualnej w Vivaldi: `adblock-vivaldi-vX.Y.zip`
  (X.Y = numer wersji, np. `adblock-vivaldi-v6.0.zip`).
- ZIP zawiera tylko pliki potrzebne do zainstalowania rozszerzenia (bez
  `scripts/`, `README.md`, `package.json`, `CLAUDE.md`, `CHANGELOG.md`,
  `_metadata/`).

### OBOWIĄZKOWY proces po KAŻDEJ zmianie (polityka użytkownika)

Po każdej zmianie w kodzie rozszerzenia, ZAWSZE w tej kolejności:

1. **Podbij wersję** w `manifest.json` (`version`) i w nagłówku `content.js`.
2. **Dopisz wpis do `CHANGELOG.md`** (na górze, format jak istniejące wpisy:
   `## vX.Y (RRRR-MM-DD)`, sekcje Nowe/Poprawki/itd.) — opis CO i DLACZEGO,
   żeby zachować pełną historię na przyszłość.
3. `npm run lint` — walidacja.
4. **`npm run build`** — buduje `adblock-vivaldi-v<wersja>.zip` (skrypt
   `scripts/build-zip.mjs`; czyta wersję z `manifest.json`, pakuje tylko pliki
   rozszerzenia, usuwa stare paczki `adblock-vivaldi-*.zip`).
5. **Wystaw gotowy ZIP użytkownikowi do pobrania** (narzędzie wysyłki plików),
   żeby mógł go od razu zainstalować w przeglądarce.
6. Commit + push (gałąź wg ustaleń; domyślnie `main`).

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
