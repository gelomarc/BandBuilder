import { isLink } from './types'
import type { Constraint, EntryKind, Id, Modifier, Pack, PackChild, PackNode } from './types'

/**
 * A node resolved at one position in the tree. `path` is the '/'-joined chain of node ids from the
 * unit root and is what a roster stores, so the same shared weapon appearing in two slots stays two
 * distinct selections.
 */
export type Node = {
  path: string
  id: Id
  /** The underlying shared entry, which is what conditions match on with `instanceOf`. */
  ref: Id
  k: 'g' | 'e'
  t?: EntryKind
  name: string
  cost: Record<Id, number>
  cats: Id[]
  primary?: Id
  cons: Constraint[]
  mods: Modifier[]
  prof: Id[]
  rules: Id[]
  hidden: boolean
  def?: Id
  /** Ancestor paths, nearest first. */
  ancestors: string[]
  ancestorNodes: Node[]
}

const EMPTY: readonly never[] = []
const arr = <T>(x: T[] | undefined): T[] => x ?? (EMPTY as unknown as T[])

/** Depth guard: real data nests about eight levels; anything deeper is a cycle through links. */
const MAX_DEPTH = 24

/**
 * Merge a child (inline node, or link plus its target) into one resolved node.
 * A link's own costs replace the target's for that use site; its constraints, modifiers,
 * categories and children are additive, which is how BattleScribe treats them.
 */
function resolve(pack: Pack, child: PackChild, parent: Node | null): Node | null {
  const parentPath = parent ? parent.path : ''
  if (!isLink(child)) {
    return {
      path: `${parentPath}/${child.id}`,
      id: child.id,
      ref: child.id,
      k: child.k,
      t: child.t,
      name: child.name,
      cost: child.cost ?? {},
      cats: arr(child.cats),
      primary: child.primary,
      cons: arr(child.cons),
      mods: arr(child.mods),
      prof: arr(child.prof),
      rules: arr(child.rules),
      hidden: child.hidden === true,
      def: child.def,
      ancestors: parent ? [parent.path, ...parent.ancestors] : [],
      ancestorNodes: parent ? [parent, ...parent.ancestorNodes] : [],
    }
  }

  const target = pack.nodes[child.link]
  if (!target) return null
  return {
    path: `${parentPath}/${child.id}`,
    id: child.id,
    ref: target.id,
    k: target.k,
    t: target.t,
    name: child.name ?? target.name,
    cost: child.cost ?? target.cost ?? {},
    cats: [...arr(target.cats), ...arr(child.cats)],
    primary: child.primary ?? target.primary,
    cons: [...arr(target.cons), ...arr(child.cons)],
    mods: [...arr(target.mods), ...arr(child.mods)],
    prof: [...arr(target.prof), ...arr(child.prof)],
    rules: [...arr(target.rules), ...arr(child.rules)],
    hidden: child.hidden === true || target.hidden === true,
    def: target.def,
    ancestors: parent ? [parent.path, ...parent.ancestors] : [],
    ancestorNodes: parent ? [parent, ...parent.ancestorNodes] : [],
  }
}

function rawChildren(pack: Pack, node: Node): PackChild[] {
  const own = pack.nodes[node.ref]
  const kids: PackChild[] = [...arr(own?.kids)]
  // A link can add children of its own on top of the target's.
  return kids
}

/**
 * Children of a resolved node. Results are cached per path because the UI, the cost pass and the
 * validation pass all walk the same subtrees.
 */
export class Tree {
  private cache = new Map<string, Node[]>()
  private linkKids = new Map<string, PackChild[]>()

  constructor(readonly pack: Pack) {}

  /** Resolve one root child of a faction into a node with an empty parent path. */
  root(child: PackChild): Node | null {
    const node = resolve(this.pack, child, null)
    if (node && isLink(child) && child.kids) this.linkKids.set(node.path, child.kids)
    return node
  }

  children(node: Node): Node[] {
    const hit = this.cache.get(node.path)
    if (hit) return hit
    if (node.ancestors.length >= MAX_DEPTH) {
      this.cache.set(node.path, [])
      return []
    }
    const raw = [...rawChildren(this.pack, node), ...arr(this.linkKids.get(node.path))]
    const out: Node[] = []
    const seen = new Set<string>()
    for (const child of raw) {
      const resolved = resolve(this.pack, child, node)
      if (!resolved) continue
      // Two links with the same id at one position would collide on path; keep the first.
      if (seen.has(resolved.path)) continue
      seen.add(resolved.path)
      if (isLink(child) && child.kids) this.linkKids.set(resolved.path, child.kids)
      out.push(resolved)
    }
    this.cache.set(node.path, out)
    return out
  }

  /** Every node in the subtree, the root itself first. */
  descendants(node: Node): Node[] {
    const out: Node[] = [node]
    for (let i = 0; i < out.length; i++) for (const c of this.children(out[i])) out.push(c)
    return out
  }

  /** Find a node by its path within a root, expanding only what is needed. */
  find(root: Node, path: string): Node | null {
    if (path === root.path) return root
    if (!path.startsWith(`${root.path}/`)) return null
    const rest = path.slice(root.path.length + 1).split('/')
    let current = root
    for (const id of rest) {
      const next = this.children(current).find((c) => c.id === id)
      if (!next) return null
      current = next
    }
    return current
  }
}

export function rootOf(pack: Pack, factionId: Id, rootId: Id): PackChild | null {
  const faction = pack.factions.find((f) => f.id === factionId)
  if (!faction) return null
  return faction.roots.find((r) => (isLink(r) ? r.id : (r as PackNode).id) === rootId) ?? null
}

export const childId = (c: PackChild): Id => (isLink(c) ? c.id : (c as PackNode).id)
