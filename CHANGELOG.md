# Changelog

## v6.14 (2026-07-25)

### Naprawione
- **Przełączniki w popupie nie reagowały na kliknięcie — PRAWDZIWA przyczyna.**
  W `popup.html` widoczna „pigułka" przełącznika była `<span class="slider">`,
  a nie `<label for="…">`. Sam `<input type="checkbox">` jest niewidoczny
  (`opacity:0; width:0; height:0`), a slider leży NA nim (`position:absolute;
  inset:0`) — więc `<span>` połykał kliknięcie i nie dochodziło ono do
  checkboxa. Klikalny był wyłącznie **opis tekstowy** po lewej (ten miał
  `<label for>`). To wyjaśnia zgłoszenie „raz działają, raz nie": trafienie w
  tekst działało, trafienie w przełącznik nie.
  - Slider zamieniony na `<label class="slider" for="domainToggle|urlToggle">`.
  - `.row label` zawężone do `.row > label`, żeby reguła opisu nie łapała
    slidera (też jest `<label>`, ale wewnątrz `.switch`).
  - Dodany stan wizualny dla wyłączonego przełącznika
    (`input:disabled + .slider` — przygaszony, `cursor:not-allowed`).
  - W CSS komentarz „NIE zamieniać na `<span>`", żeby błąd nie wrócił.
- Zweryfikowane w Chromium (klik myszą w realny popup): przed poprawką klik w
  pigułkę → 0 zdarzeń `change`, storage pusty, brak przeładowania karty; po
  poprawce → stan zapisany i karta odświeżona. Testy regresji: układ graficzny
  bez zmian (38×22 px), klik w tekst = dokładnie 1 przełączenie (bez
  podwójnego), powrót do „włączone" działa, drugi przełącznik też.

### Uwagi
- Naprawa z v6.13 (serializacja rejestracji + atomowy `updateContentScripts`)
  była potrzebna i zostaje — ale sama nie mogła pomóc, bo problemem był
  niedostępny klikalnie element UI. Dopiero v6.13 + v6.14 dają działający
  przełącznik.

## v6.13 (2026-07-25)

### Naprawione
- **Przełączniki w popupie „raz działały, raz nie".** Rejestracja skryptów w
  `background.js` (`unregister`+`register`) bywała wyścigowa: dwa równoległe
  przebiegi (szybkie przełączenie obu switchy albo `storage.onChanged` +
  żądanie z popupu) rzucały „Duplicate/Nonexistent script ID"; błąd łykał
  `catch`, więc zmiana wykluczeń po cichu się nie zapisywała. Dodatkowo service
  worker (MV3) mógł zginąć MIĘDZY `unregister` a `register`, zostawiając stronę
  bez spoofu.
  - **Serializacja** — `_applyChain`: kolejne rejestracje czekają na poprzednie
    (koniec wyścigu).
  - **Atomowa aktualizacja** — istniejące skrypty zmieniamy przez
    `updateContentScripts` (jedno wywołanie), a nie `unregister`+`register` →
    brak okna, w którym SW może zginąć „w połowie".
  - **Natychmiastowy efekt** — popup po zmianie wysyła `reapply-registration`,
    czeka na potwierdzenie SW i dopiero wtedy odświeża kartę (bez ręcznego F5);
    popup zostaje otwarty, więc można przełączyć oba switche.
  - Zweryfikowane testem (mock `chrome.scripting`): 5 równoległych rejestracji →
    0 błędów; stary kod w tym samym scenariuszu → 4 błędy.

### Proces
- **CLAUDE.md**: dodana zasada „przeczytaj `CHANGELOG.md` PRZED zmianami i
  zaktualizuj go PO każdej zmianie" (na samej górze, do czytania w pierwszej
  kolejności).

## v6.12 (2026-07-25)

