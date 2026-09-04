# BandBuilder — dokument projektowy

Wersja: 0.2 · Data: 2026-09-04 · Podstawa: [RESEARCH.md](RESEARCH.md)

> Sekcje §1–§12 to projekt sprzed implementacji. **§13 opisuje to, co faktycznie zbudowano**, wraz z miejscami, w których realne dane BSData wymusiły zmianę modelu. Gdzie §13 mówi coś innego niż §1–§12, prawdą jest §13.

---

## 1. Cel i zakres

BandBuilder to aplikacja do budowania i drukowania band/drużyn w skirmishowych grach bitewnych. Pierwszy wspierany system: **Shadow War: Armageddon**.

### Wymagania funkcjonalne (z zamówienia)

| # | Wymaganie | Gdzie w dokumencie |
|---|---|---|
| F1 | Dodawanie i odejmowanie jednostek | §5 model rostera, §7 silnik, §8 UI |
| F2 | Zliczanie punktów | §7.1 |
| F3 | Dodawanie ekwipunku do jednostek | §4.4 slots, §7.3 |
| F4 | Wydruk armii do PDF | §9 |

### Wymagania niefunkcjonalne, które wynikają z researchu

| # | Wymaganie | Uzasadnienie |
|---|---|---|
| N1 | Walidacja legalności bandy, nie tylko suma punktów | To jest realna wartość buildera (New Recruit, §2 researchu) |
| N2 | Dane oddzielone od kodu, w formacie czytelnym dla człowieka | Autorowanie danych to wąskie gardło BattleScribe (§1 researchu) |
| N3 | Roster z mutowalnym stanem per wojownik | Kampania SWA: XP, awanse, kontuzje (§4 researchu) |
| N4 | Offline-first, bez konta i bez backendu w v1 | Aplikacja używana przy stole, często bez wifi |
| N5 | Import z BSData | 12 frakcji SWA już istnieje w danych (§5 researchu) |

### Poza zakresem v1

Konta użytkowników i sync, narzędzia turniejowe, tracking kolekcji modeli, edytor danych z GUI, tryb „gra na żywo" (liczenie ran w trakcie partii).

---

## 2. Kluczowe decyzje projektowe

| # | Decyzja | Alternatywa odrzucona | Dlaczego |
|---|---|---|---|
| D1 | **Własny format danych** (BandBuilder Data Pack, JSON) zamiast BattleScribe XML jako formatu roboczego | Używać `.cat`/`.gst` bezpośrednio | Model BS jest generyczny do tego stopnia, że nieautorowalny ręcznie (§1 researchu). Nasza domena jest węższa: banda pojedynczych wojowników + budżet. Prostszy model = szybszy rozwój i dane pisane w edytorze tekstu |
| D2 | **Importer** BSData `.gst`/`.cat` → BBDP, jednorazowo/na żądanie | Ręczne przepisanie danych | 12 frakcji SWA istnieje. Import daje 90% treści za ułamek pracy; resztę dopina się ręcznie w JSON |
| D3 | Roster to **dokument z własnym stanem**, nie samo drzewo referencji | Roster = lista ID wyborów (jak BS) | N3 — bez tego kampania jest przepisaniem połowy aplikacji |
| D4 | Silnik walidacji **deklaratywny** (predykaty JSON), bez języka skryptowego | Skrypty (jak Army Builder) / modifiery BS | Deklaratywne reguły są serializowalne, testowalne i bezpieczne; nie ładujemy kodu z data packa |
| D5 | Reguły reprezentowane jako **constrainty z zasięgiem** + adjustery | Reguły zahardkodowane per system | Constraint `{scope, count, where, value}` pokrywa wszystkie znane reguły SWA (§5 researchu) łącznie z „Special Operatives podnoszą limit" |
| D6 | **Brak backendu w v1.** Persystencja IndexedDB + eksport/import pliku JSON | REST API + baza | N4, zero kosztu utrzymania, zero RODO. Sync można dodać później bez zmiany modelu |
| D7 | PDF generowany **po stronie klienta** | Renderowanie serwerowe | Wynika z D6; dodatkowo działa offline |
| D8 | **TypeScript monorepo**, core jako czysta biblioteka bez zależności od UI | Jedna aplikacja React | Silnik musi być testowalny bez DOM; importer i generator PDF też go używają |

---

## 3. Architektura

```
bandbuilder/
├── packages/
│   ├── core/              # model, silnik kosztów, walidacja, akcje. ZERO zależności runtime
│   ├── data-swa/          # data pack: Shadow War: Armageddon (JSON + testy zgodności)
│   ├── importer-bsdata/   # .gst/.cat → BBDP; CLI
│   ├── pdf/               # generowanie PDF z rostera (szablony)
│   └── schema/            # JSON Schema + typy TS generowane ze schematu
├── apps/
│   └── web/               # React + Vite PWA
└── docs/
```

Stos: TypeScript 5, React, Vite, Vitest. Walidacja data packów: Zod (albo JSON Schema + Ajv — patrz §12 O3). PDF: `@react-pdf/renderer` (patrz §9).

Przepływ danych — jednokierunkowy, silnik jest czysty:

```
                        ┌──────────────┐
   DataPack (JSON) ───► │              │
                        │  core engine │ ──► CostReport
   Roster (JSON)  ───►  │  (pure fns)  │ ──► ValidationReport
                        │              │ ──► OptionList (z powodami blokad)
   Action         ───►  │              │ ──► Roster'
                        └──────────────┘
```

