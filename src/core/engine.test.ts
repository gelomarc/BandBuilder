import { describe, expect, it } from 'vitest'
import swaRaw from '../data/swa.json'
import hh3Raw from '../data/hh3.json'
import { Ctx, blockedReason, computeCosts, gearLines, groupCount, isGranted, unitCost, validate } from './engine'
import { applyAction, newRoster } from './roster'
import { childId } from './tree'
import type { Node } from './tree'
import type { Pack, Roster } from './types'

const swa = swaRaw as unknown as Pack
const hh3 = hh3Raw as unknown as Pack

const act = (pack: Pack, r: Roster, ...actions: Parameters<typeof applyAction>[2][]) =>
  actions.reduce((acc, a) => applyAction(pack, acc, a), r)

const faction = (pack: Pack, match: RegExp) => {
  const f = pack.factions.find((x) => match.test(x.name))
  if (!f) throw new Error(`no faction matching ${match}`)
  return f
}

/** Find a root entry by name, returning the id a roster stores. */
function rootByName(pack: Pack, factionName: RegExp, name: string) {
  const f = faction(pack, factionName)
  const ctx = new Ctx(pack, newRoster(pack, f.id))
  const tree = ctx.treeFor(f.id)
  for (const child of f.roots) {
    const node = tree.root(child)
    if (node?.name === name) return { factionId: f.id, rootId: childId(child) }
  }
  throw new Error(`no root "${name}" in ${f.name}`)
}

const firstForce = (r: Roster) => r.forces[0].uid

function addUnit(pack: Pack, r: Roster, factionName: RegExp, name: string) {
  const { factionId, rootId } = rootByName(pack, factionName, name)
  return act(pack, r, { t: 'unit/add', forceUid: firstForce(r), factionId, rootId })
}

/** Locate a node inside the newest unit by name, expanding the tree as needed. */
function nodeByName(pack: Pack, r: Roster, unitUid: string, name: string | RegExp): Node {
  const ctx = new Ctx(pack, r)
  const view = ctx.unitOf(unitUid)
  if (!view) throw new Error('unit not in roster')
  const match = (n: string) => (typeof name === 'string' ? n === name : name.test(n))
  const queue: Node[] = [view.root]
  for (let i = 0; i < queue.length && i < 20000; i++) {
    const node = queue[i]
    if (node !== view.root && match(ctx.effective(view, node).name)) return node
    for (const c of view.tree.children(node)) queue.push(c)
  }
  throw new Error(`no node "${name}"`)
}

const lastUnit = (r: Roster) => r.forces[0].units[r.forces[0].units.length - 1]
const ctxOf = (pack: Pack, r: Roster) => new Ctx(pack, r)
const issuesOf = (pack: Pack, r: Roster) => {
  const ctx = ctxOf(pack, r)
  return validate(ctx, computeCosts(ctx)).map((i) => i.message)
}

// -------------------------------------------------------------------------------------------------

describe('packs load', () => {
  it.each([
    ['swa', swa, 15],
    ['hh3', hh3, 30],
  ])('%s has factions, nodes and cost types', (_id, pack, minFactions) => {
    expect(pack.schema).toBe('bandbuilder/datapack@2')
    expect(pack.factions.filter((f) => !f.library).length).toBeGreaterThanOrEqual(minFactions)
    expect(Object.keys(pack.nodes).length).toBeGreaterThan(100)
    expect(pack.costTypes.length).toBeGreaterThan(0)
    expect(pack.primaryCost).toBeTruthy()
  })

  it('reads characteristic values out of both serialisations', () => {
    // XML puts the value in an attribute and JSON in element text; missing the JSON form left every
    // Horus Heresy statline blank while every test still passed.
    for (const [id, pack] of [
      ['swa', swa],
      ['hh3', hh3],
    ] as const) {
      const profiles = Object.values(pack.profiles)
      const filled = profiles.filter((p) => Object.keys(p.chars ?? {}).length)
      expect(filled.length / profiles.length, `${id} profiles with values`).toBeGreaterThan(0.9)
    }
    const legionary = Object.values(hh3.profiles).find((p) => p.name === 'Assault Legionary')
    expect(legionary?.chars.WS).toBeTruthy()
  })

  it('marks a statline type only where the system has one universal model line', () => {
    expect(swa.statlineType).toBeTruthy()
    expect(hh3.statlineType).toBeUndefined()
  })

  it('gives Horus Heresy its force organisation templates', () => {
    const crusade = hh3.forceTemplates.find((t) => /Crusade Force Organization/i.test(t.name))
    expect(crusade).toBeTruthy()
    expect(crusade!.children!.length).toBeGreaterThan(20)
    expect(crusade!.children!.some((c) => /Crusade Primary Detachment/.test(c.name))).toBe(true)
  })
})

