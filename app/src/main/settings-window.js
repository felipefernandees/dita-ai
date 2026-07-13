import { BrowserWindow } from 'electron'
import { join } from 'path'

let win = null

export function openSettingsWindow() {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }
  win = new BrowserWindow({
    width: 560,
    height: 520,
    title: 'Dita Aí',
    resizable: false,
    fullscreenable: false,
    backgroundColor: '#f7f5f0',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.setMenuBarVisibility(false)
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#settings')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  }
  win.on('closed', () => { win = null })
  return win
}
