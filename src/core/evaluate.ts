import { Tree, rootOf } from './tree'
import type { Node } from './tree'
import type {
  Condition,
  ConditionGroup,
  Constraint,
  Force,
  Id,
  Modifier,
  Pack,
  Repeat,
  Roster,
  Unit,
} from './types'

/**
 * Evaluation context for one roster snapshot.
 *
 * Conditions and repeats in BattleScribe are queries over the roster — "how many models are in this
 * unit", "does the force contain a Praetor" — so limits cannot be read off the data alone. This
 * builds the roster once, then answers those queries; everything is cached per snapshot because the
 * cost pass, the validation pass and the UI all ask the same questions.
 */
export type UnitView = {
  unit: Unit
  force: Force
  root: Node
  tree: Tree
  /** path -> quantity, for everything the unit has selected. */
  selected: Map<string, number>
  /** path -> node, for every selected path plus its ancestors. */
  nodes: Map<string, Node>
}

export class Ctx {
  readonly units: UnitView[] = []
  private trees = new Map<string, Tree>()
  private effectiveCache = new Map<string, Effective>()

  constructor(
    readonly pack: Pack,
    readonly roster: Roster,
  ) {
    const walk = (force: Force) => {
      for (const unit of force.units) {
        const view = this.buildUnit(unit, force)
        if (view) this.units.push(view)
      }
      for (const child of force.forces) walk(child)
    }
    for (const force of roster.forces) walk(force)
  }

  /** One tree per faction, so link resolution is cached across units of the same catalogue. */
  treeFor(factionId: Id): Tree {
    let tree = this.trees.get(factionId)
    if (!tree) {
      tree = new Tree(this.pack)
      this.trees.set(factionId, tree)
    }
    return tree
  }

  rootOf(unit: Unit): Node | null {
    const child = rootOf(this.pack, unit.factionId, unit.rootId)
    if (!child) return null
    return this.treeFor(unit.factionId).root(child)
  }

  private buildUnit(unit: Unit, force: Force): UnitView | null {
    const tree = this.treeFor(unit.factionId)
    const root = this.rootOf(unit)
    if (!root) return null

    const selected = new Map<string, number>()
    for (const s of [...unit.gear, ...unit.campaign.advances]) if (s.qty > 0) selected.set(s.path, s.qty)

    // Resolve only the paths in play: the whole Horus Heresy tree under one unit is large, and
    // nothing outside the selected paths and their siblings is needed to answer a count.
    const nodes = new Map<string, Node>([[root.path, root]])
    const expand = (node: Node) => {
      for (const child of tree.children(node)) {
        if (nodes.has(child.path)) continue
        nodes.set(child.path, child)
        if (selected.has(child.path) || [...selected.keys()].some((p) => p.startsWith(`${child.path}/`)))
          expand(child)
      }
    }
    expand(root)

    return { unit, force, root, tree, selected, nodes }
  }

  unitOf(uid: Id): UnitView | undefined {
    return this.units.find((u) => u.unit.uid === uid)
  }

  // --- counting --------------------------------------------------------------------------------

  /** Does one selected node match a condition's `childId`? */
  private matches(node: Node, childId: Id | undefined): boolean {
    if (!childId) return true
    if (childId === 'unit' || childId === 'model' || childId === 'upgrade') return node.t === childId
    if (node.ref === childId || node.id === childId) return true
    return node.cats.includes(childId)
  }

  /** The nodes a scope points at, within the unit that owns `origin`. */
  private scopeNodes(view: UnitView, origin: Node, scope: string): Node[] {
    switch (scope) {
      case 'self':
        return [origin]
      case 'parent': {
        const parent = origin.ancestorNodes[0]
        return parent ? [parent] : [view.root]
      }
      case 'unit': {
        const unit = origin.ancestorNodes.find((n) => n.t === 'unit')
        return [unit ?? view.root]
      }
      case 'model': {
        const model = origin.ancestorNodes.find((n) => n.t === 'model')
        return model ? [model] : [origin]
      }
      case 'ancestor':
        return origin.ancestorNodes.length ? origin.ancestorNodes : [view.root]
      case 'force':
      case 'roster':
      case 'primary-catalogue':
        return []
      default: {
        // A scope can also name an ancestor entry directly.
        const named = origin.ancestorNodes.find((n) => n.ref === scope || n.id === scope)
        return named ? [named] : [view.root]
      }
    }
  }

  /** Units a roster-wide scope covers. */
  private scopeUnits(view: UnitView, scope: string): UnitView[] {
    if (scope === 'roster') return this.units
    if (scope === 'force') {
      const inForce = (force: Force): boolean =>
        force === view.force || force.forces.some(inForce)
      return this.units.filter((u) => u.force === view.force || inForce(u.force))
    }
    return []
  }

  private countSelections(view: UnitView, origin: Node, q: Condition | Repeat): number {
    if (q.scope === 'primary-catalogue') return this.matchesCatalogue(view, q.childId) ? 1 : 0

    let total = 0
    const add = (v: UnitView, node: Node, deep: boolean) => {
      // The scope node itself counts, which is what an `instanceOf` type check needs.
      if (this.matches(node, q.childId)) total += v.selected.get(node.path) ?? (node === v.root ? 1 : 0)
      for (const [path, qty] of v.selected) {
        if (path === node.path) continue
        const direct = path.startsWith(`${node.path}/`) && !path.slice(node.path.length + 1).includes('/')
        const nested = path.startsWith(`${node.path}/`)
        if (!(deep ? nested : direct)) continue
        const child = v.nodes.get(path)
        if (child && this.matches(child, q.childId)) total += qty
      }
    }

    const wide = this.scopeUnits(view, q.scope)
    if (wide.length) {
      for (const v of wide) add(v, v.root, true)
      return total
    }
    for (const node of this.scopeNodes(view, origin, q.scope)) add(view, node, q.ics === true)
    return total
  }