`applyAction(roster, action) → roster'` jest jedyną drogą mutacji. Konsekwencje: undo/redo za darmo (log akcji), autosave po każdej akcji, deterministyczne testy.

---

## 4. Model danych: BandBuilder Data Pack (BBDP)

Jeden data pack = jeden system gry + jego frakcje. Format: JSON (pisany ręcznie lub generowany importerem). Poniżej struktura z przykładami wypełnionymi realnymi danymi SWA.

### 4.1 Nagłówek i definicja systemu

```json
{
  "schema": "bandbuilder/datapack@1",
  "id": "swa",
  "name": "Shadow War: Armageddon",
  "version": "0.1.0",
  "vocabulary": {
    "band": "Kill Team",
    "fighter": "Fighter",
    "currency": "pts",
    "campaignCurrency": "Promethium Cache"
  },
  "budget": { "default": 1000, "editable": true },

  "statline": [
    { "id": "M",  "label": "M",  "type": "text" },
    { "id": "WS", "label": "WS", "type": "int", "max": 10 },
    { "id": "BS", "label": "BS", "type": "int", "max": 10 },
    { "id": "S",  "label": "S",  "type": "int", "max": 10 },
    { "id": "T",  "label": "T",  "type": "int", "max": 10 },
    { "id": "W",  "label": "W",  "type": "int" },
    { "id": "I",  "label": "I",  "type": "int", "max": 10 },
    { "id": "A",  "label": "A",  "type": "int" },
    { "id": "Ld", "label": "Ld", "type": "int", "max": 10 }
  ],

  "categories": [
    { "id": "leader",    "name": "Leader" },
    { "id": "trooper",   "name": "Troopers" },
    { "id": "specialist","name": "Specialists" },
    { "id": "recruit",   "name": "New Recruits" },
    { "id": "operative", "name": "Special Operatives" }
  ]
}
```

`statline` jest deklaratywny, bo to on definiuje kolumny tabeli w UI i w PDF. Zmiana systemu gry = zmiana tej listy, nie kodu.

### 4.2 Typy profili (statystyki broni i wyposażenia)

Odwzorowanie 1:1 tego, co jest w danych SWA — dzięki temu import jest bezstratny w tej części.

```json
"profileTypes": [
  { "id": "ranged", "name": "Ranged Weapons",
    "columns": ["Short Range","Long Range","Short To Hit","Long To Hit",
                "Str.","Dam.","Save Mod.","Ammo Roll","Special"] },
  { "id": "melee",  "name": "Melee Weapons",
    "columns": ["Str.","Dam.","Save Mod.","Special"] },
  { "id": "grenade","name": "Grenades",
    "columns": ["Str.","Dam.","Save Mod.","Special"] },
  { "id": "armour", "name": "Armour",  "columns": ["Armour Save","Special"] },
  { "id": "wargear","name": "Wargear", "columns": ["Description"] },
  { "id": "skill",  "name": "Skill",   "columns": ["Description"] }
]
```

### 4.3 Reguły bandy (constrainty + adjustery)

To jest serce D5. Wszystkie reguły budowy kill teamu z §5 researchu wyrażone deklaratywnie:

```json
"bandRules": [
  { "id": "min-fighters",  "type": "min", "count": "fighters", "value": 3,
    "message": "Kill Team musi mieć co najmniej 3 modele",
    "adjust": [{ "perFighterWhere": { "category": "operative" }, "delta": 1 }] },

  { "id": "max-fighters",  "type": "max", "count": "fighters", "value": 10,
    "message": "Kill Team może mieć najwyżej {limit} modeli",
    "adjust": [{ "perFighterWhere": { "category": "operative" }, "delta": 1 }] },

  { "id": "leader-exactly-1", "type": "range", "count": "fighters",
    "where": { "category": "leader" }, "min": 1, "max": 1,
    "message": "Kill Team musi mieć dokładnie jednego Leadera" },

  { "id": "max-specialists", "type": "max", "count": "fighters",
    "where": { "category": "specialist" }, "value": 2,
    "message": "Najwyżej {limit} Specialistów" },

  { "id": "recruits-budget", "type": "max", "count": "cost",
    "where": { "category": "recruit" }, "value": 50, "unit": "percentOfBudget",
    "message": "New Recruits nie mogą przekroczyć 50% budżetu bandy" },

  { "id": "budget", "type": "max", "count": "cost", "value": "$budget",
    "severity": "error", "message": "Przekroczony budżet" }
]
```

Gramatyka constraintu:

```
Constraint = {
  id: string
  type: "min" | "max" | "range"
  count: "fighters" | "cost" | "items"
  where?: Predicate            // filtr; brak = cała banda
  value | min, max: number | "$budget"
  unit?: "absolute" | "percentOfBudget"   // default absolute
  severity?: "error" | "warning"          // default error
  message: string                          // {limit}, {actual} interpolowane
  adjust?: Adjuster[]
}

Adjuster = { perFighterWhere: Predicate, delta: number }   // dynamiczny limit
         | { when: Predicate, delta: number }
```

`adjust` zastępuje cały mechanizm `modifier` + `repeat` z BattleScribe dla naszego przypadku użycia i mieści się w jednej linii zamiast w dwunastu liniach XML-a z GUID-ami.

Odstępstwa frakcyjne (Orkowie 3–20, Astra Militarum 3 Specialists) idą przez `ruleOverrides` w definicji frakcji — patrz 4.5.

