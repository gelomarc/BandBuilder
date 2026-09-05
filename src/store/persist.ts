import { defaultTemplate, uid } from '../core/roster'
import type { Pack, Roster } from '../core/types'
import { loadPack } from '../systems'

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

/** Rosters written before the engine understood units, forces and multiple systems. */
type RosterV1 = {
  schema: 'bandbuilder/roster@1'
  id: string
  name: string
  factionId: string
  budget: number
  fighters: { uid: string; typeId: string; name: string; notes?: string; campaign?: Roster['campaign'] }[]
  campaign?: { enabled: boolean; caches: number; games: [] }
  meta?: { created: string; modified: string }
}

/**
 * Best-effort upgrade of a schema-1 roster. Node addressing changed from ids to paths and the pack
 * was rebuilt, so equipment cannot be carried across; the models are matched back by name and the
 * gear is left for the user to redo. Losing it loudly beats loading a roster whose points are
 * quietly wrong.
 */
export function migrate(roster: RosterV1 | Roster): { roster: Roster; lostGear: boolean } {
  if ((roster as Roster).schema === 'bandbuilder/roster@2') return { roster: roster as Roster, lostGear: false }
  const old = roster as RosterV1
  const pack = loadPack('swa')
  const template = defaultTemplate(pack)
  const faction = pack.factions.find((f) => f.id === old.factionId)

  const byName = new Map<string, string>()
  if (faction) {
    for (const child of faction.roots) {
      const id = 'link' in child ? child.id : child.id
      const node = pack.nodes['link' in child ? child.link : child.id]
      if (node) byName.set(node.name, id)
    }
  }

  const units = (old.fighters ?? [])
    .map((f) => {
      const rootId = byName.get(f.name.replace(/\s\d+$/, '')) ?? byName.get(f.name)
      if (!rootId) return null
      return {
        uid: f.uid || uid('u'),
        rootId,
        factionId: old.factionId,
        name: f.name,
        gear: [],
        campaign: f.campaign ?? { xp: 0, advances: [], injuries: [], status: 'active' as const },
        notes: f.notes ?? '',
      }
    })
    .filter(Boolean) as Roster['forces'][number]['units']

  const now = new Date().toISOString()
  return {
    lostGear: units.length > 0,
    roster: {
      schema: 'bandbuilder/roster@2',
      id: old.id || uid('r'),
      name: old.name,
      pack: { id: 'swa', version: pack.version },
      factionId: old.factionId,
      budget: old.budget ?? pack.budget.default,
      forces: [{ uid: uid('force'), templateId: template.id, name: template.name, units, forces: [] }],
      campaign: old.campaign ?? { enabled: false, caches: 0, games: [] },
      meta: old.meta ?? { created: now, modified: now },
    },
  }
}

export function loadRosters(): { rosters: Roster[]; migrated: number } {
  const stored = read<(RosterV1 | Roster)[]>(KEY, [])
  if (!Array.isArray(stored)) return { rosters: [], migrated: 0 }
  let migrated = 0
  const rosters: Roster[] = []
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue
    const schema = (entry as { schema?: string }).schema
    if (schema !== 'bandbuilder/roster@1' && schema !== 'bandbuilder/roster@2') continue
    const result = migrate(entry)
    if (result.lostGear) migrated++
    rosters.push(result.roster)
  }
  return { rosters, migrated }
}

export const saveRosters = (rosters: Roster[]): boolean => write(KEY, rosters)
export const loadActiveId = (): string | null => read<string | null>(ACTIVE, null)
export const saveActiveId = (id: string | null): void => void write(ACTIVE, id)

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
  if (data?.schema !== 'bandbuilder/roster@1' && data?.schema !== 'bandbuilder/roster@2')
    throw new Error('To nie jest plik listy BandBuilder')
  return migrate(data).roster
}

export const packOf = (roster: Roster): Pack => loadPack(roster.pack.id)
