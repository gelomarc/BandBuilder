// Desktop shell. The renderer is the same single-file build the browser version uses; it is served
// over a loopback HTTP server on an ephemeral port rather than loaded from file://, because
// browsers (Electron included) treat file:// as an opaque origin and may refuse to persist
// localStorage there — which is where saved teams live.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const { createServer } = require('node:http')
const { readFile, writeFile, mkdir } = require('node:fs/promises')
const { existsSync } = require('node:fs')
const { extname, join, normalize, resolve } = require('node:path')

const ROOT = app.isPackaged ? join(process.resourcesPath, 'app') : resolve(__dirname, '..', 'dist')
const STATE = () => join(app.getPath('userData'), 'window.json')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function startServer() {
  return new Promise((done, fail) => {
    const server = createServer(async (req, res) => {
      try {
        const path = join(ROOT, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html')
        if (!path.startsWith(ROOT)) {
          res.writeHead(403).end('403')
          return
        }
        const body = await readFile(path)
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body)
      } catch {
        try {
          res.writeHead(200, { 'content-type': TYPES['.html'] }).end(await readFile(join(ROOT, 'index.html')))
        } catch {
          res.writeHead(500).end('500')
        }
      }
    })
    server.on('error', fail)
    // Port 0 lets the OS pick a free one, so two copies of the app never collide.
    server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}/`))
  })
}

async function readWindowState() {
  try {
    const s = JSON.parse(await readFile(STATE(), 'utf8'))
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s
  } catch {
    /* first run, or the file was removed */
  }
  return { width: 1440, height: 920 }
}

async function saveWindowState(win) {
  if (win.isDestroyed()) return
  const b = win.getBounds()
  try {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(STATE(), JSON.stringify({ ...b, maximized: win.isMaximized() }))
  } catch {
    /* losing the window size is not worth bothering the user about */
  }
}

function buildMenu(win) {
  // Deliberately no Edit menu: its native undo/redo roles would swallow Ctrl+Z before the app's
  // own roster-level undo could see it.
  return Menu.buildFromTemplate([
    {
      label: 'Plik',
      submenu: [
        { label: 'Wydruk / PDF…', accelerator: 'CmdOrCtrl+P', click: () => win.webContents.send('menu:save-pdf') },
        { type: 'separator' },
        { label: 'Zamknij', role: 'quit' },
      ],
    },
    {
      label: 'Widok',
      submenu: [
        { label: 'Odśwież', role: 'reload' },
        { type: 'separator' },
        { label: 'Powiększ', role: 'zoomIn' },
        { label: 'Pomniejsz', role: 'zoomOut' },
        { label: 'Rozmiar domyślny', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Pełny ekran', role: 'togglefullscreen' },
        { label: 'Narzędzia programisty', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Pomoc',
      submenu: [
        {
          label: 'Dane: BSData na GitHubie',
          click: () => shell.openExternal('https://github.com/BSData/wh40k-shadow-war-armageddon'),
        },
        { label: `Wersja ${app.getVersion()}`, enabled: false },
      ],
    },
  ])
}

async function createWindow(url) {
  const state = await readWindowState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    title: 'BandBuilder — Shadow War: Armageddon',
    backgroundColor: '#14161a',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  Menu.setApplicationMenu(buildMenu(win))
  if (state.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  for (const e of ['resize', 'move', 'close']) win.on(e, () => void saveWindowState(win))

  // Anything that is not the app itself belongs in the user's own browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })

  await win.loadURL(url)
  return win
}

ipcMain.handle('pdf:save', async (event, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const safe = String(suggestedName || 'druzyna').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Zapisz PDF',
    defaultPath: join(app.getPath('documents'), `${safe}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  try {
    // printToPDF applies the page's print stylesheet, so this is the same document the browser
    // version would print — the toolbar is hidden by @media print. Margins are deliberately not
    // passed: measured against a probe page, the stylesheet's own `@page { margin: 12mm }` wins
    // and any value given here is ignored, so setting one would only be misleading.
    const pdf = await event.sender.printToPDF({ pageSize: 'A4', printBackground: true })
    await writeFile(filePath, pdf)
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  }
})

ipcMain.handle('pdf:print', async (event) => {
  await new Promise((done) => event.sender.print({ printBackground: true }, () => done()))
  return { ok: true }
})

ipcMain.handle('shell:reveal', async (_event, filePath) => {
  shell.showItemInFolder(filePath)
  return { ok: true }
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    if (!existsSync(join(ROOT, 'index.html'))) {
      dialog.showErrorBox('BandBuilder', `Brak plików aplikacji w:\n${ROOT}\n\nUruchom: npm run build`)
      app.quit()
      return
    }
    const url = await startServer()
    await createWindow(url)
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow(url)
    })
  })

  app.on('window-all-closed', () => app.quit())
}
