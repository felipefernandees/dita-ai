import { BrowserWindow } from 'electron'
import { join } from 'path'

let win = null

export function openSettingsWindow() {
  if (win && !win.isDestroyed()) {
    // restore() antes de show(): uma janela MINIMIZADA no Windows não volta com
    // show() sozinho — ela reaparece na barra de tarefas e continua minimizada.
    // Esse é o caminho de quem abre o app pela segunda vez ou clica no ícone da
    // bandeja esperando que ele apareça; sem isto o clique parece não fazer nada.
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }
  win = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 700,
    minHeight: 480,
    title: 'Dita Aí',
    resizable: true,
    fullscreenable: false,
    // sem barra de título: os semáforos flutuam sobre o próprio conteúdo
    // (a sidebar já reserva o topo pra eles)
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#131315',
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