### 4.4 Typ wojownika

```json
{
  "id": "sm-scout-sergeant",
  "name": "Scout Sergeant",
  "faction": "sm-scouts",
  "categories": ["leader"],
  "cost": 180,
  "max": 1,
  "statline": { "M": "5\"", "WS": 4, "BS": 4, "S": 4, "T": 4, "W": 1, "I": 4, "A": 2, "Ld": 9 },
  "rules": ["and-they-shall-know-no-fear"],
  "skillTables": ["combat", "ferocity", "muscle", "stealth", "techno"],
  "loadout": {
    "granted": [ { "itemId": "combat-knife" } ],
    "slots": [
      { "id": "main",    "name": "Main Weapon",       "min": 0, "max": 1, "from": "sm-basic" },
      { "id": "pistols", "name": "Pistols",           "min": 0, "max": 2, "from": "sm-pistols" },
      { "id": "melee",   "name": "Hand-to-Hand",      "min": 0, "max": 2, "from": "sm-melee" },
      { "id": "grenades","name": "Grenades",          "min": 0, "max": null, "from": "sm-grenades" },
      { "id": "gear",    "name": "Gear",              "min": 0, "max": null, "from": "sm-gear",
        "distinct": true }
    ]
  }
}
```

- `granted` — ekwipunek startowy w cenie modelu (0 pts).
- `slots` — grupy wyborów odpowiadające grupom z prawdziwych danych SWA (§5 researchu). `max: null` = bez limitu, `distinct: true` = każdy item najwyżej raz.
- `from` — ID listy ekwipunku (arsenału). Wielokrotne użycie tej samej listy przez różnych wojowników to nasz odpowiednik `entryLink`.
- `max` na poziomie typu wojownika — „najwyżej 1 Scout Sergeant w bandzie".

### 4.5 Frakcja

```json
{
  "id": "sm-scouts",
  "name": "Space Marine Scouts",
  "book": "Shadow War: Armageddon",
  "fighterTypes": ["sm-scout-sergeant", "sm-scout", "sm-scout-heavy"],
  "specialOperatives": ["sm-vanguard-veteran", "sm-sternguard-veteran"],
  "ruleOverrides": [],
  "choices": [
    { "id": "chapter", "name": "Chapter", "required": true,
      "options": ["ultramarines", "space-wolves", "blood-angels", "dark-angels"] }
  ]
}
```

Przykład override dla Orków i Guardu:

```json
"ruleOverrides": [
  { "ruleId": "max-fighters",     "set": { "value": 20 } },
  { "ruleId": "max-specialists",  "set": { "value": 3 } }
]
```

`choices` obsługuje przypadek `Select Chapter` z prawdziwych danych — wybór na poziomie bandy, który może odblokowywać itemy (predykat `{ "bandChoice": { "chapter": "space-wolves" } }`).

### 4.6 Lista ekwipunku (arsenał)

```json
{
  "id": "sm-basic",
  "name": "Basic Weapons",
  "entries": [
    { "itemId": "boltgun",      "cost": 35 },
    { "itemId": "shotgun",      "cost": 30 },
    { "itemId": "sniper-rifle", "cost": 50,
      "available": { "category": "specialist" } }
  ]
}
```

