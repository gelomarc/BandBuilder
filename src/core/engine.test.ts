import { describe, expect, it } from 'vitest'
import packData from '../data/swa.json'
import { computeCosts, effectiveStatline, gearLines, groupCount, toMap, validate } from './engine'
import { faction, fighterIndex, fighterType } from './pack'
import { applyAction, newRoster } from './roster'
import type { GroupNode, ItemNode, Pack, Roster } from './types'

const pack = packData as unknown as Pack
const SCOUTS = 'space-marine-scouts'

const build = (factionId = SCOUTS) => newRoster(pack, factionId)
const act = (r: Roster, ...actions: Parameters<typeof applyAction>[2][]) =>
  actions.reduce((acc, a) => applyAction(pack, acc, a), r)

const typeByName = (factionId: string, name: string) => {
  const t = faction(pack, factionId)!.fighters.find((f) => f.name === name)
  if (!t) throw new Error(`no fighter type "${name}" in ${factionId}`)
  return t
}

const findNode = (factionId: string, typeName: string, nodeName: string) => {
  const type = typeByName(factionId, typeName)
  for (const [, node] of fighterIndex(type).byId) if (node.name === nodeName) return node
  throw new Error(`no node "${nodeName}" on ${typeName}`)
}

describe('data pack', () => {
  it('has every faction with band rules and fighters', () => {
    expect(pack.factions.length).toBeGreaterThanOrEqual(15)
    for (const f of pack.factions) {
      expect(f.fighters.length, f.name).toBeGreaterThan(0)
      expect(f.bandRules.length, f.name).toBeGreaterThan(0)
      expect(f.fighters.some((x) => x.categoryId === 'leader'), `${f.name} has a leader`).toBe(true)
    }
  })

  it('keeps the faction deviations from the rulebook', () => {
    const maxOf = (id: string) => faction(pack, id)!.bandRules.find((r) => r.id === 'max-fighters')?.value
    const specialistsOf = (id: string) => faction(pack, id)!.bandRules.find((r) => r.id === 'max-specialist')?.value
    expect(maxOf('ork-boyz-kill-team')).toBe(20)
    expect(maxOf(SCOUTS)).toBe(10)
    expect(specialistsOf('astra-militarum-veteran-kill-team')).toBe(3)
    expect(specialistsOf(SCOUTS)).toBe(2)
  })

  it('gives every fighter type a value for every statistic', () => {
    for (const f of pack.factions)
      for (const t of f.fighters)
        for (const s of pack.statline) expect(t.statline[s], `${f.name}/${t.name}/${s}`).toBeTruthy()
  })

  it('marks the known gaps in the community data instead of hiding them', () => {
    // Blank characteristics come out as "?"; the count is asserted so a regression in the
    // importer that starts dropping statistics wholesale cannot pass unnoticed.
    const gaps = pack.factions.flatMap((f) =>
      f.fighters.flatMap((t) => pack.statline.filter((s) => t.statline[s] === '?').map((s) => `${t.name}/${s}`)),
    )
    expect(gaps.length).toBeLessThanOrEqual(6)
  })
})

describe('costs', () => {
  it('sums the base cost of every fighter', () => {
    const sergeant = typeByName(SCOUTS, 'Scout Sergeant')
    const scout = typeByName(SCOUTS, 'Scout')
    const r = act(build(), { t: 'fighter/add', typeId: sergeant.id }, { t: 'fighter/add', typeId: scout.id })
    expect(computeCosts(pack, r).total).toBe(sergeant.cost + scout.cost)
  })

  it('adds gear and multiplies by quantity', () => {
    const sergeant = typeByName(SCOUTS, 'Scout Sergeant')
    const sword = findNode(SCOUTS, 'Scout Sergeant', 'Power sword') as ItemNode
    let r = act(build(), { t: 'fighter/add', typeId: sergeant.id })
    const uid = r.fighters[0].uid
    r = act(r, { t: 'gear/set', uid, nodeId: sword.id, qty: 2 })
    expect(computeCosts(pack, r).total).toBe(sergeant.cost + sword.cost * 2)
  })

  it('charges nothing for granted gear', () => {
    const sergeant = typeByName(SCOUTS, 'Scout Sergeant')
    const r = act(build(), { t: 'fighter/add', typeId: sergeant.id })
    // The sergeant starts with armour and a blade already selected, at no extra cost.
    expect(r.fighters[0].gear.length).toBeGreaterThan(0)
    expect(computeCosts(pack, r).total).toBe(sergeant.cost)
  })

  it('reports cost per category', () => {
    const leader = typeByName(SCOUTS, 'Scout Sergeant')
    const trooper = typeByName(SCOUTS, 'Scout')
    const r = act(build(), { t: 'fighter/add', typeId: leader.id }, { t: 'fighter/add', typeId: trooper.id })
    const costs = computeCosts(pack, r)
    expect(costs.byCategory.leader).toBe(leader.cost)
    expect(costs.byCategory[trooper.categoryId]).toBe(trooper.cost)
  })
})

