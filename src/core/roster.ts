import { Ctx, isGranted, selList, selMap } from './engine'
import { childId, rootOf } from './tree'
import type { Node } from './tree'
import { findTemplate } from './engine'
import type { Force, GameRecord, Id, Pack, Roster, Sel, Unit, UnitStatus } from './types'

let counter = 0
export const uid = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** The template a new roster starts with: the system's first, or a bare container. */
export function defaultTemplate(pack: Pack): { id: Id; name: string } {
  const first = pack.forceTemplates[0]
  return first ? { id: first.id, name: first.name } : { id: 'default', name: pack.vocabulary.band }
}

export function newRoster(pack: Pack, factionId: Id, name?: string): Roster {
  const now = new Date().toISOString()
  const faction = pack.factions.find((f) => f.id === factionId)
  const template = defaultTemplate(pack)
  return {
    schema: 'bandbuilder/roster@2',
    id: uid('r'),
    name: name || `Nowa lista (${faction?.name ?? factionId})`,
    pack: { id: pack.id, version: pack.version },
    factionId,
    budget: pack.budget.default,
    forces: [{ uid: uid('force'), templateId: template.id, name: template.name, units: [], forces: [] }],
    campaign: { enabled: false, caches: 0, games: [] },
    meta: { created: now, modified: now },
  }
}

export type Action =
  | { t: 'band/rename'; name: string }
  | { t: 'band/setBudget'; value: number }
  | { t: 'band/toggleCampaign'; on: boolean }
  | { t: 'band/setCaches'; value: number }
  | { t: 'band/logGame'; game: GameRecord }
  | { t: 'band/removeGame'; id: Id }
  | { t: 'force/add'; parentUid: Id | null; templateId: Id }
  | { t: 'force/remove'; uid: Id }
  | { t: 'force/rename'; uid: Id; name: string }
  | { t: 'unit/add'; forceUid: Id; factionId: Id; rootId: Id }
  | { t: 'unit/remove'; uid: Id }
  | { t: 'unit/rename'; uid: Id; name: string }
  | { t: 'unit/duplicate'; uid: Id }
  | { t: 'unit/move'; uid: Id; dir: -1 | 1 }
  | { t: 'unit/notes'; uid: Id; notes: string }
  | { t: 'unit/status'; uid: Id; status: UnitStatus }
  | { t: 'unit/xp'; uid: Id; delta: number }
  | { t: 'unit/injury/add'; uid: Id; text: string }
  | { t: 'unit/injury/remove'; uid: Id; id: Id }
  | { t: 'gear/set'; uid: Id; path: string; qty: number }
  | { t: 'gear/clearGroup'; uid: Id; path: string }
  | { t: 'advance/set'; uid: Id; path: string; qty: number }

// --- helpers -------------------------------------------------------------------------------------

const mapForces = (forces: Force[], fn: (f: Force) => Force): Force[] =>
  forces.map((f) => fn({ ...f, forces: mapForces(f.forces, fn) }))

const allForces = (roster: Roster): Force[] => {
  const out: Force[] = []
  const walk = (f: Force) => {
    out.push(f)
    f.forces.forEach(walk)
  }
  roster.forces.forEach(walk)
  return out
}

export const findUnit = (roster: Roster, uid: Id): Unit | undefined =>
  allForces(roster).flatMap((f) => f.units).find((u) => u.uid === uid)

export const forceOfUnit = (roster: Roster, uid: Id): Force | undefined =>
  allForces(roster).find((f) => f.units.some((u) => u.uid === uid))

const mapUnit = (roster: Roster, uid: Id, fn: (u: Unit) => Unit): Roster => ({
  ...roster,
  forces: mapForces(roster.forces, (f) => ({ ...f, units: f.units.map((u) => (u.uid === uid ? fn(u) : u)) })),
})

function setQty(sels: Sel[], path: string, qty: number): Sel[] {
  const m = selMap(sels)
  if (qty <= 0) m.delete(path)
  else m.set(path, qty)
  return selList(m)
}

/**
 * Resolve a unit against the pack so gear can be pruned and topped up. Building a one-unit context
 * is cheap and keeps this module free of its own tree-walking logic.
 */
function viewFor(pack: Pack, roster: Roster, unit: Unit) {
  const probe: Roster = {
    ...roster,
    forces: [{ uid: 'probe', templateId: roster.forces[0]?.templateId ?? 'default', name: '', units: [unit], forces: [] }],
  }
  const ctx = new Ctx(pack, probe)
  return { ctx, view: ctx.units[0] }
}

