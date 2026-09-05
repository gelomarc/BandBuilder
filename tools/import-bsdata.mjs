// Converts one system's BattleScribe data into a BandBuilder data pack.
//
//   node tools/import-bsdata.mjs swa
//   node tools/import-bsdata.mjs hh3
//
// The BattleScribe model is a graph: selection entries and groups wired together by entry links,
// with limits as constraints and dynamic limits as modifiers driven by conditions and repeats.
// Shadow War is small enough that the graph could be flattened; Horus Heresy is not — 18 MB of
// source that shares aggressively would explode into hundreds of megabytes — so the pack keeps the
// links and the engine resolves them while walking. Everything that cannot be mapped is reported
// rather than dropped in silence.
import fs from 'node:fs'
import path from 'node:path'
import { loadDocuments } from './bs-normalize.mjs'
import { requireSystem, SYSTEMS } from './systems.mjs'

const report = { unmapped: new Map(), notes: [], warnings: new Map() }
const count = (map, msg) => map.set(msg, (map.get(msg) ?? 0) + 1)
const unmapped = (msg) => count(report.unmapped, msg)
const warn = (msg) => count(report.warnings, msg)

const list = (x) => (Array.isArray(x) ? x : [])
const clean = (obj) => {
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) delete obj[k]
  }
  return obj
}

// --- pieces of an entry ------------------------------------------------------------------------

const costsOf = (node) => {
  const out = {}
  for (const c of list(node.costs)) {
    const id = c.typeId ?? c.costTypeId
    if (!id) continue
    const value = Number(c.value)
    if (value) out[id] = value
  }
  return Object.keys(out).length ? out : undefined
}

const CONSTRAINT_TYPES = new Set(['min', 'max'])

function constraintsOf(node, where) {
  const out = []
  for (const c of list(node.constraints)) {
    if (!CONSTRAINT_TYPES.has(c.type)) {
      unmapped(`constraint type "${c.type}"`)
      continue
    }
    out.push(
      clean({
        id: c.id,
        type: c.type,
        field: c.field,
        scope: c.scope ?? 'parent',
        value: Number(c.value),
        pct: c.percentValue === true,
        ics: c.includeChildSelections === true,
        icf: c.includeChildForces === true,
      }),
    )
    if (c.field !== 'selections' && c.field !== 'forces' && !c.field?.includes('-') && !String(c.field).startsWith('limit::'))
      unmapped(`constraint field "${c.field}" (${where})`)
  }
  return out.length ? out : undefined
}

const CONDITION_TYPES = new Set([
  'instanceOf',
  'notInstanceOf',
  'atLeast',
  'atMost',
  'equalTo',
  'notEqualTo',
  'greaterThan',
  'lessThan',
])

function conditionOf(c) {
  if (!CONDITION_TYPES.has(c.type)) {
    unmapped(`condition type "${c.type}"`)
    return null
  }
  return clean({
    type: c.type,
    field: c.field,
    scope: c.scope ?? 'parent',
    childId: c.childId,
    value: Number(c.value),
    ics: c.includeChildSelections === true,
    icf: c.includeChildForces === true,
  })
}

function conditionGroupOf(g) {
  const conds = list(g.conditions).map(conditionOf).filter(Boolean)
  const groups = list(g.conditionGroups).map(conditionGroupOf).filter(Boolean)
  if (!conds.length && !groups.length) return null
  return clean({ type: g.type === 'or' ? 'or' : 'and', conds, groups })
}

const MODIFIER_TYPES = new Set([
  'set',
  'increment',
  'decrement',
  'ceil',
  'floor',
  'append',
  'prepend',
  'replace',
  'add',
  'remove',
  'set-primary',
  'unset-primary',
])

function modifiersOf(node, where) {
  const out = []
  const push = (m) => {
    if (!MODIFIER_TYPES.has(m.type)) {
      unmapped(`modifier type "${m.type}" (${where})`)
      return
    }
    const conds = list(m.conditions).map(conditionOf).filter(Boolean)
    const groups = list(m.conditionGroups).map(conditionGroupOf).filter(Boolean)
    const reps = list(m.repeats)
      .map((r) =>
        clean({
          field: r.field,
          scope: r.scope ?? 'parent',
          childId: r.childId,
          value: Number(r.value),
          repeats: Number(r.repeats ?? 1),
          roundUp: r.roundUp === true,
          ics: r.includeChildSelections === true,
          icf: r.includeChildForces === true,
        }),
      )
      .filter((r) => r.field)
    out.push(clean({ type: m.type, field: m.field, value: m.value, conds, groups, reps }))
  }
  for (const m of list(node.modifiers)) push(m)
  // Modifier groups are just a shared condition wrapper; flatten them onto their children.
  for (const g of list(node.modifierGroups)) {
    const shared = { conditions: list(g.conditions), conditionGroups: list(g.conditionGroups) }
    for (const m of list(g.modifiers))
      push({
        ...m,
        conditions: [...shared.conditions, ...list(m.conditions)],
        conditionGroups: [...shared.conditionGroups, ...list(m.conditionGroups)],
      })
    if (list(g.modifierGroups).length) unmapped('nested modifierGroup')
  }
  return out.length ? out : undefined
}