`cost` jest na wpisie listy, nie na itemie — bo ta sama broń kosztuje różnie w różnych frakcjach. `available` to predykat (§4.8) i to on obsługuje przypadek Kadian („snajperka tylko dla Specialisty").

### 4.7 Item

```json
{
  "id": "boltgun",
  "name": "Boltgun",
  "kind": "ranged",
  "profiles": [
    { "type": "ranged", "values": {
        "Short Range": "0-12", "Long Range": "12-24",
        "Short To Hit": "-", "Long To Hit": "-1",
        "Str.": "4", "Dam.": "1", "Save Mod.": "-1",
        "Ammo Roll": "6+", "Special": "" } }
  ],
  "rules": ["unwieldy"],
  "options": [
    { "id": "reload", "name": "Weapon Reload", "cost": 13, "max": 3 }
  ],
  "effects": [
    { "stat": "S", "op": "add", "value": 1 }
  ]
}
```

- `options` — zagnieżdżone podzakupy (Weapon Reload za 13 pts z prawdziwych danych). Głębokość zagnieżdżenia ograniczona do 2 poziomów — świadomie, żeby UI był prosty.
- `effects` — modyfikacja statline'u nosiciela (np. bionika, pancerz dodający T). Zamknięta lista operacji: `add`, `sub`, `set`, `min`, `max`.

### 4.8 Predykaty

Jeden mechanizm używany w `available`, `adjust.when`, warunkach reguł.

```
Predicate =
  { category: CategoryId }                     // wojownik ma tę kategorię
  | { fighterType: FighterTypeId }
  | { hasItem: ItemId }
  | { hasAnyItem: ItemId[] }
  | { stat: { <StatId>: { ">=" | "<=" | "==": number } } }
  | { bandChoice: { <ChoiceId>: OptionId } }
  | { count: { of: "fighters" | "items", where: Predicate },
      op: ">=" | "<=" | "==", value: number }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
```

Zamknięta gramatyka, brak eval, brak dowolnego kodu z data packa (D4). Ewaluator to jedna funkcja rekurencyjna, w pełni pokryta testami.

---

## 5. Model danych: roster

```json
{
  "schema": "bandbuilder/roster@1",
  "id": "01J8Z...",
  "name": "Kaine's Recon",
  "dataPack": { "id": "swa", "version": "0.1.0" },
  "faction": "sm-scouts",
  "bandChoices": { "chapter": "ultramarines" },
  "budget": 1000,

  "fighters": [
    {
      "uid": "f1",
      "typeId": "sm-scout-sergeant",
      "name": "Sgt. Kaine",
      "items": [
        { "uid": "i1", "slotId": "main",     "itemId": "boltgun",
          "options": [{ "id": "reload", "qty": 1 }] },
        { "uid": "i2", "slotId": "grenades", "itemId": "frag-grenade" }
      ],
      "campaign": {
        "xp": 12,
        "advances": [ { "id": "a1", "kind": "stat",  "stat": "I", "delta": 1 },
                      { "id": "a2", "kind": "skill", "skillId": "sprint" } ],
        "injuries": [ { "id": "inj1", "type": "old-battle-wound" } ],
        "status": "active"
      },
      "notes": ""
    }
  ],

  "campaign": {
    "enabled": true,
    "caches": 3,
    "games": [ { "id": "g1", "date": "2026-09-01", "result": "win", "cachesGained": 2 } ],
    "stash": [ { "itemId": "plasma-gun" } ]
  },

  "meta": { "created": "...", "modified": "...", "appVersion": "0.1.0" }
}
```

Uwagi:

- **`dataPack.version` jest zapisywana w rosterze.** Gdy data pack się zmieni (np. korekta kosztów), aplikacja pokazuje diff „co się zmieniło w twojej bandzie" zamiast po cichu przeliczyć punkty. To jest częsty ból w BattleScribe.
- **`campaign` per wojownik** — realizacja D3/N3. W trybie bez kampanii to pole jest po prostu puste; nic nie trzeba przebudowywać, żeby włączyć kampanię.
- `uid` na wojowniku i na itemie — bo można mieć dwa identyczne pistolety i trzeba je odróżnić przy usuwaniu.
- Roster **nie cache'uje kosztów**. Koszty to funkcja czysta z (roster, pack); cache'owanie ich w dokumencie to gwarantowana niespójność.

---

## 6. Akcje (jedyna droga mutacji rostera)

```ts
type Action =
  | { t: "band/rename",      name: string }
  | { t: "band/setBudget",   value: number }
  | { t: "band/setChoice",   choiceId: string, optionId: string }
  | { t: "fighter/add",      typeId: string, name?: string }
  | { t: "fighter/remove",   uid: string }
  | { t: "fighter/rename",   uid: string, name: string }
  | { t: "fighter/duplicate", uid: string }
  | { t: "item/add",         fighterUid: string, slotId: string, itemId: string }
  | { t: "item/remove",      fighterUid: string, itemUid: string }
  | { t: "item/setOption",   fighterUid: string, itemUid: string, optionId: string, qty: number }
  | { t: "campaign/addXp",   fighterUid: string, delta: number }
  | { t: "campaign/addAdvance",  fighterUid: string, advance: Advance }
  | { t: "campaign/addInjury",   fighterUid: string, injury: Injury }
  | { t: "campaign/setStatus",   fighterUid: string, status: FighterStatus }
  | { t: "campaign/logGame",     game: GameRecord }
```

`fighter/add` z `granted` ekwipunkiem i slotami o `min > 0` wypełnia je automatycznie najtańszą legalną opcją — użytkownik nie zaczyna od listy błędów.

**Ważna zasada:** akcje **nie są blokowane** przez walidację. Można dodać 11. wojownika i przekroczyć budżet — aplikacja to pokaże jako błąd, ale nie zabroni. Powód: przy budowaniu listy notorycznie przechodzi się przez stany nielegalne (dodam broń, potem usunę wojownika). Blokowanie akcji to najczęstsza skarga na buildery. Wyjątek: akcje niemożliwe do zinterpretowania (item nie z tego slotu) są odrzucane jako błąd programistyczny.

---

## 7. Silnik

Pakiet `core`, funkcje czyste, bez I/O.

### 7.1 Koszty (F2)

```
itemCost(entry, item)      = entry.cost + Σ option.cost × option.qty
fighterCost(fighter, pack) = type.cost + Σ itemCost(...)     // granted → 0
bandCost(roster, pack)     = Σ fighterCost(...)
```

`computeCosts()` zwraca strukturę, nie liczbę — UI potrzebuje rozbicia:

```ts
type CostReport = {
  total: number
  budget: number
  remaining: number                        // może być < 0
  byFighter: Record<string, number>
  byItem: Record<string, number>
  byCategory: Record<CategoryId, number>   // do reguły „recruits ≤ 50%"
}
```

### 7.2 Walidacja (N1)

```ts
type Issue = {
  ruleId: string
  severity: "error" | "warning"
  scope: "band" | "fighter" | "slot"
  targetUid?: string
  message: string        // gotowy do wyświetlenia, po interpolacji {limit}/{actual}
}

validate(roster, pack): Issue[]
```

Kroki:
1. Zbuduj efektywne limity: dla każdej reguły zastosuj `ruleOverrides` frakcji, potem `adjust` (np. +1 min/max za każdego Special Operative).
2. Sprawdź reguły bandy (`bandRules`) — liczenie wg `count`/`where`, z `byCategory` z CostReport dla `count: "cost"`.
3. Sprawdź `max` per typ wojownika.
4. Dla każdego wojownika: dla każdego slotu sprawdź `min`/`max`/`distinct`; dla każdego itemu sprawdź, że jego `available` jest wciąż spełniony (bo mógł być spełniony w momencie zakupu, a potem zmieniła się kategoria wojownika).
5. Sprawdź `required` `choices` frakcji.

Kolejność stabilna — żeby lista błędów nie skakała po ekranie przy każdej edycji.

### 7.3 Dostępne opcje ekwipunku (F3)

```ts
type Option = {
  itemId: string
  name: string
  cost: number
  profilesPreview: Profile[]
  disabled: boolean
  disabledReason?: string      // np. „tylko dla Specialisty", „slot pełny (1/1)"
  wouldExceedBudget: boolean   // miękkie ostrzeżenie, nie blokada
}

availableOptions(roster, pack, fighterUid, slotId): Option[]
```

**Decyzja UX (i to jest różnica jakościowa wobec BattleScribe):** opcje niedostępne są **pokazywane jako wyszarzone z powodem**, nie ukrywane. Użytkownik, który szuka snajperki w liście Kadianina, ma zobaczyć „Sniper rifle 40 pts — tylko dla Specialisty", a nie puste miejsce, po którym nie wie, czy broni nie ma w grze, czy on czegoś nie umie.

### 7.4 Efektywny statline

```
effectiveStatline(fighter, pack) =
  base(type.statline)
  → + advances (kind: "stat")
  → + effects itemów (add/sub/set/min/max, w tej kolejności)
  → + injuries (mogą trwale obniżać)
  → clamp do statline[].max jeśli zdefiniowany
```

Funkcja zwraca też ślad („BS 4 → 5: awans a2"), używany w tooltipie i w PDF karty kampanijnej.

---

## 8. UI

### Desktop — trzy kolumny

```
┌──────────────────────┬────────────────────────────────┬──────────────────────┐
│  BANDA               │  WOJOWNIK: Sgt. Kaine          │  STATUS              │
│                      │                                │                      │
│ Kaine's Recon        │  Scout Sergeant · Leader       │ ██████████░░  847/1000│
│ Space Marine Scouts  │  M5" WS4 BS4 S4 T4 W1 I5 A2 Ld9│                      │
│ Ultramarines         │  (I 4→5: awans)                │ ✖ Brak Leadera       │
│                      │                                │ ✖ 11 modeli (max 10) │
│ ▸ Leader        (1/1)│  ── Main Weapon ────── 1/1 ──  │ ⚠ New Recruits 52%   │
│   Sgt. Kaine    215  │  ● Boltgun            35 pts   │   budżetu (max 50%)  │
│ ▸ Specialists   (2/2)│    └ Weapon Reload ×1  13 pts  │                      │
│   Ryan          130  │  ○ Shotgun            30 pts   │ Kategorie:           │
│   Spoon         165  │  ⊘ Sniper rifle       50 pts   │  Leader       215    │
│ ▸ Troopers      (3)  │      tylko dla Specialisty     │  Specialists  295    │
│   ...                │                                │  Troopers     337    │
│                      │  ── Pistols ────────── 0/2 ──  │                      │
│ [+ Dodaj wojownika]  │  ○ Bolt pistol        20 pts   │ [Wydruk PDF]         │
│                      │  ...                           │ [Eksport JSON]       │
│                      │  [Usuń wojownika]              │                      │
└──────────────────────┴────────────────────────────────┴──────────────────────┘
```

- Lewa kolumna: banda pogrupowana po kategoriach, z licznikiem `użyte/limit` przy nagłówku grupy. Drag & drop nie jest potrzebny.
- Środek: edytor wybranego wojownika. Slot = sekcja z licznikiem `wybrane/max`. Opcje jako lista radio (`max: 1`) lub checkbox/stepper (`max > 1`). `⊘` = zablokowane z powodem inline.
- Prawa: pasek budżetu (czerwony po przekroczeniu), lista problemów (klik = skok do wojownika), rozbicie kosztów po kategoriach, akcje eksportu.
- Ctrl+Z / Ctrl+Y na logu akcji. Autosave po każdej akcji (debounce 300 ms).

### Mobile

Jedna kolumna, nawigacja Banda → Wojownik. Sticky bottom bar: `847/1000` + liczba błędów + przycisk PDF. Ten sam kod komponentów, inny layout.

### Dodawanie wojownika (F1)

Dialog z listą typów pogrupowaną po kategoriach. Przy każdym: koszt bazowy i status legalności *przed* dodaniem — np. „Scout Sergeant 180 pts — Leader już obsadzony (1/1)". Dodanie mimo to jest możliwe (§6), ale użytkownik wie, co robi.

### Usuwanie (F1)

Usunięcie wojownika z ekwipunkiem: bez dialogu potwierdzenia, z toastem „Usunięto Sgt. Kaine (215 pts) — Cofnij". Undo jest tańszy niż confirm dialog.

---

## 9. Wydruk PDF (F4)

### Wybór technologii

**Rekomendacja: `@react-pdf/renderer`.** Deklaratywne komponenty, flexbox, kontrola paginacji (`wrap`, `break`), własne fonty, działa w przeglądarce, deterministyczny wynik niezależny od przeglądarki użytkownika.

Rozważone alternatywy:
- **HTML + `@media print` + `window.print()`** — najtańsze (dzień pracy), ale użytkownik musi sam wybrać „Zapisz jako PDF", paginacja tabel jest niesterowalna, a wynik różni się między przeglądarkami. **Dobre jako v0**, żeby mieć wydruk od pierwszego milestone'u.
- `pdfmake` — działa, ale layout oparty na tabelach jest męczący przy kartach wojowników.
- `jsPDF` — zbyt niskopoziomowy, ręczne pozycjonowanie.
- Puppeteer po stronie serwera — łamie D6/D7.

Plan: print-CSS w M1, `@react-pdf/renderer` w M3 jako właściwa implementacja.

### Trzy szablony

**A. Roster Sheet — 1 strona, na turniej / do teczki**

```
KAINE'S RECON                    Space Marine Scouts · Ultramarines
Budżet 1000 · Wydane 985 · Zostało 15 · Caches 3        [status: LEGALNA]

# Wojownik          Typ               Kat.  M   WS BS S  T  W  I  A  Ld   Pts
1 Sgt. Kaine        Scout Sergeant    LDR   5"  4  4  4  4  1  5  2  9    215
    Boltgun (+reload ×1), Frag grenade
2 Ryan              Scout             SPC   6"  3  4  3  4  1  4  1  8    130
    Sniper rifle, Bolt pistol, Camo cloak
...
                                                            RAZEM   985 / 1000
```

**B. Fighter Cards — karta na wojownika, do gry przy stole**

To jest szablon, który faktycznie jedzie na sesję. Zawiera to, po co się sięga w trakcie partii:

```
┌─ Sgt. Kaine ──────────────────────── Scout Sergeant · Leader · 215 pts ─┐
│  M    WS  BS  S   T   W   I   A   Ld                                     │
│  5"   4   4   4   4   1   5   2   9        Rany  □ □ □                   │
│                                                                          │
│  BROŃ            Rng S/L   ToHit S/L  Str Dam Save  Ammo  Amunicja      │
│  Boltgun         0-12/12-24   -/-1     4   1   -1   6+    □□□ (reload×1) │
│  Frag grenade         8"       -       4   1   -1   4+    □               │
│                                                                          │
│  ZASADY: And They Shall Know No Fear · Unwieldy (boltgun)                │
│  UMIEJĘTNOŚCI: Sprint                                                    │
│                                                                          │
│  XP 12   □□□□□ □□□□□ □□□□□        KONTUZJE: Old Battle Wound             │
└──────────────────────────────────────────────────────────────────────────┘
```

Kluczowe: kratki na trackowanie amunicji (bo SWA ma Ammo Roll i reloady — §5 researchu), kratki na rany, kratki na XP. Karta bez tego to tylko ładny obrazek.

**C. Weapon Reference — unikalne profile broni użytych w bandzie**

Jedna tabela z profilami, żeby nie szukać w rulebooku. Generowana automatycznie z `distinct(items)` w rosterze.

### Opcje eksportu

Checkboxy: które szablony, czy uwzględniać pola kampanijne (XP/kontuzje/amunicja), czy pokazywać pełne teksty zasad czy tylko nazwy, format A4/Letter. Nazwa pliku: `{band-name}-{date}.pdf`.

---

## 10. Import z BSData (N5)

CLI w `packages/importer-bsdata`:

```bash
pnpm importer --system ./data/swa/*.gst --catalogues ./data/swa/*.cat --out packages/data-swa/src/
```

Mapowanie:

| BattleScribe | BBDP |
|---|---|
| `gameSystem.costTypes` | `budget.currency` |
| `profileType` + `characteristicType` | `profileTypes[].columns` |
| `profileType name="Model"` | `statline` |
| `categoryEntry` | `categories` |
| `forceEntry.constraints` + `categoryLinks[].constraints` | `bandRules` |
| `modifier` + `repeat` na constraincie | `bandRules[].adjust` |
| `selectionEntry type="model"` | `fighterTypes` |
| `selectionEntryGroup` w modelu | `fighterTypes[].loadout.slots` |
| `selectionEntry type="upgrade"` | `items` + wpis w `equipmentLists` |
| zagnieżdżony `selectionEntry` w itemie | `items[].options` |
| `profile` + `characteristic` | `items[].profiles` |
| `rule` / `infoLink type="rule"` | `rules` |
| `constraint` na grupie | `slots[].min/max` |
| `condition` na `available` | `Predicate` |

**Import jest z założenia niekompletny.** Rzeczy, które nie zmapują się automatycznie (skomplikowane `conditionGroup`, tabele awansów w `Attribute Advancement`), importer wypisuje jako listę **`TODO: DO UZUPEŁNIENIA`** w raporcie i zostawia w danych pole `"_unmapped": [...]`. Ręczna dopinka po imporcie jest oczekiwaną częścią procesu, nie awarią.

Uwaga prawna: dane SWA to własność Games Workshop. Data packi trzymamy **osobno od kodu aplikacji** (osobne repo/pakiet, model BSData: „community-maintained, in no way endorsed"), aplikacja jest generyczna i pusta bez data packa.

---

## 11. Persystencja i milestone'y

### Persystencja (D6)

- **IndexedDB** — lista rosterów + log akcji dla undo. Autosave.
- **Eksport/import pliku** `.bbroster` (JSON) — backup i wymiana list.
- **Share link** — roster skompresowany (`deflate` + base64url) w URL-u. Działa do ~10 wojowników; powyżej komunikat „użyj eksportu pliku".
- Data packi: wbudowane w build + możliwość wczytania własnego pliku JSON (tryb dla autorów danych, z hot reloadem — lekcja z Army Builder, §3 researchu).

### Milestone'y

| M | Zakres | Efekt |
|---|---|---|
| **M0** ✅ | `core`: model, `computeCosts`, `applyAction`, walidacja, testy jednostkowe | Silnik działa i jest przetestowany |
| **M1** ✅ | UI: trzy kolumny, dodawanie/usuwanie wojowników, licznik punktów, ekwipunek, walidacja, zapis w przeglądarce, undo, wydruk | **Wszystkie 4 wymagania funkcjonalne działają** |
| **M2** ✅ | Importer BSData + pełne dane SWA (15 frakcji) + raport DO UZUPEŁNIENIA. Eksport/import JSON | Prawdziwa treść, nie demo |
| **M3** ✅ | Trzy szablony wydruku: karta drużyny, karty wojowników, ściąga broni | Wydruk używalny przy stole |
| **M4** ✅ | Tryb kampanii: XP, drzewa umiejętności, awanse atrybutów, kontuzje, status, promethium caches, log gier | Wyróżnik wobec New Recruit dla SWA |
| **M5** ⬜ | Share linki, PWA, wczytywanie własnych data packów, drugi system gry (Necromunda '95 / Mordheim) jako test generyczności modelu | Skalowanie |

M0–M4 są zbudowane. Szczegóły i odstępstwa od projektu: §13.

---

## 12. Otwarte pytania (do decyzji przed M0)

| # | Pytanie | Moja rekomendacja |
|---|---|---|
| O1 | Skąd biorą się dane SWA: import z BSData czy podsumowanie od drugiego agenta? | **Rozstrzygnięte:** danych od agenta nie będzie, całość pochodzi z importu BSData (§13.1) |
| O2 | Tryb kampanii w v1 czy później? | **Rozstrzygnięte:** zbudowany w całości (§13.5) |
| O3 | Walidacja data packa: Zod czy JSON Schema + Ajv? | **Odłożone.** Data pack ma jednego producenta (nasz importer) i jest sprawdzany testami na realnej treści, więc schemat runtime nie kupuje na razie niczego. Wróci, gdy ktoś zacznie pisać data packi ręcznie |
| O4 | Czy ekwipunek „w cenie" ma być usuwalny? | **Rozstrzygnięte:** nie. Pozycje z `min = max ≥ 1` są oznaczone „w cenie" i nieodznaczalne |
| O5 | Wielojęzyczność UI (PL/EN)? | **Rozstrzygnięte:** UI po polsku, nazwy z gry po angielsku (bo takie są na modelach i w rulebooku). Warstwy i18n nie ma — aplikacja ma jednego użytkownika |
| O6 | Nazwa modelu jako część rostera czy tylko typ? | **Rozstrzygnięte:** własna nazwa, domyślnie `Scout`, `Scout 2`… liczone per typ, edytowalna |

---

## 13. Co zbudowano — i czym się to różni od projektu 0.1

Kolejność prac: research → projekt (§1–§12) → import danych → silnik → UI → wydruk. Zderzenie z realnymi plikami BSData wymusiło cztery zmiany w modelu. Wszystkie idą w stronę **wierności danym**, nie wygody.

### 13.1 Dane: importer zamiast ręcznego data packa

Danych od drugiego agenta nie będzie, więc jedynym źródłem jest [BSData/wh40k-shadow-war-armageddon](https://github.com/BSData/wh40k-shadow-war-armageddon). `tools/import-bsdata.mjs` rozwiązuje graf `entryLink`-ów w płaskie drzewo i produkuje jeden plik `src/data/swa.json` (~900 KB).

Wynik: **15 frakcji, 123 typy wojowników, 2326 węzłów ekwipunku, 475 profili.** Jedna niezmapowana konstrukcja i dwa konflikty w danych źródłowych, wszystkie wypisane w [IMPORT-REPORT.md](../data/IMPORT-REPORT.md).

Trzy rzeczy, których projekt nie przewidział, a dane wymusiły:

1. **Nazwy kategorii różnią się między katalogami** — „Leader" vs „Kill Team Leader", „Trooper" vs „Troopers" vs „Tooper" (literówka w źródle), Tau ma osobną kategorię „Drone". Importer dopasowuje po kształcie nazwy, nie po dokładnym stringu, i sprowadza wszystko do pięciu kanonicznych kategorii.
2. **Każdy katalog ma własny `forceEntry`**, czasem niekompletny. Reguły drużyny są scalane: baza z `.gst`, nadpisania z `.cat`. Dzięki temu odstępstwa frakcyjne przechodzą przez import same z siebie — Orkowie 3–20 modeli, Guard i Skitarii 3 Specialistów, Genestealer Cults 15 modeli, Grey Knights i Tyranidy maks. 5.
3. **W danych są sprzeczności.** Ork Boyz deklaruje jednocześnie „max 20" i „max 3" modeli bez żadnego minimum; Adepta Sororitas oznacza „Seraphim" (ulepszenie, nie model) jako pozycję rostera; Genestealer „Neophyte Initiate" ma puste BS i S. Importer rozstrzyga to jawną, opisaną regułą i **wypisuje każdy przypadek w raporcie** — nigdy nie zgaduje po cichu. Puste statystyki trafiają do danych jako `?`, żeby braku nie dało się przeoczyć na wydruku.

### 13.2 Ekwipunek: rekurencyjne drzewo zamiast płaskich slotów

Projekt (§4.4) zakładał `slots[].from` — płaską listę arsenału per slot. Realne dane są głębsze: grupa może zawierać grupy (`entryLink type="selectionEntryGroup"`), a broń ma własne podzakupy, które mają własne grupy. Scout Sergeant to `Gear → Basic Weapons → Boltgun → {Weapon Reload, Scopes → Telescopic sight, Ammunition → Hellfire bolts}`.

Model jest więc drzewem dwóch rodzajów węzłów:

```ts
type LoadoutNode =
  | { k: 'g', id, name, min, max, children }                          // grupa wyborów
  | { k: 'i', id, ref, name, cost, min, max, profiles, rules, children, effect? }
```

Konsekwencje, które wyszły na plus: „ekwipunek w cenie" to zwykły węzeł z `min = max = 1` (nie osobny mechanizm), a wymagane pod-wybory („Missile launcher → wybierz typ pocisku") walidują się tą samą regułą co wszystko inne.

### 13.3 Selekcje: płaska mapa zamiast drzewa w rosterze

Projekt (§5) trzymał w rosterze zagnieżdżone `items[].options[]`. Okazało się, że **identyfikatory węzłów są unikalne w obrębie typu wojownika** (sprawdzone: 4360 węzłów, zero kolizji), więc wybór to po prostu `{ nodeId, qty }`, a pozycja w drzewie jest odtwarzalna z data packa. Roster nie może się rozjechać z katalogiem, bo nie duplikuje jego struktury.

Usunięcie broni kasuje jej pod-wybory (`prune`), a wybranie czegokolwiek dociąga obowiązkowe pozycje (`autoFill`) — obie funkcje iterują do stabilizacji, bo ulepszenie może odsłonić kolejne obowiązkowe ulepszenie.

### 13.4 PDF: wydruk przez przeglądarkę, nie generator

Projekt rekomendował `@react-pdf/renderer`. Odrzucone po sprawdzeniu kosztu: wbudowane fonty generatorów PDF (jsPDF, react-pdf) używają WinAnsi, w którym **nie ma polskich znaków**, a osadzenie własnego fontu to ~0,5 MB base64 w pliku, który ma działać offline z dysku.

Zamiast tego jest widok `PrintView`, który renderuje dokument A4 na ekranie dokładnie tak, jak wyjdzie na papierze, i oddaje generowanie PDF-a przeglądarce (*Zapisz jako PDF*). Zysk poza rozmiarem: poprawna polszczyzna, prawdziwa paginacja z `break-inside: avoid` na kartach i podgląd WYSIWYG zamiast niewidocznego arkusza `@media print`.

Trzy szablony z §9 są zbudowane wszystkie. Karta wojownika ma **ujednoliconą tabelę broni** (strzelecka, biała i granaty w jednej tabeli, bo przy stole nikt nie przeskakuje między trzema) oraz kratki na amunicję liczone jako *jeden strzał + jeden na każdy wykupiony reload*.

### 13.5 Kampania: zbudowana, nie odłożona

Skoro dane BSData zawierają drzewa umiejętności i tabele awansów atrybutów, koszt dodania kampanii spadł do zera po stronie treści. Zbudowane: XP, wybór umiejętności z drzew frakcyjnych, awanse atrybutów wpływające na efektywny statline (z podświetleniem zmienionej wartości i podpowiedzią wartości bazowej), lista kontuzji, status wojownika, promethium caches, log gier.

Awanse są trzymane osobno od ekwipunku (`fighter.campaign.advances` vs `fighter.gear`) i nie wchodzą do kosztu drużyny — importer rozdziela drzewo na podstawie grup `Skills` i `Advance Attributes`.

### 13.6 Struktura: jedna aplikacja zamiast monorepo

§3 zakładało `packages/*` + `apps/web`. Dla narzędzia z jednym użytkownikiem monorepo to koszt bez korzyści, więc jest jeden projekt Vite z zachowanym rozdziałem, który był w tym istotny: `src/core` nie importuje niczego z UI i jest testowany bez DOM-u.

Build to jeden samowystarczalny plik HTML (`vite-plugin-singlefile`, ~1,1 MB) — bez CDN, bez fetchowania czegokolwiek w runtime. `start.cmd` podaje go po `http://localhost`, bo przeglądarki traktują `file://` jako opaque origin i część z nich odmawia zapisu do `localStorage`; aplikacja wykrywa taki przypadek i ostrzega.

### 13.7 Czego nie ma

Share linków, PWA, wczytywania własnych data packów z pliku, drugiego systemu gry, narzędzi turniejowych, trackingu kolekcji, edytora danych. Nic z tego nie było w zamówieniu.

### 13.8 Testy

`npm test` — 27 testów silnika na realnym data packu: koszty (baza, ekwipunek, ilości, ekwipunek w cenie, rozbicie po kategoriach), kasowanie osieroconych pod-wyborów, walidacja (leader, limity kategorii, budżet, New Recruits ≤ 50% budżetu, dynamiczny limit modeli za każdego Special Operative, limit per typ), kampania (awanse na statline, darmowość awansów, caches), akcje (nazewnictwo, duplikowanie, niemutowalność) oraz przejście po **wszystkich 123 typach wojowników** z zaznaczonym każdym możliwym elementem ekwipunku — na wypadek gdyby któraś frakcja miała kształt danych, którego silnik nie przewiduje.
