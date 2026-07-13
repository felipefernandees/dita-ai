import { Tray, Menu, nativeImage, app, globalShortcut } from 'electron'
import { join } from 'path'

function loadIcon() {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'trayTemplate.png')
    : join(__dirname, '../../resources/trayTemplate.png')
  const img = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
  img.setTemplateImage(true)
  return img
}

export function createTray({ getLast, onPasteLast, onOpenSettings = () => {}, onLanguageChange = () => {}, getLanguage = () => 'pt' }) {
  const tray = new Tray(loadIcon())
  tray.setToolTip('Dita Aí')

  function truncate(t) { return t && t.length > 30 ? t.slice(0, 30) + '…' : (t || 'Nenhum ditado ainda') }

  function buildMenu(lastText) {
    return Menu.buildFromTemplate([
      { label: 'Paste last transcript', accelerator: 'Ctrl+Cmd+V', click: onPasteLast },
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
      { label: 'Sair do Dita Aí', accelerator: 'Cmd+Q', click: () => app.quit() }
    ])
  }

  tray.setContextMenu(buildMenu(getLast()?.text))
  globalShortcut.register('Control+Command+V', onPasteLast)

  return {
    updateLastTranscript(text) { tray.setContextMenu(buildMenu(text)) }
  }
}