// --- profiles, rules, categories ---------------------------------------------------------------

function collectInfo(node, pack, idx) {
  const profs = []
  const rules = []

  const addProfile = (p) => {
    const chars = {}
    for (const c of list(p.characteristics)) {
      const value = String(c.value ?? '').trim()
      if (value) chars[c.name] = value
    }
    pack.profiles[p.id] = clean({ id: p.id, name: p.name, typeId: p.typeId ?? p.profileTypeId, chars })
    profs.push(p.id)
  }
  const addRule = (r) => {
    pack.rules[r.id] = clean({ id: r.id, name: r.name, text: String(r.description ?? '').trim() })
    rules.push(r.id)
  }

  for (const p of list(node.profiles)) addProfile(p)
  for (const r of list(node.rules)) addRule(r)
  for (const l of list(node.infoLinks)) {
    if (l.type === 'profile') {
      const p = idx.profiles.get(l.targetId)
      if (p) addProfile({ ...p, id: p.id })
      else unmapped('unresolved profile link')
    } else if (l.type === 'rule') {
      const r = idx.rules.get(l.targetId)
      if (r) addRule(r)
      else unmapped('unresolved rule link')
    } else if (l.type === 'infoGroup') {
      const g = idx.infoGroups.get(l.targetId)
      if (g) {
        const inner = collectInfo(g, pack, idx)
        profs.push(...inner.profs)
        rules.push(...inner.rules)
      } else unmapped('unresolved infoGroup link')
    } else {
      unmapped(`infoLink type "${l.type}"`)
    }
  }
  return { profs, rules }
}

function categoriesOf(node) {
  const cats = []
  let primary
  for (const c of list(node.categoryLinks)) {
    cats.push(c.targetId)
    if (c.primary === true) primary = c.targetId
  }
  return { cats: cats.length ? cats : undefined, primary }
}

// --- nodes -------------------------------------------------------------------------------------

/**
 * Convert one selection entry or group. Children stay as links wherever the source used a link, so
 * the pack keeps the source's sharing instead of inlining a copy per use site.
 */
function nodeOf(src, isGroup, pack, idx) {
  const { profs, rules } = collectInfo(src, pack, idx)
  const { cats, primary } = categoriesOf(src)
  return clean({
    id: src.id,
    name: String(src.name ?? '').trim(),
    k: isGroup ? 'g' : 'e',
    t: isGroup ? undefined : (src.type ?? 'upgrade'),
    cost: costsOf(src),
    cats,
    primary,
    cons: constraintsOf(src, src.name),
    mods: modifiersOf(src, src.name),
    prof: profs.length ? profs : undefined,
    rules: rules.length ? rules : undefined,
    kids: childrenOf(src, pack, idx),
    hidden: src.hidden === true,
    def: src.defaultSelectionEntryId,
    coll: src.collective === true,
  })
}

/** A link to a shared node, carrying whatever the link overrides. */
function linkOf(l, pack, idx) {
  const { profs, rules } = collectInfo(l, pack, idx)
  const { cats, primary } = categoriesOf(l)
  return clean({
    link: l.targetId,
    id: l.id,
    name: l.name && !/^New (Entry|Info)Link$/.test(l.name) ? String(l.name).trim() : undefined,
    cost: costsOf(l),
    cats,
    primary,
    cons: constraintsOf(l, l.name),
    mods: modifiersOf(l, l.name),
    prof: profs.length ? profs : undefined,
    rules: rules.length ? rules : undefined,
    kids: childrenOf(l, pack, idx),
    hidden: l.hidden === true,
  })
}

function childrenOf(src, pack, idx) {
  const kids = []
  for (const e of list(src.selectionEntries)) kids.push(nodeOf(e, false, pack, idx))
  for (const g of list(src.selectionEntryGroups)) kids.push(nodeOf(g, true, pack, idx))
  for (const l of list(src.entryLinks)) kids.push(linkOf(l, pack, idx))
  return kids.length ? kids : undefined
}

// --- force templates ---------------------------------------------------------------------------

