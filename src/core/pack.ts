import type { CategoryId, Faction, FighterType, LoadoutNode, Pack, StatId } from './types'

/** Flattened view of one fighter type's loadout tree, so lookups are O(1) instead of a walk. */
export type NodeIndex = {
  byId: Map<string, LoadoutNode>
  parentOf: Map<string, string | null>
  /** Every ancestor id of a node, nearest first. */
  ancestorsOf: Map<string, string[]>
}

export function buildNodeIndex(roots: LoadoutNode[]): NodeIndex {
  const byId = new Map<string, LoadoutNode>()
  const parentOf = new Map<string, string | null>()
  const ancestorsOf = new Map<string, string[]>()
  const walk = (nodes: LoadoutNode[], parent: string | null, ancestors: string[]) => {
    for (const n of nodes) {
      byId.set(n.id, n)
      parentOf.set(n.id, parent)
      ancestorsOf.set(n.id, ancestors)
      walk(n.children ?? [], n.id, [n.id, ...ancestors])
    }
  }
  walk(roots, null, [])
  return { byId, parentOf, ancestorsOf }
}

const indexCache = new WeakMap<FighterType, NodeIndex>()

/** Index of a fighter type's gear plus advances, cached per fighter type. */
export function fighterIndex(type: FighterType): NodeIndex {
  const hit = indexCache.get(type)
  if (hit) return hit
  const idx = buildNodeIndex([...type.tree, ...type.advances])
  indexCache.set(type, idx)
  return idx
}

export function faction(pack: Pack, id: string): Faction | undefined {
  return pack.factions.find((f) => f.id === id)
}

export function fighterType(pack: Pack, factionId: string, typeId: string): FighterType | undefined {
  return faction(pack, factionId)?.fighters.find((f) => f.id === typeId)
}

export function categoryName(pack: Pack, id: CategoryId): string {
  return pack.categories.find((c) => c.id === id)?.name ?? id
}

export const CATEGORY_ORDER: CategoryId[] = ['leader', 'specialist', 'trooper', 'recruit', 'operative']

export const CATEGORY_SHORT: Record<CategoryId, string> = {
  leader: 'LDR',
  specialist: 'SPC',
  trooper: 'TRP',
  recruit: 'NEW',
  operative: 'OPS',
}

/**
 * Special Operatives are hired with promethium caches, not points, so the data gives them a cost
 * of zero. Printing "0 pts" would read as free; say what actually buys them.
 */
export function priceLabel(pack: Pack, cost: number, category: CategoryId): string {
  if (cost === 0 && category === 'operative') return `za ${pack.vocabulary.campaignCurrency}`
  return `${cost} ${pack.vocabulary.currency}`
}

export const STAT_LABELS: Record<StatId, string> = {
  M: 'M',
  WS: 'WS',
  BS: 'BS',
  S: 'S',
  T: 'T',
  W: 'W',
  I: 'I',
  A: 'A',
  Ld: 'Ld',
}
