import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'

let win = null

export function openSettingsWindow(pagina = null) {
  if (win && !win.isDestroyed()) {
    if (pagina) win.webContents.send('hub:abrir', pagina)
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
    // Tamanho da janela principal do Wispr Flow (1140x750, lido do app deles
    // em 2026-11-17). A de antes abria pequena e apertada.
    width: 1140,
    height: 750,
    minWidth: 880,
    minHeight: 600,
    title: 'Dita Aí',
    resizable: true,
    fullscreenable: false,
    // sem barra de título: os semáforos flutuam sobre o próprio conteúdo
    // (a sidebar já reserva o topo pra eles)
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    // mesmo fundo do tema (tema.css), pra não piscar outra cor ao abrir
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f5f4f0',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  win.setMenuBarVisibility(false)
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#settings')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  }
  if (pagina) win.webContents.once('did-finish-load', () => win?.webContents.send('hub:abrir', pagina))
  win.on('closed', () => { win = null })
  return win
}
