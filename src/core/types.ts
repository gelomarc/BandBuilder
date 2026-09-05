// Data pack (schema 2) and roster (schema 2) types.
//
// The pack keeps BattleScribe's sharing: a child of a node is either an inline node or a link to a
// node in the shared pool. Flattening would be simpler to consume but Horus Heresy's 18 MB of
// source shares so aggressively that inlining explodes it. The engine resolves links while
// walking, and a selection is addressed by its path — the '/'-joined ids from the root — which is
// unique per position even when the same shared weapon appears in three different slots.

export type Id = string

// --- pack --------------------------------------------------------------------------------------

export type CostType = { id: Id; name: string; hidden?: boolean }
export type Category = { id: Id; name: string; hidden?: boolean }
export type ProfileType = { id: Id; name: string; columns: string[] }
export type Profile = { id: Id; name: string; typeId: Id; chars: Record<string, string> }
export type Rule = { id: Id; name: string; text?: string }

export type ConstraintType = 'min' | 'max'
export type CountField = 'selections' | 'forces' | string

export type Constraint = {
  id: Id
  type: ConstraintType
  /** `selections`, `forces`, or a cost type id when limiting spend. */
  field: CountField
  scope: string
  value: number
  /** Value is a percentage of the scope's limit rather than an absolute count. */
  pct?: boolean
  ics?: boolean
  icf?: boolean
}

export type ConditionType =
  | 'instanceOf'
  | 'notInstanceOf'
  | 'atLeast'
  | 'atMost'
  | 'equalTo'
  | 'notEqualTo'
  | 'greaterThan'
  | 'lessThan'

export type Condition = {
  type: ConditionType
  field: CountField
  scope: string
  childId?: Id
  value: number
  ics?: boolean
  icf?: boolean
}

export type ConditionGroup = { type: 'and' | 'or'; conds?: Condition[]; groups?: ConditionGroup[] }

/** Applies the modifier once per `value` matches found, `repeats` times each. */
export type Repeat = {
  field: CountField
  scope: string
  childId?: Id
  value: number
  repeats: number
  roundUp?: boolean
  ics?: boolean
  icf?: boolean
}

export type ModifierType =
  | 'set'
  | 'increment'
  | 'decrement'
  | 'ceil'
  | 'floor'
  | 'append'
  | 'prepend'
  | 'replace'
  | 'add'
  | 'remove'
  | 'set-primary'
  | 'unset-primary'

export type Modifier = {
  type: ModifierType
  /** A constraint id, a cost type id, or one of `hidden`, `name`, `category`. */
  field: string
  value: unknown
  conds?: Condition[]
  groups?: ConditionGroup[]
  reps?: Repeat[]
}

export type EntryKind = 'unit' | 'model' | 'upgrade'

/** A node defined in place. */
export type PackNode = {
  id: Id
  name: string
  k: 'g' | 'e'
  t?: EntryKind
  cost?: Record<Id, number>
  cats?: Id[]
  primary?: Id
  cons?: Constraint[]
  mods?: Modifier[]
  prof?: Id[]
  rules?: Id[]
  kids?: PackChild[]
  hidden?: boolean
  def?: Id
  coll?: boolean
}

/** A reference to a node in the shared pool, plus whatever this use site overrides or adds. */
export type PackLink = {
  link: Id
  id: Id
  name?: string
  cost?: Record<Id, number>
  cats?: Id[]
  primary?: Id
  cons?: Constraint[]
  mods?: Modifier[]
  prof?: Id[]
  rules?: Id[]
  kids?: PackChild[]
  hidden?: boolean
}

export type PackChild = PackNode | PackLink

export const isLink = (c: PackChild): c is PackLink => 'link' in c

export type ForceSlot = { id: Id; category: Id; name?: string; cons?: Constraint[]; mods?: Modifier[] }

export type ForceTemplate = {
  id: Id
  name: string
  cons?: Constraint[]
  mods?: Modifier[]
  slots?: ForceSlot[]
  children?: ForceTemplate[]
}

export type Faction = {
  id: Id
  name: string
  /** Shared content imported by other catalogues rather than picked on its own. */
  library?: boolean
  roots: PackChild[]
}

export type Vocabulary = {
  band: string
  fighter: string
  fighterAcc: string
  currency: string
  campaignCurrency: string
}

export type Pack = {
  schema: 'bandbuilder/datapack@2'
  id: Id
  name: string
  version: string
  source: { repo: string; note: string }
  vocabulary: Vocabulary
  campaign: boolean
  budget: { default: number }
  costTypes: CostType[]
  primaryCost: Id
  categories: Category[]
  profileTypes: Record<Id, ProfileType>
  /** Profile type rendered as a compact statline row rather than a table, when the system has one. */
  statlineType?: Id
  profiles: Record<Id, Profile>
  rules: Record<Id, Rule>
  forceTemplates: ForceTemplate[]
  nodes: Record<Id, PackNode>
  factions: Faction[]
}

// --- roster ------------------------------------------------------------------------------------

/** One picked node, addressed by its path from the unit root. */
export type Sel = { path: string; qty: number }

export type Injury = { id: Id; text: string }
export type UnitStatus = 'active' | 'recovering' | 'dead'

/** One instance of a root entry: a kill team fighter, or a Horus Heresy unit. */
export type Unit = {
  uid: Id
  /** Path of the root entry inside its faction, i.e. the root child's id. */
  rootId: Id
  factionId: Id
  name: string
  gear: Sel[]
  campaign: { xp: number; advances: Sel[]; injuries: Injury[]; status: UnitStatus }
  notes: string
}

export type Force = {
  uid: Id
  templateId: Id
  name: string
  units: Unit[]
  forces: Force[]
}

export type GameRecord = { id: Id; date: string; result: 'win' | 'loss' | 'draw'; caches: number; note: string }

export type Roster = {
  schema: 'bandbuilder/roster@2'
  id: Id
  name: string
  pack: { id: Id; version: string }
  /** Primary faction, used to seed pickers; units carry their own faction for allies. */
  factionId: Id
  budget: number
  forces: Force[]
  campaign: { enabled: boolean; caches: number; games: GameRecord[] }
  meta: { created: string; modified: string }
}

// --- engine output -----------------------------------------------------------------------------

export type CostReport = {
  total: number
  budget: number
  remaining: number
  byUnit: Record<Id, number>
  byCategory: Record<Id, number>
  byCostType: Record<Id, number>
}

export type Issue = {
  ruleId: string
  severity: 'error' | 'warning'
  scope: 'band' | 'force' | 'unit'
  targetUid?: Id
  message: string
}
