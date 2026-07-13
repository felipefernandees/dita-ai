import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

export function createRecorderWindow() {
  const win = new BrowserWindow({
    width: 300, height: 84,
    frame: false, transparent: true, alwaysOnTop: true,
    focusable: false, skipTaskbar: true, show: false, resizable: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  function position() {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setPosition(
      Math.round(workArea.x + workArea.width / 2 - 150),
      Math.round(workArea.y + workArea.height - 120)
    )
  }

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  return {
    win,
    show() { position(); win.showInactive() },
    hide() { win.hide() },
    send(channel, ...args) { win.webContents.send(channel, ...args) }
  }
}
