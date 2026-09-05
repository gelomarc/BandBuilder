import { blockedReason, groupCount, isGranted, isLive, qtyOf } from '../core/engine'
import type { Ctx, UnitView } from '../core/engine'
import type { Node } from '../core/tree'
import { ProfileTables } from './Profiles'

type Common = {
  ctx: Ctx
  view: UnitView
  onSet: (path: string, qty: number) => void
  onClearGroup?: (path: string) => void
  /** Advances are earned rather than bought, so their zero cost is only noise. */
  hideCost?: boolean
}

export function Loadout({ nodes, ...rest }: Common & { nodes: Node[] }) {
  const visible = nodes.filter((n) => !rest.ctx.effective(rest.view, n).hidden)
  if (!visible.length) return <p className="faint tiny">Brak opcji.</p>
  return (
    <>
      {visible.map((n) =>
        n.k === 'g' ? <Group key={n.path} node={n} {...rest} /> : <Item key={n.path} node={n} {...rest} />,
      )}
    </>
  )
}

/** min/max on a node, after modifiers. */
function limits(ctx: Ctx, view: UnitView, node: Node) {
  const cons = ctx.effective(view, node).cons.filter((c) => c.field === 'selections')
  let min = 0
  let max: number | null = null
  for (const c of cons) {
    if (c.type === 'min') min = Math.max(min, c.value)
    if (c.type === 'max') max = max === null ? c.value : Math.min(max, c.value)
  }
  return { min, max }
}

function Group({ node, ...rest }: Common & { node: Node }) {
  const { ctx, view, onClearGroup } = rest
  const eff = ctx.effective(view, node)
  const n = groupCount(view, node)
  const { min, max } = limits(ctx, view, node)
  const bad = n < min || (max !== null && n > max)
  const children = view.tree.children(node).filter((c) => !ctx.effective(view, c).hidden)
  if (!children.length) return null

  const removable = children.some((c) => c.k === 'e' && !isGranted(ctx, view, c) && qtyOf(view, c) > 0)

  return (
    <div className="group">
      <div className={`group-head${bad ? ' bad' : ''}`}>
        <span style={{ flex: 1 }}>{eff.name}</span>
        <span className="count">
          {n}/{max === null ? '∞' : max}
          {min > 0 && ` (min ${min})`}
        </span>
        {removable && onClearGroup && (
          <button className="ghost tiny" onClick={() => onClearGroup(node.path)} title="Wyczyść tę grupę">
            ✕
          </button>
        )}
      </div>
      <div className="group-body">
        {children.map((c) =>
          c.k === 'g' ? (
            <div key={c.path} className="subtree">
              <Group node={c} {...rest} />
            </div>
          ) : (
            <Item key={c.path} node={c} {...rest} />
          ),
        )}
      </div>
    </div>
  )
}

function Item({ node, ...rest }: Common & { node: Node }) {
  const { ctx, view, onSet, hideCost } = rest
  const eff = ctx.effective(view, node)
  const qty = qtyOf(view, node)
  const picked = qty > 0
  const granted = isGranted(ctx, view, node)
  const why = picked ? null : blockedReason(ctx, view, node)
  const { min, max } = limits(ctx, view, node)
  const single = max === 1
  const canAddMore = !granted && !blockedReason(ctx, view, node)
  const canRemove = !granted && qty > min
  const cost = eff.cost[ctx.pack.primaryCost] ?? 0
  const children = picked && isLive(view, node) ? view.tree.children(node) : []

  return (
    <>
      <div className={`opt${picked ? ' picked' : ''}${why ? ' blocked' : ''}`}>
        {granted ? (
          <span className="granted">w cenie</span>
        ) : (
          <input
            type="checkbox"
            checked={picked}
            disabled={Boolean(why)}
            onChange={() => onSet(node.path, picked ? 0 : Math.max(1, min))}
          />
        )}
        <span className="nm">
          {eff.name}
          {node.t === 'model' && <span className="faint tiny"> · model</span>}
        </span>
        {why && <span className="why">{why}</span>}
        {picked && !single && (
          <span className="qty">
            <button className="ghost" disabled={!canRemove} onClick={() => onSet(node.path, qty - 1)} title="Mniej">
              −
            </button>
            <span className="n">{qty}</span>
            <button className="ghost" disabled={!canAddMore} onClick={() => onSet(node.path, qty + 1)} title="Więcej">
              +
            </button>
          </span>
        )}
        {!hideCost && (
          <span className="cost">{granted && !cost ? '—' : `${cost * Math.max(1, qty)} ${ctx.pack.vocabulary.currency}`}</span>
        )}
      </div>

      {picked && (node.prof.length > 0 || node.rules.length > 0) && (
        <div className="subtree">
          <ProfileTables pack={ctx.pack} profileIds={node.prof} ruleIds={node.rules} />
        </div>
      )}
      {children.length > 0 && (
        <div className="subtree">
          <Loadout nodes={children} {...rest} />
        </div>
      )}
    </>
  )
}
