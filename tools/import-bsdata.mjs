// Converts BattleScribe .gst/.cat files into one BandBuilder data pack (src/data/swa.json).
//
// The BattleScribe model is a generic tree of selectionEntry / selectionEntryGroup nodes wired
// together by entryLink references, with limits expressed as constraints and dynamic limits as
// modifiers driven by repeats. This importer resolves all links into a plain nested tree, keeps
// only the constraint shapes the game actually uses, and reports everything it could not map.
import { XMLParser } from 'fast-xml-parser'
import fs from 'node:fs'
import path from 'node:path'

const SRC = 'data/bsdata'
const OUT = 'src/data/swa.json'
const REPORT = 'data/IMPORT-REPORT.md'
const MAX_DEPTH = 8

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' })
const arr = (x) => (x === undefined || x === null || x === '' ? [] : Array.isArray(x) ? x : [x])
const num = (v) => (v === undefined || v === null ? null : Number(v))
const report = { unmapped: [], notes: [], warnings: [] }
const warn = (msg) => {
  if (!report.warnings.includes(msg)) report.warnings.push(msg)
}
const unmapped = (msg) => {
  if (!report.unmapped.includes(msg)) report.unmapped.push(msg)
}

// ---------------------------------------------------------------------------------------------
// parsing / indexing
// ---------------------------------------------------------------------------------------------

function load(file) {
  const doc = parser.parse(fs.readFileSync(path.join(SRC, file), 'utf8'))
  return doc.gameSystem || doc.catalogue
}

/** Index every addressable node of a document by its id, so entryLinks can be resolved. */
function index(doc, into = { entries: {}, groups: {}, profiles: {}, rules: {}, categories: {} }) {
  const walkEntry = (e) => {
    into.entries[e['@id']] = e
    arr(e.selectionEntries?.selectionEntry).forEach(walkEntry)
    arr(e.selectionEntryGroups?.selectionEntryGroup).forEach(walkGroup)
    arr(e.profiles?.profile).forEach((p) => (into.profiles[p['@id']] = p))
    arr(e.rules?.rule).forEach((r) => (into.rules[r['@id']] = r))
  }
  const walkGroup = (g) => {
    into.groups[g['@id']] = g
    arr(g.selectionEntries?.selectionEntry).forEach(walkEntry)
    arr(g.selectionEntryGroups?.selectionEntryGroup).forEach(walkGroup)
  }
  arr(doc.sharedSelectionEntries?.selectionEntry).forEach(walkEntry)
  arr(doc.selectionEntries?.selectionEntry).forEach(walkEntry)
  arr(doc.sharedSelectionEntryGroups?.selectionEntryGroup).forEach(walkGroup)
  arr(doc.sharedProfiles?.profile).forEach((p) => (into.profiles[p['@id']] = p))
  arr(doc.profiles?.profile).forEach((p) => (into.profiles[p['@id']] = p))
  arr(doc.sharedRules?.rule).forEach((r) => (into.rules[r['@id']] = r))
  arr(doc.rules?.rule).forEach((r) => (into.rules[r['@id']] = r))
  arr(doc.categoryEntries?.categoryEntry).forEach((c) => (into.categories[c['@id']] = c['@name']))
  return into
}

// ---------------------------------------------------------------------------------------------
// costs, constraints, profiles, rules
// ---------------------------------------------------------------------------------------------

const costOf = (node) => {
  const c = arr(node?.costs?.cost).find((x) => x['@name'] === 'pts' || x['@costTypeId'] === 'Points')
  return c ? Number(c['@value']) : null
}

/**
 * Pull the two constraint shapes the game uses out of a node: a min and a max on the number of
 * selections, counted against the immediate parent. Anything else is reported, not silently lost.
 */
function limits(nodes, where) {
  let min = null
  let max = null
  for (const node of nodes) {
    for (const c of arr(node?.constraints?.constraint)) {
      const field = c['@field']
      const type = c['@type']
      const value = Number(c['@value'])
      if (field === 'selections' && (type === 'min' || type === 'max')) {
        if (type === 'min') min = min === null ? value : Math.max(min, value)
        else max = max === null ? value : Math.min(max, value)
      } else {
        unmapped(`constraint ${type}/${field} @${c['@scope']} = ${c['@value']} (${where})`)
      }
    }
  }
  return { min, max }
}

