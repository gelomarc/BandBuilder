import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import packData from './data/swa.json'
import { computeCosts, validate } from './core/engine'
import { faction } from './core/pack'
import { applyAction, newRoster, type Action } from './core/roster'
import type { CategoryId, Pack, Roster } from './core/types'
import { desktop } from './desktop'
import {
  downloadJson,
  loadActiveId,
  loadRosters,
  parseRoster,
  saveActiveId,
  saveRosters,
  storageAvailable,
} from './store/persist'
import { AddFighterDialog } from './ui/AddFighterDialog'
import { BandPanel } from './ui/BandPanel'
import { FighterPanel } from './ui/FighterPanel'
import { PrintView } from './ui/PrintView'
import { StatusPanel } from './ui/StatusPanel'

const pack = packData as unknown as Pack
const HISTORY = 60

export function App() {
  const [rosters, setRosters] = useState<Roster[]>(() => loadRosters())
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId())
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [noStorage] = useState(() => !storageAvailable())
  const fileInput = useRef<HTMLInputElement>(null)

  // Undo/redo works on whole roster snapshots: the documents are small and this cannot desync.
  const past = useRef<Roster[]>([])
  const future = useRef<Roster[]>([])

  const roster = rosters.find((r) => r.id === activeId) ?? null

  useEffect(() => {
    saveRosters(rosters)
  }, [rosters])
  useEffect(() => {
    saveActiveId(activeId)
  }, [activeId])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const replace = useCallback((next: Roster) => {
    setRosters((list) => list.map((r) => (r.id === next.id ? next : r)))
  }, [])

  const dispatch = useCallback(
    (action: Action) => {
      if (!roster) return
      const next = applyAction(pack, roster, action)
      if (next === roster) return
      past.current = [...past.current.slice(-HISTORY), roster]
      future.current = []
      replace(next)
      if (action.t === 'fighter/remove') {
        const gone = roster.fighters.find((f) => f.uid === action.uid)
        const snapshot = roster
        setToast({ text: `Usunięto ${gone?.name ?? 'wojownika'}`, undo: () => replace(snapshot) })
        if (activeUid === action.uid) setActiveUid(null)
      }
      if (action.t === 'fighter/add' || action.t === 'fighter/duplicate') {
        const added = next.fighters.find((f) => !roster.fighters.some((o) => o.uid === f.uid))
        if (added) setActiveUid(added.uid)
      }
    },
    [roster, replace, activeUid],
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev || !roster) return
    future.current = [...future.current, roster]
    replace(prev)
  }, [roster, replace])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next || !roster) return
    past.current = [...past.current, roster]
    replace(next)
  }, [roster, replace])

  // File > Wydruk / PDF in the desktop menu opens the print view, where the options live.
  useEffect(() => desktop()?.onSavePdfRequested(() => setPrinting(true)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const costs = useMemo(() => (roster ? computeCosts(pack, roster) : null), [roster])
  const issues = useMemo(() => (roster && costs ? validate(pack, roster, costs) : []), [roster, costs])

  // The band panel and the add dialog both want "used / allowed" per category, which is exactly
  // the band rules evaluated without the message text.
  const limits = useMemo(() => {
    const out: Record<string, { limit: number; actual: number }> = {}
    if (!roster) return out
    const fac = faction(pack, roster.factionId)
    for (const rule of fac?.bandRules ?? []) {
      if (rule.type !== 'max' || rule.count !== 'fighters') continue
      let limit = rule.value
      if (rule.unit === 'percentOfCount') limit = Math.floor((rule.value / 100) * roster.fighters.length)
      for (const adj of rule.adjust ?? []) {
        const n = roster.fighters.filter(
          (f) => faction(pack, roster.factionId)?.fighters.find((t) => t.id === f.typeId)?.categoryId === adj.perFighterWhere.category,
        ).length
        limit += adj.delta * n
      }
      const actual = rule.where
        ? roster.fighters.filter(
            (f) => fac?.fighters.find((t) => t.id === f.typeId)?.categoryId === (rule.where!.category as CategoryId),
          ).length
        : roster.fighters.length
      out[rule.id] = { limit, actual }
    }
    return out
  }, [roster])

  const createRoster = (factionId: string) => {
    const r = newRoster(pack, factionId)
    setRosters((list) => [...list, r])
    setActiveId(r.id)
    setActiveUid(null)
    past.current = []
    future.current = []
  }

  const importFile = async (file: File) => {
    try {
      const r = parseRoster(await file.text())
      setRosters((list) => [...list.filter((x) => x.id !== r.id), r])
      setActiveId(r.id)
      setToast({ text: `Wczytano „${r.name}"` })
    } catch (err) {
      setToast({ text: `Nie udało się wczytać pliku: ${(err as Error).message}` })
    }
  }

  const fighter = roster?.fighters.find((f) => f.uid === activeUid) ?? null

  if (printing && roster && costs)
    return (
      <PrintView
        pack={pack}
        roster={roster}
        costs={costs}
        legal={issues.every((i) => i.severity !== 'error')}
        onClose={() => setPrinting(false)}
      />
    )

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">BandBuilder</span>
        <select
          value={activeId ?? ''}
          onChange={(e) => {
            setActiveId(e.target.value || null)
            setActiveUid(null)
            past.current = []
            future.current = []
          }}
          aria-label="Drużyna"
        >
          <option value="">— wybierz drużynę —</option>
          {rosters.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <NewRosterButton onCreate={createRoster} />
        <button onClick={() => fileInput.current?.click()}>Import</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.bbroster,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importFile(f)
            e.target.value = ''
          }}
        />
        {roster && (
          <>
            <button onClick={undo} title="Ctrl+Z">
              ↶
            </button>
            <button onClick={redo} title="Ctrl+Y">
              ↷
            </button>
            <button
              className="danger"
              onClick={() => {
                const snapshot = rosters
                setRosters((list) => list.filter((r) => r.id !== roster.id))
                setActiveId(null)
                setToast({ text: `Usunięto drużynę „${roster.name}"`, undo: () => setRosters(snapshot) })
              }}
            >
              Usuń drużynę
            </button>
          </>
        )}
        <span className="spacer" />
        {noStorage && <span className="tiny" style={{ color: 'var(--warn)' }}>Brak pamięci przeglądarki — eksportuj JSON</span>}
      </div>

      {!roster || !costs ? (
        <Welcome onCreate={createRoster} count={rosters.length} />
      ) : (
        <div className="columns">
          <BandPanel
            pack={pack}
            roster={roster}
            costs={costs}
            limits={limits}
            activeUid={activeUid}
            onSelect={setActiveUid}
            dispatch={dispatch}
            onAdd={() => setAdding(true)}
          />
          {fighter ? (
            <FighterPanel
              pack={pack}
              roster={roster}
              fighter={fighter}
              costs={costs}
              issues={issues}
              dispatch={dispatch}
            />
          ) : (
            <div className="col">
              <h1>{pack.vocabulary.fighter}</h1>
              <p className="muted">
                Wybierz {pack.vocabulary.fighterAcc} z listy po lewej albo dodaj nowego.
              </p>
              <button className="primary" onClick={() => setAdding(true)}>
                + Dodaj {pack.vocabulary.fighterAcc}
              </button>
            </div>
          )}
          <StatusPanel
            pack={pack}
            roster={roster}
            costs={costs}
            issues={issues}
            onGoto={setActiveUid}
            onPrint={() => setPrinting(true)}
            onExport={() => downloadJson(roster)}
            dispatch={dispatch}
          />
        </div>
      )}

      {adding && roster && costs && (
        <AddFighterDialog
          pack={pack}
          roster={roster}
          costs={costs}
          limits={limits}
          onAdd={(typeId) => dispatch({ t: 'fighter/add', typeId })}
          onClose={() => setAdding(false)}
        />
      )}

      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo!()
                setToast(null)
              }}
            >
              Cofnij
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function NewRosterButton({ onCreate }: { onCreate: (factionId: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}>
        Nowa drużyna
      </button>
      {open && (
        <div className="backdrop" onClick={() => setOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>Wybierz frakcję</strong>
            </header>
            <div className="body">
              {pack.factions.map((f) => (
                <button
                  key={f.id}
                  className="pick"
                  onClick={() => {
                    onCreate(f.id)
                    setOpen(false)
                  }}
                >
                  <span className="nm">{f.name}</span>
                  <span className="muted tiny">{f.fighters.length} typów</span>
                </button>
              ))}
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

function Welcome({ onCreate, count }: { onCreate: (factionId: string) => void; count: number }) {
  return (
    <div className="col" style={{ maxWidth: 620, margin: '0 auto' }}>
      <h1>{pack.name}</h1>
      <p className="muted">
        {count > 0
          ? 'Wybierz drużynę na górze albo zacznij nową.'
          : 'Zacznij od wyboru frakcji. Drużyny zapisują się w tej przeglądarce; plik JSON to kopia zapasowa.'}
      </p>
      <div className="stack" style={{ marginTop: 12 }}>
        {pack.factions.map((f) => (
          <button key={f.id} className="pick" onClick={() => onCreate(f.id)}>
            <span className="nm">{f.name}</span>
            <span className="muted tiny">
              {f.fighters.length} typów · {f.bandRules.find((r) => r.id === 'max-fighters')?.value ?? '?'} modeli maks.
            </span>
          </button>
        ))}
      </div>
      <p className="tiny faint" style={{ marginTop: 16 }}>
        Dane: {pack.source.note}
      </p>
    </div>
  )
}
