import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ctx, computeCosts, validate } from './core/engine'
import { applyAction, findUnit, newRoster, type Action } from './core/roster'
import type { Id, Pack, Roster } from './core/types'
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
import { loadPack, SYSTEMS } from './systems'
import { AddUnitDialog } from './ui/AddUnitDialog'
import { ForcePanel } from './ui/ForcePanel'
import { PrintView } from './ui/PrintView'
import { StatusPanel } from './ui/StatusPanel'
import { UnitPanel } from './ui/UnitPanel'

const HISTORY = 60

export function App() {
  const initial = useRef(loadRosters())
  const [rosters, setRosters] = useState<Roster[]>(initial.current.rosters)
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId())
  const [activeUid, setActiveUid] = useState<Id | null>(null)
  const [addingTo, setAddingTo] = useState<Id | null>(null)
  const [printing, setPrinting] = useState(false)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(
    initial.current.migrated
      ? { text: `Zaktualizowano ${initial.current.migrated} listę do nowego silnika — ekwipunek trzeba wybrać ponownie` }
      : null,
  )
  const [noStorage] = useState(() => !storageAvailable())
  const fileInput = useRef<HTMLInputElement>(null)

  // Undo/redo works on whole roster snapshots: the documents are small and this cannot desync.
  const past = useRef<Roster[]>([])
  const future = useRef<Roster[]>([])

  const roster = rosters.find((r) => r.id === activeId) ?? null
  const pack: Pack | null = useMemo(() => (roster ? loadPack(roster.pack.id) : null), [roster])

  useEffect(() => void saveRosters(rosters), [rosters])
  useEffect(() => saveActiveId(activeId), [activeId])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  const replace = useCallback((next: Roster) => {
    setRosters((list) => list.map((r) => (r.id === next.id ? next : r)))
  }, [])

  const dispatch = useCallback(
    (action: Action) => {
      if (!roster || !pack) return
      const next = applyAction(pack, roster, action)
      if (next === roster) return
      past.current = [...past.current.slice(-HISTORY), roster]
      future.current = []
      replace(next)

      if (action.t === 'unit/remove') {
        const gone = findUnit(roster, action.uid)
        const snapshot = roster
        setToast({ text: `Usunięto ${gone?.name ?? 'pozycję'}`, undo: () => replace(snapshot) })
        if (activeUid === action.uid) setActiveUid(null)
      }
      if (action.t === 'unit/add' || action.t === 'unit/duplicate') {
        const before = new Set(allUids(roster))
        const added = allUids(next).find((u) => !before.has(u))
        if (added) setActiveUid(added)
      }
    },
    [roster, pack, replace, activeUid],
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

  const ctx = useMemo(() => (roster && pack ? new Ctx(pack, roster) : null), [roster, pack])
  const costs = useMemo(() => (ctx ? computeCosts(ctx) : null), [ctx])
  const issues = useMemo(() => (ctx && costs ? validate(ctx, costs) : []), [ctx, costs])

  const createRoster = (systemId: string, factionId: Id) => {
    const r = newRoster(loadPack(systemId), factionId)
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

  const unit = roster && activeUid ? findUnit(roster, activeUid) : null

  if (printing && roster && ctx && costs)
    return (
      <PrintView
        ctx={ctx}
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
          aria-label="Lista"
        >
          <option value="">— wybierz listę —</option>
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
                setToast({ text: `Usunięto listę „${roster.name}"`, undo: () => setRosters(snapshot) })
              }}
            >
              Usuń listę
            </button>
          </>
        )}
        <span className="spacer" />
        {noStorage && <span className="tiny" style={{ color: 'var(--warn)' }}>Brak pamięci przeglądarki — eksportuj JSON</span>}
      </div>

      {!roster || !ctx || !costs ? (
        <Welcome onCreate={createRoster} count={rosters.length} />
      ) : (
        <div className="columns">
          <ForcePanel
            ctx={ctx}
            roster={roster}
            costs={costs}
            activeUid={activeUid}
            onSelect={setActiveUid}
            onAddUnit={setAddingTo}
            dispatch={dispatch}
          />
          {unit ? (
            <UnitPanel ctx={ctx} unit={unit} costs={costs} issues={issues} dispatch={dispatch} />
          ) : (
            <div className="col">
              <h1>{ctx.pack.vocabulary.fighter}</h1>
              <p className="muted">Wybierz pozycję z listy po lewej albo dodaj nową.</p>
            </div>
          )}
          <StatusPanel
            ctx={ctx}
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

      {addingTo && ctx && costs && roster && (
        <AddUnitDialog
          ctx={ctx}
          factionId={roster.factionId}
          costs={costs}
          onAdd={(factionId, rootId) => dispatch({ t: 'unit/add', forceUid: addingTo, factionId, rootId })}
          onClose={() => setAddingTo(null)}
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

function allUids(roster: Roster): Id[] {
  const out: Id[] = []
  const walk = (f: Roster['forces'][number]) => {
    for (const u of f.units) out.push(u.uid)
    f.forces.forEach(walk)
  }
  roster.forces.forEach(walk)
  return out
}

function FactionPicker({ systemId, onPick }: { systemId: string; onPick: (factionId: Id) => void }) {
  const pack = loadPack(systemId)
  const [q, setQ] = useState('')
  const factions = pack.factions.filter((f) => !f.library && f.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj frakcji…" style={{ flex: 1 }} autoFocus />
      </div>
      {factions.map((f) => (
        <button key={f.id} className="pick" onClick={() => onPick(f.id)}>
          <span className="nm">{f.name}</span>
          <span className="muted tiny">{f.roots.length} pozycji</span>
        </button>
      ))}
      {!factions.length && <p className="muted">Brak wyników.</p>}
    </>
  )
}

/**
 * Choosing a system parses its pack, which for Horus Heresy is ten megabytes and blocks for about
 * half a second. Yielding a frame first means the click is acknowledged instead of appearing stuck.
 */
function useSystemChoice() {
  const [system, setSystem] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const choose = (id: string | null) => {
    if (!id) {
      setSystem(null)
      return
    }
    setLoading(true)
    setTimeout(() => {
      loadPack(id)
      setSystem(id)
      setLoading(false)
    }, 16)
  }
  return { system, loading, choose }
}

function NewRosterButton({ onCreate }: { onCreate: (systemId: string, factionId: Id) => void }) {
  const { system, loading, choose } = useSystemChoice()
  const [open, setOpen] = useState(false)
  const close = () => {
    setOpen(false)
    choose(null)
  }
  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}>
        Nowa lista
      </button>
      {open && (
        <div className="backdrop" onClick={close}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>{system ? 'Wybierz frakcję' : 'Wybierz system'}</strong>
              {system && (
                <button className="ghost tiny" onClick={() => choose(null)}>
                  ← system
                </button>
              )}
            </header>
            <div className="body">
              {loading ? (
                <p className="muted">Wczytywanie danych…</p>
              ) : system ? (
                <FactionPicker systemId={system} onPick={(factionId) => {
                  onCreate(system, factionId)
                  close()
                }} />
              ) : (
                SYSTEMS.map((s) => (
                  <button key={s.id} className="pick" onClick={() => choose(s.id)}>
                    <span className="nm">
                      {s.name}
                      <br />
                      <span className="faint tiny">{s.hint}</span>
                    </span>
                    <span className="muted tiny">{s.short}</span>
                  </button>
                ))
              )}
            </div>
            <footer>
              <button onClick={close}>Anuluj</button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

function Welcome({ onCreate, count }: { onCreate: (systemId: string, factionId: Id) => void; count: number }) {
  const { system, loading, choose } = useSystemChoice()
  return (
    <div className="col" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1>BandBuilder</h1>
      <p className="muted">
        {count > 0
          ? 'Wybierz listę na górze albo zacznij nową.'
          : 'Zacznij od wyboru systemu. Listy zapisują się lokalnie; plik JSON to kopia zapasowa.'}
      </p>
      <div className="stack" style={{ marginTop: 12 }}>
        {loading ? (
          <p className="muted">Wczytywanie danych…</p>
        ) : system ? (
          <>
            <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => choose(null)}>
              ← inny system
            </button>
            <FactionPicker systemId={system} onPick={(factionId) => onCreate(system, factionId)} />
          </>
        ) : (
          SYSTEMS.map((s) => (
            <button key={s.id} className="pick" onClick={() => choose(s.id)}>
              <span className="nm">
                {s.name}
                <br />
                <span className="faint tiny">{s.hint}</span>
              </span>
              <span className="muted tiny">{s.short}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