const STAT_IDS = ['M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'Ld']

function readProfile(p) {
  const chars = {}
  for (const c of arr(p.characteristics?.characteristic)) chars[c['@name']] = String(c['@value'] ?? '')
  return { id: p['@id'], name: p['@name'], typeId: p['@profileTypeId'], typeName: p['@profileTypeName'], chars }
}

const isStatProfile = (p) => STAT_IDS.every((s) => p.chars[s] !== undefined)

/** Campaign progression subtrees, kept out of the gear tree. */
const isAdvancement = (n) => n.k === 'g' && /^(skills|advance attributes)$/i.test(n.name)

// ---------------------------------------------------------------------------------------------
// tree resolution
// ---------------------------------------------------------------------------------------------

/**
 * Resolve the children of a BattleScribe container into BandBuilder nodes.
 * Node ids are made unique per position (link id when present) so a roster can address the
 * same shared weapon appearing in two different slots.
 */
function resolveChildren(container, ctx, depth, seen) {
  if (depth > MAX_DEPTH) {
    warn(`tree deeper than ${MAX_DEPTH} levels, truncated`)
    return []
  }
  const out = []
  for (const e of arr(container.selectionEntries?.selectionEntry)) {
    const n = itemNode(e, null, ctx, depth, seen)
    if (n) out.push(n)
  }
  for (const g of arr(container.selectionEntryGroups?.selectionEntryGroup)) {
    const n = groupNode(g, null, ctx, depth, seen)
    if (n) out.push(n)
  }
  for (const l of arr(container.entryLinks?.entryLink)) {
    const id = l['@targetId']
    if (l['@type'] === 'selectionEntryGroup') {
      const t = ctx.idx.groups[id]
      if (!t) {
        unmapped(`unresolved group link ${id} in ${ctx.faction}`)
        continue
      }
      const n = groupNode(t, l, ctx, depth, seen)
      if (n) out.push(n)
    } else {
      const t = ctx.idx.entries[id]
      if (!t) {
        unmapped(`unresolved entry link ${id} in ${ctx.faction}`)
        continue
      }
      const n = itemNode(t, l, ctx, depth, seen)
      if (n) out.push(n)
    }
  }
  return out
}

function collectInfo(node, ctx) {
  const profileIds = []
  const ruleIds = []
  for (const p of arr(node.profiles?.profile)) {
    const prof = readProfile(p)
    ctx.pack.profiles[prof.id] = prof
    profileIds.push(prof.id)
  }
  for (const r of arr(node.rules?.rule)) {
    ctx.pack.rules[r['@id']] = { id: r['@id'], name: r['@name'], text: String(r.description ?? '') }
    ruleIds.push(r['@id'])
  }
  for (const l of arr(node.infoLinks?.infoLink)) {
    const id = l['@targetId']
    if (l['@type'] === 'profile') {
      const p = ctx.idx.profiles[id]
      if (!p) {
        unmapped(`unresolved profile link ${id} in ${ctx.faction}`)
        continue
      }
      const prof = readProfile(p)
      ctx.pack.profiles[prof.id] = prof
      profileIds.push(prof.id)
    } else if (l['@type'] === 'rule') {
      const r = ctx.idx.rules[id]
      if (!r) {
        unmapped(`unresolved rule link ${id} in ${ctx.faction}`)
        continue
      }
      ctx.pack.rules[id] = { id, name: r['@name'], text: String(r.description ?? '') }
      ruleIds.push(id)
    } else {
      unmapped(`infoLink type ${l['@type']}`)
    }
  }
  return { profileIds, ruleIds }
}

function itemNode(entry, link, ctx, depth, seen) {
  if (entry['@hidden'] === 'true' || link?.['@hidden'] === 'true') return null
  const key = entry['@id']
  if (seen.has(key)) {
    warn(`cycle broken at entry ${entry['@name']} (${key})`)
    return null
  }
  const nextSeen = new Set(seen).add(key)
  const { min, max } = limits([link, entry], `item ${entry['@name']}`)
  const { profileIds, ruleIds } = collectInfo(entry, ctx)
  const children = [
    ...resolveChildren(entry, ctx, depth + 1, nextSeen),
    ...(link ? resolveChildren(link, ctx, depth + 1, nextSeen) : []),
  ]
  const node = {
    k: 'i',
    id: link?.['@id'] || entry['@id'],
    ref: entry['@id'],
    name: entry['@name'],
    cost: costOf(link) ?? costOf(entry) ?? 0,
    min,
    max,
    profiles: profileIds,
    rules: ruleIds,
    children,
  }
  const stat = statAdvance(entry['@name'])
  if (stat) node.effect = stat
  return node
}

/** The campaign advancement entries are plain text ("+1 Ballistic Skill"); read them as deltas. */
const ADVANCE_STATS = {
  move: 'M',
  'weapon skill': 'WS',
  'ballistic skill': 'BS',
  strength: 'S',
  toughness: 'T',
  wound: 'W',
  wounds: 'W',
  initiative: 'I',
  attack: 'A',
  attacks: 'A',
  leadership: 'Ld',
}
function statAdvance(name) {
  const m = /^([+-])(\d+)\s+(.+)$/.exec(String(name || '').trim())
  if (!m) return null
  const stat = ADVANCE_STATS[m[3].toLowerCase()]
  if (!stat) return null
  return { stat, delta: (m[1] === '-' ? -1 : 1) * Number(m[2]) }
}

function groupNode(group, link, ctx, depth, seen) {
  if (group['@hidden'] === 'true' || link?.['@hidden'] === 'true') return null
  const key = group['@id']
  if (seen.has(key)) {
    warn(`cycle broken at group ${group['@name']} (${key})`)
    return null
  }
  const nextSeen = new Set(seen).add(key)
  const { min, max } = limits([link, group], `group ${group['@name']}`)
  const children = resolveChildren(group, ctx, depth + 1, nextSeen)
  if (!children.length) return null
  return {
    k: 'g',
    id: link?.['@id'] || group['@id'],
    name: group['@name'],
    min,
    max,
    children,
  }
}

// ---------------------------------------------------------------------------------------------
// band rules from a forceEntry
// ---------------------------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'leader', name: 'Leader' },
  { id: 'specialist', name: 'Specialists' },
  { id: 'trooper', name: 'Troopers' },
  { id: 'recruit', name: 'New Recruits' },
  { id: 'operative', name: 'Special Operatives' },
]

