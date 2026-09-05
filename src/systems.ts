import swaRaw from './data/swa.json?raw'
import hh3Raw from './data/hh3.json?raw'
import type { Pack } from './core/types'

/**
 * Packs are imported as raw text and parsed on demand: Horus Heresy is ten megabytes of JSON, and
 * paying to parse it when someone only wants to open a kill team would be a slow, pointless start.
 */
const SOURCES: Record<string, string> = { swa: swaRaw, hh3: hh3Raw }

export type SystemInfo = { id: string; name: string; short: string; hint: string }

/** Names for the picker, so choosing a system needs no parsing. */
export const SYSTEMS: SystemInfo[] = [
  {
    id: 'swa',
    name: 'Shadow War: Armageddon',
    short: 'Kill teamy, potyczka',
    hint: '15 frakcji · budżet 1000 pts · kampania',
  },
  {
    id: 'hh3',
    name: 'Horus Heresy 3rd Edition',
    short: 'Armie, bitwa',
    hint: '33 frakcje · organizacja sił · detachmenty',
  },
]

const cache = new Map<string, Pack>()

export function loadPack(id: string): Pack {
  const hit = cache.get(id)
  if (hit) return hit
  const raw = SOURCES[id]
  if (!raw) throw new Error(`Nieznany system: ${id}`)
  const pack = JSON.parse(raw) as Pack
  cache.set(id, pack)
  return pack
}

export const systemInfo = (id: string): SystemInfo | undefined => SYSTEMS.find((s) => s.id === id)
