import { Ctx } from './evaluate'
import type { UnitView } from './evaluate'
import type { Node } from './tree'
import type { CostReport, Force, Id, Issue, Pack, Roster, Sel } from './types'

export { Ctx } from './evaluate'
export type { UnitView, Effective } from './evaluate'

export const selMap = (sels: Sel[]): Map<string, number> => {
  const m = new Map<string, number>()
  for (const s of sels) if (s.qty > 0) m.set(s.path, s.qty)
  return m
}

export const selList = (m: Map<string, number>): Sel[] =>
  [...m.entries()].filter(([, q]) => q > 0).map(([path, qty]) => ({ path, qty }))

/** A node is live only when every entry above it is selected; groups pass through. */
export function isLive(view: UnitView, node: Node): boolean {
  for (const a of node.ancestorNodes) {
    if (a.path === view.root.path) continue
    if (a.k === 'e' && !view.selected.has(a.path)) return false
  }
  return true
}

/** Picks currently inside a group: item quantities count, nested groups do not. */
export function groupCount(view: UnitView, group: Node, tree = view.tree, deep = false): number {
  let n = 0
  for (const child of tree.children(group)) {
    if (child.k === 'e') n += view.selected.get(child.path) ?? 0
    else if (deep) n += groupCount(view, child, tree, deep)
  }
  return n
}

/** How many of this node the unit currently holds. */
export const qtyOf = (view: UnitView, node: Node): number =>
  node.path === view.root.path ? 1 : (view.selected.get(node.path) ?? 0)

// --- costs --------------------------------------------------------------------------------------

export function unitCost(ctx: Ctx, view: UnitView, costType = ctx.pack.primaryCost): number {
  let total = ctx.effective(view, view.root).cost[costType] ?? 0
  for (const [path, qty] of view.selected) {
    const node = view.nodes.get(path)
    if (!node) continue
    total += (ctx.effective(view, node).cost[costType] ?? 0) * qty
  }
  return total
}

export function computeCosts(ctx: Ctx): CostReport {
  const pack = ctx.pack
  const byUnit: Record<Id, number> = {}
  const byCategory: Record<Id, number> = {}
  const byCostType: Record<Id, number> = {}
  let total = 0

  for (const view of ctx.units) {
    const cost = unitCost(ctx, view)
    byUnit[view.unit.uid] = cost
    total += cost
    const cat = primaryCategory(ctx, view)
    if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + cost
    for (const type of pack.costTypes) {
      const value = unitCost(ctx, view, type.id)
      if (value) byCostType[type.id] = (byCostType[type.id] ?? 0) + value
    }
  }

  return {
    total,
    budget: ctx.roster.budget,
    remaining: ctx.roster.budget - total,
    byUnit,
    byCategory,
    byCostType,
  }
}

/** The category a unit occupies in a force organisation slot. */
export function primaryCategory(ctx: Ctx, view: UnitView): Id | null {
  const eff = ctx.effective(view, view.root)
  return view.root.primary ?? eff.cats[0] ?? null
}

export function categoriesOf(ctx: Ctx, view: UnitView): Id[] {
  return ctx.effective(view, view.root).cats
}

// --- validation ---------------------------------------------------------------------------------

const categoryName = (pack: Pack, id: Id) => pack.categories.find((c) => c.id === id)?.name ?? id

