import { autoFill, toMap, toSels } from './engine'
import { faction, fighterIndex, fighterType } from './pack'
import type { Fighter, GameRecord, Pack, Roster, Sel } from './types'

let counter = 0
export const uid = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function newRoster(pack: Pack, factionId: string, name?: string): Roster {
  const now = new Date().toISOString()
  const fac = faction(pack, factionId)
  return {
    schema: 'bandbuilder/roster@1',
    id: uid('r'),
    name: name || `Nowa drużyna (${fac?.name ?? factionId})`,
    pack: { id: pack.id, version: pack.version },
    factionId,
    bandOptions: [],
    budget: pack.budget.default,
    fighters: [],
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
  | { t: 'band/removeGame'; id: string }
  | { t: 'fighter/add'; typeId: string }
  | { t: 'fighter/remove'; uid: string }
  | { t: 'fighter/rename'; uid: string; name: string }
  | { t: 'fighter/duplicate'; uid: string }
  | { t: 'fighter/move'; uid: string; dir: -1 | 1 }
  | { t: 'fighter/notes'; uid: string; notes: string }
  | { t: 'fighter/status'; uid: string; status: Fighter['campaign']['status'] }
  | { t: 'fighter/xp'; uid: string; delta: number }
  | { t: 'fighter/injury/add'; uid: string; text: string }
  | { t: 'fighter/injury/remove'; uid: string; id: string }
  | { t: 'gear/set'; uid: string; nodeId: string; qty: number }
  | { t: 'gear/clearGroup'; uid: string; groupId: string }
  | { t: 'advance/set'; uid: string; nodeId: string; qty: number }

/**
 * Names default to the type with a running number, so a band never has two nameless models.
 * Counted per type id, not per name prefix: "Scout Sergeant" and "Scout Gunner" must not make
 * the first plain Scout come out as "Scout 3".
 */
function defaultName(roster: Roster, typeId: string, typeName: string): string {
  let n = 0
  for (const f of roster.fighters) if (f.typeId === typeId) n++
  return n === 0 ? typeName : `${typeName} ${n + 1}`
}

/**
 * Drop selections that are no longer reachable. Removing a boltgun must also remove its scope,
 * otherwise the roster keeps paying for an upgrade to a weapon the fighter no longer carries.
 */
function prune(pack: Pack, roster: Roster, fighter: Fighter): Fighter {
  const type = fighterType(pack, roster.factionId, fighter.typeId)
  if (!type) return fighter
  const idx = fighterIndex(type)
  const keep = (sels: Sel[]): Sel[] => {
    let sel = toMap(sels)
    for (let pass = 0; pass < 8; pass++) {
      let changed = false
      for (const id of [...sel.keys()]) {
        const ancestors = idx.ancestorsOf.get(id) ?? []
        const orphan = ancestors.some((a) => idx.byId.get(a)?.k === 'i' && !sel.has(a))
        if (orphan) {
          sel.delete(id)
          changed = true
        }
      }
      if (!changed) break
    }
    return toSels(sel)
  }
  return { ...fighter, gear: keep(fighter.gear), campaign: { ...fighter.campaign, advances: keep(fighter.campaign.advances) } }
}

function mapFighter(roster: Roster, uid: string, fn: (f: Fighter) => Fighter): Roster {
  return { ...roster, fighters: roster.fighters.map((f) => (f.uid === uid ? fn(f) : f)) }
}

function setQty(sels: Sel[], nodeId: string, qty: number): Sel[] {
  const m = toMap(sels)
  if (qty <= 0) m.delete(nodeId)
  else m.set(nodeId, qty)
  return toSels(m)
}

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

    case 'fighter/add': {
      const type = fighterType(pack, roster.factionId, action.typeId)
      if (!type) return roster
      const fighter: Fighter = {
        uid: uid('f'),
        typeId: type.id,
        name: defaultName(roster, type.id, type.name),
        gear: autoFill(type, []),
        campaign: { xp: 0, advances: [], injuries: [], status: 'active' },
        notes: '',
      }
      return touch({ ...roster, fighters: [...roster.fighters, fighter] })
    }
    case 'fighter/remove':
      return touch({ ...roster, fighters: roster.fighters.filter((f) => f.uid !== action.uid) })
    case 'fighter/rename':
      return touch(mapFighter(roster, action.uid, (f) => ({ ...f, name: action.name })))
    case 'fighter/notes':
      return touch(mapFighter(roster, action.uid, (f) => ({ ...f, notes: action.notes })))
    case 'fighter/status':
      return touch(
        mapFighter(roster, action.uid, (f) => ({ ...f, campaign: { ...f.campaign, status: action.status } })),
      )
    case 'fighter/xp':
      return touch(
        mapFighter(roster, action.uid, (f) => ({
          ...f,
          campaign: { ...f.campaign, xp: Math.max(0, f.campaign.xp + action.delta) },
        })),
      )
    case 'fighter/injury/add':
      return touch(
        mapFighter(roster, action.uid, (f) => ({
          ...f,
          campaign: { ...f.campaign, injuries: [...f.campaign.injuries, { id: uid('i'), text: action.text }] },
        })),
      )
    case 'fighter/injury/remove':
      return touch(
        mapFighter(roster, action.uid, (f) => ({
          ...f,
          campaign: { ...f.campaign, injuries: f.campaign.injuries.filter((i) => i.id !== action.id) },
        })),
      )
    case 'fighter/duplicate': {
      const src = roster.fighters.find((f) => f.uid === action.uid)
      if (!src) return roster
      const type = fighterType(pack, roster.factionId, src.typeId)
      const copy: Fighter = {
        ...structuredClone(src),
        uid: uid('f'),
        name: defaultName(roster, src.typeId, type?.name ?? src.name),
      }
      const at = roster.fighters.indexOf(src) + 1
      const fighters = [...roster.fighters]
      fighters.splice(at, 0, copy)
      return touch({ ...roster, fighters })
    }
    case 'fighter/move': {
      const i = roster.fighters.findIndex((f) => f.uid === action.uid)
      const j = i + action.dir
      if (i < 0 || j < 0 || j >= roster.fighters.length) return roster
      const fighters = [...roster.fighters]
      ;[fighters[i], fighters[j]] = [fighters[j], fighters[i]]
      return touch({ ...roster, fighters })
    }

    case 'gear/set':
      return touch(
        mapFighter(roster, action.uid, (f) => {
          const type = fighterType(pack, roster.factionId, f.typeId)
          if (!type) return f
          const withQty = { ...f, gear: setQty(f.gear, action.nodeId, action.qty) }
          const pruned = prune(pack, roster, withQty)
          return { ...pruned, gear: autoFill(type, pruned.gear) }
        }),
      )
    case 'gear/clearGroup':
      return touch(
        mapFighter(roster, action.uid, (f) => {
          const type = fighterType(pack, roster.factionId, f.typeId)
          if (!type) return f
          const idx = fighterIndex(type)
          const group = idx.byId.get(action.groupId)
          if (group?.k !== 'g') return f
          const m = toMap(f.gear)
          for (const c of group.children) if (c.k === 'i' && !(c.min && c.min >= 1)) m.delete(c.id)
          const pruned = prune(pack, roster, { ...f, gear: toSels(m) })
          return { ...pruned, gear: autoFill(type, pruned.gear) }
        }),
      )
    case 'advance/set':
      return touch(
        mapFighter(roster, action.uid, (f) => ({
          ...f,
          campaign: { ...f.campaign, advances: setQty(f.campaign.advances, action.nodeId, action.qty) },
        })),
      )
  }
}