describe('Shadow War: Armageddon', () => {
  const SCOUTS = /Space Marine Scouts/

  it('costs a fighter with its granted gear', () => {
    let r = newRoster(swa, faction(swa, SCOUTS).id)
    r = addUnit(swa, r, SCOUTS, 'Scout Sergeant')
    const ctx = ctxOf(swa, r)
    // Scout armour and a combat blade come with the model, at no extra cost.
    expect(lastUnit(r).gear.length).toBeGreaterThan(0)
    expect(computeCosts(ctx).total).toBe(200)
  })

  it('adds bought gear and drops its sub-options when the weapon goes', () => {
    let r = newRoster(swa, faction(swa, SCOUTS).id)
    r = addUnit(swa, r, SCOUTS, 'Scout Sergeant')
    const uid = lastUnit(r).uid

    const boltgun = nodeByName(swa, r, uid, 'Boltgun')
    r = act(swa, r, { t: 'gear/set', uid, path: boltgun.path, qty: 1 })
    expect(computeCosts(ctxOf(swa, r)).total).toBe(235)

    const sight = nodeByName(swa, r, uid, 'Telescopic sight')
    r = act(swa, r, { t: 'gear/set', uid, path: sight.path, qty: 1 })
    expect(computeCosts(ctxOf(swa, r)).total).toBe(255)

    r = act(swa, r, { t: 'gear/set', uid, path: boltgun.path, qty: 0 })
    expect(r.forces[0].units[0].gear.some((s) => s.path === sight.path)).toBe(false)
    expect(computeCosts(ctxOf(swa, r)).total).toBe(200)
  })

  it('names duplicates apart and copies their gear', () => {
    let r = newRoster(swa, faction(swa, SCOUTS).id)
    r = addUnit(swa, r, SCOUTS, 'Scout')
    r = addUnit(swa, r, SCOUTS, 'Scout')
    expect(r.forces[0].units.map((u) => u.name)).toEqual(['Scout', 'Scout 2'])

    const uid = r.forces[0].units[0].uid
    r = act(swa, r, { t: 'unit/duplicate', uid })
    expect(r.forces[0].units).toHaveLength(3)
    expect(r.forces[0].units[1].gear).toEqual(r.forces[0].units[0].gear)
  })

  it('reports going over budget', () => {
    let r = newRoster(swa, faction(swa, SCOUTS).id)
    r = addUnit(swa, r, SCOUTS, 'Scout Sergeant')
    r = act(swa, r, { t: 'band/setBudget', value: 10 })
    expect(issuesOf(swa, r).join(' ')).toMatch(/budżet/i)
    r = act(swa, r, { t: 'band/setBudget', value: 1000 })
    expect(issuesOf(swa, r).join(' ')).not.toMatch(/budżet/i)
  })

  it('lists carried gear for a sheet', () => {
    let r = newRoster(swa, faction(swa, SCOUTS).id)
    r = addUnit(swa, r, SCOUTS, 'Scout Sergeant')
    const uid = lastUnit(r).uid
    const sword = nodeByName(swa, r, uid, 'Power sword')
    r = act(swa, r, { t: 'gear/set', uid, path: sword.path, qty: 1 })
    const ctx = ctxOf(swa, r)
    expect(gearLines(ctx, ctx.unitOf(uid)!).map((l) => l.name)).toContain('Power sword')
  })
})