/**
 * Drop selections whose parent entry is gone, then add back anything the data makes mandatory.
 * Both iterate to a fixed point: removing a weapon orphans its scope, and granting an upgrade can
 * expose a further mandatory upgrade underneath it.
 */
function reconcile(pack: Pack, roster: Roster, unit: Unit): Unit {
  let current = unit
  for (let pass = 0; pass < 8; pass++) {
    const { ctx, view } = viewFor(pack, roster, current)
    if (!view) return current

    const gear = selMap(current.gear)
    let changed = false

    for (const path of [...gear.keys()]) {
      const parts = path.split('/')
      // Every entry above this one must still be selected; groups are transparent, and the unit
      // root is always present without appearing in the selection map.
      for (let i = parts.length - 1; i > 1; i--) {
        const parentPath = parts.slice(0, i).join('/')
        if (parentPath === view.root.path) continue
        const parentNode = view.nodes.get(parentPath)
        if (parentNode && parentNode.k === 'e' && !gear.has(parentPath)) {
          gear.delete(path)
          changed = true
          break
        }
      }
    }

    const grantable: Node[] = []
    const collect = (node: Node) => {
      for (const child of view.tree.children(node)) {
        const live = child.ancestorNodes.every(
          (a) => a.path === view.root.path || a.k === 'g' || gear.has(a.path),
        )
        if (!live) continue
        if (child.k === 'e') {
          const min = ctx
            .effective(view, child)
            .cons.find((c) => c.type === 'min' && c.field === 'selections')?.value
          if (min && min >= 1 && (gear.get(child.path) ?? 0) < min) grantable.push(child)
        }
        if (child.k === 'g' || gear.has(child.path)) collect(child)
      }
    }
    collect(view.root)

    for (const node of grantable) {
      const min = ctx.effective(view, node).cons.find((c) => c.type === 'min')?.value ?? 1
      gear.set(node.path, min)
      changed = true
    }

    if (!changed) return current
    current = { ...current, gear: selList(gear) }
  }
  return current
}

/** Names default to the entry with a running number, counted per entry so they never collide. */
function defaultName(roster: Roster, rootId: Id, name: string): string {
  const n = allForces(roster)
    .flatMap((f) => f.units)
    .filter((u) => u.rootId === rootId).length
  return n === 0 ? name : `${name} ${n + 1}`
}

// --- reducer -------------------------------------------------------------------------------------

