import { CATEGORY_ORDER, categoryName, fighterIndex, fighterType, faction } from './pack'
import type {
  BandRule,
  CategoryId,
  CostReport,
  Fighter,
  FighterType,
  GroupNode,
  Issue,
  ItemNode,
  LoadoutNode,
  Pack,
  Roster,
  Sel,
  StatId,
} from './types'
import type { NodeIndex } from './pack'

// --- selections ------------------------------------------------------------------------------

export function toMap(sels: Sel[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of sels) if (s.qty > 0) m.set(s.nodeId, s.qty)
  return m
}

export function toSels(m: Map<string, number>): Sel[] {
  return [...m.entries()].filter(([, q]) => q > 0).map(([nodeId, qty]) => ({ nodeId, qty }))
}

/**
 * A node can be used only if every item on the way to it is selected. Groups are containers and
 * pass through, so "Scopes" under an unselected Boltgun is unreachable, but "Pistols" under the
 * fighter root always is.
 */
export function isReachable(nodeId: string, idx: NodeIndex, sel: Map<string, number>): boolean {
  for (const a of idx.ancestorsOf.get(nodeId) ?? []) {
    const node = idx.byId.get(a)
    if (node?.k === 'i' && !sel.has(a)) return false
  }
  return true
}

/** How many picks a group currently holds — item quantities count, nested groups do not. */
export function groupCount(group: GroupNode, sel: Map<string, number>): number {
  let n = 0
  for (const c of group.children) if (c.k === 'i') n += sel.get(c.id) ?? 0
  return n
}

/** Why a node cannot be picked right now, or null when it can. */
export function blockedReason(
  node: ItemNode,
  idx: NodeIndex,
  sel: Map<string, number>,
): string | null {
  if (!isReachable(node.id, idx, sel)) return 'wymaga wcześniejszego wyboru'
  const have = sel.get(node.id) ?? 0
  if (node.max !== null && have >= node.max)
    return node.max === 1 ? 'już wybrane' : `limit ${node.max} szt.`
  const parentId = idx.parentOf.get(node.id)
  const parent = parentId ? idx.byId.get(parentId) : null
  if (parent?.k === 'g' && parent.max !== null && groupCount(parent, sel) >= parent.max)
    return `grupa pełna (${parent.max}/${parent.max})`
  return null
}

/** Items the data marks as mandatory (min >= 1) and that are reachable but not yet picked. */
export function autoFill(type: FighterType, sels: Sel[]): Sel[] {
  const idx = fighterIndex(type)
  const sel = toMap(sels)
  // Repeat until stable: granting an item can make its own children reachable and mandatory.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (const [id, node] of idx.byId) {
      if (node.k !== 'i' || !node.min || node.min < 1) continue
      if (!isReachable(id, idx, sel)) continue
      if ((sel.get(id) ?? 0) >= node.min) continue
      sel.set(id, node.min)
      changed = true
    }
    if (!changed) break
  }
  return toSels(sel)
}

/** Mandatory, non-removable gear: min >= 1 means the fighter always carries it. */
export function isGranted(node: LoadoutNode): boolean {
  return node.k === 'i' && node.min !== null && node.min >= 1 && node.max === node.min
}

// --- costs -----------------------------------------------------------------------------------

export function fighterCost(pack: Pack, roster: Roster, fighter: Fighter): number {
  const type = fighterType(pack, roster.factionId, fighter.typeId)
  if (!type) return 0
  const idx = fighterIndex(type)
  let total = type.cost
  for (const s of fighter.gear) {
    const node = idx.byId.get(s.nodeId)
    if (node?.k === 'i') total += node.cost * s.qty
  }
  return total
}

