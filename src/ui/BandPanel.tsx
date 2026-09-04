import { CATEGORY_ORDER, CATEGORY_SHORT, categoryName, faction } from '../core/pack'
import type { Action } from '../core/roster'
import type { CategoryId, CostReport, Pack, Roster } from '../core/types'

type Props = {
  pack: Pack
  roster: Roster
  costs: CostReport
  limits: Record<string, { limit: number; actual: number }>
  activeUid: string | null
  onSelect: (uid: string) => void
  dispatch: (a: Action) => void
  onAdd: () => void
}

export function BandPanel({ pack, roster, costs, limits, activeUid, onSelect, dispatch, onAdd }: Props) {
  const fac = faction(pack, roster.factionId)
  const byCategory = new Map<CategoryId, typeof roster.fighters>()
  for (const f of roster.fighters) {
    const cat = fac?.fighters.find((t) => t.id === f.typeId)?.categoryId
    if (!cat) continue
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), f])
  }

  return (
    <div className="col">
      <h1>{pack.vocabulary.band}</h1>
      <input
        value={roster.name}
        onChange={(e) => dispatch({ t: 'band/rename', name: e.target.value })}
        style={{ width: '100%' }}
        aria-label="Nazwa drużyny"
      />
      <p className="tiny muted" style={{ margin: '6px 0 0' }}>
        {fac?.name}
        <br />
        <span className="faint">{fac?.book}</span>
      </p>

      <div className="row" style={{ marginTop: 10 }}>
        <label className="tiny muted" htmlFor="budget">
          Budżet
        </label>
        <input
          id="budget"
          type="number"
          min={0}
          step={50}
          value={roster.budget}
          onChange={(e) => dispatch({ t: 'band/setBudget', value: Number(e.target.value) })}
          style={{ width: 90 }}
        />
        <span className="tiny faint">{pack.vocabulary.currency}</span>
      </div>

      {CATEGORY_ORDER.filter((cat) => fac?.fighters.some((t) => t.categoryId === cat)).map((cat) => {
        const list = byCategory.get(cat) ?? []
        const lim = limits[`max-${cat}`]
        const over = lim ? lim.actual > lim.limit : false
        return (
          <div className="band-group" key={cat}>
            <div className={`band-group-head${over ? ' over' : ''}`}>
              <span>{categoryName(pack, cat)}</span>
              <span>{lim ? `${lim.actual}/${lim.limit}` : list.length || ''}</span>
            </div>
            {list.map((f) => (
              <button
                key={f.uid}
                className={`fighter-row${f.uid === activeUid ? ' active' : ''}${
                  f.campaign.status === 'dead' ? ' dead' : ''
                }`}
                onClick={() => onSelect(f.uid)}
              >
                <span className={`pill${cat === 'leader' ? ' ldr' : ''}`}>{CATEGORY_SHORT[cat]}</span>
                <span className="nm">{f.name}</span>
                <span className="pts">{costs.byFighter[f.uid] ?? 0}</span>
              </button>
            ))}
            {!list.length && <p className="tiny faint" style={{ margin: '4px 6px' }}>—</p>}
          </div>
        )
      })}

      <button className="primary" style={{ width: '100%', marginTop: 12 }} onClick={onAdd}>
        + Dodaj {pack.vocabulary.fighterAcc}
      </button>
    </div>
  )
}