export function applyAction(pack: Pack, roster: Roster, action: Action): Roster {
  const touch = (r: Roster): Roster => ({ ...r, meta: { ...r.meta, modified: new Date().toISOString() } })

  switch (action.t) {
    case 'band/rename':
      return touch({ ...roster, name: action.name })
    case 'band/setBudget':
      return touch({ ...roster, budget: Math.max(0, Math.round(action.value)) })
    case 'band/toggleCampaign':
      return touch({ ...roster, campaign: { ...roster.campaign, enabled: action.on } })
    case 'band/setCaches':
      return touch({ ...roster, campaign: { ...roster.campaign, caches: Math.max(0, action.value) } })
    case 'band/logGame':
      return touch({
        ...roster,
        campaign: {
          ...roster.campaign,
          games: [...roster.campaign.games, action.game],
          caches: roster.campaign.caches + action.game.caches,
        },
      })
    case 'band/removeGame': {
      const game = roster.campaign.games.find((g) => g.id === action.id)
      return touch({
        ...roster,
        campaign: {
          ...roster.campaign,
          games: roster.campaign.games.filter((g) => g.id !== action.id),
          caches: Math.max(0, roster.campaign.caches - (game?.caches ?? 0)),
        },
      })
    }

    case 'force/add': {
      const template = findTemplate(pack, action.templateId)
      if (!template) return roster
      const force: Force = { uid: uid('force'), templateId: template.id, name: template.name, units: [], forces: [] }
      if (!action.parentUid) return touch({ ...roster, forces: [...roster.forces, force] })
      return touch({
        ...roster,
        forces: mapForces(roster.forces, (f) =>
          f.uid === action.parentUid ? { ...f, forces: [...f.forces, force] } : f,
        ),
      })
    }
    case 'force/remove': {
      const strip = (list: Force[]): Force[] =>
        list.filter((f) => f.uid !== action.uid).map((f) => ({ ...f, forces: strip(f.forces) }))
      const forces = strip(roster.forces)
      return touch({ ...roster, forces: forces.length ? forces : roster.forces })
    }
    case 'force/rename':
      return touch({
        ...roster,
        forces: mapForces(roster.forces, (f) => (f.uid === action.uid ? { ...f, name: action.name } : f)),
      })

    case 'unit/add': {
      const child = rootOf(pack, action.factionId, action.rootId)
      if (!child) return roster
      const ctx = new Ctx(pack, roster)
      const node = ctx.treeFor(action.factionId).root(child)
      if (!node) return roster
      const bare: Unit = {
        uid: uid('u'),
        rootId: childId(child),
        factionId: action.factionId,
        name: defaultName(roster, childId(child), node.name),
        gear: [],
        campaign: { xp: 0, advances: [], injuries: [], status: 'active' },
        notes: '',
      }
      const unit = reconcile(pack, roster, bare)
      return touch({
        ...roster,
        forces: mapForces(roster.forces, (f) =>
          f.uid === action.forceUid ? { ...f, units: [...f.units, unit] } : f,
        ),
      })
    }
    case 'unit/remove':
      return touch({
        ...roster,
        forces: mapForces(roster.forces, (f) => ({ ...f, units: f.units.filter((u) => u.uid !== action.uid) })),
      })
    case 'unit/rename':
      return touch(mapUnit(roster, action.uid, (u) => ({ ...u, name: action.name })))
    case 'unit/notes':
      return touch(mapUnit(roster, action.uid, (u) => ({ ...u, notes: action.notes })))
    case 'unit/status':
      return touch(mapUnit(roster, action.uid, (u) => ({ ...u, campaign: { ...u.campaign, status: action.status } })))
    case 'unit/xp':
      return touch(
        mapUnit(roster, action.uid, (u) => ({
          ...u,
          campaign: { ...u.campaign, xp: Math.max(0, u.campaign.xp + action.delta) },
        })),
      )
    case 'unit/injury/add':
      return touch(
        mapUnit(roster, action.uid, (u) => ({
          ...u,
          campaign: { ...u.campaign, injuries: [...u.campaign.injuries, { id: uid('i'), text: action.text }] },
        })),
      )
    case 'unit/injury/remove':
      return touch(
        mapUnit(roster, action.uid, (u) => ({
          ...u,
          campaign: { ...u.campaign, injuries: u.campaign.injuries.filter((i) => i.id !== action.id) },
        })),
      )
    case 'unit/duplicate': {
      const source = findUnit(roster, action.uid)
      if (!source) return roster
      const copy: Unit = {
        ...structuredClone(source),
        uid: uid('u'),
        name: defaultName(roster, source.rootId, stripNumber(source.name)),
      }
      return touch({
        ...roster,
        forces: mapForces(roster.forces, (f) => {
          const at = f.units.findIndex((u) => u.uid === action.uid)
          if (at < 0) return f
          const units = [...f.units]
          units.splice(at + 1, 0, copy)
          return { ...f, units }
        }),
      })
    }
    case 'unit/move':
      return touch({
        ...roster,
        forces: mapForces(roster.forces, (f) => {
          const i = f.units.findIndex((u) => u.uid === action.uid)
          const j = i + action.dir
          if (i < 0 || j < 0 || j >= f.units.length) return f
          const units = [...f.units]
          ;[units[i], units[j]] = [units[j], units[i]]
          return { ...f, units }
        }),
      })

    case 'gear/set':
      return touch(
        mapUnit(roster, action.uid, (u) => reconcile(pack, roster, { ...u, gear: setQty(u.gear, action.path, action.qty) })),
      )
    case 'gear/clearGroup':
      return touch(
        mapUnit(roster, action.uid, (u) => {
          const { ctx, view } = viewFor(pack, roster, u)
          if (!view) return u
          const group = view.nodes.get(action.path) ?? findByPath(view, action.path)
          if (!group) return u
          const gear = selMap(u.gear)
          for (const child of view.tree.children(group))
            if (child.k === 'e' && !isGranted(ctx, view, child)) gear.delete(child.path)
          return reconcile(pack, roster, { ...u, gear: selList(gear) })
        }),
      )
    case 'advance/set':
      return touch(
        mapUnit(roster, action.uid, (u) => ({
          ...u,
          campaign: { ...u.campaign, advances: setQty(u.campaign.advances, action.path, action.qty) },
        })),
      )
  }
}

function findByPath(view: { root: Node; tree: { find: (r: Node, p: string) => Node | null } }, path: string) {
  return view.tree.find(view.root, path)
}

const stripNumber = (name: string) => name.replace(/\s\d+$/, '')
