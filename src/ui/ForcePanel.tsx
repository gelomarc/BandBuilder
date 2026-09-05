import { useState } from 'react'
import { categoriesOf, findTemplate, forceSlots, primaryCategory } from '../core/engine'
import type { Ctx } from '../core/engine'
import type { Action } from '../core/roster'
import type { CostReport, Force, Id, Pack, Roster, Unit } from '../core/types'

type Props = {
  ctx: Ctx
  roster: Roster
  costs: CostReport
  activeUid: Id | null
  onSelect: (uid: Id) => void
  onAddUnit: (forceUid: Id) => void
  dispatch: (a: Action) => void
}

const categoryName = (pack: Pack, id: Id) => pack.categories.find((c) => c.id === id)?.name ?? id

export function ForcePanel({ ctx, roster, costs, activeUid, onSelect, onAddUnit, dispatch }: Props) {
  const pack = ctx.pack
  const faction = pack.factions.find((f) => f.id === roster.factionId)
  const multiForce = pack.forceTemplates.some((t) => (t.children?.length ?? 0) > 0)

  return (
    <div className="col">
      <h1>{pack.vocabulary.band}</h1>
      <input
        value={roster.name}
        onChange={(e) => dispatch({ t: 'band/rename', name: e.target.value })}
        style={{ width: '100%' }}
        aria-label="Nazwa listy"
      />
      <p className="tiny muted" style={{ margin: '6px 0 0' }}>
        {faction?.name}
        <br />
        <span className="faint">{pack.name}</span>
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

      {roster.forces.map((force) => (
        <ForceBlock
          key={force.uid}
          force={force}
          depth={0}
          {...{ ctx, roster, costs, activeUid, onSelect, onAddUnit, dispatch, multiForce }}
        />
      ))}
    </div>
  )
}

function ForceBlock({
  ctx,
  force,
  depth,
  costs,
  activeUid,
  onSelect,
  onAddUnit,
  dispatch,
  multiForce,
}: Omit<Props, 'roster'> & { force: Force; depth: number; multiForce: boolean }) {
  const pack = ctx.pack
  const template = findTemplate(pack, force.templateId)
  const slots = forceSlots(ctx, force)
  const usedSlots = slots.filter((s) => s.actual > 0 || s.min > 0)
  const unslotted = force.units.filter((u) => {
    const view = ctx.unitOf(u.uid)
    if (!view) return true
    const cats = categoriesOf(ctx, view)
    return !usedSlots.some((s) => cats.includes(s.category))
  })

  return (
    <div className="force" style={{ marginTop: 12, marginLeft: depth * 8 }}>
      <div className="force-head">
        <input
          value={force.name}
          onChange={(e) => dispatch({ t: 'force/rename', uid: force.uid, name: e.target.value })}
          aria-label="Nazwa detachmentu"
        />
        {depth > 0 && (
          <button className="ghost tiny danger" title="Usuń detachment" onClick={() => dispatch({ t: 'force/remove', uid: force.uid })}>
            ✕
          </button>
        )}
      </div>

      {usedSlots.map((slot) => {
        const units = force.units.filter((u) => {
          const view = ctx.unitOf(u.uid)
          return view ? categoriesOf(ctx, view).includes(slot.category) : false
        })
        const over = slot.max !== null && slot.actual > slot.max
        const under = slot.actual < slot.min
        return (
          <div className="band-group" key={slot.slotId}>
            <div className={`band-group-head${over || under ? ' over' : ''}`}>
              <span>{slot.name}</span>
              <span>
                {slot.actual}
                {slot.max !== null ? `/${slot.max}` : ''}
                {slot.min > 0 && ` (min ${slot.min})`}
              </span>
            </div>
            {units.map((u) => (
              <UnitRow key={u.uid} {...{ ctx, unit: u, costs, activeUid, onSelect }} />
            ))}
            {!units.length && <p className="tiny faint" style={{ margin: '4px 6px' }}>—</p>}
          </div>
        )
      })}

      {unslotted.length > 0 && (
        <div className="band-group">
          {usedSlots.length > 0 && (
            <div className="band-group-head">
              <span>Pozostałe</span>
              <span>{unslotted.length}</span>
            </div>
          )}
          {unslotted.map((u) => (
            <UnitRow key={u.uid} {...{ ctx, unit: u, costs, activeUid, onSelect }} />
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" style={{ flex: 1 }} onClick={() => onAddUnit(force.uid)}>
          + {pack.vocabulary.fighter}
        </button>
        {multiForce && template?.children?.length ? (
          <AddForceButton parentUid={force.uid} template={template} dispatch={dispatch} />
        ) : null}
      </div>

      {force.forces.map((child) => (
        <ForceBlock
          key={child.uid}
          force={child}
          depth={depth + 1}
          {...{ ctx, costs, activeUid, onSelect, onAddUnit, dispatch, multiForce }}
        />
      ))}
    </div>
  )
}

function UnitRow({
  ctx,
  unit,
  costs,
  activeUid,
  onSelect,
}: {
  ctx: Ctx
  unit: Unit
  costs: CostReport
  activeUid: Id | null
  onSelect: (uid: Id) => void
}) {
  const view = ctx.unitOf(unit.uid)
  const cat = view ? primaryCategory(ctx, view) : null
  return (
    <button
      className={`fighter-row${unit.uid === activeUid ? ' active' : ''}${unit.campaign.status === 'dead' ? ' dead' : ''}`}
      onClick={() => onSelect(unit.uid)}
      title={cat ? categoryName(ctx.pack, cat) : undefined}
    >
      <span className="nm">{unit.name}</span>
      <span className="pts">{costs.byUnit[unit.uid] ?? 0}</span>
    </button>
  )
}

function AddForceButton({
  parentUid,
  template,
  dispatch,
}: {
  parentUid: Id
  template: NonNullable<ReturnType<typeof findTemplate>>
  dispatch: (a: Action) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const children = (template.children ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <button onClick={() => setOpen(true)} title="Dodaj detachment">
        + detachment
      </button>
      {open && (
        <div className="backdrop" onClick={() => setOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>Dodaj detachment</strong>
              <span className="muted tiny">{template.name}</span>
              <span style={{ flex: 1 }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj…" style={{ width: 180 }} />
            </header>
            <div className="body">
              {children.map((c) => (
                <button
                  key={c.id}
                  className="pick"
                  onClick={() => {
                    dispatch({ t: 'force/add', parentUid, templateId: c.id })
                    setOpen(false)
                  }}
                >
                  <span className="nm">{c.name}</span>
                  <span className="muted tiny">{c.slots?.length ?? 0} slotów</span>
                </button>
              ))}
              {!children.length && <p className="muted">Brak wyników.</p>}
            </div>
            <footer>
              <button onClick={() => setOpen(false)}>Anuluj</button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
