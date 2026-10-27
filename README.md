# Universal Adblock Spoof

Rozszerzenie do przeglądarek opartych na Chromium (**Vivaldi**, Chrome, Edge,
Brave), które **oszukuje detektory adblocka**. Strony przestają zasłaniać
treść ścianami typu „wyłącz adblocka", a reklamy nadal blokuje Twój właściwy
adblock (np. uBlock Origin).

## Jak to działa

Podział ról:

- **Twój adblock (uBlock itp.)** — blokuje faktyczne reklamy i połączenia do
  sieci reklamowych. To on sprawia, że nie widzisz reklam.
- **To rozszerzenie** — sprawia, że strona *myśli*, że adblocka nie ma, więc
  nie pokazuje ściany i nie chowa artykułu.

Efekt: **brak reklam (dzięki adblockowi) + brak zasłoniętej treści (dzięki
temu rozszerzeniu).**

### Model „detekcja → reakcja"

Rozszerzenie działa na **każdej stronie**, ale w dwóch warstwach:

1. **Warstwa lekka (zawsze aktywna, bezpieczna).** Podstawia atrapy popularnych
   API reklamowych (`googletag`, `adsbygoogle`, Piano `window.tp`) oraz pasywnie
   przechwytuje znane frameworki (WP, `__INIT_CONFIG__`). Nic nie usuwa ze
   strony — te atrapy mają znaczenie tylko wtedy, gdy strona faktycznie ich używa.
2. **Warstwa ciężka (włącza się dopiero po wykryciu ściany adblock).** Usuwa
   nakładki, odblokowuje przewijanie, odkrywa ukrytą treść artykułu, chroni
   tekst przed usunięciem.

Dzięki temu zwykłe strony (banki, sklepy, social media) działają normalnie —
agresywne akcje nie odpalają się, dopóki nie pojawi się realna ściana adblock.

### Co wykrywa ścianę

- **Sygnatury tekstowe** — frazy PL/EN typu „wyłącz adblocka", „disable your ad
  blocker", „dodaj nas do wyjątków".
- **Znane obiekty i klasy** — Piano (`window.tp`), WP (`window.WP`,
  `__INIT_CONFIG__`), klasy `fc-ab-*`, `adblock-wall`, `AdBlockInfo` itd.
- **Heurystyka nakładki** — pełnoekranowy element `position:fixed` o wysokim
  `z-index`, który blokuje przewijanie strony.

### Prawdziwe skrypty Google (`fake-scripts/`)

`gpt.js` i `pubads_impl.js` to **oryginalne** skrypty Google Publisher Tag,
serwowane lokalnie. To celowe: gdy uBlock zablokuje je w sieci, strona przez
nasze podstawienie nadal „widzi" załadowane GPT i nie uznaje, że masz adblocka.
Faktyczne żądania reklam i tak blokuje uBlock. **Nie zamieniaj ich na stuby** —
zepsułoby to spoof.

## Instalacja (Vivaldi / Chromium, tryb dewelopera)

1. Sklonuj repozytorium lub pobierz jako ZIP i rozpakuj.
2. Wejdź na `vivaldi://extensions` (w Chrome: `chrome://extensions`).
3. Włącz **Tryb dewelopera** (przełącznik w prawym górnym rogu).
4. Kliknij **Wczytaj rozpakowane** i wskaż folder z repozytorium (ten, w którym
   leży `manifest.json`).
5. Gotowe — ikona pojawi się na pasku. Upewnij się, że masz też aktywny adblock
   (np. uBlock Origin).

> Po aktualizacji plików kliknij **Odśwież** przy rozszerzeniu w
> `vivaldi://extensions`.

### Z jakim blokerem używać

