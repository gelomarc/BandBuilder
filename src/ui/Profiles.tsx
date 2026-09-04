import type { Pack, Profile } from '../core/types'

/** Profiles of one type share a table, with the type's characteristics as columns. */
export function ProfileTables({
  pack,
  profileIds,
  ruleIds,
}: {
  pack: Pack
  profileIds: string[]
  ruleIds: string[]
}) {
  const profiles = profileIds.map((id) => pack.profiles[id]).filter(Boolean)
  const byType = new Map<string, Profile[]>()
  for (const p of profiles) {
    const list = byType.get(p.typeId) ?? []
    list.push(p)
    byType.set(p.typeId, list)
  }
  const rules = ruleIds.map((id) => pack.rules[id]).filter(Boolean)

  return (
    <>
      {[...byType.entries()].map(([typeId, list]) => {
        const type = pack.profileTypes[typeId]
        // Only show columns that at least one profile actually fills in.
        const columns = (type?.columns ?? Object.keys(list[0].chars)).filter((c) =>
          list.some((p) => (p.chars[c] ?? '').trim() !== ''),
        )
        return (
          <div className="scroll-x" key={typeId}>
            <table className="prof">
              <thead>
                <tr>
                  <th>{type?.name ?? 'Profil'}</th>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    {columns.map((c) => (
                      <td key={c}>{p.chars[c] || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
      {rules.length > 0 && (
        <p className="tiny muted" style={{ margin: '4px 0 0' }}>
          {rules.map((r) => (
            <span key={r.id} title={r.text}>
              <strong>{r.name}</strong>
              {r.text ? `: ${r.text}` : ''}
              <br />
            </span>
          ))}
        </p>
      )}
    </>
  )
}