function forceTemplateOf(f) {
  return clean({
    id: f.id,
    name: String(f.name ?? '').trim(),
    cons: constraintsOf(f, f.name),
    mods: modifiersOf(f, f.name),
    slots: list(f.categoryLinks).map((c) =>
      clean({
        id: c.id,
        category: c.targetId,
        name: c.name,
        cons: constraintsOf(c, `${f.name}/${c.name}`),
        mods: modifiersOf(c, `${f.name}/${c.name}`),
      }),
    ),
    children: list(f.forceEntries).map(forceTemplateOf),
  })
}

// --- main --------------------------------------------------------------------------------------

function importSystem(systemId) {
  const system = requireSystem(systemId)
  const dir = path.join('data/bsdata', system.id)
  if (!fs.existsSync(dir)) {
    console.error(`${system.id}: brak ${dir}. Uruchom: npm run fetch-data ${system.id}`)
    process.exitCode = 1
    return null
  }

  report.unmapped.clear()
  report.warnings.clear()
  report.notes.length = 0

  const docs = loadDocuments(dir, system.format)
  const gameSystem = docs.find((d) => d.isGameSystem)
  if (!gameSystem) throw new Error(`${system.id}: brak pliku systemu gry`)

  // Index every addressable definition across all documents. Ids are globally unique in
  // BattleScribe, so catalogueLinks (one catalogue importing another) need no special handling:
  // one shared pool covers them.
  const idx = { entries: new Map(), groups: new Map(), profiles: new Map(), rules: new Map(), infoGroups: new Map() }
  const walkDefinitions = (node) => {
    for (const e of list(node.selectionEntries)) {
      idx.entries.set(e.id, e)
      walkDefinitions(e)
    }
    for (const g of list(node.selectionEntryGroups)) {
      idx.groups.set(g.id, g)
      walkDefinitions(g)
    }
    for (const p of list(node.profiles)) idx.profiles.set(p.id, p)
    for (const r of list(node.rules)) idx.rules.set(r.id, r)
    for (const l of list(node.entryLinks)) walkDefinitions(l)
  }
  for (const { doc } of docs) {
    for (const e of list(doc.sharedSelectionEntries)) {
      idx.entries.set(e.id, e)
      walkDefinitions(e)
    }
    for (const g of list(doc.sharedSelectionEntryGroups)) {
      idx.groups.set(g.id, g)
      walkDefinitions(g)
    }
    for (const p of [...list(doc.sharedProfiles), ...list(doc.profiles)]) idx.profiles.set(p.id, p)
    for (const r of [...list(doc.sharedRules), ...list(doc.rules)]) idx.rules.set(r.id, r)
    for (const g of list(doc.sharedInfoGroups)) idx.infoGroups.set(g.id, g)
    walkDefinitions(doc)
  }

  const pack = {
    schema: 'bandbuilder/datapack@2',
    id: system.id,
    name: gameSystem.doc.name,
    version: `bsdata-r${gameSystem.doc.revision ?? 0}`,
    source: {
      repo: `https://github.com/${system.repo}`,
      note: 'Dane społecznościowe BattleScribe, bez autoryzacji Games Workshop. Import: tools/import-bsdata.mjs.',
    },
    vocabulary: system.vocabulary,
    campaign: system.campaign,
    budget: { default: system.budget },
    costTypes: [],
    primaryCost: null,
    categories: [],
    profileTypes: {},
    profiles: {},
    rules: {},
    forceTemplates: [],
    nodes: {},
    factions: [],
  }

  for (const c of list(gameSystem.doc.costTypes))
    pack.costTypes.push(clean({ id: c.id, name: c.name, hidden: c.hidden === true }))
  pack.primaryCost = (pack.costTypes.find((c) => !c.hidden) ?? pack.costTypes[0])?.id ?? null

  for (const { doc } of docs)
    for (const pt of list(doc.profileTypes))
      if (!pack.profileTypes[pt.id])
        pack.profileTypes[pt.id] = { id: pt.id, name: pt.name, columns: list(pt.characteristicTypes).map((c) => c.name) }
  // Only a system with one universal model line gets a compact statline row; Horus Heresy has a
  // dozen (Profile, Vehicle, Knight, Titan parts...), so there it stays a table like any other.
  pack.statlineType = Object.values(pack.profileTypes).find((t) => t.name === 'Model')?.id

  const seenCategory = new Set()
  for (const { doc } of docs)
    for (const c of list(doc.categoryEntries))
      if (!seenCategory.has(c.id)) {
        seenCategory.add(c.id)
        pack.categories.push(clean({ id: c.id, name: String(c.name ?? '').trim(), hidden: c.hidden === true }))
      }

  pack.forceTemplates = list(gameSystem.doc.forceEntries).map(forceTemplateOf)

  // Shared definitions become the addressable node pool.
  for (const [id, src] of idx.entries) pack.nodes[id] = nodeOf(src, false, pack, idx)
  for (const [id, src] of idx.groups) pack.nodes[id] = nodeOf(src, true, pack, idx)

  // Each catalogue contributes the roots a player can actually pick.
  for (const { doc, isGameSystem } of docs) {
    const roots = [
      ...list(doc.entryLinks).map((l) => linkOf(l, pack, idx)),
      ...list(doc.selectionEntries).map((e) => nodeOf(e, false, pack, idx)),
    ].filter((r) => !r.hidden)
    if (!roots.length) continue
    if (isGameSystem && roots.length < 3) {
      report.notes.push(`${doc.name}: ${roots.length} korzeni w pliku systemu, pominięte jako frakcja`)
      continue
    }
    pack.factions.push({
      id: String(doc.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      name: String(doc.name).replace(/^[IVXLC]+\s*-\s*/, '').trim(),
      library: doc.library === true,
      roots,
    })
  }

  return { system, pack }
}

// --- output ------------------------------------------------------------------------------------

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SYSTEMS)
const summaries = []

