import { Fragment, useState } from 'react'
import { gearLines, primaryCategory, statlineOf } from '../core/engine'
import type { Ctx, UnitView } from '../core/engine'
import { desktop } from '../desktop'
import type { CostReport, Force, Id, Pack, Profile, Roster } from '../core/types'

/**
 * The printable document, rendered on screen exactly as it prints. The PDF comes from the host —
 * Electron's printToPDF in the desktop app, the browser's own "Save as PDF" otherwise — which keeps
 * Polish diacritics and real pagination without shipping an embedded font.
 */
export function PrintView({
  ctx,
  roster,
  costs,
  legal,
  onClose,
}: {
  ctx: Ctx
  roster: Roster
  costs: CostReport
  legal: boolean
  onClose: () => void
}) {
  const [sheet, setSheet] = useState(true)
  const [cards, setCards] = useState(true)
  const [reference, setReference] = useState(true)
  const [campaign, setCampaign] = useState(roster.campaign.enabled)
  const [ruleText, setRuleText] = useState(false)
  const [status, setStatus] = useState<{ text: string; filePath?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const app = desktop()
  const fileName = `${roster.name} ${new Date().toISOString().slice(0, 10)}`

  const savePdf = async () => {
    if (!app) return
    setBusy(true)
    setStatus(null)
    const result = await app.savePdf(fileName)
    setBusy(false)
    if (result.ok) setStatus({ text: 'Zapisano', filePath: result.filePath })
    else if (result.error) setStatus({ text: `Nie udało się zapisać: ${result.error}` })
  }

  return (
    <div className="print-root">
      <div className="print-bar">
        <button onClick={onClose}>← Wróć do edytora</button>
        <span style={{ flex: 1 }} />
        <label className="row tiny">
          <input type="checkbox" checked={sheet} onChange={(e) => setSheet(e.target.checked)} /> Lista
        </label>
        <label className="row tiny">
          <input type="checkbox" checked={cards} onChange={(e) => setCards(e.target.checked)} /> Karty
        </label>
        <label className="row tiny">
          <input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} /> Ściąga
        </label>
        {ctx.pack.campaign && (
          <label className="row tiny">
            <input type="checkbox" checked={campaign} onChange={(e) => setCampaign(e.target.checked)} /> Pola kampanii
          </label>
        )}
        <label className="row tiny">
          <input type="checkbox" checked={ruleText} onChange={(e) => setRuleText(e.target.checked)} /> Treść zasad
        </label>
        {status && (
          <span className="tiny muted">
            {status.text}
            {status.filePath && (
              <>
                {' '}
                <button className="ghost tiny" onClick={() => app?.reveal(status.filePath!)}>
                  Pokaż plik
                </button>
              </>
            )}
          </span>
        )}
        {app ? (
          <>
            <button onClick={() => void app.print()}>Drukuj</button>
            <button className="primary" disabled={busy} onClick={() => void savePdf()}>
              {busy ? 'Zapisywanie…' : 'Zapisz PDF'}
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => window.print()}>
            Drukuj / Zapisz jako PDF
          </button>
        )}
      </div>

      <div className="paper">
        {sheet && <ListSheet {...{ ctx, roster, costs, legal, campaign }} />}
        {cards && ctx.units.map((view) => <UnitCard key={view.unit.uid} {...{ ctx, view, costs, campaign, ruleText }} />)}
        {reference && <Reference {...{ ctx, ruleText }} />}
      </div>
    </div>
  )
}

const categoryName = (pack: Pack, id: Id | null) =>
  id ? (pack.categories.find((c) => c.id === id)?.name ?? '') : ''

// --- list sheet ----------------------------------------------------------------------------------

