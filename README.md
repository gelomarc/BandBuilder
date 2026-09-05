# BandBuilder

Builder list do gier bitewnych. Działa offline, bez konta i bez serwera.

Dodawanie i usuwanie pozycji · zliczanie punktów · ekwipunek z zagnieżdżonymi opcjami · walidacja legalności listy · wydruk do PDF.

| System | Zawartość |
|---|---|
| **Shadow War: Armageddon** | 15 frakcji, 123 typy wojowników, tryb kampanii (XP, awanse, kontuzje, promethium caches) |
| **Horus Heresy 3rd Edition** | 32 frakcje, ~5900 pozycji, organizacja sił z detachmentami, oddziały o zmiennej liczebności |

---

## Uruchomienie

### Aplikacja desktopowa (zalecane)

**`release\BandBuilder-0.1.0.exe`** — jeden plik, bez instalacji, bez Node.js. Można go skopiować gdziekolwiek (pendrive też) i uruchomić dwuklikiem. Drużyny zapisują się w `%APPDATA%\BandBuilder` i przeżywają przenoszenie samego exe.

Windows przy pierwszym uruchomieniu może pokazać ostrzeżenie SmartScreen („Windows chronił twój komputer”) — plik nie jest podpisany certyfikatem. *Więcej informacji → Uruchom mimo to.*

Wersja z instalatorem i skrótem na pulpicie: `npm run exe:setup` → `release\BandBuilder-Setup-0.1.0.exe`.

### W przeglądarce

`start.cmd` (dwuklik) buduje przy pierwszym razie i podaje aplikację na `http://localhost:8787`. Wymaga [Node.js](https://nodejs.org).

Można też otworzyć `dist\index.html` wprost z dysku — to jeden samowystarczalny plik HTML. Uwaga: część przeglądarek nie zapisuje danych dla adresów `file://`, więc listy mogą nie przetrwać zamknięcia karty. Aplikacja to wykrywa i ostrzega na górnym pasku.

### Komendy

```bash
npm install
npm run build       # web build -> dist/index.html (jeden plik)
npm run app         # uruchom wersję desktopową bez pakowania
npm run exe         # portable .exe -> release/
npm run exe:setup   # instalator .exe -> release/
npm test            # testy silnika
```

## Jak to działa

- **Listy zapisują się automatycznie** po każdej zmianie. `Ctrl+Z` / `Ctrl+Y` cofa i ponawia.
- **Eksport JSON** to kopia zapasowa i sposób przenoszenia listy na inny komputer. `Import` wczytuje taki plik.
- **Wydruk PDF** pokazuje dokument dokładnie tak, jak zostanie wydrukowany. W wersji desktopowej *Zapisz PDF* zapisuje plik bezpośrednio (`Ctrl+P` otwiera widok wydruku); w przeglądarce *Drukuj / Zapisz jako PDF* otwiera okno druku, gdzie trzeba wybrać „Zapisz jako PDF" jako drukarkę. Trzy części do włączania osobno:
  - **Lista** — jedna strona: detachmenty, pozycje z ekwipunkiem, suma punktów, status legalności,
  - **Karty** — po jednej na pozycję: statystyki, tabele profili broni i wyposażenia, zasady. W Shadow War dochodzą kratki na rany, amunicję (jedna na strzał plus po jednej za każdy wykupiony reload), XP i kontuzje,
  - **Ściąga** — wszystkie profile użyte na liście, pogrupowane po typie, opcjonalnie z treścią zasad specjalnych.
- **Nic nie jest blokowane.** Można przekroczyć budżet albo limit modeli — aplikacja pokaże to jako błąd, ale nie zabroni. Przy budowaniu listy notorycznie przechodzi się przez stany nielegalne.
- **Limity liczone są na żywo.** W Horus Heresy „1–5 modeli może wymienić broń" to limit rosnący z liczebnością oddziału; nagłówek grupy pokazuje aktualną wartość, a nie tę z książki.
- **Niedostępne opcje są wyszarzone z powodem**, nie ukryte („grupa pełna (1/1)", „wymaga wcześniejszego wyboru").

## Dane

Dane obu systemów pochodzą ze społecznościowych repozytoriów BattleScribe — [wh40k-shadow-war-armageddon](https://github.com/BSData/wh40k-shadow-war-armageddon) (XML) i [horus-heresy-3rd-edition](https://github.com/BSData/horus-heresy-3rd-edition) (JSON) — przetworzonych na wspólny format:

```bash
npm run fetch-data          # oba systemy do data/bsdata/<system>/
npm run fetch-data hh3      # tylko jeden
npm run import-data         # buduje src/data/<system>.json + raporty importu
```

Raporty importu wypisują wszystko, czego nie udało się zmapować, oraz konflikty w danych źródłowych — [swa](data/IMPORT-REPORT-swa.md), [hh3](data/IMPORT-REPORT-hh3.md). Surowe pliki BattleScribe nie są trzymane w repozytorium.

### Dodanie kolejnego systemu

Dopisz wpis do [tools/systems.mjs](tools/systems.mjs) (repozytorium BSData, format `xml` albo `json`, słownictwo, domyślny budżet), dodaj go do listy w [src/systems.ts](src/systems.ts), potem `npm run fetch-data <id> && npm run import-data <id>`. Silnik jest agnostyczny wobec systemu — nie ma w nim niczego specyficznego dla żadnej gry.

Warhammer 40,000 i Shadow War: Armageddon są własnością Games Workshop. Dane są utrzymywane przez społeczność i nie są w żaden sposób autoryzowane przez GW; sama aplikacja jest generyczna i bez wczytanego data packa nie zawiera treści żadnej gry.

## Struktura

```
src/core/      model danych, drzewo, ewaluator modyfikatorów, koszty, walidacja, akcje
src/ui/        panele React + widok do druku
src/data/      wygenerowane data packi (swa.json, hh3.json)
src/store/     zapis w przeglądarce, eksport/import JSON, migracja starych list
electron/      powłoka desktopowa (okno, menu, zapis PDF)
tools/         pobieranie i import danych BSData, serwer statyczny, generator ikony
docs/          research i dokument projektowy
```

Testy silnika (`npm test`) działają na obu prawdziwych data packach: koszty, walidacja, kampania, limity skalujące się z liczebnością oddziału oraz przejście po każdej pozycji każdej frakcji w obu systemach.

## Gdy build .exe się wywala

`electron-builder` pobiera paczkę `winCodeSign`, w której są symlinki dla macOS. Bez trybu programisty ani uprawnień administratora Windows nie potrafi ich utworzyć i build przerywa się na `Cannot create symbolic link`. Obejście — rozpakować paczkę raz, bez katalogu `darwin`:

```bash
CACHE="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
curl -sL -o "$CACHE/wcs.7z" https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
node_modules/7zip-bin/win/x64/7za.exe x -y -snld -o"$CACHE/winCodeSign-2.6.0" "$CACHE/wcs.7z" "-xr!darwin"
rm "$CACHE/wcs.7z"
```

Potem `npm run exe` przechodzi. Alternatywnie: włączyć w Windows tryb programisty (Ustawienia → Prywatność i zabezpieczenia → Dla programistów).

## Dokumentacja

- [docs/DESIGN.md](docs/DESIGN.md) — projekt: model danych, silnik, UI, PDF, powłoka desktopowa, co zbudowano i czym się to różni od pierwotnego szkicu
- [docs/RESEARCH.md](docs/RESEARCH.md) — jak działają BattleScribe, New Recruit, Army Builder i Rosterizer; reguły budowy kill teamu w SWA
