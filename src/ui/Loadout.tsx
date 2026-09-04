import { blockedReason, groupCount, isGranted, isReachable, toMap } from '../core/engine'
import type { NodeIndex } from '../core/pack'
import type { GroupNode, ItemNode, LoadoutNode, Pack, Sel } from '../core/types'
import { ProfileTables } from './Profiles'

type Common = {
  pack: Pack
  idx: NodeIndex
  sels: Sel[]
  onSet: (nodeId: string, qty: number) => void
  onClearGroup?: (groupId: string) => void
  /** Advances are earned, not bought, so their zero cost is not worth a column of noise. */
  hideCost?: boolean
}

type Props = Common & { nodes: LoadoutNode[] }

export function Loadout({ pack, nodes, idx, sels, onSet, onClearGroup, hideCost }: Props) {
  return (
    <>
      {nodes.map((n) =>
        n.k === 'g' ? (
          <Group
            key={n.id}
            node={n}
            {...{ pack, idx, sels, onSet, onClearGroup, hideCost }}
          />
        ) : (
          <Item key={n.id} node={n} {...{ pack, idx, sels, onSet, onClearGroup, hideCost }} />
        ),
      )}
      {nodes.length === 0 && <p className="faint tiny">Brak opcji.</p>}
    </>
  )
}

function Group({ pack, node, idx, sels, onSet, onClearGroup, hideCost }: Common & { node: GroupNode }) {
  const sel = toMap(sels)
  const n = groupCount(node, sel)
  const min = node.min ?? 0
  const bad = n < min || (node.max !== null && n > node.max)
  const limit = node.max === null ? '∞' : String(node.max)
  const removable = node.children.some((c) => c.k === 'i' && !isGranted(c) && (sel.get(c.id) ?? 0) > 0)
  return (
    <div className="group">
      <div className={`group-head${bad ? ' bad' : ''}`}>
        <span style={{ flex: 1 }}>{node.name}</span>
        <span className="count">
          {n}/{limit}
          {min > 0 && ` (min ${min})`}
        </span>
        {removable && onClearGroup && (
          <button className="ghost tiny" onClick={() => onClearGroup(node.id)} title="Wyczyść tę grupę">
            ✕
          </button>
        )}
      </div>
      <div className="group-body">
        {node.children.map((c) =>
          c.k === 'g' ? (
            <div key={c.id} className="subtree">
              <Group node={c} {...{ pack, idx, sels, onSet, onClearGroup, hideCost }} />
            </div>
          ) : (
            <Item key={c.id} node={c} {...{ pack, idx, sels, onSet, onClearGroup, hideCost }} />
          ),
        )}
      </div>
    </div>
  )
}

function Item({ pack, node, idx, sels, onSet, onClearGroup, hideCost }: Common & { node: ItemNode }) {
  const sel = toMap(sels)
  const qty = sel.get(node.id) ?? 0
  const picked = qty > 0
  const granted = isGranted(node)
  const why = picked ? null : blockedReason(node, idx, sel)
  const parentId = idx.parentOf.get(node.id)
  const parent = parentId ? idx.byId.get(parentId) : null
  const single = node.max === 1 || (parent?.k === 'g' && parent.max === 1)
  const canAddMore = !granted && !blockedReason(node, idx, sel)

  const toggle = () => {
    if (!granted) onSet(node.id, picked ? 0 : 1)
  }

  return (
    <>
      <div className={`opt${picked ? ' picked' : ''}${why ? ' blocked' : ''}`}>
        {granted ? (
          <span className="granted">w cenie</span>
        ) : (
          <input type="checkbox" checked={picked} disabled={!!why} onChange={toggle} />
        )}
        <span className="nm">
          {node.name}
          {node.effect && <span className="faint tiny"> ({node.effect.stat} +{node.effect.delta})</span>}
        </span>
        {why && <span className="why">{why}</span>}
        {picked && !single && !granted && (
          <span className="qty">
            <button className="ghost" onClick={() => onSet(node.id, qty - 1)} title="Mniej">
              −
            </button>
            <span className="n">{qty}</span>
            <button className="ghost" disabled={!canAddMore} onClick={() => onSet(node.id, qty + 1)} title="Więcej">
              +
            </button>
          </span>
        )}
        {!hideCost && (
          <span className="cost">
            {granted ? '—' : `${node.cost * Math.max(1, qty)} ${pack.vocabulary.currency}`}
          </span>
        )}
      </div>
      {picked && (node.profiles.length > 0 || node.rules.length > 0) && (
        <div className="subtree">
          <ProfileTables pack={pack} profileIds={node.profiles} ruleIds={node.rules} />
        </div>
      )}
      {picked && node.children.length > 0 && isReachable(node.id, idx, sel) && (
        <div className="subtree">
          <Loadout pack={pack} nodes={node.children} idx={idx} sels={sels} onSet={onSet} onClearGroup={onClearGroup} hideCost={hideCost} />
        </div>
      )}
    </>
  )
}
