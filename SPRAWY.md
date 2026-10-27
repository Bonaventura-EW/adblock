# Sprawy — zgłoszenia, ustalenia, otwarte pytania

Rejestr wszystkiego, co wyszło w rozmowach z użytkownikiem: zgłoszenia, prośby,
ustalenia z dochodzeń, pytania bez odpowiedzi, rzeczy do zrobienia.
`CHANGELOG.md` mówi, **co zmieniono w kodzie**. Ten plik mówi, **z jakim
problemem przyszedł użytkownik i czy problem naprawdę zniknął**.

## Zasady prowadzenia

- **Czytaj na starcie każdej sesji**, razem z `CHANGELOG.md`.
- **Każde nowe zgłoszenie, prośba, ustalenie albo pytanie bez odpowiedzi →
  nowa sprawa** z kolejnym numerem (`S-NN`), od razu, nie dopiero po
  naprawie.
- **Nic nie kasujemy.** Postęp dopisujemy w punkcie „Stan" z datą i wersją.
- **Rozwiązana sprawa**: przenieś ją do „Rozwiązane" i dopisz
  `✅ Rozwiązane: vX.Y (RRRR-MM-DD)` — jak, czym potwierdzone (test, raport
  użytkownika). Sprawa jest rozwiązana dopiero po potwierdzeniu. Poprawka
  wydana, ale niepotwierdzona = „Stan: czeka na potwierdzenie".
- **Świadomie nie robimy** → „Zamknięte bez zmian" z powodem.
- Przy sprawie podaj test z `tests/` (jeśli jest), który jej pilnuje.

---

## Otwarte

### S-21: Prawie 600 MB RAM-u na jednym artykule — co to jest?
- **Zgłoszono:** 2026-10-27, v6.23 (zrzut popupu: 582 MB = strona 237 MB +
  ramki w osobnych procesach 345 MB (8); raport: 479 MB = 154 + 325 MB (8),
  sterta JS 24 MB, DOM 14 MB, warstwa ciężka 66–80 ms CPU).
- **Ustalenia (2026-10-27, ten sam artykuł w Chromium, z rozszerzeniem / bez):**
  - bez blokera: 1154–1334 MB, 36–39 procesów — ramki „synchronizacji
    ciasteczek" kilkudziesięciu firm reklamowych, każda w osobnym procesie
    (~25–50 MB);
  - AdBlock 6.50: 350–359 MB = strona + 8 procesów ramek po ~30 MB
    (pubmatic, adnxs, rubiconproject, indexww, casalemedia, openx, criteo,
    visx) — ten sam profil co u użytkownika;
  - uBlock Origin Lite: 105–106 MB, jeden proces;
  - rozszerzenie (spoof) nie zmienia wyniku przy żadnym blokerze (106/105,
    350/359 MB); jego własna praca na stronie to ~70 ms CPU.
  Wniosek: ~60% RAM-u karty to ramki reklam/śledzenia przepuszczane przez
  bloker użytkownika; proces strony (150–240 MB) to sama strona WP.
