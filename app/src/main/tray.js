import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'

const isMac = process.platform === 'darwin'

function loadIcon() {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, isMac ? 'trayTemplate.png' : 'tray.ico')
    : join(__dirname, '../../resources', isMac ? 'trayTemplate.png' : 'win/tray.ico')

  const img = nativeImage.createFromPath(iconPath)
  if (!isMac) return img            // o .ico já traz os tamanhos certos
  const resized = img.resize({ width: 18, height: 18 })
  resized.setTemplateImage(true)    // só o macOS entende template image
  return resized
}

export function createTray({ getLast, onOpenSettings = () => {}, onLanguageChange = () => {}, getLanguage = () => 'pt' }) {
  const tray = new Tray(loadIcon())
  tray.setToolTip('Dita Aí')

  function truncate(t) { return t && t.length > 30 ? t.slice(0, 30) + '…' : (t || 'Nenhum ditado ainda') }

  function buildMenu(lastText) {
    // "Colar último ditado" saiu daqui, e o atalho global Ctrl+Alt+V que fazia
    // a mesma coisa saiu junto. Manter o atalho invisível seria pior que
    // remover: uma tecla que cola texto antigo sem nada na interface
    // explicando de onde veio é surpresa, não recurso. A linha abaixo com o
    // último ditado fica — ela informa, não age.
    return Menu.buildFromTemplate([
      { label: truncate(lastText), enabled: false },
      { type: 'separator' },
      { label: 'Abrir Dita Aí', click: onOpenSettings },
      {
        label: 'Idiomas',
        submenu: [
          { label: 'Português', type: 'radio', checked: getLanguage() === 'pt', click: () => onLanguageChange('pt') },
          { label: 'English', type: 'radio', checked: getLanguage() === 'en', click: () => onLanguageChange('en') },
          { label: 'Automático', type: 'radio', checked: getLanguage() === 'auto', click: () => onLanguageChange('auto') }
        ]
      },
      { type: 'separator' },
      { label: 'Sair do Dita Aí', accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q', click: () => app.quit() }
    ])
  }

  tray.setContextMenu(buildMenu(getLast()?.text))

  // Clique com o botão ESQUERDO abre as Preferências.
  //
  // No macOS um clique no ícone da barra de menus já abre o menu sozinho, e é
  // isso que o usuário de Mac espera. No Windows não: o clique esquerdo não
  // faz nada por padrão, e quem instala o app clica nele esperando que abra —
  // ter que descobrir o botão direito é atrito à toa.
  if (!isMac) tray.on('click', () => onOpenSettings())

  return {
    updateLastTranscript(text) { tray.setContextMenu(buildMenu(text)) }
  }
}
