import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

// A janela é transparente e sempre tem a largura EXPANDIDA (pra caber o texto
// + botão quando o popup cresce); a pílula compacta fica centrada dentro dela.
const SIZES = {
  p: { w: 252, h: 34 },
  m: { w: 322, h: 42 },
  g: { w: 382, h: 52 }
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
    // toca a animação de saída no renderer e só então esconde a janela
    hideAnimated() {
      if (!win.isVisible()) return
      win.webContents.send('rec:closing')
      setTimeout(() => { if (!win.isDestroyed()) win.hide() }, 240)
    },
    send(channel, ...args) { win.webContents.send(channel, ...args) }
  }
}