function ListSheet({
  ctx,
  roster,
  costs,
  legal,
  campaign,
}: {
  ctx: Ctx
  roster: Roster
  costs: CostReport
  legal: boolean
  campaign: boolean
}) {
  const pack = ctx.pack
  const faction = pack.factions.find((f) => f.id === roster.factionId)

  const renderForce = (force: Force, depth: number) => {
    const views = ctx.units.filter((v) => v.force === force)
    const subtotal = views.reduce((n, v) => n + (costs.byUnit[v.unit.uid] ?? 0), 0)
    return (
      <Fragment key={force.uid}>
        <tr className="force-row">
          <td colSpan={4} style={{ paddingLeft: `${depth * 8}pt` }}>
            <b>{force.name}</b>
          </td>
          <td className="n">
            <b>{subtotal || ''}</b>
          </td>
        </tr>
        {views.map((view, i) => {
          const lines = gearLines(ctx, view)
          return (
            <Fragment key={view.unit.uid}>
              <tr>
                <td className="n">{i + 1}</td>
                <td style={{ paddingLeft: `${depth * 8 + 4}pt` }}>
                  <b>{view.unit.name}</b>
                </td>
                <td>{ctx.effective(view, view.root).name}</td>
                <td>{categoryName(pack, primaryCategory(ctx, view))}</td>
                <td className="n">{costs.byUnit[view.unit.uid] ?? 0}</td>
              </tr>
              {lines.length > 0 && (
                <tr className="gear">
                  <td />
                  <td colSpan={4}>
                    {lines.map((l) => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}`).join(' · ')}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {force.forces.map((child) => renderForce(child, depth + 1))}
      </Fragment>
    )
  }

  return (
    <section className="page">
      <header className="ph">
        <h1>{roster.name}</h1>
        <div>
          {faction?.name} · {pack.name}
        </div>
      </header>
      <div className="summary">
        <span>
          Budżet <b>{roster.budget}</b>
        </span>
        <span>
          Wydane <b>{costs.total}</b>
        </span>
        <span>
          Zostało <b>{costs.remaining}</b>
        </span>
        <span>
          Pozycje <b>{ctx.units.length}</b>
        </span>
        {campaign && pack.campaign && (
          <span>
            {pack.vocabulary.campaignCurrency} <b>{roster.campaign.caches}</b>
          </span>
        )}
        <span className={legal ? 'ok' : 'bad'}>{legal ? 'LEGALNA' : 'NIELEGALNA'}</span>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th className="n">#</th>
            <th>Nazwa</th>
            <th>Typ</th>
            <th>Kategoria</th>
            <th className="n">Pts</th>
          </tr>
        </thead>
        <tbody>{roster.forces.map((f) => renderForce(f, 0))}</tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ textAlign: 'right' }}>
              <b>Razem</b>
            </td>
            <td className="n">
              <b>
                {costs.total} / {roster.budget}
              </b>
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}

// --- unit card -----------------------------------------------------------------------------------

const boxes = (n: number) => '□'.repeat(Math.max(1, Math.min(n, 12)))

/** Weapons that can run dry get ammo boxes; the data says so by having an Ammo Roll column. */
const hasAmmo = (pack: Pack, profile: Profile) =>
  (pack.profileTypes[profile.typeId]?.columns ?? []).includes('Ammo Roll')

function UnitCard({
  ctx,
  view,
  costs,
  campaign,
  ruleText,
}: {
  ctx: Ctx
  view: UnitView
  costs: CostReport
  campaign: boolean
  ruleText: boolean
}) {
  const pack = ctx.pack
  const eff = ctx.effective(view, view.root)
  const lines = gearLines(ctx, view)
  const stat = statlineOf(pack, view.root.prof)

  // Collect every profile the unit and its gear carry, keeping one row per distinct profile.
  const profileIds = new Set<Id>(view.root.prof)
  const ruleIds = new Set<Id>(view.root.rules)
  for (const line of lines) {
    for (const p of line.prof) profileIds.add(p)
    for (const r of line.rules) ruleIds.add(r)
  }
  const profiles = [...profileIds].map((id) => pack.profiles[id]).filter(Boolean)
  const byType = new Map<Id, Profile[]>()
  for (const p of profiles) {
    if (stat && p.typeId === pack.statlineType) continue
    byType.set(p.typeId, [...(byType.get(p.typeId) ?? []), p])
  }
  const rules = [...ruleIds].map((id) => pack.rules[id]).filter(Boolean)
  const plain = lines.filter((l) => l.prof.length === 0)
  const wounds = Number(stat?.values[stat.columns.indexOf('W')] ?? 1) || 1

  return (
    <section className="fcard">
      <header>
        <h2>{view.unit.name}</h2>
        <span>
          {view.unit.name !== eff.name && `${eff.name} · `}
          {categoryName(pack, primaryCategory(ctx, view))} · {costs.byUnit[view.unit.uid] ?? 0}{' '}
          {pack.vocabulary.currency}
        </span>
      </header>

      {stat && (
        <div className="cardrow">
          <table className="grid tight">
            <thead>
              <tr>
                {stat.columns.map((c) => (
                  <th key={c} className="n">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {stat.values.map((v, i) => (
                  <td key={i} className="n">
                    {v}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="track">
            <span className="lbl">Rany</span>
            <span className="bx">{boxes(wounds + 2)}</span>
          </div>
        </div>
      )}

      {[...byType.entries()].map(([typeId, list]) => {
        const type = pack.profileTypes[typeId]
        const columns = (type?.columns ?? Object.keys(list[0].chars)).filter((c) =>
          list.some((p) => (p.chars[c] ?? '').trim()),
        )
        const ammo = hasAmmo(pack, list[0])
        return (
          <table className="grid tight" key={typeId}>
            <thead>
              <tr>
                <th>{type?.name ?? 'Profil'}</th>
                {columns.map((c) => (
                  <th key={c} className="n">
                    {c}
                  </th>
                ))}
                {ammo && <th>Amunicja</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  {columns.map((c) => (
                    <td key={c} className={c === 'Special Rules' || c === 'Special' ? 'sp' : 'n'}>
                      {p.chars[c] || '—'}
                    </td>
                  ))}
                  {ammo && <td className="bx">{boxes(1 + reloadsFor(ctx, view, p.name))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )
      })}

      {plain.length > 0 && (
        <p className="line">
          <b>Wyposażenie:</b> {plain.map((l) => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}`).join(' · ')}
        </p>
      )}

      {rules.length > 0 && (
        <p className="line">
          <b>Zasady:</b> {rules.map((r) => (ruleText && r.text ? `${r.name} — ${r.text}` : r.name)).join(' · ')}
        </p>
      )}

      {view.unit.notes && <p className="line notes">{view.unit.notes}</p>}

      {campaign && pack.campaign && (
        <div className="cardrow campaign">
          <div className="track">
            <span className="lbl">XP {view.unit.campaign.xp}</span>
            <span className="bx">{boxes(10)}</span>
          </div>
          <div className="track grow">
            <span className="lbl">Kontuzje</span>
            <span>{view.unit.campaign.injuries.map((i) => i.text).join(' · ') || '—'}</span>
          </div>
          <div className="track">
            <span className="lbl">Stan</span>
            <span>{{ active: 'gotowy', recovering: 'rekonwalescencja', dead: 'poległ' }[view.unit.campaign.status]}</span>
          </div>
        </div>
      )}
    </section>
  )
}

/** One box per shot the weapon starts with, plus one per reload bought for it. */
function reloadsFor(ctx: Ctx, view: UnitView, weaponName: string): number {
  let reloads = 0
  for (const [path, qty] of view.selected) {
    const node = view.nodes.get(path)
    if (!node || !/reload/i.test(ctx.effective(view, node).name)) continue
    const parent = node.ancestorNodes[0]
    if (parent && ctx.effective(view, parent).name === weaponName) reloads += qty
  }
  return reloads
}

// --- reference -----------------------------------------------------------------------------------

function Reference({ ctx, ruleText }: { ctx: Ctx; ruleText: boolean }) {
  const pack = ctx.pack
  const profileIds = new Set<Id>()
  const ruleIds = new Set<Id>()
  for (const view of ctx.units) {
    for (const p of view.root.prof) profileIds.add(p)
    for (const r of view.root.rules) ruleIds.add(r)
    for (const line of gearLines(ctx, view)) {
      for (const p of line.prof) profileIds.add(p)
      for (const r of line.rules) ruleIds.add(r)
    }
  }
  const byType = new Map<Id, Profile[]>()
  for (const id of profileIds) {
    const p = pack.profiles[id]
    if (!p) continue
    byType.set(p.typeId, [...(byType.get(p.typeId) ?? []), p])
  }
  if (!byType.size) return null
  const rules = [...ruleIds].map((id) => pack.rules[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section className="page break">
      <header className="ph">
        <h1>Ściąga</h1>
        <div>{pack.name}</div>
      </header>
      {[...byType.entries()].map(([typeId, list]) => {
        const type = pack.profileTypes[typeId]
        const columns = (type?.columns ?? []).filter((c) => list.some((p) => (p.chars[c] ?? '').trim()))
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
        return (
          <Fragment key={typeId}>
            <h3 className="sub">{type?.name ?? 'Profile'}</h3>
            <table className="grid tight">
              <thead>
                <tr>
                  <th>Nazwa</th>
                  {columns.map((c) => (
                    <th key={c} className="n">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    {columns.map((c) => (
                      <td key={c} className={/special|traits|description|summary/i.test(c) ? 'sp' : 'n'}>
                        {p.chars[c] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Fragment>
        )
      })}
      {ruleText && rules.length > 0 && (
        <>
          <h3 className="sub">Zasady specjalne</h3>
          <dl className="rules">
            {rules.map((r) => (
              <div key={r.id}>
                <dt>{r.name}</dt>
                <dd>{r.text}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
