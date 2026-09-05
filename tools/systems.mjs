// The game systems BandBuilder ships, and where their community data comes from.
export const SYSTEMS = {
  swa: {
    id: 'swa',
    name: 'Shadow War: Armageddon',
    repo: 'BSData/wh40k-shadow-war-armageddon',
    /** BattleScribe XML (.gst/.cat). */
    format: 'xml',
    vocabulary: {
      band: 'Kill Team',
      fighter: 'Wojownik',
      fighterAcc: 'wojownika',
      currency: 'pts',
      campaignCurrency: 'Promethium Cache',
    },
    budget: 1000,
    campaign: true,
  },
  hh3: {
    id: 'hh3',
    name: 'Horus Heresy 3rd Edition',
    repo: 'BSData/horus-heresy-3rd-edition',
    /** Same object model as BattleScribe, serialised as JSON. */
    format: 'json',
    vocabulary: {
      band: 'Armia',
      fighter: 'Oddział',
      fighterAcc: 'oddział',
      currency: 'pts',
      campaignCurrency: '',
    },
    budget: 3000,
    campaign: false,
  },
}

export function requireSystem(id) {
  const s = SYSTEMS[id]
  if (!s) {
    console.error(`Nieznany system: ${id}\nDostępne: ${Object.keys(SYSTEMS).join(', ')}`)
    process.exit(1)
  }
  return s
}
