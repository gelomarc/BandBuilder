# BandBuilder

Builder band / kill teamów do skirmishowych gier bitewnych. Pierwszy wspierany system: **Shadow War: Armageddon**.

Status: **faza projektowa** — kod jeszcze nie istnieje.

## Dokumentacja

- [docs/RESEARCH.md](docs/RESEARCH.md) — jak działają BattleScribe, New Recruit, Army Builder i Rosterizer; reguły budowy kill teamu w Shadow War: Armageddon
- [docs/DESIGN.md](docs/DESIGN.md) — projekt aplikacji: model danych, silnik kosztów i walidacji, UI, wydruk PDF, milestone'y

## Zakres funkcjonalny v1

Dodawanie i usuwanie wojowników · zliczanie punktów · ekwipunek per wojownik · walidacja legalności bandy · wydruk do PDF.

## Dane

Dane systemów gry (data packi) są trzymane osobno od kodu aplikacji. Aplikacja jest generyczna — bez wczytanego data packa nie zawiera treści żadnej gry.
