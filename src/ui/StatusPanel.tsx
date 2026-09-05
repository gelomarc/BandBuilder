import type { Ctx } from '../core/engine'
import type { Action } from '../core/roster'
import type { CostReport, Id, Issue, Pack, Roster } from '../core/types'

const categoryName = (pack: Pack, id: Id) => pack.categories.find((c) => c.id === id)?.name ?? id

export function StatusPanel({
  ctx,
  roster,
  costs,
  issues,
  onGoto,
  onPrint,
  onExport,
  dispatch,
}: {
  ctx: Ctx
  roster: Roster
  costs: CostReport
  issues: Issue[]
  onGoto: (uid: Id) => void
  onPrint: () => void
  onExport: () => void
  dispatch: (a: Action) => void
}) {
  const pack = ctx.pack
  const pct = roster.budget > 0 ? Math.min(100, (costs.total / roster.budget) * 100) : 0
  const over = costs.total > roster.budget
  const errors = issues.filter((i) => i.severity === 'error')
  const byCategory = Object.entries(costs.byCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="col stack">
      <div>
        <h1>Status</h1>
        <div className="row">
          <span className={`budget-num${over ? ' over' : ''}`}>{costs.total}</span>
          <span className="muted">/ {roster.budget}</span>
          <span style={{ flex: 1 }} />
          <span className={`mono tiny${over ? '' : ' muted'}`} style={over ? { color: '#ffb3ae' } : undefined}>
            {over ? `+${costs.total - roster.budget}` : `zostało ${costs.remaining}`}
          </span>
        </div>
        <div className={`budget${over ? ' over' : ''}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="tiny faint" style={{ margin: '4px 0 0' }}>
          {ctx.units.length} {pack.vocabulary.fighter.toLowerCase()}
          {ctx.units.length === 1 ? '' : 'ów'}
        </p>
      </div>

      <div>
        <h2>Legalność</h2>
        {errors.length === 0 ? (
          <div className="legal">Lista jest legalna</div>
        ) : (
          <div className="issues">
            {errors.slice(0, 40).map((i, n) => (
              <button
                key={n}
                className={`issue ${i.severity}`}
                onClick={() => i.targetUid && onGoto(i.targetUid)}
                title={i.targetUid ? 'Przejdź do pozycji' : undefined}
              >
                {i.message}
              </button>
            ))}
            {errors.length > 40 && <p className="tiny faint">…i {errors.length - 40} więcej</p>}
          </div>
        )}
      </div>

      {byCategory.length > 0 && (
        <div>
          <h2>Koszty</h2>
          <table className="prof">
            <tbody>
              {byCategory.map(([cat, value]) => (
                <tr key={cat}>
                  <td>{categoryName(pack, cat)}</td>
                  <td style={{ textAlign: 'right' }}>{value}</td>
                  <td className="faint" style={{ textAlign: 'right' }}>
                    {costs.total ? `${Math.round((value / costs.total) * 100)}%` : ''}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Razem</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{costs.total}</strong>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {pack.campaign && (
        <div>
          <h2>Kampania</h2>
          <label className="row tiny muted">
            <input
              type="checkbox"
              checked={roster.campaign.enabled}
              onChange={(e) => dispatch({ t: 'band/toggleCampaign', on: e.target.checked })}
            />
            tryb kampanii
          </label>
          {roster.campaign.enabled && (
            <>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="tiny muted" style={{ flex: 1 }}>
                  {pack.vocabulary.campaignCurrency}
                </span>
                <button onClick={() => dispatch({ t: 'band/setCaches', value: roster.campaign.caches - 1 })}>−</button>
                <span className="mono" style={{ minWidth: 24, textAlign: 'center' }}>
                  {roster.campaign.caches}
                </span>
                <button onClick={() => dispatch({ t: 'band/setCaches', value: roster.campaign.caches + 1 })}>+</button>
              </div>
              <p className="tiny faint" style={{ margin: '6px 0 0' }}>
                Zwycięstwo = D3, przegrana = 1. Cache można wymienić na 100 {pack.vocabulary.currency} budżetu.
              </p>
            </>
          )}
        </div>
      )}

      <div className="stack">
        <button className="primary" style={{ width: '100%' }} onClick={onPrint}>
          Wydruk PDF
        </button>
        <button style={{ width: '100%' }} onClick={onExport}>
          Eksport JSON
        </button>
      </div>

      <p className="tiny faint">
        Dane: {pack.name} · {pack.version}
      </p>
    </div>
  )
}
