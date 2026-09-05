import { useMemo, useState } from 'react'
import type { Ctx } from '../core/engine'
import { childId } from '../core/tree'
import type { CostReport, Id, Pack } from '../core/types'

type Option = { factionId: Id; rootId: Id; name: string; cost: number; category: string }

const categoryName = (pack: Pack, id: Id) => pack.categories.find((c) => c.id === id)?.name ?? ''

/**
 * Picking is never blocked — building a list means passing through illegal states — but the list
 * says up front what a choice would break, so it stays an informed one.
 */
export function AddUnitDialog({
  ctx,
  factionId,
  costs,
  onAdd,
  onClose,
}: {
  ctx: Ctx
  factionId: Id
  costs: CostReport
  onAdd: (factionId: Id, rootId: Id) => void
  onClose: () => void
}) {
  const pack = ctx.pack
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<Id>(factionId)

  const factions = pack.factions.filter((f) => !f.library)

  const options = useMemo<Option[]>(() => {
    const wanted = scope === '*' ? factions : factions.filter((f) => f.id === scope)
    const out: Option[] = []
    for (const faction of wanted) {
      const tree = ctx.treeFor(faction.id)
      for (const child of faction.roots) {
        const node = tree.root(child)
        if (!node || node.hidden) continue
        out.push({
          factionId: faction.id,
          rootId: childId(child),
          name: node.name,
          cost: node.cost[pack.primaryCost] ?? 0,
          category: categoryName(pack, node.primary ?? node.cats[0] ?? ''),
        })
      }
    }
    return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }, [ctx, factions, pack, scope])

  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())) : options
  const grouped = new Map<string, Option[]>()
  for (const o of filtered) grouped.set(o.category, [...(grouped.get(o.category) ?? []), o])

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>Dodaj {pack.vocabulary.fighterAcc}</strong>
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Frakcja">
            {factions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="*">— wszystkie frakcje —</option>
          </select>
          <span style={{ flex: 1 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj…" style={{ width: 180 }} autoFocus />
        </header>
        <div className="body">
          {[...grouped.entries()].map(([category, list]) => (
            <div key={category || 'inne'} style={{ marginBottom: 12 }}>
              <h3>{category || 'Bez kategorii'}</h3>
              {list.map((o) => {
                const warn = o.cost > 0 && costs.remaining < o.cost ? 'brak punktów w budżecie' : null
                return (
                  <button key={`${o.factionId}/${o.rootId}`} className="pick" onClick={() => onAdd(o.factionId, o.rootId)}>
                    <span className="nm">
                      {o.name}
                      {scope === '*' && (
                        <span className="faint tiny"> · {pack.factions.find((f) => f.id === o.factionId)?.name}</span>
                      )}
                    </span>
                    {warn && <span className="warnx">{warn}</span>}
                    <span className="mono">
                      {o.cost} {pack.vocabulary.currency}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {!filtered.length && <p className="muted">Brak wyników.</p>}
        </div>
        <footer>
          <span className="tiny faint" style={{ flex: 1 }}>
            {filtered.length} pozycji
          </span>
          <button onClick={onClose}>Zamknij</button>
        </footer>
      </div>
    </div>
  )
}