- **Stan:** 2026-10-27 — v6.24: popup i raport pokazują podział na ramki z
  nazwą serwisu („Ramki z innych serwisów: …"). Czeka na odpowiedź
  użytkownika: jaki bloker (S-17); propozycja — uBlock Origin / uBO Lite
  (artykuł ~105 MB zamiast ~350–580 MB).
- **Stan 2026-10-27:** użytkownik przeszedł na uBlock Origin Lite. Czeka na
  potwierdzenie, że RAM karty spadł. Oczekiwane: brak procesów ramek
  reklamowych, karta ok. 150–250 MB (w Chromium 105 MB; proces strony w
  Vivaldi był większy — 154–237 MB).
- **Test:** `npm test -- "podział RAM"`.

### S-04: AdBlock (getadblock) + spoof = lawinowy RAM na portalach WP
- **Zgłoszono:** 2026-07, AdBlock 6.43 (potwierdzone przez użytkownika: po
  wyłączeniu AdBlocka problem znikał).
- **Ustalenia:** wtedy uznane za niekompatybilność („przepychanka" o sloty
  reklamowe). Mechanizm mógł być ten sam co w S-15 (pętla odsłaniania
  zdjęcia) albo pętla ochrony DOM (v6.18). W teście 2026-10-26 (AdBlock 6.50
  + v6.21, Chromium) pętli nie było.
- **Stan:** do ponownego sprawdzenia po v6.22 — czy AdBlock nadal jest
  niekompatybilny. Do tego czasu w README/CLAUDE.md zostaje ostrzeżenie.
- **Stan 2026-10-27:** test w Chromium, AdBlock 6.50 + v6.23 na artykule z
  wiadomosci.wp.pl: bez pętli, RAM taki sam z rozszerzeniem i bez (350 / 359
  MB). Brakuje jeszcze potwierdzenia u użytkownika (Vivaldi), że RAM nie
  rośnie w czasie.
- **Stan 2026-10-27:** użytkownik przeszedł na uBO Lite (S-17), więc
  potwierdzenia z jego przeglądarki raczej nie będzie. Ostrzeżenie przed
  AdBlockiem zostaje w README do czasu nowego testu.

### S-18: Stare gałęzie na GitHubie do usunięcia
- **Zgłoszono:** 2026-10-26 — proxy git odrzuca usuwanie gałęzi (HTTP 403).
- **Do usunięcia ręcznie przez użytkownika:**
  `claude/vivaldi-extension-ram-usage-9dgp0s`,
  `claude/adblock-message-20s-yu9nid`, `claude/adoring-tesla-ObIvZ`.
- **Stan:** czeka na użytkownika.

### S-19: Ściany w Shadow DOM
- **Ustalenie:** część nowoczesnych ścian renderuje się w shadow root,
  niewidocznym dla `querySelectorAll` — nieobsługiwane.
- **Stan:** pomysł na przyszłość; brak zgłoszenia konkretnej strony.

---

## Rozwiązane

### S-17: Jakiego blokera reklam używa użytkownik?
- **Zgłoszono:** pytanie zadane kilka razy 2026-10-26/27 — bez odpowiedzi.
- **Dlaczego ważne:** AdBlock (getadblock.com) był niekompatybilny (S-04);
  chowanie zdjęcia (S-16) prawdopodobnie zależy od blokera; zalecany jest
  uBlock Origin.
- **Stan:** czeka na odpowiedź. Przy każdym zgłoszeniu „zjada RAM" zapytaj o
  listę rozszerzeń.
- **Stan 2026-10-27:** poszlaka — profil RAM-u u użytkownika (strona + 8
  procesów ramek reklamowych, S-21) jest taki sam jak w teście z AdBlockiem
  6.50; z uBO Lite tych ramek nie ma. Na zrzucie z paska narzędzi widać kilka
  rozszerzeń; nazwy blokera z niego nie da się pewnie odczytać.
- ✅ **Rozwiązane: bez zmiany wersji (2026-10-27)** — użytkownik: „przeniosłem
  się na uBlock Origin Lite". Poprzedniego blokera nie nazwał; profil RAM-u
  (S-21) wskazywał na AdBlock lub podobny. Od teraz testy i porady zakładają
  uBO Lite (MV3, reguły DNR).

### S-16: Pierwsze zdjęcie artykułu niewidoczne na wiadomosci.wp.pl
- **Zgłoszono:** 2026-10-27, v6.22 (raport z
  `wiadomosci.wp.pl/sfalszowala-wybory-…-7344357483726880a`).
- **Objawy:** RAM już nie rośnie (S-15), ale pierwsze zdjęcie jest schowane.
  Użytkownik sądzi, że to skutek pracy blokera reklam.
- **Ustalenia:** w raporcie `revealGaveUp: 1` — zdjęcia pilnował czyjś
  obserwator (strony albo blokera). Bezpiecznik z v6.22 odpuścił po 5
  próbach, więc zdjęcie zostało schowane. W Chromium bez Vivaldi (uBlock
  Origin Lite, AdBlock 6.50) zdjęcie na tym artykule jest widoczne — chowanie
  występuje tylko w zestawie użytkownika.
- **Stan:** 2026-10-27 — v6.23: odsłonięcie arkuszem `origin: 'USER'` bez
  przepychanki.
- ✅ **Rozwiązane: v6.23 (2026-10-27)** — potwierdzone przez użytkownika tego
  samego dnia: zrzut ekranu (zdjęcie widoczne na
  `wiadomosci.wp.pl/nowy-sondaz-w-usa-…-7344451083147360a`) i raport z
  `revealGaveUp: 1`, `revealCss: 1`.
- **Test:** `npm test -- pilnowane`.

### S-20: Testy i rejestr spraw w repozytorium
- **Zgłoszono:** 2026-10-27 — użytkownik: „czy wszystkie uwagi z każdej
  iteracji spisujesz?", „dopisz", „na przyszłość też dopisywać i robić
  dopisek, że coś zostało rozwiązane".
- ✅ **Rozwiązane: 2026-10-27 (bez nowej wersji rozszerzenia)** — `tests/`
  (15 testów regresji, `npm test`) i ten plik. Zasady w CLAUDE.md. Testy
  sprawdzone na starych wersjach: v6.20, v6.21 i v6.22 dają czerwone testy
  dokładnie tam, gdzie brakowało poprawki.

### S-15: RAM rośnie bez końca (~2 GB/min), karta „nie odpowiada" — tylko wiadomosci.wp.pl
- **Zgłoszono:** 2026-10-26, v6.21 („minuta i już ze 2 GB ramu zjedzone",
  „rośnie w nieskończoność", „tam się musi jakaś pętla robić").
- **Ustalenia:** obserwator odsłaniający główne zdjęcie (`installMediaReveal`)
  i obserwator strony (albo blokera), który chowa je z powrotem, odpalały się
  na zmianę w nieskończoność w mikrozadaniach. Wątek strony nie wracał do
  pętli zdarzeń, a przeglądarka nie sprzątała. Odtworzone na stronie
  testowej; bez rozszerzenia brak problemu.
- ✅ **Rozwiązane: v6.22 (2026-10-26)** — bezpiecznik `mayReveal` (≤ 5
  odsłonięć zdjęcia w 10 s). **Potwierdzone przez użytkownika 2026-10-27**
  raportem: RAM karty stały (475 MB), `revealGaveUp: 1`. Skutek uboczny →
  S-16.
- **Test:** `npm test -- pilnowane`.

### S-14: „Diagnoza przerwana: timeout"
- **Zgłoszono:** 2026-10-26, raport z v6.20 (zawieszona karta WP).
- **Ustalenia:** przeglądarka wstawiała kartę diagnozy do istniejącego,
  zawieszonego procesu serwisu. Rozszerzenie nie potrafi zabić takiego
  procesu (`tabs.discard`, `tabs.remove`, `Page.crash` — sprawdzone).
- ✅ **Rozwiązane: v6.21 (2026-10-26)** — osobny proces dla karty diagnozy
  (`Origin-Agent-Cluster` przez sesyjną regułę DNR) i start z `diag.html`.
  Także: przycięcie ≠ zawieszenie, kolumna w stosie.
- **Test:** `npm test -- "wspólnym procesie"`.

### S-13: Onet „pamięć w normie", choć RAM się nie wyświetla
- **Zgłoszono:** 2026-10-26, v6.19 (jednocześnie otwarta zawieszona karta WP).
- **Ustalenia:** zrzut pamięci jest globalny — zawieszona karta w tle
  blokowała pomiar wszystkich kart; etykieta „w normie" była pokazywana bez
  pomiaru RAM-u.
- ✅ **Rozwiązane: v6.20 (2026-10-26)** — limit 3 s zrzutu z komunikatem
  „inna karta prawdopodobnie nie odpowiada"; uczciwe etykiety „mierzę…" i
  „w normie (bez RAM)".
- **Test:** `npm test -- "w tle"`.

### S-12: „Diagnozuj" nie otwiera żadnej karty
- **Zgłoszono:** 2026-10-26, v6.19 („żadna karta się nie uruchomiła").
- **Ustalenia:** prawdziwa przyczyna — pliki podmienione bez „Odśwież" w
  vivaldi://extensions (popup v6.19 + stary worker v6.18). Dodatkowo karta
  tworzona bez `windowId`.
- ✅ **Rozwiązane: v6.20 (2026-10-26)** — baner „W folderze jest vX, działa
  vY" z przyciskiem do strony rozszerzeń (bez `chrome.runtime.reload()`, bo
  w testach rozszerzenie po nim znikało); karta obok badanej; błędy widoczne.
- **Test:** `npm test -- "błąd otwarcia"`.

### S-11: Karty WP „nie odpowiadają"
- **Zgłoszono:** 2026-10-26, v6.17 („Pomiar przerwany po 10 s").
- **Ustalenia:** wątek strony zablokowany. Możliwa przyczyna: pętla czyszcząca
  kontener przy ochronie DOM.
- ✅ **Rozwiązane: v6.18 (2026-10-26)** — wykrywanie (`rendererBusy`, „!" na
  ikonie, „nie odpowiada"), bezpiecznik `mayRefuse`; v6.19 — „Diagnozuj (30 s)".
  Właściwa przyczyna zawieszeń na wiadomosci.wp.pl: S-15.
- **Test:** `npm test -- "nie odpowiada"`, `npm test -- "ochrona DOM"`.

### S-10: Popup wisi na „Mierzę…", raport się nie kopiuje
- **Zgłoszono:** 2026-10-26, v6.15/v6.16 (zrzuty ekranu).
- **Ustalenia:** niekompletna instalacja u użytkownika (brak `memcheck.js` i
  `monitor.js`) blokowała popup i całą rejestrację spoofu; zawieszony pomiar
  trzymał debugger.
- ✅ **Rozwiązane: v6.16 + v6.17 (2026-10-26)** — monitor rejestrowany
  osobno, sprawdzanie kompletności instalacji, limity czasu (pomiar 10 s z
  odłączeniem debuggera), raport bez czekania.
- **Test:** `npm test -- raport`.

### S-09: Wyłączanie adresu (z `?query`, z portem) i przekierowania na wyłączonej domenie
- **Zgłoszono:** 2026-10-26 — znalezione przy porządkach („połataj wszystko,
  żeby było spójne").
- ✅ **Rozwiązane: v6.15 (2026-10-26)** — wzorce z `hostname`, wariant
  `ścieżka?*`, reguła DNR `allow` (id 1000).
- **Test:** `npm test -- wyłączanie`.

### S-08: Wykrywanie, która karta zjada RAM i dlaczego; RAM w popupie; czerwona ikona; raport
- **Zgłoszono:** 2026-10-26 (prośby: „skrypt, który wykrywa, czy na karcie
  jest za dużo RAM-u", „i dlaczego", „popup ma pokazywać, ile RAM-u zjada
  karta", „ikona na czerwono", „jak pobierać dane, żebyś mógł analizować").
  Wybrana opcja „Hybryda"; auto-pomiar — decyzja: co 5 min.
- ✅ **Rozwiązane: v6.15 (2026-10-26)** — `monitor.js` + `memcheck.js`,
  pomiar przez `chrome.debugger`, czerwona ikona, auto-pomiar, „Kopiuj
  raport" / „Pobierz .json".
- **Test:** `npm test -- "pomiar RAM"`, `npm test -- raport`.

### S-07: Przełączniki w popupie nie działają / „raz działa, raz nie"
- **Zgłoszono:** 2026-07 i ponownie 2026-10-26 (zrzut ekranu wraz z prośbą o
  numer wersji w popupie).
- ✅ **Rozwiązane: v6.13 + v6.14 (2026-07-25)** — serializowana rejestracja;
  „pigułka" jako `<label for>`. Zgłoszenie z 2026-10-26 dotyczyło ZIP-a z
  gałęzi pobocznej bez tych poprawek (S-05); od v6.15 użytkownik dostaje ZIP
  z `main`, gdzie poprawki już były.
- **Test:** `npm test -- przełączniki`.

### S-06: fxmag.pl — ściana „Nie widzisz tej strony" wraca
- ✅ **Rozwiązane: v6.12 (2026-07-25)** — bait spoof geometrii i
  `getPropertyValue` (biblioteka `just-detect-adblock`).
- **Test:** `npm test -- ściany` (przynęty).

### S-05: Rozjazd gałęzi i zdublowane numery wersji
- **Ustalenie:** v6.4–v6.8 powstawały na gałęziach od starych baz; użytkownik
  dostawał ZIP-y z innym kodem niż `main`.
- ✅ **Rozwiązane: v6.11 (2026-07-11)** — porządki; v6.15 (2026-10-26) —
  zasady w CLAUDE.md: wszystko na `main`, ZIP tylko z `main`.

### S-03: Lawinowy wzrost RAM na portalach WP (zgłoszenie przy v6.9)
- ✅ **Rozwiązane: v6.10 (2026-07-11)** — budżet wydajności (obserwator na
  całym `body` z `attributes`, dławik warstwy ciężkiej, limit czasu
  obserwatora). Kolejny przypadek RAM-u na WP: S-15.

### S-01: Znikające główne zdjęcie (hero) na wp.pl
- ✅ **Rozwiązane: v6.4 + v6.5 (2026-06-07)** — odsłanianie zdjęcia i trwały
  obserwator. Uwaga: ten obserwator po latach okazał się źródłem pętli (S-15).

---

## Zamknięte bez zmian

### S-02: Ściana w playerze wideo WP („Wyłącz AdBlocka, aby obejrzeć materiał")
- **Powód:** decyzja zapada w `window.WP.crux.sealed()` w zamkniętych modułach,
  spięta z impresjami reklam — bez wpuszczenia reklam nie da się wiarygodnie
  oszukać. Próby (v6.6–v6.8) wycofane w v6.9 (2026-07-05). Nie podejmować bez
  nowych ustaleń.
