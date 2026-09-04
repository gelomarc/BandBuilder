import type { Roster } from '../core/types'

// Everything lives in the browser. The app is also expected to run from file://, where IndexedDB
// is blocked in Chromium but localStorage works, so localStorage is the store and JSON export is
// the durable backup.
const KEY = 'bandbuilder/rosters@1'
const ACTIVE = 'bandbuilder/active@1'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadRosters(): Roster[] {
  const list = read<Roster[]>(KEY, [])
  return Array.isArray(list) ? list.filter((r) => r && r.schema === 'bandbuilder/roster@1') : []
}

export function saveRosters(rosters: Roster[]): boolean {
  return write(KEY, rosters)
}

export function loadActiveId(): string | null {
  return read<string | null>(ACTIVE, null)
}

export function saveActiveId(id: string | null): void {
  write(ACTIVE, id)
}

/** True when the browser lets us persist at all — a private window or file:// lockdown may not. */
export function storageAvailable(): boolean {
  try {
    localStorage.setItem('bandbuilder/probe', '1')
    localStorage.removeItem('bandbuilder/probe')
    return true
  } catch {
    return false
  }
}

export function downloadJson(roster: Roster): void {
  const blob = new Blob([JSON.stringify(roster, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${roster.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.bbroster.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function parseRoster(text: string): Roster {
  const data = JSON.parse(text)
  if (data?.schema !== 'bandbuilder/roster@1') throw new Error('To nie jest plik drużyny BandBuilder')
  return data as Roster
}
