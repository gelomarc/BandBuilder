// Downloads the community data for one game system into data/bsdata/<system>/.
// Sources are community-maintained BattleScribe repositories, not endorsed by Games Workshop.
// Raw files are gitignored; only the generated pack is committed.
//
//   node tools/fetch-bsdata.mjs swa
//   node tools/fetch-bsdata.mjs hh3
import fs from 'node:fs'
import path from 'node:path'
import { requireSystem, SYSTEMS } from './systems.mjs'

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SYSTEMS)

for (const id of ids) {
  const system = requireSystem(id)
  const out = path.join('data/bsdata', system.id)
  const wanted = system.format === 'json' ? /\.json$/ : /\.(cat|gst)$/

  const res = await fetch(`https://api.github.com/repos/${system.repo}/git/trees/HEAD?recursive=1`)
  if (!res.ok) {
    console.error(`${system.id}: nie udało się pobrać listy plików (${res.status})`)
    process.exitCode = 1
    continue
  }
  const tree = await res.json()
  // Only top-level data files: subdirectories hold sources, tests and CI, not catalogues.
  const files = tree.tree.filter((t) => t.type === 'blob' && !t.path.includes('/') && wanted.test(t.path))

  fs.mkdirSync(out, { recursive: true })
  let bytes = 0
  for (const f of files) {
    const url = `https://raw.githubusercontent.com/${system.repo}/HEAD/${f.path.split('/').map(encodeURIComponent).join('/')}`
    const file = await fetch(url)
    if (!file.ok) {
      console.error(`  FAIL ${f.path}: ${file.status}`)
      process.exitCode = 1
      continue
    }
    const text = await file.text()
    fs.writeFileSync(path.join(out, f.path), text)
    bytes += text.length
  }
  console.log(`${system.id}: ${files.length} plików, ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${out}`)
}
