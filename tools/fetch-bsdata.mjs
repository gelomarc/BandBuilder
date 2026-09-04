// Downloads the community BattleScribe data for Shadow War: Armageddon into data/bsdata/.
// Source: https://github.com/BSData/wh40k-shadow-war-armageddon (community maintained, not
// endorsed by Games Workshop). Raw files are gitignored; only the generated pack is committed.
import fs from 'node:fs'
import path from 'node:path'

const REPO = 'BSData/wh40k-shadow-war-armageddon'
const OUT = 'data/bsdata'

const tree = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/master`)).json()
const files = tree.tree.filter((t) => /\.(cat|gst)$/.test(t.path)).map((t) => t.path)

fs.mkdirSync(OUT, { recursive: true })
for (const f of files) {
  const url = `https://raw.githubusercontent.com/${REPO}/master/${encodeURIComponent(f)}`
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`FAIL ${f}: ${res.status}`)
    continue
  }
  fs.writeFileSync(path.join(OUT, f), await res.text())
  console.log(`ok   ${f}`)
}
console.log(`\n${files.length} files -> ${OUT}`)
