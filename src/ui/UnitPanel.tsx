import { useState } from 'react'
import { primaryCategory, statlineOf } from '../core/engine'
import type { Ctx } from '../core/engine'
import type { Action } from '../core/roster'
import type { CostReport, Id, Issue, Pack, Unit, UnitStatus } from '../core/types'
import { Loadout } from './Loadout'
import { ProfileTables } from './Profiles'

type Tab = 'gear' | 'campaign' | 'notes'

const categoryName = (pack: Pack, id: Id) => pack.categories.find((c) => c.id === id)?.name ?? id

export function UnitPanel({
  ctx,
  unit,
  costs,
  issues,
  dispatch,
}: {
  ctx: Ctx
  unit: Unit
  costs: CostReport
  issues: Issue[]
  dispatch: (a: Action) => void
}) {
  const [tab, setTab] = useState<Tab>('gear')
  const pack = ctx.pack
  const view = ctx.unitOf(unit.uid)

  if (!view)
    return (
      <div className="col">
        <p>Pozycja „{unit.rootId}" nie istnieje w tym data packu.</p>
      </div>
    )

  const eff = ctx.effective(view, view.root)
  const stat = statlineOf(pack, view.root.prof)
  const cat = primaryCategory(ctx, view)
  const mine = issues.filter((i) => i.targetUid === unit.uid)
  const children = view.tree.children(view.root)
  const advances = children.filter((c) => /^(skills|advance attributes)$/i.test(c.name))
  const gear = children.filter((c) => !advances.includes(c))

  return (
    <div className="col">
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <input
          value={unit.name}
          onChange={(e) => dispatch({ t: 'unit/rename', uid: unit.uid, name: e.target.value })}
          style={{ flex: 1, minWidth: 160, fontWeight: 600 }}
          aria-label="Nazwa"
        />
        {cat && <span className="pill">{categoryName(pack, cat)}</span>}
        <span className="muted">{eff.name}</span>
        <span className="mono">
          {costs.byUnit[unit.uid] ?? 0} {pack.vocabulary.currency}
        </span>
      </div>

      <div className="row wrap" style={{ marginBottom: 10 }}>
        {stat && (
          <div className="scroll-x">
            <table className="stats">
              <thead>
                <tr>
                  {stat.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {stat.values.map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={() => dispatch({ t: 'unit/move', uid: unit.uid, dir: -1 })} title="W górę">
          ↑
        </button>
        <button className="ghost" onClick={() => dispatch({ t: 'unit/move', uid: unit.uid, dir: 1 })} title="W dół">
          ↓
        </button>
        <button className="ghost" onClick={() => dispatch({ t: 'unit/duplicate', uid: unit.uid })}>
          Duplikuj
        </button>
        <button className="ghost danger" onClick={() => dispatch({ t: 'unit/remove', uid: unit.uid })}>
          Usuń
        </button>
      </div>

      {mine.length > 0 && (
        <div className="card" style={{ marginBottom: 10, borderColor: 'var(--err)' }}>
          {mine.map((i, n) => (
            <div key={n} className="tiny" style={{ color: '#ffb3ae' }}>
              {i.message}
            </div>
          ))}
        </div>
      )}

      {(view.root.prof.length > 0 || view.root.rules.length > 0) && (
        // Horus Heresy units carry pages of special rules; collapsed by default they stay
        // available without pushing the actual list building below the fold.
        <details className="card" style={{ marginBottom: 10 }} open={view.root.rules.length <= 2}>
          <summary className="tiny muted">
            Profile i zasady ({view.root.prof.length + view.root.rules.length})
          </summary>
          <ProfileTables
            pack={pack}
            profileIds={stat ? view.root.prof.filter((id) => pack.profiles[id]?.typeId !== pack.statlineType) : view.root.prof}
            ruleIds={view.root.rules}
          />
        </details>
      )}

      <div className="tabs">
        <button className={tab === 'gear' ? 'on' : ''} onClick={() => setTab('gear')}>
          Skład i ekwipunek
        </button>
        {pack.campaign && advances.length > 0 && (
          <button className={tab === 'campaign' ? 'on' : ''} onClick={() => setTab('campaign')}>
            Kampania
            {unit.campaign.advances.length > 0 && ` (${unit.campaign.advances.length})`}
          </button>
        )}
        <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
          Notatki
        </button>
      </div>

      {tab === 'gear' && (
        <Loadout
          ctx={ctx}
          view={view}
          nodes={gear}
          onSet={(path, qty) => dispatch({ t: 'gear/set', uid: unit.uid, path, qty })}
          onClearGroup={(path) => dispatch({ t: 'gear/clearGroup', uid: unit.uid, path })}
        />
      )}

      {tab === 'campaign' && (
        <div className="stack">
          <div className="card row wrap">
            <span className="muted tiny">Doświadczenie</span>
            <button onClick={() => dispatch({ t: 'unit/xp', uid: unit.uid, delta: -1 })}>−</button>
            <span className="mono" style={{ minWidth: 28, textAlign: 'center' }}>
              {unit.campaign.xp}
            </span>
            <button onClick={() => dispatch({ t: 'unit/xp', uid: unit.uid, delta: 1 })}>+</button>
            <span style={{ flex: 1 }} />
            <span className="muted tiny">Stan</span>
            <select
              value={unit.campaign.status}
              onChange={(e) => dispatch({ t: 'unit/status', uid: unit.uid, status: e.target.value as UnitStatus })}
            >
              <option value="active">gotowy</option>
              <option value="recovering">rekonwalescencja</option>
              <option value="dead">poległ</option>
            </select>
          </div>

          <div className="card">
            <h3>Kontuzje</h3>
            {unit.campaign.injuries.map((i) => (
              <div className="opt" key={i.id}>
                <span className="nm">{i.text}</span>
                <button className="ghost tiny" onClick={() => dispatch({ t: 'unit/injury/remove', uid: unit.uid, id: i.id })}>
                  ✕
                </button>
              </div>
            ))}
            <InjuryInput onAdd={(text) => dispatch({ t: 'unit/injury/add', uid: unit.uid, text })} />
          </div>

          <div>
            <h3>Awanse i umiejętności</h3>
            <Loadout
              ctx={ctx}
              view={view}
              nodes={advances}
              onSet={(path, qty) => dispatch({ t: 'advance/set', uid: unit.uid, path, qty })}
              hideCost
            />
          </div>
        </div>
      )}

      {tab === 'notes' && (
        <textarea
          value={unit.notes}
          onChange={(e) => dispatch({ t: 'unit/notes', uid: unit.uid, notes: e.target.value })}
          rows={10}
          style={{ width: '100%' }}
          placeholder="Historia, blizny, przezwiska…"
        />
      )}
    </div>
  )
}

function InjuryInput({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('')
  const commit = () => {
    if (!text.trim()) return
    onAdd(text.trim())
    setText('')
  }
  return (
    <div className="row" style={{ marginTop: 6 }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder="np. Old Battle Wound"
        style={{ flex: 1 }}
      />
      <button onClick={commit}>Dodaj</button>
    </div>
  )
}
