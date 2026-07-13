import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

const SIZES = {
  p: { w: 180, h: 34 },
  m: { w: 230, h: 44 },
  g: { w: 290, h: 56 }
}

export function createRecorderWindow({ getScale = () => 'm' } = {}) {
  const win = new BrowserWindow({
    width: SIZES.m.w, height: SIZES.m.h,
    frame: false, transparent: true, alwaysOnTop: true,
    focusable: false, skipTaskbar: true, show: false, resizable: false,
    hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  function position() {
    const { w, h } = SIZES[getScale()] || SIZES.m
    win.setSize(w, h)
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setPosition(
      Math.round(workArea.x + workArea.width / 2 - w / 2),
      Math.round(workArea.y + workArea.height - h - 36)
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