### Naprawione
- **fxmag.pl** — ściana „Nie widzisz tej strony, bo blokujesz reklamy" wracała
  po ~20 s. Strona przeszła na bibliotekę
  [`just-detect-adblock`](https://github.com/wmcmurray/just-detect-adblock)
  (webpack moduł `20228`). Dla Vivaldi/Chromium (nie Brave, nie Opera) cała
  detekcja to test „przynęty" `o()`, którego dotąd nie pokonywaliśmy w całości:
  - sprawdza **geometrię** wstrzykniętego `<div>` z klasami reklam
    (`offsetParent`, `offsetHeight`, `offsetWidth`, `offsetTop`, `offsetLeft`,
    `clientHeight`, `clientWidth`) — gdy uBlock ukryje przynętę, wszystkie `0`/`null`,
  - sprawdza `getComputedStyle` przez **metodę** `getPropertyValue("display")`
    (poprzedni spoof obsługiwał tylko dostęp przez właściwość `.display`).
- **Fix (blok „BAIT SPOOF" w content.js):**
  - `patchGeom()` — gettery na `HTMLElement`/`Element.prototype`; dla przynęt
    zwraca wartość niezerową, gdy realna wyszła `0`/`null`. Dla innych elementów:
    oryginał (zero efektów ubocznych, potwierdzone testem w Chromium).
  - Proxy `getComputedStyle` obsługuje teraz również `getPropertyValue()`
    (`display`/`visibility`/`opacity`/`height`/`width`).
  - Wspólny `isBaitEl()` rozpoznaje przynętę po klasach/id reklam.
- Efekt: `o()` → `false` → `detectAnyAdblocker()` → `false` → React nie renderuje
  ściany (blokada u źródła). Zweryfikowane oryginalną funkcją `o()` z biblioteki:
  bez fiksa `detected=true`, z fiksem `detected=false`. Działa obok
  `removeMarkerOverlays()` z v6.11 (obrona w głąb — gdyby ściana jednak powstała).

## v6.11 (2026-07-11)

### Nowe (scalenie osieroconych gałęzi — porządek w repozytorium)
Repozytorium miało kilka równoległych gałęzi z różnych sesji; wartościowe,
niescalone zmiany zostały włączone tutaj, reszta (zdublowane rozwiązania tych
samych błędów) wycofana. Gałęzie robocze po scaleniu usunięte.

- **`randvar` z kolejką wczesnych wywołań** (z gałęzi `peaceful-hypatia`):
  dotychczas wywołania `window[randvar](...)` sprzed przypisania prawdziwej
  funkcji trafiały w no-op i ginęły — to była PRZYCZYNA białego zdjęcia
  wiodącego (pierwszy slot odpala się najwcześniej). Teraz wrapper kolejkuje
  wczesne wywołania i odtwarza je (z `hasAdblock=false`) zaraz po przypisaniu
  funkcji przez stronę. Uzupełnia się z `installMediaReveal` (v6.5), które
  zostaje jako siatka bezpieczeństwa.
- **Dodatkowe klucze screeningowe WP**: `slot3`, `slot75`, `slot501`
  (`*ScreeningWallpaper`) — z gałęzi `peaceful-hypatia`.
- **toolkitspro adblock (np. fxmag.pl)** (z gałęzi `youthful-darwin`): klasy
  modala są haszowane per-dzień (SHA256), stała jest tylko ikona
  `adblock_new_icon`. Nowe `removeMarkerOverlays()` w warstwie ciężkiej:
  od ikony wspina się do nakładki `position:fixed` z wysokim z-index i usuwa
  ją całą. Dodany selektor `[class*="adblock_new_icon"]` w `WALL_SELECTORS`
  i sygnatura `'korzystajac z adblocka'` (wariant bez ogonków).
  Działa obok neutralizacji detekcji fxmag z v6.3 (obrona w głąb).

### Świadomie NIE scalono
- Agresywny CSS wymiarujący zdjęcia main-media (`width/height:100%` na
  wszystkich `img`/`picture` w kontenerach) z `peaceful-hypatia` — ryzyko
  psucia layoutu; problem rozwiązuje precyzyjniejsze `installMediaReveal`
  (v6.5) + kolejka `randvar` (wyżej).
- Fix ikon z `youthful-darwin` — nieaktualny (ikony podmienione w main
  na prawdziwe PNG już wcześniej).

---

## v6.10 (2026-07-11)

### Poprawki
- **Lawinowy wzrost RAM na portalach WP (wiadomosci.wp.pl itd.)**: dwa źródła,
  oba naprawione.
  1. Na stronach WP `window.WP` włącza warstwę ciężką od razu, a główny
     MutationObserver odpalał pełny skan strony (`runHeavy`) przy każdej mutacji
     DOM — do 5×/s, bez końca, bo portal WP mutuje DOM non-stop:
     - `runHeavy` z dławikiem: maksymalnie raz na sekundę.
     - Główny MutationObserver odłącza się po 3 minutach; potem wolny tick
       rezerwowy co 15 s (tylko na widocznej karcie). Detekcję zdarzeniową
       dalej zapewniają przechwyty `window.WP`, `__INIT_CONFIG__`, Piano
       i script killer.
     - `textMatchesSignature` pomija ogromne kontenery (>1500 elementów) PRZED
       czytaniem `textContent` — wcześniej każdy skan sklejał cały tekst strony
       (root aplikacji React) w nowy string → setki MB śmieci GC na minutę.
     - `applyWPScreeningCSS` nie przebudowuje elementu `<style>`, gdy treść
       się nie zmieniła.
     - `removeAdblockPopups`: skan tylko bezpośrednich dzieci kontenerów
       artykułu zamiast `querySelectorAll('div, section')` per kontener
       (było O(n²)).
     - `revealArticleContent`: najpierw tani warunek na styl inline, dopiero
       potem `getComputedStyle` (mniej wymuszonych reflow).
     - Getter `randvar` zwraca zcache'owany wrapper zamiast tworzyć nową
       funkcję przy każdym odczycie.
  2. Trwały obserwator zdjęć z v6.5 (`installMediaReveal`) nasłuchiwał zmian
     `style`/`class` na **całym** `body` (subtree) — React na WP przełącza
     klasy bez przerwy, więc przeglądarka bez końca alokowała MutationRecordy
     dla całej strony. Teraz obserwuje wyłącznie poddrzewa kontenerów
     medialnych (`MEDIA_CONTAINER`, małe `<figure>` itp.); nowe kontenery
     dopinane przy przebiegach warstwy ciężkiej i ticku rezerwowym.

### Uwagi
- Numeracja: fix pamięci powstał pierwotnie jako „v6.4" na bazie starej gałęzi
  v6.3; tutaj scalony z główną linią v6.4–v6.9 (hero, badge wersji, wycofany
  kod wideo) — ta wersja zawiera obie linie zmian.

---

## v6.9 (2026-07-05)

### Usunięte
- **Wycofano eksperymentalny kod anty-ściany playera wideo WP** (mock Google IMA
  `installVideoImaSpoof()` z v6.6 + poller `installCruxUnseal()` z v6.7) oraz
  **logi diagnostyczne** `console.info('[adblock-spoof] …')`. Reverse-engineering
  wykazał, że ściana w playerze wideo WP („Wyłącz AdBlocka, aby obejrzeć materiał")
  jest **utwardzonym antyadblockiem spiętym z potokiem impresji reklamowych**:
  - decyzję podejmuje `window.WP.crux.sealed()` — czyta na żywo stan detekcji
    (moduł 6167), który detektor oparty na licznikach impresji (`WPvimpbd`,
    moduł 11167) ustawia na „adblock", gdy reklamy nie renderują impresji;
  - wszystkie punkty zaczepienia (setter stanu, escape-hatch `4367.z`) są zamknięte
    w closure modułów webpacka — nieosiągalne z content scriptu;
  - wyjście jest utwardzone: obiekt `crux` jest `Object.frozen`, a właściwość
    `WP.crux` non-configurable/non-writable (potwierdzone testami w konsoli).
  - To wykracza poza technikę rozszerzenia (podobnie jak paywalle serwerowe) —
    bez wpuszczenia reklam lub przepisania playera nie da się tego wiarygodnie
    oszukać. Ściany artykułowe działają bez zmian.

## v6.8 (2026-07-05)

### Nowe
- **Numer wersji w popupie**: w nagłówku popupu (obok tytułu) pokazujemy badge
  `v<wersja>` pobierany z `chrome.runtime.getManifest().version` — zawsze zgodny
  z faktycznie zainstalowanym buildem, żeby było wiadomo, której wersji się używa.

### Uwagi
- **Licznik „Usunięte ściany" — potwierdzenie działania**: licznik inkrementuje
  się tylko wtedy, gdy warstwa ciężka faktycznie usuwa element ściany z DOM
  (`el.remove()` w `removeAdblockPopups()`/`cleanGeneric()`); sygnał idzie
  MAIN → `bridge.js` (ISOLATED) → `background.js` → `storage.local.removedCount`.
  Uwaga: licznik jest globalny (sumuje po wszystkich stronach) i NIE liczy ściany
  w playerze wideo (ta jest obsługiwana przez crux/IMA, bez usuwania elementu).
- Ściana w playerze wideo WP nadal w diagnostyce (patrz v6.6/v6.7) — logi
  `[adblock-spoof]` w konsoli mają wskazać, którą ścieżką idzie player.

## v6.7 (2026-07-05)

### Poprawki
- **Odtwarzacz wideo WP — właściwy fix przez `window.WP.crux.sealed()`**: sam mock
  IMA z v6.6 nie wystarczył. Diagnostyka na żywej stronie pokazała, że player
  **nie idzie ścieżką IMA** dla tej ściany — do `<video>` wstawia wbudowaną atrapę
  `staticVideoMp4` (40 ms pustego MP4), a widoczna plansza „Wyłącz AdBlocka" to
  **poster** wideo (obraz z `crux.mess()`), nie tekst w DOM. To kreacja „blockade"
  z wewnętrznego waterfalla reklam.
  - **Sedno**: w kodzie playera `canSkipAd() === !window.WP.crux.sealed() ||
    isRadio() || isLive()`, a KAŻDA gałąź nieudanego pobrania reklamy robi
    `canSkipAd() ? resume()/end() (gra właściwa treść) : blockade/onAdBlock
    (ściana)`. `sealed()===true` oznacza „treść zapieczętowana, bo wykryto
    adblocka".
  - **Rozwiązanie** (`content.js` → `installCruxUnseal()`): zmuszamy
    `window.WP.crux.sealed()` do zwracania `false` → `canSkipAd()` zawsze `true`
    → po reklamie zablokowanej przez uBlock player przechodzi prosto do wideo
    zamiast serwować „blockade". `sealed()` jest używane wyłącznie w `canSkipAd()`,
    więc nadpisanie niczego innego nie rusza — `mess`/`unmess` (deobfuskacja
    URL-i treści) zostają nietknięte. `crux` to obiekt first-party osiągalny z
    MAIN world; dopinamy się pollingiem, bo `WP.crux` pojawia się z opóźnieniem.
  - Mock IMA z v6.6 zostaje jako zabezpieczenie ścieżki IMA (gdyby była użyta).
  - **Logi diagnostyczne**: tymczasowo dodane `console.info('[adblock-spoof] …')`
    przy przechwyceniu IMA i odpieczętowaniu crux — do potwierdzenia, którą
    ścieżką idzie player. Zostaną usunięte, gdy potwierdzimy, że działa.

## v6.6 (2026-07-05)

### Nowe
- **Odtwarzacz wideo WP — spoof pre-rolla (Google IMA)**: na stronach WP
  (np. `wiadomosci.wp.pl`) w odtwarzaczu wideo pojawiała się ściana „Wyłącz
  AdBlocka, aby obejrzeć materiał" zamiast filmu. To osobny mechanizm od ściany
  na treści artykułu — realizuje go player `std.wpcdn.pl/player/wpjslib_player.js`.
  - **Przyczyna**: player przed puszczeniem filmu odtwarza pre-roll reklamowy
    przez Google IMA SDK (`imasdk.googleapis.com/js/sdkloader/ima3.js` + tag
    VAST). uBlock blokuje ima3.js oraz tagi reklam → nieudane pobranie reklamy
    player interpretuje jako adblock i renderuje kreację `blockade` (ścianę)
    zamiast wideo.
  - **Rozwiązanie** (`content.js` → `installVideoImaSpoof()`): podstawiamy własny,
    kompletny `window.google.ima`. `AdsLoader.requestAds()` asynchronicznie
    zgłasza `ADS_MANAGER_LOADED`, a `AdsManager.start()` natychmiast emituje
    `ALL_ADS_COMPLETED` (zero reklam). Z analizy kodu playera: w ścieżce IMA
    ścianę wywołuje wyłącznie `AD_ERROR` na AdsManagerze (→ `onAdBlock(13)`);
    zarówno `ALL_ADS_COMPLETED`, jak i błąd samego `AdsLoadera` kończą się
    `resume()` → film gra. Nigdy nie emitujemy `AD_ERROR` na managerze, więc
    ściana nie powstaje, a player przechodzi prosto do treści wideo.
  - Dodatkowo neutralizujemy sam `<script src=…ima3.js>` (onerror→no-op + ręczne
    `onload`), bo błąd jego ładowania też prowadzi do `onAdBlock(13)`.
  - Mock instalowany **leniwie** — dopiero gdy strona faktycznie wstrzykuje loader
    IMA — więc na zwykłych stronach niczego nie dotyka. Reklamy nadal blokuje
    uBlock; tu jedynie sprawiamy, że player traktuje pre-roll jako „odtworzony".
  - Uwaga: jeśli dana strona serwuje sam strumień wideo dopiero po handshake
    reklamowym po stronie serwera, mock może nie wystarczyć — wymaga testu w
    przeglądarce (`window.__adblockSpoof === "6.6"` potwierdza aktywny build).

## v6.5 (2026-06-07)

### Poprawki
- **wp.pl — hero nadal znikał (dokończenie fixu z v6.4)**: jednorazowe odsłonięcie
  z v6.4 nie wystarczało — framework WP **ponownie** ustawia `display:none!important`
  inline na `<img>` PO naszym odsłonięciu, a nasze odkrywanie kończyło się po ~30 s
  (ticki). Teraz trzymamy **trwały `MutationObserver`** (`installMediaReveal()`),
  który nasłuchuje zmian atrybutu `style`/`class` oraz nowych węzłów i re-odsłania
  główne zdjęcie za każdym razem, gdy zostanie znów schowane. Inline `!important`
  da się nadpisać tylko inline'em, więc robimy to przez `style.setProperty(...,'important')`.
  - Zakres bez zmian: tylko **załadowane** zdjęcia (`complete && naturalWidth>0`)
    w kontenerach treści (`[data-mainmedia-photo]`, `.article-img-placeholder`,
    `article/main figure`). Niezaładowane lazy-obrazki i reklamy nietknięte.
  - Reakcja punktowa (na konkretnym `<img>`, nie pełny re-scan) → tanie.

### Nowe
- **Znacznik wersji** `window.__adblockSpoof` (np. `"6.5"`) — do szybkiego
  potwierdzenia w konsoli, że aktywny jest właściwy build rozszerzenia.

---

## v6.4 (2026-06-07)

### Poprawki
- **wp.pl — brak pierwszego/głównego zdjęcia (hero)**: framework WP na niektórych
  artykułach chowa główne zdjęcie wstrzykując **inline** na `<img class="wp-media-image">`
  styl `display:none!important` (obok `width/height:100%;object-fit:cover`). Zdjęcie
  jest w pełni załadowane (`complete`, `naturalWidth>0`), ale stan „odsłoń" nie
  wraca przy aktywnym adblocku → zostaje pusty box i „znika" grafika. To **inny
  mechanizm niż `randvar`** i niż screening-CSS (zdiagnozowane na żywo w DevTools:
  cały łańcuch przodków `visible`, sam `<img>` `display:none` inline).
  - Nowa funkcja `revealMainMedia()` w warstwie ciężkiej: odkrywa **tylko
    załadowane** zdjęcia (`complete && naturalWidth>0`) w kontenerach treści
    (`[data-mainmedia-photo]`, `.article-img-placeholder`, `article/main figure`,
    `article img.wp-media-image`). Niezaładowane lazy-obrazki zostawia loaderowi,
    nie rusza reklam.

### Dokumentacja / build
- Dodano `scripts/build-zip.mjs` + `npm run build` — buduje
  `adblock-vivaldi-v<wersja>.zip` (wersja z `manifest.json`), pakuje tylko pliki
  rozszerzenia, usuwa stare paczki. **Polityka: po każdej zmianie podbić wersję,
  dopisać do tego changeloga i przebudować ZIP.**

### Sprostowanie
- Wpis v6.2 opisywał sygnaturę `randvar` jako `(el, slot, hasAdblock)`. W rzeczywistości
  to `(element, slot, withPlaceholder, placeholder, options)` — **nie ma parametru
  `hasAdblock`**; gałąź chowająca slot jest serwerowo szablonowana (`if(<bool>){…display='none'}`)
  i zależy od `withPlaceholder`. Nasz wrapper wymusza `args[2]=false` (czyli
  `withPlaceholder=false`), co pomija `registerPlaceholder` i ewentualne ukrycie
  slotu — działa obronnie, ale opis w v6.2 był nieścisły.

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
