import { useMemo, useState } from 'react'
import { CATEGORY_ORDER, categoryName, faction, priceLabel } from '../core/pack'
import type { CategoryId, CostReport, FighterType, Pack, Roster } from '../core/types'

/**
 * Adding a fighter is never blocked — building a list means passing through illegal states — but
 * the dialog says up front what would break, so it is an informed choice.
 */
export function AddFighterDialog({
  pack,
  roster,
  costs,
  limits,
  onAdd,
  onClose,
}: {
  pack: Pack
  roster: Roster
  costs: CostReport
  limits: Record<string, { limit: number; actual: number }>
  onAdd: (typeId: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const fac = faction(pack, roster.factionId)
  const groups = useMemo(() => {
    const map = new Map<CategoryId, FighterType[]>()
    for (const t of fac?.fighters ?? []) {
      if (q && !t.name.toLowerCase().includes(q.toLowerCase())) continue
      map.set(t.categoryId, [...(map.get(t.categoryId) ?? []), t])
    }
    return map
  }, [fac, q])

  const totalLimit = limits['max-fighters']

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>Dodaj {pack.vocabulary.fighterAcc}</strong>
          <span className="muted tiny">
            {fac?.name} · {totalLimit ? `${totalLimit.actual}/${totalLimit.limit} modeli` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj…" style={{ width: 160 }} />
        </header>
        <div className="body">
          {CATEGORY_ORDER.map((cat) => {
            const list = groups.get(cat) ?? []
            if (!list.length) return null
            const lim = limits[`max-${cat}`]
            return (
              <div key={cat} style={{ marginBottom: 12 }}>
                <h3>
                  {categoryName(pack, cat)}
                  {lim && <span className="faint"> — {lim.actual}/{lim.limit}</span>}
                </h3>
                {list.map((t) => {
                  const used = roster.fighters.filter((f) => f.typeId === t.id).length
                  const warnings: string[] = []
                  if (lim && lim.actual >= lim.limit) warnings.push(`limit ${categoryName(pack, cat)} wyczerpany`)
                  if (totalLimit && totalLimit.actual >= totalLimit.limit) warnings.push('limit modeli wyczerpany')
                  if (t.max !== null && used >= t.max) warnings.push(`maks. ${t.max} tego typu`)
                  if (t.cost > 0 && costs.remaining < t.cost) warnings.push('brak punktów w budżecie')
                  return (
                    <button key={t.id} className="pick" onClick={() => onAdd(t.id)}>
                      <span className="nm">
                        {t.name}
                        {used > 0 && <span className="faint tiny"> (w drużynie: {used})</span>}
                      </span>
                      {warnings.length > 0 && <span className="warnx">{warnings.join(' · ')}</span>}
                      <span className="mono">{priceLabel(pack, t.cost, t.categoryId)}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
          {[...groups.values()].every((l) => !l.length) && <p className="muted">Brak wyników.</p>}
        </div>
        <footer>
          <button onClick={onClose}>Zamknij</button>
        </footer>
      </div>
    </div>
  )
}