for (const id of ids) {
  const result = importSystem(id)
  if (!result) continue
  const { system, pack } = result

  const out = path.join('src/data', `${system.id}.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(pack))
  const kb = fs.statSync(out).size / 1024

  const countKids = (kids) => list(kids).reduce((n, k) => n + 1 + countKids(k.kids), 0)
  const stats = {
    factions: pack.factions.filter((f) => !f.library).length,
    libraries: pack.factions.filter((f) => f.library).length,
    roots: pack.factions.reduce((n, f) => n + f.roots.length, 0),
    nodes: Object.keys(pack.nodes).length,
    inline: Object.values(pack.nodes).reduce((n, x) => n + countKids(x.kids), 0),
    profiles: Object.keys(pack.profiles).length,
    rules: Object.keys(pack.rules).length,
    categories: pack.categories.length,
    forces: pack.forceTemplates.length,
    costTypes: pack.costTypes.length,
  }
  summaries.push({ system, pack, stats, kb, out })

  const lines = [
    `# Raport importu — ${pack.name}`,
    '',
    `\`npm run import-data ${system.id}\` · źródło: [${system.repo}](${pack.source.repo}) · ${pack.version}`,
    '',
    '## Wynik',
    '',
    `| | |`,
    `|---|---|`,
    `| Frakcje | **${stats.factions}**${stats.libraries ? ` (+${stats.libraries} bibliotek współdzielonych)` : ''} |`,
    `| Pozycje wybieralne | **${stats.roots}** |`,
    `| Węzły współdzielone | **${stats.nodes}** |`,
    `| Węzły inline | **${stats.inline}** |`,
    `| Profile | **${stats.profiles}** |`,
    `| Zasady | **${stats.rules}** |`,
    `| Kategorie | **${stats.categories}** |`,
    `| Szablony sił | **${stats.forces}** |`,
    `| Typy kosztów | **${stats.costTypes}** |`,
    `| Rozmiar packa | **${kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`}** |`,
    '',
    '## DO UZUPEŁNIENIA',
    '',
    report.unmapped.size
      ? [...report.unmapped.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `- ${m} — ${n}×`).join('\n')
      : '_Nic — wszystkie napotkane konstrukcje zostały zmapowane._',
    '',
    '## Ostrzeżenia',
    '',
    report.warnings.size
      ? [...report.warnings.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `- ${m} — ${n}×`).join('\n')
      : '_Brak._',
    '',
    '## Uwagi',
    '',
    report.notes.length ? report.notes.map((n) => `- ${n}`).join('\n') : '_Brak._',
    '',
  ]
  fs.writeFileSync(path.join('data', `IMPORT-REPORT-${system.id}.md`), lines.join('\n'))

  console.log(
    `${system.id.padEnd(4)} ${String(pack.name).padEnd(28)} frakcje=${String(stats.factions).padStart(2)} ` +
      `korzenie=${String(stats.roots).padStart(4)} węzły=${String(stats.nodes).padStart(5)} ` +
      `profile=${String(stats.profiles).padStart(5)} ${(kb / 1024).toFixed(1)} MB`,
  )
  console.log(
    `     niezmapowane=${report.unmapped.size} ostrzeżenia=${report.warnings.size} -> ${out}, data/IMPORT-REPORT-${system.id}.md`,
  )
}
