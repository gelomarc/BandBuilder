# Research: jak działają aplikacje typu army/list builder

Data: 2026-09-04. Kontekst: BandBuilder ma być builderem band/kill teamów, docelowo dla **Shadow War: Armageddon**.

---

## 1. BattleScribe — wzorzec „data-driven", którego wszyscy kopiują

Model plikowy (XML, opcjonalnie zzipowany):

| Plik | Rola |
|---|---|
| `.gst` / `.gstz` | **Game system** — korzeń. Definiuje `gameSystemId`, typy kosztów, typy profili, kategorie, `forceEntries` (szkielet rostera) |
| `.cat` / `.catz` | **Catalogue** — treść jednej frakcji/książki. Odwołuje się do `gameSystemId` |
| `.ros` / `.rosz` | **Roster** — wynik pracy użytkownika: drzewo `selections` pogrupowane w `forces` |

Model obiektowy:

- **`selectionEntry` / `selectionEntryGroup`** — fundament. Definiują całe drzewo wyborów prezentowane użytkownikowi (jednostki, modele, ulepszenia, ekwipunek). `type` = `model` | `unit` | `upgrade`.
- **`entryLink` / `infoLink` / `categoryLink`** — referencje do wpisów współdzielonych (`sharedSelectionEntries`, `sharedProfiles`, `sharedRules`). To mechanizm reuse'u: „bolter" definiujesz raz, linkujesz 50 razy.
- **`categoryEntry`** — tagi przypisywane wyborom (np. `Leader`, `Specialists`). Nośnik limitów per kategoria.
- **`profileType` + `profile` + `characteristic`** — typowana tabela statystyk. Profile tego samego typu renderują się jako jedna tabela, gdzie `characteristicType` to kolumny.
- **`rule`** — wielolinijkowy tekst zasady.
- **`costType` + `cost`** — dowolna liczba „walut" (punkty, power level, CP…).
- **`constraint`** — limit `min`/`max`. Kluczowe atrybuty: `field` (co liczymy: `selections` albo konkretny costType), `scope` (gdzie sumujemy: `parent`, `roster`, `force`, kategoria główna, konkretny ancestor), `percentValue`, `includeChildSelections`, `includeChildForces`.
- **`modifier`** — zmiana właściwości rodzica albo **wartości constraintu**. Operacje: `increment`, `decrement`, `set`, `append`. Uruchamiany warunkowo (`condition`, `conditionGroup` z logiką AND/OR) albo powtarzalnie (`repeat`).

### Co z tego wynika dla nas

**Mocne strony do skopiowania:** rozdzielenie danych od aplikacji, tagi kategorii jako nośnik limitów, constrainty ze zdefiniowanym *zasięgiem* (bez tego nie wyrazisz „max 2 w bandzie" vs „max 1 na modelu"), typowane profile.

**Słabość do naprawienia:** ekstremalna gadatliwość i trudność autorowania. Konkret z prawdziwego pliku `Space Marine Scouts.cat` — wyrażenie „awans może dać +1 do Inicjatywy" to:

```xml
<modifier type="increment" field="0098-42da-9043-eaf9" value="1">
  <repeats>
    <repeat field="selections" scope="7ab3-f472-1e92-5c76" value="1.0"
      childId="52d0-d0b7-244e-0f26" repeats="1" .../>
  </repeats>
</modifier>
```

Same GUID-y, zero czytelności, osiem takich bloków na jednego wojownika. Autorowanie danych wymaga dedykowanego edytora. To jest główna przyczyna, dla której repozytoria danych BSData mają wąskie gardło w postaci kilku maintainerów.

---

## 2. New Recruit — jak wygląda nowoczesny produkt

Web + iOS + Android + desktop (Windows/macOS/Linux), darmowy, działa offline, synchronizacja między urządzeniami.

Funkcje, które definiują dziś „stan sztuki":
- automatyczny licznik punktów,
- **walidacja listy** — i to jest killer feature, nie licznik punktów,
- **import `.ros` / `.rosz` z BattleScribe** — droga wejścia dla użytkowników z istniejącymi listami,
- narzędzia turniejowe (swiss, single/double elimination) z automatyczną walidacją list uczestników — realna oszczędność czasu dla organizatora,
- tracking rozegranych gier i statystyki win-rate,
- **ewidencja kolekcji** — „czy tę listę mogę faktycznie wystawić modelami, które mam" i „co muszę dokupić",
- mocno konfigurowalne UI (motywy, kolory).