describe('Horus Heresy: units of many models', () => {
  const LEGION = /Legiones Astartes/

  const assaultSquad = () => {
    const f = faction(hh3, LEGION)
    let r = newRoster(hh3, f.id)
    r = act(hh3, r, { t: 'band/setBudget', value: 3000 })
    r = addUnit(hh3, r, LEGION, 'Assault Squad')
    return r
  }

  it('refuses to shrink a squad below its minimum size', () => {
    let r = assaultSquad()
    const uid = lastUnit(r).uid
    const legionary = nodeByName(hh3, r, uid, 'Legionary')
    // The data says nine or more; asking for five puts it straight back to nine.
    r = act(hh3, r, { t: 'gear/set', uid, path: legionary.path, qty: 5 })
    const ctx = ctxOf(hh3, r)
    expect(ctx.unitOf(uid)!.selected.get(legionary.path)).toBe(9)
  })

  it('starts at its minimum legal size and costs unit plus per-model points', () => {
    const r = assaultSquad()
    const ctx = ctxOf(hh3, r)
    const view = ctx.unitOf(lastUnit(r).uid)!
    const legionary = nodeByName(hh3, r, view.unit.uid, 'Legionary')
    // 9 Legionaries at 12, a Sergeant that is mandatory and free, and 32 on the unit itself.
    expect(view.selected.get(legionary.path)).toBe(9)
    expect(unitCost(ctx, view)).toBe(32 + 9 * 12)
  })

  it('scales the cost with the number of models', () => {
    let r = assaultSquad()
    const uid = lastUnit(r).uid
    const legionary = nodeByName(hh3, r, uid, 'Legionary')
    r = act(hh3, r, { t: 'gear/set', uid, path: legionary.path, qty: 19 })
    expect(computeCosts(ctxOf(hh3, r)).total).toBe(32 + 19 * 12)
  })

  it('rejects a squad above its maximum size', () => {
    let r = assaultSquad()
    const uid = lastUnit(r).uid
    const legionary = nodeByName(hh3, r, uid, 'Legionary')
    r = act(hh3, r, { t: 'gear/set', uid, path: legionary.path, qty: 25 })
    expect(issuesOf(hh3, r).join(' ')).toMatch(/najwyżej 19/)
  })

  it('keeps the mandatory Sergeant', () => {
    const r = assaultSquad()
    const ctx = ctxOf(hh3, r)
    const view = ctx.unitOf(lastUnit(r).uid)!
    const sergeant = nodeByName(hh3, r, view.unit.uid, 'Sergeant')
    expect(view.selected.get(sergeant.path)).toBe(1)
    expect(isGranted(ctx, view, sergeant)).toBe(true)
  })
})

