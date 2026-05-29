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

## Popup — wyłączanie per domena / adres

Rozszerzenie działa wszędzie, ale czasem może kolidować z konkretną stroną.
Kliknij ikonę rozszerzenia:

- **Aktywne na tej domenie** — wyłącz, by przestać działać na całej domenie
  (np. `example.com` i wszystkich subdomenach).
- **Aktywne na tym adresie** — wyłącz tylko dla bieżącego, konkretnego adresu.
- **Usunięte ściany** — licznik usuniętych blokad (z przyciskiem reset).

Po zmianie odśwież stronę (F5), aby zaczęła obowiązywać.

## Dodawanie obsługi nowej strony

W trybie uniwersalnym **nie dodaje się domen**. Jeśli jakaś ściana się
prześlizgnie, dodaj jej **sygnaturę** w `content.js`:

- nową frazę do tablicy `TEXT_SIGNATURES`, lub
- nową klasę/selektor do `WALL_SELECTORS`.

Następnie uruchom walidację i przeładuj rozszerzenie.

## Rozwój i walidacja

```bash
npm run lint   # node --check na .js + walidacja manifest/rules + zakresu
```

Folder `_metadata/` jest generowany przez przeglądarkę i ignorowany przez git.

### Struktura

```
manifest.json      konfiguracja MV3 (zakres *://*/*)
content.js         rdzeń: warstwa lekka + detekcja + warstwa ciężka (MAIN world)
background.js      service worker: dynamiczna rejestracja + licznik
bridge.js          most ISOLATED ↔ SW (licznik)
popup.html/js      wyłączanie per domena/adres + licznik
rules/rules.json   reguły declarativeNetRequest (adblock-check, GPT)
fake-scripts/      oryginalne skrypty Google (nie modyfikować)
scripts/lint.mjs   walidacja
```

## Pomysły na przyszłość

- Strona opcji z edytowalną listą sygnatur i wyjątków.
- Skrypt odświeżający `gpt.js`/`pubads_impl.js` z CDN Google (są wersjonowane).
- Obsługa Shadow DOM (część ścian renderuje się w shadow root).
- Badge na ikonie z licznikiem per karta.
- Tryb „strict" per domena (warstwa ciężka od startu, bez czekania na detekcję).
- Testy regresji (jsdom + fixtury HTML): brak fałszywych trafień na zwykłych
  modalach (cookie itp.).

## Zastrzeżenie

Projekt do **użytku osobistego / edukacyjnego**. Blokowanie reklam i obchodzenie
ścian adblock może naruszać regulaminy niektórych serwisów — używasz na własną
odpowiedzialność. Rozważ wspieranie ulubionych serwisów subskrypcją lub
whitelistą.