describe('gear selection', () => {
  it('drops sub-options when the weapon carrying them is removed', () => {
    const sergeant = typeByName(SCOUTS, 'Scout Sergeant')
    const boltgun = findNode(SCOUTS, 'Scout Sergeant', 'Boltgun') as ItemNode
    const scope = boltgun.children
      .flatMap((c) => (c.k === 'g' ? c.children : [c]))
      .find((c) => c.k === 'i' && /telescopic|red-dot/i.test(c.name)) as ItemNode
    let r = act(build(), { t: 'fighter/add', typeId: sergeant.id })
    const uid = r.fighters[0].uid
    r = act(r, { t: 'gear/set', uid, nodeId: boltgun.id, qty: 1 }, { t: 'gear/set', uid, nodeId: scope.id, qty: 1 })
    expect(toMap(r.fighters[0].gear).has(scope.id)).toBe(true)

    r = act(r, { t: 'gear/set', uid, nodeId: boltgun.id, qty: 0 })
    expect(toMap(r.fighters[0].gear).has(scope.id)).toBe(false)
    expect(computeCosts(pack, r).total).toBe(sergeant.cost)
  })

  it('counts group picks without counting nested groups', () => {
    const group = findNode(SCOUTS, 'Scout Sergeant', 'Pistols') as GroupNode
    const first = group.children.find((c) => c.k === 'i') as ItemNode
    expect(groupCount(group, toMap([{ nodeId: first.id, qty: 2 }]))).toBe(2)
  })

  it('lists carried gear for the sheet', () => {
    const sergeant = typeByName(SCOUTS, 'Scout Sergeant')
    const sword = findNode(SCOUTS, 'Scout Sergeant', 'Power sword') as ItemNode
    let r = act(build(), { t: 'fighter/add', typeId: sergeant.id })
    r = act(r, { t: 'gear/set', uid: r.fighters[0].uid, nodeId: sword.id, qty: 1 })
    expect(gearLines(pack, r, r.fighters[0]).map((l) => l.name)).toContain('Power sword')
  })
})

describe('validation', () => {
  const ids = (r: Roster) => validate(pack, r, computeCosts(pack, r)).map((i) => i.ruleId)

  it('demands a leader and three models', () => {
    expect(ids(build())).toEqual(expect.arrayContaining(['min-fighters', 'min-leader']))
  })

  it('accepts a legal team', () => {
    const leader = typeByName(SCOUTS, 'Scout Sergeant')
    const scout = typeByName(SCOUTS, 'Scout')
    const r = act(
      build(),
      { t: 'fighter/add', typeId: leader.id },
      { t: 'fighter/add', typeId: scout.id },
      { t: 'fighter/add', typeId: scout.id },
    )
    expect(ids(r)).toEqual([])
  })

  it('rejects a second leader', () => {
    const leader = typeByName(SCOUTS, 'Scout Sergeant')
    const r = act(build(), { t: 'fighter/add', typeId: leader.id }, { t: 'fighter/add', typeId: leader.id })
    expect(ids(r)).toContain('max-leader')
  })

  it('flags going over budget', () => {
    const leader = typeByName(SCOUTS, 'Scout Sergeant')
    let r = act(build(), { t: 'band/setBudget', value: 10 }, { t: 'fighter/add', typeId: leader.id })
    expect(ids(r)).toContain('budget')
    r = act(r, { t: 'band/setBudget', value: 1000 })
    expect(ids(r)).not.toContain('budget')
  })

  it('caps New Recruits at half the budget', () => {
    const leader = typeByName(SCOUTS, 'Scout Sergeant')
    const recruit = faction(pack, SCOUTS)!.fighters.find((f) => f.categoryId === 'recruit')!
    const many = Math.ceil(501 / recruit.cost)
    const r = act(
      build(),
      { t: 'fighter/add', typeId: leader.id },
      ...Array.from({ length: many }, () => ({ t: 'fighter/add' as const, typeId: recruit.id })),
    )
    expect(computeCosts(pack, r).byCategory.recruit).toBeGreaterThan(500)
    expect(ids(r)).toContain('max-cost-recruit')
  })

  it('lets each Special Operative raise the model limit', () => {
    const leader = typeByName(SCOUTS, 'Scout Sergeant')
    const scout = typeByName(SCOUTS, 'Scout')
    const operative = faction(pack, SCOUTS)!.fighters.find((f) => f.categoryId === 'operative')!
    // Ten ordinary models is the cap; the eleventh is legal only as an operative.
    const ten = act(
      build(),
      { t: 'band/setBudget', value: 99_999 },
      { t: 'fighter/add', typeId: leader.id },
      ...Array.from({ length: 9 }, () => ({ t: 'fighter/add' as const, typeId: scout.id })),
    )
    expect(ids(ten)).not.toContain('max-fighters')
    expect(ids(act(ten, { t: 'fighter/add', typeId: scout.id }))).toContain('max-fighters')
    expect(ids(act(ten, { t: 'fighter/add', typeId: operative.id }))).not.toContain('max-fighters')
  })

  it('honours a per-type cap', () => {
    const capped = faction(pack, SCOUTS)!.fighters.find((f) => f.max === 1)
    if (!capped) return
    const r = act(build(), { t: 'fighter/add', typeId: capped.id }, { t: 'fighter/add', typeId: capped.id })
    expect(ids(r).some((id) => id.startsWith('type-max-'))).toBe(true)
  })
})

