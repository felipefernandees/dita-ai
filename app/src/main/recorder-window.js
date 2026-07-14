import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

// Gravação = janela compacta (tight na pílula). Resultado = janela cresce com
// animação até a largura expandida pra caber o texto + Copiar Ditado.
const REC = { p: { w: 150, h: 36 }, m: { w: 190, h: 44 }, g: { w: 240, h: 54 } }
const RES = { p: 252, m: 322, g: 382 }
const MARGIN_BOTTOM = 42

export function createRecorderWindow({ getScale = () => 'm' } = {}) {
  const win = new BrowserWindow({
    width: REC.m.w, height: REC.m.h,
    frame: false, transparent: true, alwaysOnTop: true,
    focusable: false, skipTaskbar: true, show: false, resizable: false, hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  let tween = null
  let guard = null
  function scaleKey() { return REC[getScale()] ? getScale() : 'm' }

  function place(w, h) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setBounds({
      x: Math.round(workArea.x + workArea.width / 2 - w / 2),
      y: Math.round(workArea.y + workArea.height - h - MARGIN_BOTTOM),
      width: w, height: h
    })
  }

  function tweenWidth(target) {
    if (tween) { clearInterval(tween); tween = null }
    const start = win.getBounds().width
    const h = win.getBounds().height
    if (start === target) return
    const t0 = Date.now()
    const dur = 170
    tween = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3) // easeOutCubic
      place(Math.round(start + (target - start) * e), h)
      if (p >= 1) { clearInterval(tween); tween = null }
    }, 10)
  }

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  function startGuard() {
    if (guard) clearInterval(guard)
    guard = setInterval(() => {
      if (win.isDestroyed()) return
      win.setAlwaysOnTop(true, 'screen-saver')
      if (!win.isVisible()) win.showInactive()
    }, 700)
  }
  function stopGuard() { if (guard) { clearInterval(guard); guard = null } }

  return {
    win,
    show() {
      if (tween) { clearInterval(tween); tween = null }
      const { w, h } = REC[scaleKey()]
      place(w, h)
      win.setAlwaysOnTop(true, 'screen-saver') // reafirma o topo (evita o sumiço)
      win.showInactive()
      startGuard()
    },
    expand() { tweenWidth(RES[scaleKey()]) },
    startVisibilityGuard() {}, // compat: o guard agora vive no show/hide
    stopVisibilityGuard() {},
    hide() { stopGuard(); win.hide() },
    hideAnimated() {
      if (!win.isVisible()) { stopGuard(); return }
      win.webContents.send('rec:closing')
      setTimeout(() => { if (!win.isDestroyed()) { stopGuard(); win.hide() } }, 150)
    },
    send(channel, ...args) { win.webContents.send(channel, ...args) }
  }
}
