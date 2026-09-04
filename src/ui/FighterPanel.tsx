import { useState } from 'react'
import { effectiveStatline } from '../core/engine'
import { CATEGORY_SHORT, categoryName, fighterIndex, fighterType, priceLabel } from '../core/pack'
import type { Action } from '../core/roster'
import type { CostReport, Fighter, Issue, Pack, Roster } from '../core/types'
import { Loadout } from './Loadout'
import { ProfileTables } from './Profiles'

type Tab = 'gear' | 'campaign' | 'notes'

export function FighterPanel({
  pack,
  roster,
  fighter,
  costs,
  issues,
  dispatch,
}: {
  pack: Pack
  roster: Roster
  fighter: Fighter
  costs: CostReport
  issues: Issue[]
  dispatch: (a: Action) => void
}) {
  const [tab, setTab] = useState<Tab>('gear')
  const type = fighterType(pack, roster.factionId, fighter.typeId)
  if (!type)
    return (
      <div className="col">
        <p>Typ „{fighter.typeId}" nie istnieje w tym data packu.</p>
      </div>
    )

  const idx = fighterIndex(type)
  const stats = effectiveStatline(pack, roster, fighter)
  const mine = issues.filter((i) => i.targetUid === fighter.uid)

  return (
    <div className="col">
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <input
          value={fighter.name}
          onChange={(e) => dispatch({ t: 'fighter/rename', uid: fighter.uid, name: e.target.value })}
          style={{ flex: 1, minWidth: 160, fontWeight: 600 }}
          aria-label="Imię wojownika"
        />
        <span className="pill">{CATEGORY_SHORT[type.categoryId]}</span>
        <span className="muted">{type.name}</span>
        <span className="mono">
          {costs.byFighter[fighter.uid] ?? 0} {pack.vocabulary.currency}
        </span>
      </div>

      <div className="row wrap" style={{ marginBottom: 10 }}>
        <div className="scroll-x">
          <table className="stats">
            <thead>
              <tr>
                {pack.statline.map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {pack.statline.map((s) => (
                  <td key={s} className={stats[s]?.changed ? 'changed' : ''} title={stats[s]?.changed ? `bazowo ${stats[s].base}` : ''}>
                    {stats[s]?.value ?? '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="ghost" onClick={() => dispatch({ t: 'fighter/move', uid: fighter.uid, dir: -1 })} title="W górę">
          ↑
        </button>
        <button className="ghost" onClick={() => dispatch({ t: 'fighter/move', uid: fighter.uid, dir: 1 })} title="W dół">
          ↓
        </button>
        <button className="ghost" onClick={() => dispatch({ t: 'fighter/duplicate', uid: fighter.uid })}>
          Duplikuj
        </button>
        <button className="ghost danger" onClick={() => dispatch({ t: 'fighter/remove', uid: fighter.uid })}>
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

      {(type.profiles.length > 0 || type.rules.length > 0) && (
        <div className="card" style={{ marginBottom: 10 }}>
          <ProfileTables pack={pack} profileIds={type.profiles} ruleIds={type.rules} />
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'gear' ? 'on' : ''} onClick={() => setTab('gear')}>
          Ekwipunek
        </button>
        <button className={tab === 'campaign' ? 'on' : ''} onClick={() => setTab('campaign')}>
          Kampania
          {fighter.campaign.advances.length > 0 && ` (${fighter.campaign.advances.length})`}
        </button>
        <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
          Notatki
        </button>
      </div>

      {tab === 'gear' && (
        <Loadout
          pack={pack}
          nodes={type.tree}
          idx={idx}
          sels={fighter.gear}
          onSet={(nodeId, qty) => dispatch({ t: 'gear/set', uid: fighter.uid, nodeId, qty })}
          onClearGroup={(groupId) => dispatch({ t: 'gear/clearGroup', uid: fighter.uid, groupId })}
        />
      )}

      {tab === 'campaign' && (
        <div className="stack">
          <div className="card row wrap">
            <span className="muted tiny">Doświadczenie</span>
            <button onClick={() => dispatch({ t: 'fighter/xp', uid: fighter.uid, delta: -1 })}>−</button>
            <span className="mono" style={{ minWidth: 28, textAlign: 'center' }}>
              {fighter.campaign.xp}
            </span>
            <button onClick={() => dispatch({ t: 'fighter/xp', uid: fighter.uid, delta: 1 })}>+</button>
            <span style={{ flex: 1 }} />
            <span className="muted tiny">Stan</span>
            <select
              value={fighter.campaign.status}
              onChange={(e) =>
                dispatch({ t: 'fighter/status', uid: fighter.uid, status: e.target.value as Fighter['campaign']['status'] })
              }
            >
              <option value="active">gotowy</option>
              <option value="recovering">rekonwalescencja</option>
              <option value="dead">poległ</option>
            </select>
          </div>

          <div className="card">
            <h3>Kontuzje</h3>
            {fighter.campaign.injuries.map((i) => (
              <div className="opt" key={i.id}>
                <span className="nm">{i.text}</span>
                <button
                  className="ghost tiny"
                  onClick={() => dispatch({ t: 'fighter/injury/remove', uid: fighter.uid, id: i.id })}
                >
                  ✕
                </button>
              </div>
            ))}
            <InjuryInput onAdd={(text) => dispatch({ t: 'fighter/injury/add', uid: fighter.uid, text })} />
          </div>

          <div>
            <h3>Awanse i umiejętności</h3>
            <Loadout
              pack={pack}
              nodes={type.advances}
              idx={idx}
              sels={fighter.campaign.advances}
              onSet={(nodeId, qty) => dispatch({ t: 'advance/set', uid: fighter.uid, nodeId, qty })}
              hideCost
            />
          </div>
        </div>
      )}

      {tab === 'notes' && (
        <textarea
          value={fighter.notes}
          onChange={(e) => dispatch({ t: 'fighter/notes', uid: fighter.uid, notes: e.target.value })}
          rows={10}
          style={{ width: '100%' }}
          placeholder="Historia, blizny, przezwiska…"
        />
      )}

      <p className="tiny faint" style={{ marginTop: 12 }}>
        {categoryName(pack, type.categoryId)} · baza {priceLabel(pack, type.cost, type.categoryId)}
        {type.max !== null && ` · maks. ${type.max} w drużynie`}
      </p>
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