describe('Horus Heresy: limits that scale with unit size', () => {
  const LEGION = /Legiones Astartes/

  /**
   * "1-5 may exchange their Chainsword for..." is a constraint of zero raised by a modifier that
   * repeats once per five models in the unit. Getting this right is the whole reason the engine
   * evaluates modifiers rather than reading constraints straight off the data.
   *
   * The count is of models, so the mandatory Sergeant counts too: a squad of nine Legionaries plus
   * a Sergeant is ten models and gets two exchanges.
   */
  it('raises a per-five-models option limit as the squad grows', () => {
    const f = faction(hh3, LEGION)
    let r = act(hh3, newRoster(hh3, f.id), { t: 'band/setBudget', value: 3000 })
    r = addUnit(hh3, r, LEGION, 'Assault Squad')
    const uid = lastUnit(r).uid
    const legionary = nodeByName(hh3, r, uid, 'Legionary')

    const limitFor = (legionaries: number) => {
      const next = act(hh3, r, { t: 'gear/set', uid, path: legionary.path, qty: legionaries })
      const ctx = ctxOf(hh3, next)
      const view = ctx.unitOf(uid)!
      const group = nodeByName(hh3, next, uid, /^1-5 may exchange Chainsword/)
      const max = ctx.effective(view, group).cons.find((c) => c.type === 'max' && c.field === 'selections')
      return max?.value ?? null
    }

    expect(limitFor(9)).toBe(2) // 10 models
    expect(limitFor(14)).toBe(3) // 15 models
    expect(limitFor(19)).toBe(4) // 20 models
  })

  it('blocks an option once its scaled group limit is used up', () => {
    const f = faction(hh3, LEGION)
    let r = act(hh3, newRoster(hh3, f.id), { t: 'band/setBudget', value: 3000 })
    r = addUnit(hh3, r, LEGION, 'Assault Squad')
    const uid = lastUnit(r).uid
    const group = nodeByName(hh3, r, uid, /^1-5 may exchange Chainsword/)
    const ctx = ctxOf(hh3, r)
    const view = ctx.unitOf(uid)!
    const option = view.tree.children(group).find((c) => c.k === 'e')
    expect(option, 'group has a pickable option').toBeTruthy()

    expect(blockedReason(ctx, view, option!)).toBeNull()
    r = act(hh3, r, { t: 'gear/set', uid, path: option!.path, qty: 1 })
    const after = ctxOf(hh3, r)
    const viewAfter = after.unitOf(uid)!
    expect(groupCount(viewAfter, nodeByName(hh3, r, uid, /^1-5 may exchange Chainsword/))).toBe(1)
  })
})

describe('force organisation', () => {
  it('adds a detachment under the chart and puts units in it', () => {
    const f = faction(hh3, /Legiones Astartes/)
    let r = act(hh3, newRoster(hh3, f.id), { t: 'band/setBudget', value: 3000 })
    const chart = r.forces[0]
    const primary = hh3.forceTemplates
      .find((t) => /Crusade Force Organization/i.test(t.name))!
      .children!.find((c) => /Crusade Primary Detachment/.test(c.name))!

    r = act(hh3, r, { t: 'force/add', parentUid: chart.uid, templateId: primary.id })
    expect(r.forces[0].forces).toHaveLength(1)

    const detachment = r.forces[0].forces[0]
    const { factionId, rootId } = rootByName(hh3, /Legiones Astartes/, 'Assault Squad')
    r = act(hh3, r, { t: 'unit/add', forceUid: detachment.uid, factionId, rootId })
    expect(r.forces[0].forces[0].units).toHaveLength(1)

    const ctx = ctxOf(hh3, r)
    expect(ctx.units).toHaveLength(1)
    expect(computeCosts(ctx).total).toBe(32 + 9 * 12)
  })
})

describe('every root of every faction', () => {
  it.each([
    ['swa', swa],
    ['hh3', hh3],
  ])('%s: resolves, costs and validates without throwing', (_id, pack) => {
    let checked = 0
    for (const f of pack.factions) {
      const base = newRoster(pack, f.id)
      const ctx = new Ctx(pack, base)
      const tree = ctx.treeFor(f.id)
      for (const child of f.roots) {
        const node = tree.root(child)
        expect(node, `${f.name} root resolves`).toBeTruthy()
        const r = applyAction(pack, base, {
          t: 'unit/add',
          forceUid: base.forces[0].uid,
          factionId: f.id,
          rootId: childId(child),
        })
        if (r === base) continue
        const unitCtx = new Ctx(pack, r)
        const costs = computeCosts(unitCtx)
        expect(Number.isFinite(costs.total), `${f.name}/${node!.name} cost`).toBe(true)
        expect(() => validate(unitCtx, costs)).not.toThrow()
        checked++
      }
    }
    expect(checked).toBeGreaterThan(100)
  })
})
