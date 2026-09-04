# BandBuilder

Builder drużyn do **Shadow War: Armageddon**. Działa offline w przeglądarce, bez konta i bez serwera.

Dodawanie i usuwanie wojowników · zliczanie punktów · ekwipunek z zagnieżdżonymi opcjami · walidacja legalności drużyny · tryb kampanii (XP, awanse, kontuzje, promethium caches) · wydruk do PDF.

**15 frakcji, 123 typy wojowników** z profilami broni, zasadami specjalnymi i drzewami umiejętności.

---

## Uruchomienie

Kliknij dwukrotnie **`start.cmd`**. Za pierwszym razem zbuduje aplikację (potrzebny [Node.js](https://nodejs.org)), potem uruchomi ją na `http://localhost:8787` i otworzy przeglądarkę. Zamknięcie okna konsoli zatrzymuje serwer.

Zamiast tego można otworzyć `dist/index.html` bezpośrednio z dysku — to jeden samowystarczalny plik HTML, bez żadnych zależności. Uwaga: część przeglądarek nie zapisuje danych dla adresów `file://`, więc drużyny mogą się nie zachować między sesjami. Aplikacja to wykryje i ostrzeże na górnym pasku. Przez `start.cmd` zapis działa zawsze.

Ręcznie:

```bash
npm install && npm run build && npm start
```

## Jak to działa

- **Drużyny zapisują się w przeglądarce** (localStorage), automatycznie po każdej zmianie. `Ctrl+Z` / `Ctrl+Y` cofa i ponawia.
- **Eksport JSON** to kopia zapasowa i sposób przenoszenia drużyny na inny komputer. `Import` wczytuje taki plik.
- **Wydruk PDF** pokazuje dokument dokładnie tak, jak się wydrukuje. Do PDF-a: przycisk *Drukuj / Zapisz jako PDF*, a w okienku druku wybierz „Zapisz jako PDF" jako drukarkę. Trzy części do włączania osobno:
  - **Karta drużyny** — jedna strona: statystyki i ekwipunek wszystkich modeli, suma punktów, status legalności,
  - **Karty wojowników** — po jednej na model, z ujednoliconą tabelą broni i kratkami na rany, amunicję (jedna na strzał plus po jednej za każdy wykupiony reload), XP i kontuzje,
  - **Ściąga broni** — unikalne profile broni użytych w drużynie, opcjonalnie z treścią zasad specjalnych.
- **Nic nie jest blokowane.** Można przekroczyć budżet albo limit modeli — aplikacja to pokaże jako błąd, ale nie zabroni. Przy budowaniu listy notorycznie przechodzi się przez stany nielegalne.
- **Niedostępne opcje są wyszarzone z powodem**, nie ukryte („grupa pełna (1/1)", „wymaga wcześniejszego wyboru").

## Dane

Dane systemu pochodzą ze społecznościowego repozytorium [BSData/wh40k-shadow-war-armageddon](https://github.com/BSData/wh40k-shadow-war-armageddon) (BattleScribe), przetworzonego na własny format:

```bash
npm run fetch-data    # pobiera pliki .gst/.cat do data/bsdata/
npm run import-data   # buduje src/data/swa.json + data/IMPORT-REPORT.md
```

Raport importu wypisuje wszystko, czego nie udało się zmapować, oraz konflikty w danych źródłowych — patrz [data/IMPORT-REPORT.md](data/IMPORT-REPORT.md). Surowe pliki BattleScribe nie są trzymane w repozytorium.

Warhammer 40,000 i Shadow War: Armageddon są własnością Games Workshop. Dane są utrzymywane przez społeczność i nie są w żaden sposób autoryzowane przez GW; sama aplikacja jest generyczna i bez wczytanego data packa nie zawiera treści żadnej gry.

## Struktura

```
src/core/      model danych, koszty, walidacja, akcje — czysty TypeScript, bez UI
src/ui/        panele React + widok do druku
src/data/      wygenerowany data pack (swa.json)
src/store/     zapis w przeglądarce, eksport/import JSON
tools/         pobieranie i import danych BSData, serwer statyczny
docs/          research i dokument projektowy
```

Testy silnika (`npm test`) pokrywają koszty, walidację reguł drużyny wraz z odstępstwami frakcyjnymi, kampanię i przejście po wszystkich 123 typach wojowników z pełnym ekwipunkiem.

## Dokumentacja

- [docs/DESIGN.md](docs/DESIGN.md) — projekt: model danych, silnik, UI, PDF, co zbudowano i czym się to różni od pierwotnego szkicu
- [docs/RESEARCH.md](docs/RESEARCH.md) — jak działają BattleScribe, New Recruit, Army Builder i Rosterizer; reguły budowy kill teamu w SWA