**Wniosek:** web-first PWA offline to właściwa platforma. Import z BattleScribe to tania funkcja z dużym efektem. Walidacja > liczenie punktów.

---

## 3. Army Builder (Lone Wolf) — stara szkoła, jedna dobra lekcja

Desktop, płatny, autorski format danych z własnym językiem skryptowym. Dane leżą poza aplikacją (`C:\ProgramData\Army Builder\data`), a autorzy danych mają tryb `Develop | Enable Data File Debugging` z inspekcją tagów i **hot reloadem pod Ctrl+R**.

**Wniosek:** narzędzia dla autorów danych są funkcją produktu, nie dodatkiem. Data pack musi się dać podmienić i przeładować bez rebuildu aplikacji; walidacja data packa musi dawać czytelne błędy z numerem linii.

---

## 4. Rosterizer — nowa szkoła, najważniejsza lekcja dla nas

Web, open source, agnostyczny wobec systemu gry. Dane w plikach „Manifest" tworzonych przez społeczność — pokrycie systemów, których duzi ignorują (Horus Heresy, Kill Team, One Page Rules, Bolt Action).

Wyróżnik, którego BattleScribe nie ma: **możliwość edycji statystyk jednostki wewnątrz rostera** — dokładnie po to, żeby obsłużyć kampanie, gdzie modele zdobywają doświadczenie i odnoszą trwałe kontuzje.

**Wniosek — i to jest projektowo najważniejsze zdanie z całego researchu:** dla Shadow War roster **nie może** być tylko drzewem referencji do katalogu. Musi być dokumentem z własnym, mutowalnym stanem per wojownik (XP, awanse, kontuzje). Jeśli tego nie zaplanujemy w modelu od początku, tryb kampanii będzie przepisaniem połowy aplikacji.

---

## 5. Shadow War: Armageddon — reguły budowy drużyny

Ustalenia ze streszczeń rulebooka oraz — co ważniejsze — **z faktycznych danych BSData**, które są weryfikowalne i gotowe do zaciągnięcia.