  private matchesCatalogue(view: UnitView, childId: Id | undefined): boolean {
    if (!childId) return true
    const faction = this.pack.factions.find((f) => f.id === view.unit.factionId)
    return faction?.id === childId || faction?.name === childId
  }

  private countForces(view: UnitView, q: Condition | Repeat): number {
    const all: Force[] = []
    const walk = (f: Force) => {
      all.push(f)
      f.forces.forEach(walk)
    }
    if (q.scope === 'roster') this.roster.forces.forEach(walk)
    else view.force.forces.forEach(walk)
    return all.filter((f) => !q.childId || f.templateId === q.childId).length
  }

  private count(view: UnitView, origin: Node, q: Condition | Repeat): number {
    if (q.field === 'forces') return this.countForces(view, q)
    if (q.field === 'selections') return this.countSelections(view, origin, q)
    // Otherwise the field names a cost type: sum it over the scope.
    let total = 0
    const wide = this.scopeUnits(view, q.scope)
    const views = wide.length ? wide : [view]
    for (const v of views)
      for (const [path, qty] of v.selected) {
        const node = v.nodes.get(path)
        if (node && this.matches(node, q.childId)) total += (node.cost[q.field] ?? 0) * qty
      }
    return total
  }

  // --- conditions ------------------------------------------------------------------------------

  private testCondition(view: UnitView, origin: Node, c: Condition): boolean {
    const n = this.count(view, origin, c)
    switch (c.type) {
      case 'atLeast':
        return n >= c.value
      case 'atMost':
        return n <= c.value
      case 'equalTo':
        return n === c.value
      case 'notEqualTo':
        return n !== c.value
      case 'greaterThan':
        return n > c.value
      case 'lessThan':
        return n < c.value
      case 'instanceOf':
        return n >= Math.max(1, c.value)
      case 'notInstanceOf':
        return n < Math.max(1, c.value)
      default:
        return true
    }
  }

  private testGroup(view: UnitView, origin: Node, g: ConditionGroup): boolean {
    const results = [
      ...(g.conds ?? []).map((c) => this.testCondition(view, origin, c)),
      ...(g.groups ?? []).map((sub) => this.testGroup(view, origin, sub)),
    ]
    if (!results.length) return true
    return g.type === 'or' ? results.some(Boolean) : results.every(Boolean)
  }

  private modifierApplies(view: UnitView, origin: Node, m: Modifier): boolean {
    const conds = (m.conds ?? []).every((c) => this.testCondition(view, origin, c))
    const groups = (m.groups ?? []).every((g) => this.testGroup(view, origin, g))
    return conds && groups
  }

  /** How many times a modifier fires, given its repeats. One with no repeats fires once. */
  private modifierTimes(view: UnitView, origin: Node, m: Modifier): number {
    if (!m.reps?.length) return 1
    let times = 0
    for (const r of m.reps) {
      const n = this.count(view, origin, r)
      const divisor = r.value || 1
      const cycles = r.roundUp ? Math.ceil(n / divisor) : Math.floor(n / divisor)
      times += Math.max(0, cycles) * (r.repeats || 1)
    }
    return times
  }

  // --- effective node --------------------------------------------------------------------------

  /** A node after its modifiers have been applied for the current roster. */
  effective(view: UnitView, node: Node): Effective {
    const key = `${view.unit.uid}${node.path}`
    const hit = this.effectiveCache.get(key)
    if (hit) return hit

    let name = node.name
    let hidden = node.hidden
    const cost = { ...node.cost }
    const cats = [...node.cats]
    const cons = node.cons.map((c) => ({ ...c }))
    const byId = new Map(cons.map((c) => [c.id, c]))

    for (const m of node.mods) {
      if (!this.modifierApplies(view, node, m)) continue
      const times = this.modifierTimes(view, node, m)
      if (times <= 0 && m.reps?.length) continue

      if (m.field === 'hidden') {
        hidden = m.value === true || m.value === 'true'
        continue
      }
      if (m.field === 'name') {
        name = applyText(m, name)
        continue
      }
      if (m.field === 'category') {
        const id = String(m.value)
        if (m.type === 'add' || m.type === 'set-primary') {
          if (!cats.includes(id)) cats.push(id)
        } else if (m.type === 'remove' || m.type === 'unset-primary') {
          const at = cats.indexOf(id)
          if (at >= 0) cats.splice(at, 1)
        }
        continue
      }

      const constraint = byId.get(m.field)
      if (constraint) {
        constraint.value = applyNumber(m, constraint.value, times)
        continue
      }
      if (this.pack.costTypes.some((c) => c.id === m.field)) {
        cost[m.field] = applyNumber(m, cost[m.field] ?? 0, times)
      }
    }

    const result: Effective = { name, hidden, cost, cats, cons }
    this.effectiveCache.set(key, result)
    return result
  }
}

export type Effective = {
  name: string
  hidden: boolean
  cost: Record<Id, number>
  cats: Id[]
  cons: Constraint[]
}

function applyNumber(m: Modifier, current: number, times: number): number {
  const value = Number(m.value)
  if (!Number.isFinite(value)) return current
  switch (m.type) {
    case 'set':
      return value
    case 'increment':
      return current + value * times
    case 'decrement':
      return current - value * times
    case 'ceil':
      return Math.min(current, value)
    case 'floor':
      return Math.max(current, value)
    default:
      return current
  }
}

function applyText(m: Modifier, current: string): string {
  const value = String(m.value ?? '')
  switch (m.type) {
    case 'set':
      return value
    case 'append':
      return current + value
    case 'prepend':
      return value + current
    case 'replace':
      return value
    default:
      return current
  }
}
