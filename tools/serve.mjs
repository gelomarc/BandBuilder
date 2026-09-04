// Serves dist/ on localhost and opens it. Opening dist/index.html straight from the file system
// also works, but browsers treat file:// as an opaque origin and some of them refuse to persist
// anything there, which would cost you your saved teams. Over http://localhost they always do.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..', 'dist')
const PORT = Number(process.env.PORT) || 8787

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

try {
  await stat(join(ROOT, 'index.html'))
} catch {
  console.error(`Brak ${join(ROOT, 'index.html')}. Uruchom najpierw: npm install && npm run build`)
  process.exit(1)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
  const file = rel === '' ? 'index.html' : rel
  const path = join(ROOT, file)
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('403')
    return
  }
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    // Single-page app: anything unknown falls back to the one document.
    res.writeHead(200, { 'content-type': TYPES['.html'] }).end(await readFile(join(ROOT, 'index.html')))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`
  console.log(`BandBuilder: ${url}`)
  console.log('Zamknij to okno, żeby zatrzymać serwer.')
  if (!process.env.NO_OPEN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
})