Istnieje repozytorium **[BSData/wh40k-shadow-war-armageddon](https://github.com/BSData/wh40k-shadow-war-armageddon)** (`Shadow War Armageddon.gst` + `.cat` per frakcja: Space Marine Scouts, Necron, Ork, Chaos, Tyranid, Genestealer Cults, Astra Militarum, Eldar, Skitarii, Grey Knights, Tau…). To jest realna baza startowa dla danych.

### Reguły odczytane z `Shadow War Armageddon.gst`

Force `Kill Team`:

| Reguła | Zapis w danych |
|---|---|
| Budżet 1000 pts | `costType id="Points"` |
| min 3 modele | `constraint type="min" field="selections" scope="Kill Team" value="3"` |
| max 10 modeli | `constraint type="max" field="selections" scope="Kill Team" value="10"` |
| Dokładnie 1 Leader | `categoryLink Leader` → min 1 / max 1, `scope="roster"` |
| Max 2 Specialists | `categoryLink Specialists` → max 2, `scope="parent"` |
| New Recruits max 50% budżetu | `constraint field="limit::Points" scope="roster" value="50" percentValue="true"` |
| Special Operatives podnoszą min i max o 1 każdy | dwa `modifier type="increment"` na constrainty min/max, z `repeat` po `childId` = kategoria Special Operatives |

Kategorie: `Leader`, `Troopers`, `Specialists`, `New Recruits`, `Special Operatives`.

Odstępstwa frakcyjne (potwierdzone): Orkowie 3–20 modeli zamiast 3–10; Astra Militarum 3 Specialists zamiast 2.

### Statystyki

Jeden statline dla wszystkich frakcji: **M, WS, BS, S, T, W, I, A, Ld** (`profileType name="Model"`).

### Typy profili w danych

`Model`, `Ranged Weapons` (Short Range, Long Range, Short To Hit, Long To Hit, Str., Dam., Save Mod., **Ammo Roll**, Special), `Melee weapons`, `Grenades`, `Armour`, `Wargear`, `Skill`, `Psychic abilities`, `Attribute Advancement`.

Uwaga na `Ammo Roll` i `Save Mod.` — SWA używa systemu „Rends" (modyfikator save'u) zamiast AP, a każda broń może się zaciąć / skończyć amunicję. To ma konsekwencje dla wydruku: karta wojownika musi mieć miejsce na trackowanie amunicji.

### Ekwipunek

Wojownicy mają **grupy wyborów** (z prawdziwych danych Scoutów): `Main Weapon`, `Basic Weapons`, `Pistols`, `Hand-to-Hand Weapons`, `Heavy Weapons`, `Grenades`, `Gear`, `Ammunition`, `Scopes`, `Side Arm`, `Skills`, `Select Chapter`. Każda z własnym min/max.

Bronie mają zagnieżdżone podzakupy — np. `Bolt pistol` zawiera opcję `Weapon Reload` za 13 pts. Czyli **item może mieć własne opcje**, model danych musi być rekurencyjny (choć w praktyce max 2 poziomy).

Ograniczenia warunkowe istnieją i są istotne: np. Kadianie mogą wziąć snajperkę **tylko jako opcja Specialisty**. Silnik musi umieć predykat „ten item dostępny tylko dla wojownika z kategorią X".

### Kampania

- Po każdej grze: rzut na tabelę kontuzji dla poległych.
- Awanse: **skill trees** zależne od typu wojownika, korzyści losowane na D6.
- Waluta kampanijna: **promethium caches**. Zwycięstwo = D3 cache, przegrana = 1. Cache można wydać na Special Operatives albo wymienić na 100 pts budżetu rekrutacyjnego/ekwipunkowego.

### Przykładowe koszty (Cadian Kill Team, dla kalibracji)

Leader 120 pts bazowo · Specialist 70 · Veteran 60 · Guardsman 50. Broń: power sword 50, plasma pistol 50, sniper rifle 40, plasma gun 80, frag launcher 85, laspistol 15, camo gear 5.

---

## 6. Podsumowanie: co budujemy, czego nie budujemy

**Budujemy:**
1. Model danych **węższy niż BattleScribe** — dopasowany do gier typu „banda pojedynczych wojowników z budżetem", czytelny w JSON/YAML bez dedykowanego edytora.
2. Silnik walidacji z zasięgami constraintów — bo bez tego builder jest tylko kalkulatorem.
3. Roster jako dokument z mutowalnym stanem per wojownik — kampania od pierwszego dnia w modelu.
4. Importer z BSData — żeby nie przepisywać ręcznie 12 frakcji SWA.
5. PDF, który jest **narzędziem przy stole**, nie wydrukiem ekranu (statline + profile broni + trackowanie amunicji/XP/kontuzji).

**Nie budujemy (na razie):** własnego edytora danych z GUI, backendu z kontami, narzędzi turniejowych, trackingu kolekcji. Wszystko to są dobre funkcje New Recruit, ale żadna z nich nie jest potrzebna, żeby zbudować kill team i wydrukować go na sesję.

---

## Źródła

- [Data structure overview · BSData/catalogue-development Wiki](https://github.com/BSData/catalogue-development/wiki/Data-structure-overview)
- [BSData/wh40k-shadow-war-armageddon](https://github.com/BSData/wh40k-shadow-war-armageddon) — `Shadow War Armageddon.gst`, `Space Marine Scouts.cat` (analizowane bezpośrednio)
- [New Recruit](https://www.newrecruit.eu/) · [download / platformy](https://www.newrecruit.eu/download/)
- [Army Builder — Lone Wolf Development Forums](https://forums.wolflair.com/threads/army-builder-data-files.1519/)
- [Is Rosterizer a real alternative to the Warhammer 40k app? — Wargamer](https://www.wargamer.com/warhammer-40k/app-alternative-rosterizer)
- [Shadow War: Armageddon — 2d4chan](https://2d4chan.org/wiki/Shadow_War:_Armageddon)
- [Shadow War: Armageddon — Building a Cadian Kill Team](https://www.alwaysboardneverboring.com/2017/05/shadow-war-armageddon-building-cadian.html)
