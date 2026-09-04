export type StatId = 'M' | 'WS' | 'BS' | 'S' | 'T' | 'W' | 'I' | 'A' | 'Ld'
export type CategoryId = 'leader' | 'specialist' | 'trooper' | 'recruit' | 'operative'

// --- data pack -------------------------------------------------------------------------------

export type Profile = {
  id: string
  name: string
  typeId: string
  typeName: string
  chars: Record<string, string>
}

export type Rule = { id: string; name: string; text: string }
export type ProfileType = { id: string; name: string; columns: string[] }

export type GroupNode = {
  k: 'g'
  id: string
  name: string
  min: number | null
  max: number | null
  children: LoadoutNode[]
}

export type ItemNode = {
  k: 'i'
  id: string
  ref: string
  name: string
  cost: number
  min: number | null
  max: number | null
  profiles: string[]
  rules: string[]
  children: LoadoutNode[]
  /** Campaign attribute advance, e.g. "+1 Ballistic Skill". */
  effect?: { stat: StatId; delta: number }
}

export type LoadoutNode = GroupNode | ItemNode

export type BandRule = {
  id: string
  type: 'min' | 'max'
  count: 'fighters' | 'cost'
  where?: { category: CategoryId }
  value: number
  unit?: 'absolute' | 'percentOfBudget' | 'percentOfCount'
  adjust: { perFighterWhere: { category: CategoryId }; delta: number }[]
}

export type FighterType = {
  id: string
  name: string
  categoryId: CategoryId
  cost: number
  max: number | null
  statline: Record<StatId, string>
  profiles: string[]
  rules: string[]
  /** Purchasable gear. */
  tree: LoadoutNode[]
  /** Skill tables and attribute advances, earned in a campaign rather than bought. */
  advances: LoadoutNode[]
}

export type Faction = {
  id: string
  name: string
  book: string
  bandRules: BandRule[]
  bandOptions: LoadoutNode[]
  fighters: FighterType[]
}

export type Pack = {
  schema: string
  id: string
  name: string
  version: string
  source: { repo: string; note: string }
  vocabulary: {
    band: string
    fighter: string
    /** Polish accusative, for labels like "Dodaj wojownika". */
    fighterAcc: string
    currency: string
    campaignCurrency: string
  }
  budget: { default: number }
  statline: StatId[]
  categories: { id: CategoryId; name: string }[]
  profileTypes: Record<string, ProfileType>
  profiles: Record<string, Profile>
  rules: Record<string, Rule>
  factions: Faction[]
}

// --- roster ----------------------------------------------------------------------------------

/**
 * One picked loadout node. Selections are stored flat: node ids are unique inside a fighter type,
 * so the tree position is recoverable from the pack and nothing has to be kept in sync.
 */
export type Sel = { nodeId: string; qty: number }

export type Injury = { id: string; text: string }

export type FighterStatus = 'active' | 'recovering' | 'dead'

export type Fighter = {
  uid: string
  typeId: string
  name: string
  gear: Sel[]
  campaign: {
    xp: number
    advances: Sel[]
    injuries: Injury[]
    status: FighterStatus
  }
  notes: string
}

export type GameRecord = { id: string; date: string; result: 'win' | 'loss' | 'draw'; caches: number; note: string }

export type Roster = {
  schema: 'bandbuilder/roster@1'
  id: string
  name: string
  pack: { id: string; version: string }
  factionId: string
  bandOptions: Sel[]
  budget: number
  fighters: Fighter[]
  campaign: { enabled: boolean; caches: number; games: GameRecord[] }
  meta: { created: string; modified: string }
}

// --- engine output ---------------------------------------------------------------------------

export type CostReport = {
  total: number
  budget: number
  remaining: number
  byFighter: Record<string, number>
  byCategory: Record<CategoryId, number>
}

export type Issue = {
  ruleId: string
  severity: 'error' | 'warning'
  scope: 'band' | 'fighter'
  targetUid?: string
  message: string
}
