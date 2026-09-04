import { Fragment, useState } from 'react'
import { effectiveStatline, gearLines, toMap } from '../core/engine'
import { CATEGORY_SHORT, fighterIndex, fighterType } from '../core/pack'
import type { CostReport, Fighter, Pack, Profile, Roster } from '../core/types'

/**
 * The printable document. Rendered on screen exactly as it prints, so the print dialog holds no
 * surprises; the browser's own "Save as PDF" produces the file, which keeps Polish diacritics and
 * real pagination without shipping an embedded font.
 */
export function PrintView({
  pack,
  roster,
  costs,
  legal,
  onClose,
}: {
  pack: Pack
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

  return (
    <div className="print-root">
      <div className="print-bar">
        <button onClick={onClose}>← Wróć do edytora</button>
        <span style={{ flex: 1 }} />
        <label className="row tiny">
          <input type="checkbox" checked={sheet} onChange={(e) => setSheet(e.target.checked)} /> Karta drużyny
        </label>
        <label className="row tiny">
          <input type="checkbox" checked={cards} onChange={(e) => setCards(e.target.checked)} /> Karty wojowników
        </label>
        <label className="row tiny">
          <input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} /> Ściąga broni
        </label>
        <label className="row tiny">
          <input type="checkbox" checked={campaign} onChange={(e) => setCampaign(e.target.checked)} /> Pola kampanii
        </label>
        <label className="row tiny">
          <input type="checkbox" checked={ruleText} onChange={(e) => setRuleText(e.target.checked)} /> Treść zasad
        </label>
        <button className="primary" onClick={() => window.print()}>
          Drukuj / Zapisz jako PDF
        </button>
      </div>

      <div className="paper">
        {sheet && <RosterSheet pack={pack} roster={roster} costs={costs} legal={legal} campaign={campaign} />}
        {cards &&
          roster.fighters.map((f) => (
            <FighterCard key={f.uid} pack={pack} roster={roster} fighter={f} costs={costs} campaign={campaign} ruleText={ruleText} />
          ))}
        {reference && <WeaponReference pack={pack} roster={roster} ruleText={ruleText} />}
      </div>
    </div>
  )
}

// --- unified weapon view ---------------------------------------------------------------------

type WeaponRow = {
  name: string
  qty: number
  range: string
  toHit: string
  str: string
  dam: string
  save: string
  ammo: string
  special: string
  kind: 'ranged' | 'melee' | 'grenade'
}

const cell = (p: Profile, c: string) => (p.chars[c] ?? '').trim()

function weaponRow(pack: Pack, profileId: string, name: string, qty: number): WeaponRow | null {
  const p = pack.profiles[profileId]
  if (!p) return null
  const type = pack.profileTypes[p.typeId]?.name ?? p.typeName ?? ''
  const has = (c: string) => p.chars[c] !== undefined
  if (has('Short Range') || has('Long Range')) {
    const short = cell(p, 'Short Range')
    const long = cell(p, 'Long Range')
    return {
      name,
      qty,
      range: [short, long].filter(Boolean).join(' / ') || '—',
      toHit: [cell(p, 'Short To Hit') || '—', cell(p, 'Long To Hit') || '—'].join(' / '),
      str: cell(p, 'Str.') || '—',
      dam: cell(p, 'Dam.') || '—',
      save: cell(p, 'Save Mod.') || '—',
      ammo: cell(p, 'Ammo Roll') || '—',
      special: cell(p, 'Special'),
      kind: 'ranged',
    }
  }
  if (has('Str.')) {
    const grenade = /grenad/i.test(type)
    return {
      name,
      qty,
      range: grenade ? 'rzut' : 'wręcz',
      toHit: '—',
      str: cell(p, 'Str.') || '—',
      dam: cell(p, 'Dam.') || '—',
      save: cell(p, 'Save Mod.') || '—',
      ammo: '—',
      special: cell(p, 'Special'),
      kind: grenade ? 'grenade' : 'melee',
    }
  }
  return null
}