export function computeCosts(pack: Pack, roster: Roster): CostReport {
  const byFighter: Record<string, number> = {}
  const byCategory = { leader: 0, specialist: 0, trooper: 0, recruit: 0, operative: 0 } as Record<
    CategoryId,
    number
  >
  let total = 0
  for (const f of roster.fighters) {
    const c = fighterCost(pack, roster, f)
    byFighter[f.uid] = c
    total += c
    const type = fighterType(pack, roster.factionId, f.typeId)
    if (type) byCategory[type.categoryId] += c
  }
  return { total, budget: roster.budget, remaining: roster.budget - total, byFighter, byCategory }
}

// --- statline --------------------------------------------------------------------------------

export type StatCell = { value: string; base: string; changed: boolean }

/** Base profile plus every attribute advance the fighter has taken. */
export function effectiveStatline(
  pack: Pack,
  roster: Roster,
  fighter: Fighter,
): Record<StatId, StatCell> {
  const type = fighterType(pack, roster.factionId, fighter.typeId)
  const out = {} as Record<StatId, StatCell>
  if (!type) return out
  const idx = fighterIndex(type)
  const deltas = {} as Record<string, number>
  for (const s of fighter.campaign.advances) {
    const node = idx.byId.get(s.nodeId)
    if (node?.k === 'i' && node.effect) deltas[node.effect.stat] = (deltas[node.effect.stat] ?? 0) + node.effect.delta * s.qty
  }
  for (const stat of pack.statline) {
    const base = type.statline[stat] ?? '-'
    const d = deltas[stat] ?? 0
    let value = base
    if (d !== 0) {
      // Movement is written with an inch mark; everything else is a plain number.
      const m = /^(\d+)(.*)$/.exec(base)
      value = m ? `${Number(m[1]) + d}${m[2]}` : base
    }
    out[stat] = { value, base, changed: value !== base }
  }
  return out
}

// --- validation ------------------------------------------------------------------------------

