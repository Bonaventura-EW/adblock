# Universal Adblock Spoof — CLAUDE.md

## Co to jest

Rozszerzenie MV3 (Manifest V3) do Vivaldi/Chromium. Cel: użytkownik ma adblock
(uBlock Origin), strony wykrywają to i zasłaniają treść ścianami „wyłącz
adblocka". Rozszerzenie oszukuje te detektory — strona myśli, że adblocka nie
ma, więc nie zasłania treści. Reklamy nadal blokuje uBlock.

Repozytorium: `Bonaventura-EW/adblock`, branch główny: `main`.

### ⚠️ Zasada: CHANGELOG (CZYTAJ NAJPIERW)

- **PRZED jakąkolwiek zmianą — przeczytaj `CHANGELOG.md`.** Mówi, na jakiej
  wersji realnie jesteś i co ostatnio zmieniono. Chroni przed pracą na
  przestarzałym stanie i błędną numeracją.
- **PO każdej zmianie — zaktualizuj `CHANGELOG.md`**: nowy wpis na górze (numer
  `6.X`, data, „co i dlaczego"). Numer podbij SPÓJNIE w: `manifest.json` →
  `version`, nagłówku `content.js`, markerze `window.__adblockSpoof` w
  `content.js`. Zip zbuduj `npm run build` (nazwa bierze wersję z manifestu).
- **Zmiana poza rozszerzeniem** (testy, dokumentacja, narzędzia — ZIP się nie
  zmienia): wpis w `CHANGELOG.md` jako `## Repozytorium (RRRR-MM-DD) — bez
  nowej wersji rozszerzenia`, bez podbijania numeru i bez nowego ZIP-a.

### ⚠️ Zasada: SPRAWY.md — rejestr spraw (decyzja użytkownika, 2026-10-27)

- **Na starcie sesji przeczytaj `SPRAWY.md`** (razem z `CHANGELOG.md`): co jest
  otwarte, na co czekamy (potwierdzenie użytkownika, odpowiedź na pytanie).
- **Każde zgłoszenie, prośbę, ustalenie z dochodzenia i pytanie bez odpowiedzi
  dopisz od razu** jako nową sprawę `S-NN` — także takie, które nie kończą się
  zmianą w kodzie.
- **Nic nie kasuj.** Postęp dopisuj w „Stan" z datą. Rozwiązaną sprawę
  przenieś do „Rozwiązane" z dopiskiem `✅ Rozwiązane: vX.Y (data)` — jak i
  czym potwierdzone. Poprawka wydana, ale niepotwierdzona przez użytkownika =
  „Stan: czeka na potwierdzenie", sprawa zostaje otwarta.
- Kiedy użytkownik przyśle raport albo potwierdzenie — zaktualizuj sprawę.

### ⚠️ Zasada: testy (`npm test`, tests/README.md)

- **`npm test` przed każdym pushem** — 15 testów regresji (ok. 3 min, bez
  sieci). Każdy pilnuje konkretnej poprawki; czerwony = cofnięta poprawka.
- **Nowy błąd → najpierw odtwórz go** stroną w `tests/site/` i testem w
  `tests/cases/` (ma być czerwony na starej wersji), potem popraw kod. Dopisz
  test do tabeli w `tests/README.md` i podaj go w sprawie w `SPRAWY.md`.
- Starą wersję sprawdzisz przez `SPOOF_EXT=/rozpakowany/zip npm test -- słowo`.

### Zasady pracy z gałęziami (lekcja z porządków przy v6.10/6.11)

- **`main` jest jedynym źródłem prawdy** — zawiera pełną, liniową historię wersji.
- Nową pracę ZAWSZE zaczynaj od aktualnego `origin/main` (`git fetch origin main`
  najpierw!). W przeszłości równoległe sesje tworzyły gałęzie od przestarzałych
  baz → zdublowane numery wersji (dwa różne „v6.4"–„v6.6") i rozjazd historii.
- **ZAWSZE WSZYSTKO WYPYCHAJ NA `main`** (decyzja użytkownika, zastępuje
  wcześniejsze „pytaj przed pushem"). Każda skończona zmiana (zwalidowana,
  z wpisem w CHANGELOG) trafia na `main` bez dodatkowego pytania. Jeśli sesja
  dostała własną gałąź roboczą, scal ją do `main` (lub zrób commit wprost na
  `main` od aktualnego `origin/main`) i wypchnij `main`. Nie zostawiaj pracy
  tylko na gałęzi pobocznej.
- **Gotowy plik rozszerzenia (ZIP) buduj WYŁĄCZNIE z `main`** — po wypchnięciu,
  z aktualnego stanu `origin/main` (`npm run build`). Nigdy nie dawaj
  użytkownikowi ZIP-a zbudowanego z gałęzi pobocznej: tak powstały „v6.4–v6.8"
  z innym kodem niż `main` i użytkownik tracił poprawki z głównej linii.
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
manifest.json        MV3, host_permissions: *://*/*, permissions: scripting, storage,
                     declarativeNetRequest, debugger (pomiar RAM), alarms
content.js           rdzeń, world: MAIN, document_start, allFrames
background.js        service worker: dynamiczna rejestracja skryptów, licznik,
                     pomiar RAM kart (chrome.debugger), czerwona ikona, auto-pomiar
bridge.js            world: ISOLATED — przekazuje postMessage → chrome.runtime
                     (licznik ścian, prośba o arkusz odsłaniający zdjęcie)
memcheck.js          progi i powody „dużo pamięci" (wspólne: monitor, popup, SW)
monitor.js           world: ISOLATED, tylko główna ramka, document_idle —
                     co 30 s tanie wskaźniki pamięci karty
diag.html            strona startowa karty diagnozy (proces rozszerzenia)
popup.html/popup.js  UI: toggle per domena/adres + licznik usuniętych ścian
                     + badge wersji (z chrome.runtime.getManifest().version)
                     + sekcja „Pamięć tej karty" (RAM, powody, raport)
rules/rules.json     7 reguł declarativeNetRequest (redirect ad-check → fake JSON, GPT)
fake-scripts/        oryginalne skrypty Google (gpt.js 112KB, pubads_impl.js 596KB)
icons/               16/32/48/128px PNG (neonowe zielone koło + żółty bolt)
                     + icon*-red.png (czerwone koło — karta zużywa dużo RAM-u)
scripts/lint.mjs     walidacja składni + JSON + zakresu (npm run lint)
scripts/build-zip.mjs budowa paczki instalacyjnej (npm run build)
scripts/extension-files.mjs  lista plików rozszerzenia (ZIP i testy — jedno źródło)
tests/               testy regresji (npm test): lib.cjs, run.cjs, cases/, site/,
                     tools/wp-bench.cjs (RAM na prawdziwej stronie, z siecią)
package.json         "lint" + "build" + "test"
CHANGELOG.md         pełna historia wersji (CO i DLACZEGO)
SPRAWY.md            rejestr spraw: zgłoszenia, ustalenia, otwarte pytania, stan
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
buduje `excludeMatches` i aktualizuje content.js + bridge.js + monitor dynamicznie
przez `chrome.scripting`. Odpalane przy `onInstalled`, `onStartup`,
`storage.onChanged` oraz na żądanie z popupu (`reapply-registration`).

- Wzorce adresów używają `hostname` (bez portu — `*://host:port/` Chromium
  odrzuca „Invalid port" i wtedy cała rejestracja się nie udaje) oraz wariantu
  `ścieżka?*`, bo ścieżka we wzorcu obejmuje też query (v6.15).
- Wyłączone domeny dostają dynamiczną regułę DNR `allow` (id 1000,
  `initiatorDomains`), żeby nie działały na nich przekierowania z `rules.json`
  (v6.15).

**Klikalność przełącznika (v6.14) — NIE COFAĆ:** w `popup.html` „pigułka"
przełącznika MUSI być `<label class="slider" for="…">`. Jako `<span>` przykrywała
niewidoczny (`0×0`, `opacity:0`) `<input type="checkbox">` i połykała kliknięcie —
działał tylko klik w opis tekstowy, stąd wrażenie „raz działa, raz nie". Reguła
opisu jest zawężona do `.row > label`, żeby nie łapała slidera.

**Niezawodność przełączników (v6.13) — NIE COFAĆ:** rejestracja jest
SERIALIZOWANA (`_applyChain` — kolejne wywołania czekają na poprzednie), więc dwa
równoległe przebiegi nie kolidują. Wcześniej `unregister`+`register` w wyścigu
rzucały „Duplicate/Nonexistent script ID" (łykane przez `catch`) → przełącznik
„raz działał, raz nie". Istniejące skrypty AKTUALIZUJEMY atomowym
`updateContentScripts` (nie unregister+register), więc SW nie zginie „w połowie"
i nie zostawi strony bez spoofu. Popup po zmianie wysyła `reapply-registration`,
czeka na potwierdzenie i dopiero odświeża kartę — zmiana działa od razu.

### Pamięć karty: monitor, pomiar RAM, czerwona ikona (v6.15)

Zwykłe API nie dają RAM-u karty: `chrome.processes` jest tylko w kanale Dev, a
`performance.memory` jest zaokrąglane i prawie się nie odświeża. Dlatego:

1. **monitor.js** (zawsze, tanio) — co 30 s: elementy DOM, iframe'y, wideo,
   szacunek zdekodowanych obrazków, żądania per host; historia 120 odczytów.
   Ocena przez `memcheck.js`; do SW idzie tylko **zmiana poziomu**
   (`adblock-spoof-mem-level`).
2. **Pomiar RAM** (`measureTab` w `background.js`) — `chrome.debugger` na ok.
   0,3–0,5 s: `Performance.getMetrics` + `Runtime.getHeapUsage` oraz
   `Tracing.start` (kategorie `disabled-by-default-memory-infra` +
   `disabled-by-default-devtools.timeline`) → `Tracing.requestMemoryDump` →
   `Tracing.end`. Ze zdarzeń `ph:'v'` bierzemy
   `process_totals.private_footprint_bytes` (hex) per pid — ta sama miara co
   Menedżer zadań; procesy karty z `TracingStartedInBrowser.args.data.frames`
   (`processId`; ramka bez `parent` = proces strony). Wynik młodszy niż
   `maxAgeMs` (popup: 20 s) wraca z pamięci SW; równoległe prośby o tę samą
   kartę czekają na jeden pomiar. Przeglądarka pokazuje pasek „debuguje" przez
   kilka sekund (można go ukryć flagą `--silent-debugger-extension-api`).
3. **Ikona i znaczek** — stan per karta w `storage.session` (`tm:<tabId>`:
   `monitorLevel`, `ramMB`, `ramT`), zapisy serializowane per karta
   (`queueTab`). Ikona czerwona (`icons/icon*-red.png`), gdy
   `max(monitorLevel, poziom RAM) ≥ 1` (RAM ≥ 500 MB wg `LIMITS.tabMB`);
   znaczek: MB („620", „1.2G") albo „RAM". `tabs.onUpdated` status `loading`
   resetuje stan i ikonę (wartości per karta nie resetują się same).
4. **Auto-pomiar** — alarm `ram-check` co 5 min mierzy aktywną kartę ostatnio
   aktywnego okna; `tabs.onActivated` + 3 s mierzy kartę, jeśli jej pomiar ma
   > 5 min; limit 1 auto-pomiar/min; wyłączany `storage.local.autoRam = false`.

**Zawieszona karta (v6.18):** pomiar zaczyna od `Runtime.getHeapUsage` z
limitem 2 s (`RENDERER_PROBE_MS`); brak odpowiedzi → `rendererBusy` (wątek
strony zablokowany — wtedy nie odpowiada też monitor ani zrzut pamięci).
Stan karty dostaje `busy: true` → ikona czerwona ze znakiem „!", popup:
poziom „nie odpowiada".

**Diagnoza (v6.19)** — popup „Diagnozuj (30 s)" → `startDiagnosis(url, tabId)`
w `background.js`: nowa karta `diag.html` (strona rozszerzenia, v6.21) W TYM
SAMYM OKNIE obok badanej (`windowId` + `index` — bez tego w Vivaldi karta się
nie otwierała, v6.20), odpowiedź do popupu dopiero po utworzeniu karty;
`chrome.debugger.attach`,
`Debugger.enable` + `setBreakpointsActive(false)` (obce pauzy wznawiamy),
`Tracing.start` z `disabled-by-default-v8.cpu_profiler` (domena `Profiler`
jest NIEDOSTĘPNA dla rozszerzeń), potem nawigacja do adresu. Co 2 s
`Runtime.evaluate('1')` z limitem 1,5 s; brak odpowiedzi → `Debugger.pause` →
stos (`scriptParsed` mapuje `scriptId` → URL dla skryptów inline; `col`, bo
skrypty WP to jedna linia) → `Debugger.resume` i obserwacja dalej (v6.21):
`freezes[]` = przycięcia (moment, czas, ≤ 2 stosy), `hung` = brak odpowiedzi
do końca obserwacji. Profil:
`ProfileChunk` → czas własny per plik/funkcja, tylko procesy wykonujące kod
serwisu albo tego rozszerzenia (`summarizeCpu`). Wynik w `storage.session`
`diagLast` (popup zamyka się przy otwarciu nowej karty) i w raporcie
(`diagnosis`). Na karcie, która już wisi, `Debugger.enable` nie odpowiada —
stąd nowa karta.

**Osobny proces karty diagnozy (v6.21) — NIE COFAĆ:** przeglądarka dokłada
nowe karty serwisu do jego istniejącego procesu, także zawieszonego (u
użytkownika: „Diagnoza przerwana: timeout"). Rozszerzenie NIE zabije
zawieszonego procesu — `tabs.discard`, `tabs.remove` i `Page.crash`
sprawdzone, proces żyje dalej. Dlatego `isolateDiagTab()` dodaje sesyjną
regułę DNR (id = id karty, `tabIds`, `main_frame`+`sub_frame`) z nagłówkiem
`Origin-Agent-Cluster: ?1` → proces przypisany do originu, niezgodny ze starym
procesem serwisu. Reguła znika w `finally`. Start z `diag.html` (proces
rozszerzenia), bo `about:blank` też mógł trafić do zawieszonego procesu.
Test: `--process-per-site` w Chromium odtwarza współdzielenie procesu.

**Przeładowanie (v6.20):** popup porównuje `version` z `manifest.json` na dysku
(fetch) z `chrome.runtime.getManifest().version`; różnica = pliki podmienione
bez „Odśwież" → baner z przyciskiem otwierającym `chrome://extensions/?id=…`
(NIE `chrome.runtime.reload()` — w testach rozszerzenie rozpakowane znikało po
nim zamiast się przeładować). Zrzut pamięci
(`Tracing.requestMemoryDump`) ma limit 3 s — jest globalny, więc jedna
zawieszona karta blokowała pomiar wszystkich.

**Odporność (v6.16) — NIE COFAĆ:** monitor rejestrowany OSOBNO od
content.js/bridge.js (`registerContentScripts` jest atomowe — brak
`monitor.js` blokował cały spoof); `importScripts('memcheck.js')` w `try`
(brak pliku nie może zabić SW); popup sprawdza kompletność instalacji
(`REQUIRED_FILES`) i ma limity czasu na każde czekanie (monitor 3 s, SW 15 s),
przycisk pomiaru wraca w `finally`; raport nie czeka na nowy pomiar.

Popup pyta monitor przez `chrome.tabs.sendMessage` (`adblock-spoof-mem-now`);
monitor prosi wtedy content.js (postMessage `stats-req` → `stats`) o statystyki
warstwy ciężkiej (przebiegi, ms CPU) — ten postMessage leci tylko na żądanie.

**Raport** — popup: „Kopiuj raport" / „Pobierz .json". JSON
`report: 'adblock-spoof-memory'`: `version`, `created`, `userAgent`, `page`
(bez query/hasha), `extensionActiveHere`, `taskManagerMB` (ręcznie, pole
widoczne tylko gdy pomiar RAM zawiedzie), `evaluation`, `precise` (z `tabMB`,
`mainMB`, `subframesMB`, `browserMB`), `sample` (z `heavy`), `first`,
`history`, `limits`, `missingFiles`, `diagnosis` (wynik „Diagnozuj"). Użytkownik wkleja go w rozmowie — tak analizujemy
przypadki „dużo RAM-u".

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
- **Bait spoof** (rozszerzony w v6.12): dla elementów-przynęt (klasy/id `adsbox`,
  `adsbygoogle`, `pub_300x250`, `pub_728x90`) udajemy widoczność dwoma drogami —
  `getComputedStyle` (`display:block`, także przez `getPropertyValue()`) ORAZ
  geometria (`offsetParent/offsetHeight/clientWidth…` niezerowe, gdy uBlock ukrył
  przynętę). Pokonuje biblioteki typu `just-detect-adblock`. Tylko przynęty —
  pozostałe elementy bez zmian.
- **DOM protection**: `Node.removeChild` / `Element.remove` / `innerHTML` setter
  w trybie pass-through dopóki `!wallDetected`; aktywna ochrona `.wp-content-text-raw`.
  **Bezpiecznik pętli (v6.18) — NIE USUWAĆ:** najwyżej 3 odmowy dla tego samego
  węzła w obrębie jednego zadania (`mayRefuse`), potem usunięcie przechodzi.
  Bez tego pętle typu `while (el.firstChild) el.removeChild(el.firstChild)`
  kręciły się w nieskończoność → zawieszona karta, rosnący RAM.
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
  **Bezpiecznik odsłaniania (v6.22) — NIE USUWAĆ:** `mayReveal()` — najwyżej 5
  odsłonięć jednego zdjęcia w 10 s, potem zdjęcie odpuszczone na stałe
  (`heavyStats.revealGaveUp`). Strona pilnująca schowanego zdjęcia własnym
  MutationObserverem robiła z naszym obserwatorem nieskończoną pętlę
  mikrozadań → karta „nie odpowiada", RAM +2 GB/min (wiadomosci.wp.pl).
  Zasada ogólna: każdy obserwator, który ZMIENIA to, co sam obserwuje, musi
  mieć limit liczony w zdarzeniach, nie tylko w czasie.
  **Odsłonięcie bez przepychanki (v6.23):** gdy limit wyczerpie się w < 1 s
  (walka obserwatorów), `revealViaUserCss()` oznacza zdjęcie atrybutem
  `data-adblock-spoof-reveal` i przez bridge.js (`reveal-css`) prosi SW o
  `chrome.scripting.insertCSS({origin:'USER'})` z
  `img[data-adblock-spoof-reveal]{display:block!important;…}`. `!important`
  użytkownika wygrywa z inline `!important` strony, a styl inline zostaje
  „none" → obserwator strony milczy. Max 5 zdjęć/stronę (`revealCss`).
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

### fxmag.pl (v6.12) — Next.js/React, biblioteka `just-detect-adblock`

Strona przeszła na bibliotekę
[`just-detect-adblock`](https://github.com/wmcmurray/just-detect-adblock)
(webpack module `20228`). Ściana pojawia się z ~20-sekundowym opóźnieniem. Dla
Vivaldi/Chromium (nie Brave, nie Opera) cała detekcja to funkcja `o()` — test
„przynęty". Ścieżka XHR do `raw.githubusercontent.com/.../baits/...` odpala się
TYLKO w Brave/Operze, więc dla Vivaldi jest bez znaczenia.

```javascript
function o() {
  if (document.body.getAttribute("abp") !== null) return true;  // Adblock Plus
  var n = document.createElement("div");
  n.className = "pub_300x250 pub_728x90 text-ad textAd adSense adBlock adBanner …";
  n.style = "width:1px; height:1px; position:absolute; left:-10000px; top:-1000px";
  document.body.appendChild(n);
  // (a) GEOMETRIA — uBlock ukrywa przynętę → offsetParent=null, wymiary=0:
  if (n.offsetParent === null || n.offsetHeight == 0 || n.offsetLeft == 0 ||
      n.offsetTop == 0 || n.offsetWidth == 0 || n.clientHeight == 0 || n.clientWidth == 0) return true;
  // (b) STYL — getComputedStyle przez METODĘ getPropertyValue:
  var cs = getComputedStyle(n, null);
  if (cs.getPropertyValue("display") == "none" || cs.getPropertyValue("visibility") == "hidden") return true;
  return false;
}
```

**Nasze neutralizacje (content.js, blok „BAIT SPOOF"):**
- `isBaitEl()` rozpoznaje przynętę po ściśle reklamowych klasach/id
  (`pub_300x250`, `pub_728x90`, `adsbox`, `adsbygoogle`).
- **Geometria** — `patchGeom()` nakłada gettery na `HTMLElement.prototype`
  (`offsetParent/offsetHeight/offsetWidth/offsetTop/offsetLeft`) i
  `Element.prototype` (`clientHeight/clientWidth`). Realną wartość podmienia na
  niezerową TYLKO dla przynęt i TYLKO gdy wyszła `0`/`null`. Dla każdego innego
  elementu zwraca oryginał → zero efektów ubocznych.
- **Styl** — Proxy na `getComputedStyle` zwraca `display:block`/`visibility:visible`
  także przez metodę `getPropertyValue()` (tej formy używa `just-detect-adblock`).
- Efekt: `o()` → `false` → `detectAnyAdblocker()` → `false` → React nigdy nie
  ustawia stanu „wykryto adblock". Blokada U ŹRÓDŁA; `removeMarkerOverlays()`
  (v6.11) zostaje jako obrona w głąb.

Stary `installFxmagNeutraliser` (usuwanie `#stndz-style`, neutralizacja `onerror`
skryptów `pagead`) zostaje — nieszkodliwy, chroni strony wciąż używające
poprzedniej metody.

## Zakres i ograniczenia

- **Niekompatybilne z AdBlockiem (getadblock.com)** — potwierdzone przez
  użytkownika (2026-07): AdBlock 6.43 + spoof na portalach WP = lawinowy wzrost
  RAM karty (AdBlock wycina elementy reklamowe, spoof utrzymuje sloty przy
  życiu → wieczna przepychanka). Wyłączenie AdBlocka usuwa problem. Sama
  wtyczka zmierzona jako czysta (v6.11: heap i RSS płaskie w 4 scenariuszach
  na artykułach wiadomosci.wp.pl, w tym z uBlock Origin Lite). Zalecany
  bloker: uBlock Origin. Przy zgłoszeniu „wtyczka zżera RAM" najpierw pytaj
  o listę innych rozszerzeń. Możliwe mechanizmy (niepotwierdzone z AdBlockiem):
  nieskończona pętla czyszcząca kontener przy ochronie DOM — bezpiecznik w
  v6.18; nieskończona pętla odsłaniania zdjęcia (my odsłaniamy, strona chowa)
  — bezpiecznik w v6.22 (zgłoszenie: tylko wiadomosci.wp.pl, 2 GB/min).
  Zawieszoną kartę popup pokazuje jako „nie odpowiada".
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
   **Zaktualizuj `SPRAWY.md`** — sprawa, której dotyczy zmiana (stan /
   ✅ rozwiązane), nowe ustalenia i pytania.
3. `npm run lint` — walidacja; **`npm test`** — testy regresji (wszystkie
   zielone; nowy błąd = nowy test).
4. **`npm run build`** — na `main` (zaktualizowanym z `origin/main`) buduje
   `adblock-vivaldi-v<wersja>.zip` (skrypt `scripts/build-zip.mjs`; czyta wersję
   z `manifest.json`, pakuje tylko pliki rozszerzenia, usuwa stare paczki
   `adblock-vivaldi-*.zip`).
5. **Commit na `main` i `git push origin main`** — bez pytania (patrz „Zasady
   pracy z gałęziami" wyżej). Gałąź robocza sesji → scal do `main`, wypchnij,
   usuń gałąź.
6. **Wystaw użytkownikowi ZIP z `main`** (narzędzie wysyłki plików) — dopiero
   po udanym pushu, i tylko plik zbudowany z tego samego stanu, który jest na
   `origin/main`.

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
npm run lint   # node --check na .js/.mjs/.cjs + JSON + zakres *://*/*
npm test       # testy regresji w Chromium (Playwright), ok. 3 min — tests/README.md
```