/** Polish needs three plural forms; "3 modeli" instead of "3 modele" reads like a bug. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (n === 1) return one
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few
  return many
}

const picks = (n: number) => plural(n, 'wybór', 'wybory', 'wyborów')

export function validate(ctx: Ctx, costs: CostReport): Issue[] {
  const issues: Issue[] = []
  const pack = ctx.pack

  if (costs.total > costs.budget)
    issues.push({
      ruleId: 'budget',
      severity: 'error',
      scope: 'band',
      message: `Przekroczony budżet o ${costs.total - costs.budget} ${pack.vocabulary.currency}`,
    })

  for (const view of ctx.units) validateUnit(ctx, view, issues)
  for (const force of ctx.roster.forces) validateForce(ctx, force, issues)

  return issues
}

function validateUnit(ctx: Ctx, view: UnitView, issues: Issue[]): void {
  const label = view.unit.name
  for (const node of view.nodes.values()) {
    if (!isLive(view, node)) continue
    const eff = ctx.effective(view, node)
    if (eff.hidden) continue

    for (const c of eff.cons) {
      if (c.field !== 'selections') continue
      const actual =
        node.k === 'g' ? groupCount(view, node, view.tree, c.ics === true) : qtyOf(view, node)
      // A group that holds nothing and demands nothing is simply an unopened section.
      if (node.k === 'g' && actual === 0 && c.type === 'max') continue
      if (c.type === 'min' && actual < c.value)
        issues.push({
          ruleId: `min:${node.path}:${c.id}`,
          severity: 'error',
          scope: 'unit',
          targetUid: view.unit.uid,
          message: `${label} / ${eff.name}: wymagane co najmniej ${c.value} ${picks(c.value)}, jest ${actual}`,
        })
      if (c.type === 'max' && actual > c.value)
        issues.push({
          ruleId: `max:${node.path}:${c.id}`,
          severity: 'error',
          scope: 'unit',
          targetUid: view.unit.uid,
          message: `${label} / ${eff.name}: najwyżej ${c.value} ${picks(c.value)}, jest ${actual}`,
        })
    }
  }
}

/** Force organisation: how many units of each category a detachment may hold. */
export function forceSlots(
  ctx: Ctx,
  force: Force,
): { slotId: Id; category: Id; name: string; min: number; max: number | null; actual: number }[] {
  const template = findTemplate(ctx.pack, force.templateId)
  if (!template?.slots) return []
  const views = ctx.units.filter((u) => u.force === force)
  return template.slots.map((slot) => {
    let min = 0
    let max: number | null = null
    for (const c of slot.cons ?? []) {
      if (c.field !== 'selections') continue
      if (c.type === 'min') min = Math.max(min, c.value)
      if (c.type === 'max') max = max === null ? c.value : Math.min(max, c.value)
    }
    const actual = views.filter((v) => categoriesOf(ctx, v).includes(slot.category)).length
    return {
      slotId: slot.id,
      category: slot.category,
      name: slot.name ?? categoryName(ctx.pack, slot.category),
      min,
      max,
      actual,
    }
  })
}

function validateForce(ctx: Ctx, force: Force, issues: Issue[]): void {
  for (const slot of forceSlots(ctx, force)) {
    if (slot.actual < slot.min)
      issues.push({
        ruleId: `force-min:${force.uid}:${slot.slotId}`,
        severity: 'error',
        scope: 'force',
        targetUid: force.uid,
        message: `${force.name} / ${slot.name}: minimum ${slot.min}, jest ${slot.actual}`,
      })
    if (slot.max !== null && slot.actual > slot.max)
      issues.push({
        ruleId: `force-max:${force.uid}:${slot.slotId}`,
        severity: 'error',
        scope: 'force',
        targetUid: force.uid,
        message: `${force.name} / ${slot.name}: maksimum ${slot.max}, jest ${slot.actual}`,
      })
  }

  const template = findTemplate(ctx.pack, force.templateId)
  for (const c of template?.cons ?? []) {
    if (c.field !== 'forces') continue
    const actual = force.forces.length
    if (c.type === 'max' && actual > c.value)
      issues.push({
        ruleId: `force-count-max:${force.uid}:${c.id}`,
        severity: 'error',
        scope: 'force',
        targetUid: force.uid,
        message: `${force.name}: najwyżej ${c.value} pododdziałów, jest ${actual}`,
      })
    if (c.type === 'min' && actual < c.value)
      issues.push({
        ruleId: `force-count-min:${force.uid}:${c.id}`,
        severity: 'error',
        scope: 'force',
        targetUid: force.uid,
        message: `${force.name}: wymagane co najmniej ${c.value} pododdziałów, jest ${actual}`,
      })
  }

  for (const child of force.forces) validateForce(ctx, child, issues)
}