/** Polish needs three plural forms; "3 modeli" instead of "3 modele" reads like a bug. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (n === 1) return one
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few
  return many
}

function ruleLimit(rule: BandRule, roster: Roster, pack: Pack): number {
  let limit = rule.value
  if (rule.unit === 'percentOfBudget') limit = Math.floor((rule.value / 100) * roster.budget)
  else if (rule.unit === 'percentOfCount') limit = Math.floor((rule.value / 100) * roster.fighters.length)
  for (const adj of rule.adjust ?? []) {
    const n = roster.fighters.filter((f) => categoryOf(pack, roster, f) === adj.perFighterWhere.category).length
    limit += adj.delta * n
  }
  return limit
}

export function categoryOf(pack: Pack, roster: Roster, fighter: Fighter): CategoryId | null {
  return fighterType(pack, roster.factionId, fighter.typeId)?.categoryId ?? null
}

function ruleActual(rule: BandRule, pack: Pack, roster: Roster, costs: CostReport): number {
  const inScope = rule.where
    ? roster.fighters.filter((f) => categoryOf(pack, roster, f) === rule.where!.category)
    : roster.fighters
  if (rule.count === 'cost') return inScope.reduce((n, f) => n + (costs.byFighter[f.uid] ?? 0), 0)
  return inScope.length
}

export function validate(pack: Pack, roster: Roster, costs: CostReport): Issue[] {
  const issues: Issue[] = []
  const fac = faction(pack, roster.factionId)
  if (!fac) return [{ ruleId: 'faction', severity: 'error', scope: 'band', message: 'Nieznana frakcja' }]

  if (costs.total > roster.budget)
    issues.push({
      ruleId: 'budget',
      severity: 'error',
      scope: 'band',
      message: `Przekroczony budżet o ${costs.total - roster.budget} ${pack.vocabulary.currency}`,
    })

  for (const rule of fac.bandRules) {
    const limit = ruleLimit(rule, roster, pack)
    const actual = ruleActual(rule, pack, roster, costs)
    const what = rule.where ? categoryName(pack, rule.where.category) : pack.vocabulary.band
    const unit = (n: number) => (rule.count === 'cost' ? pack.vocabulary.currency : plural(n, 'model', 'modele', 'modeli'))
    if (rule.type === 'min' && actual < limit)
      issues.push({
        ruleId: rule.id,
        severity: 'error',
        scope: 'band',
        message: `${what}: minimum ${limit} ${unit(limit)}, jest ${actual}`,
      })
    if (rule.type === 'max' && actual > limit)
      issues.push({
        ruleId: rule.id,
        severity: 'error',
        scope: 'band',
        message: `${what}: maksimum ${limit} ${unit(limit)}, jest ${actual}`,
      })
  }

  // One fighter type may be capped on its own (a named leader, a unique operative).
  for (const type of fac.fighters) {
    if (type.max === null) continue
    const n = roster.fighters.filter((f) => f.typeId === type.id).length
    if (n > type.max)
      issues.push({
        ruleId: `type-max-${type.id}`,
        severity: 'error',
        scope: 'band',
        message: `${type.name}: maksimum ${type.max} w drużynie, jest ${n}`,
      })
  }

  for (const f of roster.fighters) {
    const type = fighterType(pack, roster.factionId, f.typeId)
    if (!type) {
      issues.push({
        ruleId: 'unknown-type',
        severity: 'error',
        scope: 'fighter',
        targetUid: f.uid,
        message: `${f.name}: typ nieobecny w danych`,
      })
      continue
    }
    const idx = fighterIndex(type)
    const sel = toMap(f.gear)
    for (const [id, node] of idx.byId) {
      if (!isReachable(id, idx, sel)) continue
      if (node.k === 'g') {
        const n = groupCount(node, sel)
        if (node.min !== null && n < node.min)
          issues.push({
            ruleId: `group-min-${id}`,
            severity: 'error',
            scope: 'fighter',
            targetUid: f.uid,
            message: `${f.name} / ${node.name}: wybierz co najmniej ${node.min}`,
          })
        if (node.max !== null && n > node.max)
          issues.push({
            ruleId: `group-max-${id}`,
            severity: 'error',
            scope: 'fighter',
            targetUid: f.uid,
            message: `${f.name} / ${node.name}: najwyżej ${node.max}, jest ${n}`,
          })
      } else {
        const have = sel.get(id) ?? 0
        if (have && node.max !== null && have > node.max)
          issues.push({
            ruleId: `item-max-${id}`,
            severity: 'error',
            scope: 'fighter',
            targetUid: f.uid,
            message: `${f.name} / ${node.name}: najwyżej ${node.max} szt., jest ${have}`,
          })
      }
    }
  }

  return issues
}

// --- summaries used by the UI and the PDF ----------------------------------------------------

export type GearLine = { name: string; qty: number; cost: number; profiles: string[]; rules: string[] }

/** Flat, printable list of what a fighter actually carries. */
export function gearLines(pack: Pack, roster: Roster, fighter: Fighter): GearLine[] {
  const type = fighterType(pack, roster.factionId, fighter.typeId)
  if (!type) return []
  const lines: GearLine[] = []
  const sel = toMap(fighter.gear)
  const walk = (nodes: LoadoutNode[]) => {
    for (const n of nodes) {
      if (n.k === 'i') {
        const qty = sel.get(n.id) ?? 0
        if (qty > 0) lines.push({ name: n.name, qty, cost: n.cost * qty, profiles: n.profiles, rules: n.rules })
      }
      walk(n.children ?? [])
    }
  }
  walk(type.tree)
  return lines
}

export function fighterSort(pack: Pack, roster: Roster) {
  return (a: Fighter, b: Fighter) => {
    const ca = categoryOf(pack, roster, a)
    const cb = categoryOf(pack, roster, b)
    const d = CATEGORY_ORDER.indexOf(ca!) - CATEGORY_ORDER.indexOf(cb!)
    return d !== 0 ? d : roster.fighters.indexOf(a) - roster.fighters.indexOf(b)
  }
}