function fighterWeapons(pack: Pack, roster: Roster, fighter: Fighter) {
  const rows: WeaponRow[] = []
  const other: { name: string; qty: number; text: string }[] = []
  for (const line of gearLines(pack, roster, fighter)) {
    const weapons = line.profiles.map((id) => weaponRow(pack, id, line.name, line.qty)).filter(Boolean) as WeaponRow[]
    if (weapons.length) {
      rows.push(...weapons)
      continue
    }
    // Reloads are not equipment: they are already counted as extra ammo boxes on their weapon.
    if (/reload/i.test(line.name)) continue
    const desc = line.profiles
      .map((id) => pack.profiles[id])
      .filter(Boolean)
      .flatMap((p) =>
        Object.entries(p.chars)
          .filter(([, v]) => v.trim())
          .map(([col, v]) => (col === 'Description' ? v : `${col}: ${v}`)),
      )
      .join(' · ')
    other.push({ name: line.name, qty: line.qty, text: desc.trim() })
  }
  return { rows, other }
}

/** How many ammo boxes a weapon deserves: the shot it starts with plus every reload bought. */
function reloadsFor(pack: Pack, roster: Roster, fighter: Fighter, weaponName: string): number {
  const type = fighterType(pack, roster.factionId, fighter.typeId)
  if (!type) return 0
  const idx = fighterIndex(type)
  const sel = toMap(fighter.gear)
  let reloads = 0
  for (const [id, node] of idx.byId) {
    if (node.k !== 'i' || !/reload/i.test(node.name)) continue
    const qty = sel.get(id) ?? 0
    if (!qty) continue
    const parentId = idx.parentOf.get(id)
    const parent = parentId ? idx.byId.get(parentId) : null
    if (parent?.k === 'i' && parent.name === weaponName) reloads += qty
  }
  return reloads
}

const boxes = (n: number) => '□'.repeat(Math.max(1, Math.min(n, 12)))

// --- sheet -----------------------------------------------------------------------------------