/**
 * Category names differ per catalogue ("Leader" / "Kill Team Leader", "Trooper" / "Troopers" /
 * "Tooper", Tau "Drone"), so match on shape rather than on an exact string. Order matters:
 * "Special Operative" must be tested before "Specialist".
 */
function canonCategory(name) {
  const n = String(name || '').toLowerCase()
  if (/leader/.test(n)) return 'leader'
  if (/special\s*operative/.test(n) || /drone/.test(n)) return 'operative'
  if (/specialist/.test(n)) return 'specialist'
  if (/recruit/.test(n)) return 'recruit'
  if (/t[o]+per/.test(n) || /trooper/.test(n) || /ganger/.test(n)) return 'trooper'
  return null
}

/**
 * Turn a forceEntry into declarative band rules. The two dynamic limits in this game (each
 * Special Operative raises the min and max fighter count by one) are expressed in BattleScribe
 * as modifiers whose repeat counts selections of a category; that becomes an `adjust` entry.
 */
function bandRules(force, categories, label = '') {
  const rules = []
  const byConstraintId = {}

  // A few catalogues carry two max constraints on the model count, one of which duplicates the
  // minimum (Ork Boyz declares max 20 and max 3 next to min 3). A max that is not above the
  // minimum cannot be the intended limit, so drop it and say so in the report.
  const raw = arr(force.constraints?.constraint).filter((c) => {
    if (c['@field'] === 'selections') return true
    unmapped(`force constraint field ${c['@field']}`)
    return false
  })
  const maxes = raw.filter((c) => c['@type'] === 'max')
  const keptMax = maxes.length ? maxes.reduce((a, b) => (Number(a['@value']) >= Number(b['@value']) ? a : b)) : null
  if (maxes.length > 1)
    warn(
      `${label}: ${maxes.length} max constraints on model count (${maxes
        .map((c) => c['@value'])
        .join(', ')}), kept ${keptMax['@value']}`,
    )
  for (const c of raw) {
    if (c['@type'] === 'max' && c !== keptMax) continue
    const rule = {
      id: c['@type'] === 'min' ? 'min-fighters' : 'max-fighters',
      type: c['@type'],
      count: 'fighters',
      value: Number(c['@value']),
      adjust: [],
    }
    byConstraintId[c['@id']] = rule
    rules.push(rule)
  }

  for (const m of arr(force.modifiers?.modifier)) {
    const target = byConstraintId[m['@field']]
    const rep = arr(m.repeats?.repeat)[0]
    if (!target || !rep || m['@type'] !== 'increment') {
      unmapped(`force modifier ${m['@type']} on ${m['@field']}`)
      continue
    }
    const cat = canonCategory(categories[rep['@childId']])
    if (!cat) {
      unmapped(`force modifier repeats over unknown category ${rep['@childId']}`)
      continue
    }
    target.adjust.push({ perFighterWhere: { category: cat }, delta: Number(m['@value']) })
  }

  for (const cl of arr(force.categoryLinks?.categoryLink)) {
    const cat = canonCategory(categories[cl['@targetId']])
    if (!cat) continue
    for (const c of arr(cl.constraints?.constraint)) {
      const percent = c['@percentValue'] === 'true'
      if (c['@field'] === 'selections') {
        // A percentage on a selection count means "at most half the models", not "at most 50".
        rules.push({
          id: `${c['@type']}-${cat}`,
          type: c['@type'],
          count: 'fighters',
          where: { category: cat },
          value: Number(c['@value']),
          unit: percent ? 'percentOfCount' : 'absolute',
          adjust: [],
        })
      } else if (String(c['@field']).startsWith('limit::') || percent) {
        rules.push({
          id: `${c['@type']}-cost-${cat}`,
          type: c['@type'],
          count: 'cost',
          where: { category: cat },
          value: Number(c['@value']),
          unit: percent ? 'percentOfBudget' : 'absolute',
          adjust: [],
        })
      } else {
        unmapped(`category constraint ${c['@type']}/${c['@field']} on ${cat}`)
      }
    }
  }
  return rules
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

const files = fs.readdirSync(SRC)
const gstFile = files.find((f) => f.endsWith('.gst'))
if (!gstFile) throw new Error(`no .gst in ${SRC}`)
const gst = load(gstFile)
const gstIdx = index(gst)

const pack = {
  schema: 'bandbuilder/datapack@1',
  id: 'swa',
  name: gst['@name'],
  version: `bsdata-r${gst['@revision']}`,
  source: {
    repo: 'https://github.com/BSData/wh40k-shadow-war-armageddon',
    note: 'Community BattleScribe data, not endorsed by Games Workshop. Imported by tools/import-bsdata.mjs.',
  },
  vocabulary: { band: 'Kill Team', fighter: 'Fighter', currency: 'pts', campaignCurrency: 'Promethium Cache' },
  budget: { default: 1000 },
  statline: STAT_IDS,
  categories: CATEGORIES,
  profileTypes: {},
  profiles: {},
  rules: {},
  factions: [],
}

for (const pt of arr(gst.profileTypes?.profileType)) {
  pack.profileTypes[pt['@id']] = {
    id: pt['@id'],
    name: pt['@name'],
    columns: arr(pt.characteristicTypes?.characteristicType).map((c) => c['@name']),
  }
}

for (const file of files.filter((f) => f.endsWith('.cat')).sort()) {
  const cat = load(file)
  const idx = index(cat, index(gst)) // catalogue definitions win over game system ones
  for (const pt of arr(cat.profileTypes?.profileType)) {
    if (!pack.profileTypes[pt['@id']])
      pack.profileTypes[pt['@id']] = {
        id: pt['@id'],
        name: pt['@name'],
        columns: arr(pt.characteristicTypes?.characteristicType).map((c) => c['@name']),
      }
  }

  const faction = {
    id: cat['@name'].toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: cat['@name'],
    book: cat['@book'] || 'Shadow War: Armageddon',
    bandRules: [],
    bandOptions: [],
    fighters: [],
  }
  const ctx = { idx, pack, faction: faction.name }

  // Some catalogues carry a complete forceEntry, others leave parts of it empty and rely on the
  // game system's. Merge by rule id with the catalogue winning, so faction deviations (Orks 3-20
  // models, Guard 3 specialists) survive without losing the shared baseline.
  const merged = new Map()
  for (const r of bandRules(arr(gst.forceEntries?.forceEntry)[0], index(gst).categories, 'game system')) merged.set(r.id, r)
  const catForce = arr(cat.forceEntries?.forceEntry)[0]
  if (catForce) for (const r of bandRules(catForce, idx.categories, faction.name)) merged.set(r.id, r)
  faction.bandRules = [...merged.values()]

  // Fighter types are the catalogue's selectable roots: root entryLinks plus root entries.
  const roots = [
    ...arr(cat.entryLinks?.entryLink).map((l) => ({
      link: l,
      target: l['@type'] === 'selectionEntryGroup' ? null : idx.entries[l['@targetId']],
    })),
    ...arr(cat.selectionEntries?.selectionEntry).map((e) => ({ link: null, target: e })),
  ]

  for (const { link, target } of roots) {
    if (!target) {
      unmapped(`root link of type selectionEntryGroup skipped in ${faction.name}`)
      continue
    }
    if (target['@hidden'] === 'true') continue

    const catLinks = arr(link?.categoryLinks?.categoryLink).concat(arr(target.categoryLinks?.categoryLink))
    const primary = catLinks.find((c) => c['@primary'] === 'true') || catLinks[0]
    let categoryId = primary ? canonCategory(idx.categories[primary['@targetId']]) : null

    const node = itemNode(target, link, ctx, 0, new Set())
    if (!node) continue

    const statProfile = node.profiles.map((id) => pack.profiles[id]).find(isStatProfile)

    if (!categoryId) {
      // An uncategorised root is either a model the catalogue forgot to tag (it has a statline,
      // and in this game an untagged model is always a Special Operative) or a band-wide choice
      // such as Chapter / Regiment / Clan, which belongs to the band, not to a fighter.
      if (target['@type'] === 'model' && statProfile) {
        categoryId = 'operative'
        report.notes.push(`${faction.name}: "${node.name}" untagged, treated as Special Operative`)
      } else {
        faction.bandOptions.push({ ...node, k: 'g', children: node.children })
        report.notes.push(`${faction.name}: "${node.name}" treated as a band-wide option`)
        continue
      }
    }

    const statline = {}
    if (statProfile) for (const s of STAT_IDS) statline[s] = statProfile.chars[s]
    else warn(`${faction.name}: "${target['@name']}" has no statline profile`)

    faction.fighters.push({
      id: `${faction.id}--${node.ref}`,
      name: node.name,
      categoryId,
      cost: node.cost,
      max: node.max,
      statline,
      profiles: node.profiles.filter((id) => pack.profiles[id] !== statProfile),
      rules: node.rules,
      // Skill trees and attribute advances are campaign progression, not list building, so keep
      // them apart from the gear tree; the app shows them on the fighter's campaign tab.
      tree: node.children.filter((n) => !isAdvancement(n)),
      advances: node.children.filter(isAdvancement),
    })
  }

  faction.fighters.sort((a, b) => {
    const order = ['leader', 'specialist', 'trooper', 'recruit', 'operative']
    const d = order.indexOf(a.categoryId) - order.indexOf(b.categoryId)
    return d !== 0 ? d : b.cost - a.cost
  })
  pack.factions.push(faction)
  console.log(
    `${faction.name.padEnd(26)} fighters=${String(faction.fighters.length).padStart(2)}  rules=${faction.bandRules.length}`,
  )
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(pack))
const kb = (fs.statSync(OUT).size / 1024).toFixed(0)

const countNodes = (nodes) => nodes.reduce((n, x) => n + 1 + countNodes(x.children || []), 0)
const stats = {
  factions: pack.factions.length,
  fighters: pack.factions.reduce((n, f) => n + f.fighters.length, 0),
  nodes: pack.factions.reduce((n, f) => n + f.fighters.reduce((m, x) => m + countNodes(x.tree), 0), 0),
  profiles: Object.keys(pack.profiles).length,
  rules: Object.keys(pack.rules).length,
}

const lines = [
  '# Raport importu danych BSData',
  '',
  `Wygenerowany przez \`npm run import-data\`. Źródło: [BSData/wh40k-shadow-war-armageddon](${pack.source.repo}), revision ${pack.version}.`,
  '',
  '## Wynik',
  '',
  `- Frakcje: **${stats.factions}**`,
  `- Typy wojowników: **${stats.fighters}**`,
  `- Węzły drzewa ekwipunku: **${stats.nodes}**`,
  `- Profile: **${stats.profiles}**`,
  `- Zasady: **${stats.rules}**`,
  `- Rozmiar data packa: **${kb} KB**`,
  '',
  '## DO UZUPEŁNIENIA',
  '',
  report.unmapped.length
    ? report.unmapped.map((u) => `- ${u}`).join('\n')
    : '_Nic — wszystkie napotkane konstrukcje zostały zmapowane._',
  '',
  '## Ostrzeżenia',
  '',
  report.warnings.length ? report.warnings.map((u) => `- ${u}`).join('\n') : '_Brak._',
  '',
  '## Pominięte korzenie bez kategorii',
  '',
  report.notes.length ? report.notes.map((u) => `- ${u}`).join('\n') : '_Brak._',
  '',
]
fs.writeFileSync(REPORT, lines.join('\n'))

console.log(`\n-> ${OUT} (${kb} KB)`)
console.log(`-> ${REPORT}`)
console.log(`   ${stats.fighters} fighters, ${stats.nodes} loadout nodes, ${stats.profiles} profiles`)
console.log(`   ${report.unmapped.length} unmapped constructs, ${report.warnings.length} warnings`)
