# Testy regresji

Każdy test pilnuje konkretnej poprawki z `CHANGELOG.md`: przy niezaliczonym
teście runner wypisuje, której wersji i czego dotyczy (pole `guards`).
Czerwony test oznacza, że ktoś cofnął albo zepsuł poprawkę.

```bash
npm test                          # wszystkie testy, ok. 3 min (diagnozy po 30 s)
npm test -- diagnoza              # tylko pasujące do słowa (grupa albo nazwa)
SPOOF_EXT=/ścieżka npm test       # inna wersja, np. rozpakowany stary ZIP
```

Bez sieci: strony testowe serwuje lokalny serwer z `tests/site/`. Testy ładują
kopię rozszerzenia z tych samych plików, co ZIP (`scripts/extension-files.mjs`).

**Wymagania:** Node 22+ i Playwright z Chromium, ładowany przez `require`.
W chmurowym środowisku Claude Code jest już zainstalowany — nie instaluj go
ponownie, bo inna wersja nie znajdzie przeglądarki. Lokalnie:
`npm i -g playwright && npx playwright install chromium`, z `NODE_PATH`
wskazującym na globalne `node_modules`.

## Co sprawdzają

| Grupa | Test | Pilnuje |
|---|---|---|
| spoof | rejestracja skryptów i spójny numer wersji | v6.16 (monitor osobno), wersja manifest = marker = ikona |
| spoof | ściany „wyłącz adblocka" i przynęty | detekcja ściany, warstwa ciężka, bait spoof (v6.12), idempotentne style (v6.10) |
| spoof | ochrona DOM: pętle czyszczące kontener się kończą | v6.18 `mayRefuse` |
| spoof | pilnowane zdjęcie: bez pętli i widoczne | v6.22 `mayReveal` (RAM +2 GB/min), v6.23 arkusz USER |
| spoof | zwykłe „schowaj ponownie" | v6.22/6.23 nie psują zwykłego odsłaniania |
| popup | przełączniki reagują na klik w „pigułkę" | v6.14 |
| popup | wyłączanie domeny i adresu (także z ?query) | v6.13, v6.15 |
| popup | raport: kopiuj / pobierz .json | format raportu, który użytkownik wkleja |
| pamiec | pomiar RAM karty i znaczek „RAM" | v6.15 |
| pamiec | podział RAM na procesy ramek z nazwą serwisu | v6.24 |
| pamiec | zawieszona karta → „nie odpowiada", „!" | v6.17, v6.18 |
| pamiec | zawieszona karta w tle nie blokuje pomiaru | v6.20 (limit 3 s zrzutu) |
| diagnoza | zawieszona strona → stos | v6.19–v6.21 |
| diagnoza | przycięcia to nie zawieszenie | v6.21 |
| diagnoza | błąd otwarcia karty i stary stan „trwa" | v6.20 |
| diagnoza | zawieszona karta we wspólnym procesie | v6.21 (`--process-per-site` odtwarza Vivaldi) |

## Strony testowe (`tests/site/`)

Każda strona ma na górze komentarz z opisem, co odtwarza.

- `index.html` — ściany, przynęty, losowe klasy WP.
- `protect.html` — pętle czyszczące kontener.
- `big.html` — duży DOM.
- `frames.html` + `frame.html` — ramki z innego serwisu (localhost ≠ 127.0.0.1).
- `guarded-img.html` — strona chowa zdjęcie i pilnuje go własnym obserwatorem.
- `rehide.html` — zdjęcie chowane kilka razy timerami.
- `loop.html` — zawieszenie na 40 s.
- `freeze.html` — przycięcia po 3 s.
- `hang.html` — zawieszenie na 120 s.

## Narzędzia (wymagają sieci, poza `npm test`)

- `tests/tools/wp-bench.cjs <url> [sekundy] [spoof,/ścieżka/blokera|none]` —
  RAM przeglądarki na prawdziwej stronie, z rozszerzeniem i bez. Tak
  sprawdzamy zgłoszenia „zjada RAM".

## Zasada

Każdy nowy błąd zgłoszony przez użytkownika: najpierw odtwórz go stroną w
`tests/site/` i testem w `tests/cases/` (ma być czerwony), potem popraw kod
(test zielony). Wpisz test do tabeli wyżej, a sprawę do `SPRAWY.md`.