function RosterSheet({
  pack,
  roster,
  costs,
  legal,
  campaign,
}: {
  pack: Pack
  roster: Roster
  costs: CostReport
  legal: boolean
  campaign: boolean
}) {
  const fac = pack.factions.find((f) => f.id === roster.factionId)
  return (
    <section className="page">
      <header className="ph">
        <h1>{roster.name}</h1>
        <div>
          {fac?.name} · {pack.name}
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
          Modele <b>{roster.fighters.length}</b>
        </span>
        {campaign && (
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
            <th>Wojownik</th>
            <th>Typ</th>
            <th>Kat.</th>
            {pack.statline.map((s) => (
              <th key={s} className="n">
                {s}
              </th>
            ))}
            <th className="n">Pts</th>
          </tr>
        </thead>
        <tbody>
          {roster.fighters.map((f, i) => {
            const type = fighterType(pack, roster.factionId, f.typeId)
            const stats = effectiveStatline(pack, roster, f)
            const lines = gearLines(pack, roster, f)
            return (
              <Fragment key={f.uid}>
                <tr>
                  <td className="n">{i + 1}</td>
                  <td>
                    <b>{f.name}</b>
                  </td>
                  <td>{type?.name}</td>
                  <td>{type ? CATEGORY_SHORT[type.categoryId] : ''}</td>
                  {pack.statline.map((s) => (
                    <td key={s} className="n">
                      {stats[s]?.value ?? '—'}
                    </td>
                  ))}
                  <td className="n">{costs.byFighter[f.uid] ?? 0}</td>
                </tr>
                <tr className="gear">
                  <td />
                  <td colSpan={pack.statline.length + 4}>
                    {lines.length
                      ? lines.map((l) => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}`).join(' · ')
                      : 'bez ekwipunku'}
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={pack.statline.length + 4} style={{ textAlign: 'right' }}>
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

// --- fighter card ----------------------------------------------------------------------------

function FighterCard({
  pack,
  roster,
  fighter,
  costs,
  campaign,
  ruleText,
}: {
  pack: Pack
  roster: Roster
  fighter: Fighter
  costs: CostReport
  campaign: boolean
  ruleText: boolean
}) {
  const type = fighterType(pack, roster.factionId, fighter.typeId)
  if (!type) return null
  const stats = effectiveStatline(pack, roster, fighter)
  const { rows, other } = fighterWeapons(pack, roster, fighter)
  const wounds = Number(stats.W?.value ?? 1) || 1
  const idx = fighterIndex(type)
  const advSel = toMap(fighter.campaign.advances)
  const skills = [...advSel.keys()]
    .map((id) => idx.byId.get(id))
    .filter((n) => n && n.k === 'i' && !n.effect)
    .map((n) => n!.name)
  const ruleIds = new Set(type.rules)
  for (const line of gearLines(pack, roster, fighter)) for (const id of line.rules) ruleIds.add(id)
  const rules = [...ruleIds].map((id) => pack.rules[id]).filter(Boolean)

  return (
    <section className="fcard">
      <header>
        <h2>{fighter.name}</h2>
        <span>
          {fighter.name !== type.name && `${type.name} · `}
          {CATEGORY_SHORT[type.categoryId]} · {costs.byFighter[fighter.uid] ?? 0} {pack.vocabulary.currency}
        </span>
      </header>

      <div className="cardrow">
        <table className="grid tight">
          <thead>
            <tr>
              {pack.statline.map((s) => (
                <th key={s} className="n">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {pack.statline.map((s) => (
                <td key={s} className="n">
                  {stats[s]?.value ?? '—'}
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

      {rows.length > 0 && (
        <table className="grid tight">
          <thead>
            <tr>
              <th>Broń</th>
              <th>Zasięg</th>
              <th className="n">Trafienie</th>
              <th className="n">S</th>
              <th className="n">Dam</th>
              <th className="n">Zbroja</th>
              <th className="n">Ammo</th>
              <th>Cechy</th>
              <th>Amunicja</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.name}
                  {r.qty > 1 && ` ×${r.qty}`}
                </td>
                <td>{r.range}</td>
                <td className="n">{r.toHit}</td>
                <td className="n">{r.str}</td>
                <td className="n">{r.dam}</td>
                <td className="n">{r.save}</td>
                <td className="n">{r.ammo}</td>
                <td className="sp">{r.special || '—'}</td>
                <td className="bx">
                  {r.kind === 'ranged' ? boxes(1 + reloadsFor(pack, roster, fighter, r.name)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {other.length > 0 && (
        <p className="line">
          <b>Wyposażenie:</b>{' '}
          {other.map((o) => `${o.name}${o.qty > 1 ? ` ×${o.qty}` : ''}${o.text ? ` — ${o.text}` : ''}`).join(' · ')}
        </p>
      )}

      {skills.length > 0 && (
        <p className="line">
          <b>Umiejętności:</b> {skills.join(' · ')}
        </p>
      )}

      {rules.length > 0 && (
        <p className="line">
          <b>Zasady:</b> {rules.map((r) => (ruleText && r.text ? `${r.name} — ${r.text}` : r.name)).join(' · ')}
        </p>
      )}

      {fighter.notes && <p className="line notes">{fighter.notes}</p>}

      {campaign && (
        <div className="cardrow campaign">
          <div className="track">
            <span className="lbl">XP {fighter.campaign.xp}</span>
            <span className="bx">{boxes(10)}</span>
          </div>
          <div className="track grow">
            <span className="lbl">Kontuzje</span>
            <span>{fighter.campaign.injuries.map((i) => i.text).join(' · ') || '—'}</span>
          </div>
          <div className="track">
            <span className="lbl">Stan</span>
            <span>{{ active: 'gotowy', recovering: 'rekonwalescencja', dead: 'poległ' }[fighter.campaign.status]}</span>
          </div>
        </div>
      )}
    </section>
  )
}

// --- weapon reference ------------------------------------------------------------------------

function WeaponReference({ pack, roster, ruleText }: { pack: Pack; roster: Roster; ruleText: boolean }) {
  const seen = new Map<string, WeaponRow>()
  const ruleIds = new Set<string>()
  for (const f of roster.fighters) {
    for (const line of gearLines(pack, roster, f)) {
      for (const id of line.rules) ruleIds.add(id)
      for (const pid of line.profiles) {
        const row = weaponRow(pack, pid, line.name, 1)
        if (row && !seen.has(row.name)) seen.set(row.name, row)
      }
    }
  }
  const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  if (!rows.length) return null
  const rules = [...ruleIds].map((id) => pack.rules[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section className="page break">
      <header className="ph">
        <h1>Ściąga broni</h1>
        <div>{roster.name}</div>
      </header>
      <table className="grid tight">
        <thead>
          <tr>
            <th>Broń</th>
            <th>Zasięg</th>
            <th className="n">Trafienie</th>
            <th className="n">S</th>
            <th className="n">Dam</th>
            <th className="n">Zbroja</th>
            <th className="n">Ammo</th>
            <th>Cechy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.range}</td>
              <td className="n">{r.toHit}</td>
              <td className="n">{r.str}</td>
              <td className="n">{r.dam}</td>
              <td className="n">{r.save}</td>
              <td className="n">{r.ammo}</td>
              <td className="sp">{r.special || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