export function findTemplate(pack: Pack, id: Id) {
  const search = (list: Pack['forceTemplates']): Pack['forceTemplates'][number] | null => {
    for (const t of list) {
      if (t.id === id) return t
      const hit = search(t.children ?? [])
      if (hit) return hit
    }
    return null
  }
  return search(pack.forceTemplates)
}

// --- option availability -------------------------------------------------------------------------

/** Why a node cannot be picked right now, or null when it can. */
export function blockedReason(ctx: Ctx, view: UnitView, node: Node): string | null {
  if (!isLive(view, node)) return 'wymaga wcześniejszego wyboru'
  const eff = ctx.effective(view, node)
  if (eff.hidden) return 'niedostępne'

  const have = qtyOf(view, node)
  for (const c of eff.cons) {
    if (c.field !== 'selections' || c.type !== 'max') continue
    if (have >= c.value) return c.value === 1 ? 'już wybrane' : `limit ${c.value} szt.`
  }

  const parent = node.ancestorNodes[0]
  if (parent?.k === 'g') {
    const parentEff = ctx.effective(view, parent)
    for (const c of parentEff.cons) {
      if (c.field !== 'selections' || c.type !== 'max') continue
      const used = groupCount(view, parent, view.tree, c.ics === true)
      if (used >= c.value) return `grupa pełna (${used}/${c.value})`
    }
  }
  return null
}

/** Mandatory and unchangeable: the data fixes both ends of the range at the same value. */
export function isGranted(ctx: Ctx, view: UnitView, node: Node): boolean {
  if (node.k !== 'e') return false
  const eff = ctx.effective(view, node)
  const min = eff.cons.find((c) => c.type === 'min' && c.field === 'selections')?.value ?? 0
  const max = eff.cons.find((c) => c.type === 'max' && c.field === 'selections')?.value ?? null
  return min >= 1 && max === min
}

/** Everything the unit carries, flattened for a sheet. */
export type GearLine = { name: string; qty: number; cost: number; prof: Id[]; rules: Id[]; depth: number }

export function gearLines(ctx: Ctx, view: UnitView): GearLine[] {
  const out: GearLine[] = []
  const walk = (node: Node) => {
    for (const child of view.tree.children(node)) {
      const qty = view.selected.get(child.path) ?? 0
      if (child.k === 'e' && qty > 0) {
        const eff = ctx.effective(view, child)
        out.push({
          name: eff.name,
          qty,
          cost: (eff.cost[ctx.pack.primaryCost] ?? 0) * qty,
          prof: child.prof,
          rules: child.rules,
          depth: child.ancestorNodes.length - 1,
        })
      }
      if (child.k === 'g' || qty > 0) walk(child)
    }
  }
  walk(view.root)
  return out
}

/** Statline row, when the pack marks a profile type as one. */
export function statlineOf(pack: Pack, profileIds: Id[]): { columns: string[]; values: string[] } | null {
  const typeId = pack.statlineType
  if (!typeId) return null
  const profile = profileIds.map((id) => pack.profiles[id]).find((p) => p?.typeId === typeId)
  if (!profile) return null
  const columns = pack.profileTypes[typeId]?.columns ?? Object.keys(profile.chars)
  return { columns, values: columns.map((c) => profile.chars[c] ?? '—') }
}

export function allUnits(roster: Roster): { unit: Roster['forces'][number]['units'][number]; force: Force }[] {
  const out: { unit: Roster['forces'][number]['units'][number]; force: Force }[] = []
  const walk = (f: Force) => {
    for (const u of f.units) out.push({ unit: u, force: f })
    f.forces.forEach(walk)
  }
  roster.forces.forEach(walk)
  return out
}
