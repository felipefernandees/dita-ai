import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

// Tamanhos fixos, clonados do Wispr Flow (sem personalização)
const SIZE = {
  rec: { w: 214, h: 40 },      // pílula de gravação
  result: { w: 432, h: 188 },  // card "sem campo focado" + Copiar Ditado
  toast: { w: 264, h: 44 }     // tarja "Transcrição cancelada / Anular"
}
const MARGIN_BOTTOM = 46

export function createRecorderWindow() {
  const win = new BrowserWindow({
    width: SIZE.rec.w, height: SIZE.rec.h,
    frame: false, transparent: true, alwaysOnTop: true,
    focusable: false, skipTaskbar: true, show: false, resizable: false, hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  let tween = null
  let guard = null

  function place(w, h) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setBounds({
      x: Math.round(workArea.x + workArea.width / 2 - w / 2),
      y: Math.round(workArea.y + workArea.height - h - MARGIN_BOTTOM),
      width: w, height: h
    })
  }

  function tweenTo(w, h) {
    if (tween) { clearInterval(tween); tween = null }
    const b = win.getBounds()
    if (b.width === w && b.height === h) return
    const sw = b.width, sh = b.height
    const t0 = Date.now(), dur = 150
    tween = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      place(Math.round(sw + (w - sw) * e), Math.round(sh + (h - sh) * e))
      if (p >= 1) { clearInterval(tween); tween = null }
    }, 10)
  }

  function startGuard() {
    if (guard) clearInterval(guard)
    guard = setInterval(() => {
      if (win.isDestroyed()) return
      win.setAlwaysOnTop(true, 'screen-saver')
      if (!win.isVisible()) win.showInactive()
      win.moveTop()
    }, 600)
  }
  function stopGuard() { if (guard) { clearInterval(guard); guard = null } }

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  return {
    win,
    show() {
      if (tween) { clearInterval(tween); tween = null }
      place(SIZE.rec.w, SIZE.rec.h)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.showInactive()
      startGuard()
    },
    expandResult() { tweenTo(SIZE.result.w, SIZE.result.h) },
    toast() { tweenTo(SIZE.toast.w, SIZE.toast.h) },
    hide() { stopGuard(); win.hide() },
    hideAnimated() {
      if (!win.isVisible()) { stopGuard(); return }
      win.webContents.send('rec:closing')
      setTimeout(() => { if (!win.isDestroyed()) { stopGuard(); win.hide() } }, 130)
    },
    send(channel, ...args) { win.webContents.send(channel, ...args) }
  }
}
