// BattleScribe ships the same object model in two serialisations: XML (.gst/.cat) and JSON.
// Everything downstream works on the JSON shape, so XML is converted to it here and the importer
// stays format-agnostic.
import { XMLParser } from 'fast-xml-parser'
import fs from 'node:fs'
import path from 'node:path'

/** Elements that are always collections, so a single child still arrives as an array. */
const COLLECTIONS = new Set([
  'categoryEntries',
  'categoryLinks',
  'catalogueLinks',
  'characteristics',
  'characteristicTypes',
  'conditionGroups',
  'conditions',
  'constraints',
  'costTypes',
  'costs',
  'entryLinks',
  'forceEntries',
  'infoLinks',
  'modifierGroups',
  'modifiers',
  'profileTypes',
  'profiles',
  'publications',
  'repeats',
  'rules',
  'selectionEntries',
  'selectionEntryGroups',
  'sharedInfoGroups',
  'sharedProfiles',
  'sharedRules',
  'sharedSelectionEntries',
  'sharedSelectionEntryGroups',
])

/** Singular element name inside each collection wrapper, e.g. <constraints><constraint/></...>. */
const ITEM = {
  categoryEntries: 'categoryEntry',
  categoryLinks: 'categoryLink',
  catalogueLinks: 'catalogueLink',
  characteristics: 'characteristic',
  characteristicTypes: 'characteristicType',
  conditionGroups: 'conditionGroup',
  conditions: 'condition',
  constraints: 'constraint',
  costTypes: 'costType',
  costs: 'cost',
  entryLinks: 'entryLink',
  forceEntries: 'forceEntry',
  infoLinks: 'infoLink',
  modifierGroups: 'modifierGroup',
  modifiers: 'modifier',
  profileTypes: 'profileType',
  profiles: 'profile',
  publications: 'publication',
  repeats: 'repeat',
  rules: 'rule',
  selectionEntries: 'selectionEntry',
  selectionEntryGroups: 'selectionEntryGroup',
  sharedInfoGroups: 'sharedInfoGroup',
  sharedProfiles: 'profile',
  sharedRules: 'rule',
  sharedSelectionEntries: 'selectionEntry',
  sharedSelectionEntryGroups: 'selectionEntryGroup',
}

const BOOLS = new Set([
  'hidden',
  'collective',
  'import',
  'primary',
  'shared',
  'includeChildSelections',
  'includeChildForces',
  'percentValue',
  'roundUp',
  'library',
])

const NUMBERS = new Set(['value', 'repeats', 'revision', 'gameSystemRevision', 'defaultCostLimit'])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  parseAttributeValue: false,
  trimValues: true,
})

/** Recursively rewrite the XML parse tree into the JSON serialisation's shape. */
function convert(node) {
  if (node === null || node === undefined || node === '') return undefined
  if (typeof node !== 'object') return node

  const out = {}
  for (const [rawKey, rawValue] of Object.entries(node)) {
    if (rawKey === '#text') {
      out.description = String(rawValue)
      continue
    }
    const key = rawKey.startsWith('@') ? rawKey.slice(1) : rawKey
    if (key === 'xmlns') continue

    if (rawKey.startsWith('@')) {
      out[key] = BOOLS.has(key)
        ? rawValue === 'true'
        : NUMBERS.has(key)
          ? Number(rawValue)
          : String(rawValue)
      continue
    }

    if (COLLECTIONS.has(key)) {
      const inner = rawValue?.[ITEM[key]]
      const list = inner === undefined ? [] : Array.isArray(inner) ? inner : [inner]
      const converted = list.map(convert).filter(Boolean)
      if (converted.length) out[key] = converted
      continue
    }

    // The only remaining nested element is <description>, carrying rule text.
    const value = convert(rawValue)
    if (value !== undefined) out[key] = typeof value === 'object' && '#text' in value ? value['#text'] : value
  }
  return out
}

/** Load one system's data directory as documents in the JSON shape. */
export function loadDocuments(dir, format) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => (format === 'json' ? f.endsWith('.json') : /\.(cat|gst)$/.test(f)))
    .sort()

  return files.map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    if (format === 'json') {
      const parsed = JSON.parse(text)
      const root = parsed.gameSystem ?? parsed.catalogue ?? parsed
      return { file, isGameSystem: Boolean(parsed.gameSystem) || root.type === 'gameSystem', doc: root }
    }
    const parsed = parser.parse(text)
    const isGameSystem = Boolean(parsed.gameSystem)
    return { file, isGameSystem, doc: convert(parsed.gameSystem ?? parsed.catalogue) }
  })
}
