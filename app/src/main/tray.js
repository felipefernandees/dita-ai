import { Tray, Menu, nativeImage, app, globalShortcut } from 'electron'
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

export function createTray({ getLast, onPasteLast, onOpenSettings = () => {}, onLanguageChange = () => {}, getLanguage = () => 'pt' }) {
  const tray = new Tray(loadIcon())
  tray.setToolTip('Dita Aí')

  function truncate(t) { return t && t.length > 30 ? t.slice(0, 30) + '…' : (t || 'Nenhum ditado ainda') }

  function buildMenu(lastText) {
    return Menu.buildFromTemplate([
      { label: 'Colar último ditado', accelerator: isMac ? 'Ctrl+Cmd+V' : 'Ctrl+Alt+V', click: onPasteLast },
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
  const registered = globalShortcut.register(isMac ? 'Control+Command+V' : 'Control+Alt+V', onPasteLast)
  if (!registered) console.error('tray: falha ao registrar atalho global de colar (conflito com outro app?)')

  return {
    updateLastTranscript(text) { tray.setContextMenu(buildMenu(text)) }
  }
}