Rozszerzenie jest projektowane i testowane w parze z **uBlock Origin** oraz
**uBlock Origin Lite** (testy regresji, pomiary RAM). Na artykule z
wiadomosci.wp.pl karta z uBO Lite zajmuje ok. 105 MB — ramki reklam i
śledzenia w ogóle się nie ładują (z AdBlockiem ok. 350 MB, bez blokera ponad
1 GB; zob. „Co zjada RAM" niżej).

⚠️ **Nie łącz z AdBlockiem (getadblock.com)** — potwierdzony przypadek (2026-07,
portale WP typu wiadomosci.wp.pl): przy włączonym AdBlocku zużycie RAM karty
rośnie do absurdalnych rozmiarów i spowalnia komputer. AdBlock (domyślnie
z „Acceptable Ads") sam wycina elementy reklamowe ze strony, a spoof utrzymuje
sloty reklamowe przy życiu — obie strony przepychają się bez końca. Po
wyłączeniu AdBlocka problem znika; sama ta wtyczka (v6.11) w pomiarach
(heap JS + RSS procesów, 4 scenariusze, do 10 min) ma pamięć płaską.

## Popup — wyłączanie per domena / adres

Rozszerzenie działa wszędzie, ale czasem może kolidować z konkretną stroną.
Kliknij ikonę rozszerzenia:

- **Aktywne na tej domenie** — wyłącz, by przestać działać na całej domenie
  (np. `example.com` i wszystkich subdomenach).
- **Aktywne na tym adresie** — wyłącz tylko dla bieżącego, konkretnego adresu.
- **Usunięte ściany** — licznik usuniętych blokad (z przyciskiem reset).

Po zmianie karta odświeża się sama i zmiana od razu obowiązuje (gdyby się nie
odświeżyła, popup poprosi o F5).

## Pamięć tej karty

Po otwarciu popupu widać **RAM tej karty** w MB — proces strony plus procesy
jej ramek (np. reklam), czyli to samo, co Menedżer zadań Vivaldi (Shift+Esc),
oraz powody, jeśli jest go dużo. Pomiar idzie przez protokół DevTools, więc na
kilka sekund pojawia się pasek „rozszerzenie debuguje tę przeglądarkę".
Ponowne otwarcie popupu w ciągu 20 s pokazuje poprzedni wynik;
**Zmierz ponownie** mierzy od nowa. Pomiar działa też tam, gdzie rozszerzenie
jest wyłączone, więc można porównać kartę z rozszerzeniem i bez.

**Co zjada RAM.** Linia „Ramki z innych serwisów" pokazuje największe ramki
karty z nazwą serwisu (np. `pubmatic.com 31 MB · adnxs.com 30 MB`). Każda
ramka z innego serwisu ma w przeglądarce osobny proces (ok. 25–50 MB). Na
portalach to zwykle reklamy i śledzenie — ich liczbę ogranicza bloker reklam.
Na artykule z wiadomosci.wp.pl: z uBlock Origin Lite ok. 105 MB, z AdBlockiem
ok. 350 MB, bez blokera ponad 1 GB. U użytkownika w Vivaldi (2026-10-27): z
poprzednim blokerem 479–582 MB (8 procesów ramek), po przejściu na uBO Lite
136 MB (0 procesów ramek).

**Czerwona ikona.** Gdy karta zużywa ≥ 500 MB (albo strona ma bardzo duży DOM,
dużo ramek lub obrazków), ikona na tej karcie robi się czerwona, a znaczek
pokazuje liczbę MB (np. „620", „1.2G") albo „RAM". Rozszerzenie samo mierzy
aktywną kartę co 5 minut i chwilę po przełączeniu na kartę, której nie mierzyło
od 5 minut. Auto-pomiar wyłączysz przełącznikiem w popupie. Pasek „debuguje"
można całkiem ukryć, uruchamiając Vivaldi z flagą
`--silent-debugger-extension-api` (dopisz ją do skrótu na pulpicie).

### Diagnoza: co zawiesza albo obciąża stronę

Jeśli karta „nie odpowiada" (czerwone „!") albo mieli procesor, kliknij w
popupie **Diagnozuj (30 s)**. Rozszerzenie otworzy ten sam adres w nowej
karcie, przez 30 s nagra, który kod zużywa CPU, a gdy strona się zawiesi —
zatrzyma ją jak pauza w DevTools i odczyta, która funkcja ją blokuje. Wynik
podpisuje źródło: to rozszerzenie, inne rozszerzenie albo skrypt strony. Potem
otwórz popup ponownie i kliknij **Kopiuj raport** — diagnoza jest w raporcie.
Nowa karta dostaje własny proces, więc diagnoza działa także wtedy, gdy
badana karta wciąż wisi.

### Raport do analizy

1. Zostaw kartę otwartą tak długo, jak zwykle (monitor zbiera historię z
   ostatniej godziny).
2. Kliknij **Kopiuj raport** (i wklej go w rozmowie) albo **Pobierz .json**
   (i dołącz plik). Raport zawiera RAM karty i dokładny pomiar.
3. Dla porównania: wyłącz rozszerzenie na tej domenie, odczekaj podobny czas i
   zrób drugi raport.

Raport zawiera adres strony bez parametrów (`?…`) i nazwy hostów, z których
strona pobiera najwięcej zasobów — nic więcej o stronie ani o Tobie.

## Dodawanie obsługi nowej strony

W trybie uniwersalnym **nie dodaje się domen**. Jeśli jakaś ściana się
prześlizgnie, dodaj jej **sygnaturę** w `content.js`:

- nową frazę do tablicy `TEXT_SIGNATURES`, lub
- nową klasę/selektor do `WALL_SELECTORS`.

Następnie uruchom walidację i przeładuj rozszerzenie.

## Rozwój i walidacja

```bash
npm run lint   # node --check na .js/.mjs/.cjs + walidacja manifest/rules + zakresu
npm test       # testy regresji w Chromium (Playwright), ok. 3 min — opis: tests/README.md
```

Historia: `CHANGELOG.md` (co zmieniono w kodzie i dlaczego) oraz `SPRAWY.md`
(zgłoszenia, ustalenia, otwarte pytania i co zostało rozwiązane).

Folder `_metadata/` jest generowany przez przeglądarkę i ignorowany przez git.

### Struktura

```
manifest.json      konfiguracja MV3 (zakres *://*/*)
content.js         rdzeń: warstwa lekka + detekcja + warstwa ciężka (MAIN world)
background.js      service worker: dynamiczna rejestracja, licznik, pomiar RAM,
                   czerwona ikona, auto-pomiar
bridge.js          most ISOLATED ↔ SW (licznik, arkusz odsłaniający zdjęcie)
memcheck.js        progi i powody „dużo pamięci"
monitor.js         tanie wskaźniki pamięci karty (co 30 s)
popup.html/js      wyłączanie per domena/adres, licznik, pamięć karty, raport
diag.html          strona startowa karty diagnozy
rules/rules.json   reguły declarativeNetRequest (adblock-check, GPT)
fake-scripts/      oryginalne skrypty Google (nie modyfikować)
scripts/           lint, budowa ZIP, lista plików rozszerzenia
tests/             testy regresji (npm test) i narzędzie pomiaru RAM
```

## Pomysły na przyszłość

- Strona opcji z edytowalną listą sygnatur i wyjątków.
- Skrypt odświeżający `gpt.js`/`pubads_impl.js` z CDN Google (są wersjonowane).
- Obsługa Shadow DOM (część ścian renderuje się w shadow root).
- Badge na ikonie z licznikiem per karta.
- Tryb „strict" per domena (warstwa ciężka od startu, bez czekania na detekcję).
- Test braku fałszywych trafień na zwykłych modalach (cookie itp.) — do
  dopisania w `tests/` (testy regresji już są: `npm test`).

## Zastrzeżenie

Projekt do **użytku osobistego / edukacyjnego**. Blokowanie reklam i obchodzenie
ścian adblock może naruszać regulaminy niektórych serwisów — używasz na własną
odpowiedzialność. Rozważ wspieranie ulubionych serwisów subskrypcją lub
whitelistą.
