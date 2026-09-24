const { app, BrowserWindow, Menu, protocol, net } = require('electron')
const { join, resolve, sep } = require('node:path')
const { pathToFileURL } = require('node:url')

app.setName('Pepe')
protocol.registerSchemesAsPrivileged([
  { scheme: 'pepe', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function send(command) {
  BrowserWindow.getFocusedWindow()?.webContents.send('reader:command', command)
}

function createWindow() {
  const window = new BrowserWindow({
    title: 'Pepe',
    width: 1440,
    height: 960,
    minWidth: 560,
    minHeight: 480,
    backgroundColor: '#f3f2ef',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (process.platform === 'darwin') window.setWindowButtonVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(process.platform === 'darwin' ? input.meta : input.control))
      return
    const key = input.key.toLowerCase()
    const command =
      key === 'l'
        ? input.shift
          ? 'toggle-paper'
          : 'toggle-chat'
        : key === 'o'
          ? 'open-paper'
          : key === '+' || key === '='
            ? 'zoom-in'
            : key === '-'
              ? 'zoom-out'
              : key === '0'
                ? 'reset-zoom'
                : null
    if (command) {
      // Consume the event once, before either Chromium or the native menu can handle it.
      event.preventDefault()
      if (!input.isAutoRepeat) window.webContents.send('reader:command', command)
    }
  })
  window.once('ready-to-show', () => window.show())
  if (process.env.PEPE_DEV_URL) {
    const url = new URL(process.env.PEPE_DEV_URL)
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')
      throw new Error('Use a local development server.')
    window.loadURL(url.href)
  } else {
    window.loadURL('pepe://reader/index.html')
  }
}

app.whenReady().then(() => {
  const dist = resolve(__dirname, '../dist')
  protocol.handle('pepe', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'reader') return new Response('Not found', { status: 404 })
    let file
    try {
      file = resolve(dist, '.' + decodeURIComponent(url.pathname))
    } catch {
      return new Response('Invalid path', { status: 400 })
    }
    if (!file.startsWith(dist + sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'Pepe',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            },
          ]
        : []),
      {
        label: 'File',
        submenu: [
          { label: 'Open paper…', accelerator: 'CmdOrCtrl+O', click: () => send('open-paper') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle assistant',
            accelerator: 'CmdOrCtrl+L',
            click: () => send('toggle-chat'),
          },
          {
            label: 'Toggle reading controls',
            accelerator: 'CmdOrCtrl+Shift+L',
            click: () => send('toggle-paper'),
          },
          { type: 'separator' },
          { label: 'Larger paper', accelerator: 'CmdOrCtrl+Plus', click: () => send('zoom-in') },
          { label: 'Smaller paper', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
          {
            label: 'Reset paper size',
            accelerator: 'CmdOrCtrl+0',
            click: () => send('reset-zoom'),
          },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          ...(process.env.PEPE_DEV_URL ? [{ role: 'toggleDevTools' }] : []),
        ],
      },
      { role: 'windowMenu' },
    ]),
  )
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
