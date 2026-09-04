import { CATEGORY_ORDER, categoryName } from '../core/pack'
import type { Action } from '../core/roster'
import type { CostReport, Issue, Pack, Roster } from '../core/types'

export function StatusPanel({
  pack,
  roster,
  costs,
  issues,
  onGoto,
  onPrint,
  onExport,
  dispatch,
}: {
  pack: Pack
  roster: Roster
  costs: CostReport
  issues: Issue[]
  onGoto: (uid: string) => void
  onPrint: () => void
  onExport: () => void
  dispatch: (a: Action) => void
}) {
  const pct = roster.budget > 0 ? Math.min(100, (costs.total / roster.budget) * 100) : 0
  const over = costs.total > roster.budget
  const errors = issues.filter((i) => i.severity === 'error')

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
      </div>

      <div>
        <h2>Legalność</h2>
        {errors.length === 0 ? (
          <div className="legal">Drużyna jest legalna</div>
        ) : (
          errors.map((i, n) => (
            <button
              key={n}
              className={`issue ${i.severity}`}
              onClick={() => i.targetUid && onGoto(i.targetUid)}
              title={i.targetUid ? 'Przejdź do wojownika' : undefined}
            >
              {i.message}
            </button>
          ))
        )}
      </div>

      <div>
        <h2>Koszty</h2>
        <table className="prof">
          <tbody>
            {CATEGORY_ORDER.filter((c) => costs.byCategory[c] > 0).map((c) => (
              <tr key={c}>
                <td>{categoryName(pack, c)}</td>
                <td style={{ textAlign: 'right' }}>{costs.byCategory[c]}</td>
                <td className="faint" style={{ textAlign: 'right' }}>
                  {costs.total ? `${Math.round((costs.byCategory[c] / costs.total) * 100)}%` : ''}
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
