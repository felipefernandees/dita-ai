import { app, BrowserWindow } from 'electron'
import { join } from 'path'

let popup = null

function createPopup() {
  popup = new BrowserWindow({
    width: 280,
    height: 72,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    show: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (process.env['ELECTRON_RENDERER_URL']) {
    popup.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    popup.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createPopup)
app.on('window-all-closed', () => {})