describe('campaign', () => {
  it('applies attribute advances to the statline', () => {
    const sergeant = typeByName(SCOUTS, 'Scout Sergeant')
    const advance = findNode(SCOUTS, 'Scout Sergeant', '+1 Ballistic Skill') as ItemNode
    let r = act(build(), { t: 'fighter/add', typeId: sergeant.id })
    const uid = r.fighters[0].uid
    const before = effectiveStatline(pack, r, r.fighters[0]).BS.value
    r = act(r, { t: 'advance/set', uid, nodeId: advance.id, qty: 1 })
    const after = effectiveStatline(pack, r, r.fighters[0]).BS
    expect(Number(after.value)).toBe(Number(before) + 1)
    expect(after.changed).toBe(true)
  })

  it('keeps advances free', () => {
    const sergeant = typeByName(SCOUTS, 'Scout Sergeant')
    const advance = findNode(SCOUTS, 'Scout Sergeant', '+1 Toughness') as ItemNode
    let r = act(build(), { t: 'fighter/add', typeId: sergeant.id })
    r = act(r, { t: 'advance/set', uid: r.fighters[0].uid, nodeId: advance.id, qty: 1 })
    expect(computeCosts(pack, r).total).toBe(sergeant.cost)
  })

  it('tracks caches from logged games', () => {
    let r = build()
    r = act(r, { t: 'band/logGame', game: { id: 'g1', date: '2026-09-04', result: 'win', caches: 3, note: '' } })
    expect(r.campaign.caches).toBe(3)
    r = act(r, { t: 'band/removeGame', id: 'g1' })
    expect(r.campaign.caches).toBe(0)
  })
})

describe('roster actions', () => {
  it('names duplicates apart', () => {
    const scout = typeByName(SCOUTS, 'Scout')
    const r = act(build(), { t: 'fighter/add', typeId: scout.id }, { t: 'fighter/add', typeId: scout.id })
    expect(r.fighters.map((f) => f.name)).toEqual(['Scout', 'Scout 2'])
  })

  it('numbers by type, not by name prefix', () => {
    // "Scout Sergeant" and "Scout Gunner" must not push the first plain Scout to "Scout 3".
    const r = act(
      build(),
      { t: 'fighter/add', typeId: typeByName(SCOUTS, 'Scout Sergeant').id },
      { t: 'fighter/add', typeId: typeByName(SCOUTS, 'Scout Gunner').id },
      { t: 'fighter/add', typeId: typeByName(SCOUTS, 'Scout').id },
    )
    expect(r.fighters[2].name).toBe('Scout')
  })

  it('copies gear when duplicating a fighter', () => {
    const sergeant = typeByName(SCOUTS, 'Scout Sergeant')
    const sword = findNode(SCOUTS, 'Scout Sergeant', 'Power sword') as ItemNode
    let r = act(build(), { t: 'fighter/add', typeId: sergeant.id })
    r = act(r, { t: 'gear/set', uid: r.fighters[0].uid, nodeId: sword.id, qty: 1 })
    r = act(r, { t: 'fighter/duplicate', uid: r.fighters[0].uid })
    expect(r.fighters).toHaveLength(2)
    expect(r.fighters[1].gear).toEqual(r.fighters[0].gear)
    expect(r.fighters[1].uid).not.toBe(r.fighters[0].uid)
  })

  it('does not mutate the roster it is given', () => {
    const scout = typeByName(SCOUTS, 'Scout')
    const before = build()
    const snapshot = structuredClone(before)
    applyAction(pack, before, { t: 'fighter/add', typeId: scout.id })
    expect(before).toEqual(snapshot)
  })

  it('leaves an unknown fighter type alone', () => {
    const r = build()
    expect(applyAction(pack, r, { t: 'fighter/add', typeId: 'nope' })).toBe(r)
  })
})

describe('every fighter type in every faction', () => {
  it('can be added, fully kitted and costed without throwing', () => {
    for (const fac of pack.factions) {
      for (const type of fac.fighters) {
        let r = act(build(fac.id), { t: 'band/setBudget', value: 99_999 }, { t: 'fighter/add', typeId: type.id })
        const uid = r.fighters[0].uid
        const idx = fighterIndex(fighterType(pack, fac.id, type.id)!)
        for (const [id, node] of idx.byId) {
          if (node.k !== 'i') continue
          r = act(r, { t: 'gear/set', uid, nodeId: id, qty: 1 })
        }
        const costs = computeCosts(pack, r)
        expect(Number.isFinite(costs.total), `${fac.name}/${type.name}`).toBe(true)
        expect(costs.total, `${fac.name}/${type.name}`).toBeGreaterThanOrEqual(type.cost)
        expect(() => validate(pack, r, costs)).not.toThrow()
        expect(() => gearLines(pack, r, r.fighters[0])).not.toThrow()
      }
    }
  })
})
