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

// Uma linha só, sem quebras, cortada no tamanho que cabe num item de menu.
export function resumo(texto, max = 48) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

// Menu da barra de cima na ordem do Wispr Flow (2026-11-17): abrir o app,
// último ditado (colar e copiar), microfone, idiomas, ajustes e sair. O Wispr
// não mostra o texto do último ditado; o Dita Aí mostra, a pedido do Felipe,
// para ele saber o que vai copiar antes de clicar.
export function montarModelo({
  ultimo = '',
  idioma = 'pt',
  microfones = [],
  micEscolhido = '',
  mostrarPilula = true,
  acoes = {}
} = {}) {
  const a = { abrir() {}, ajustes() {}, copiarUltimo() {}, colarUltimo() {}, idioma() {}, microfone() {}, pilula() {}, sair() {}, ...acoes }
  const temUltimo = Boolean(String(ultimo || '').trim())
  return [
    { label: 'Abrir Dita Aí', click: a.abrir },
    { type: 'separator' },
    { label: temUltimo ? `“${resumo(ultimo)}”` : 'Nenhum ditado ainda', enabled: false },
    { label: 'Copiar último ditado', enabled: temUltimo, click: a.copiarUltimo },
    { label: 'Colar último ditado', enabled: temUltimo, click: a.colarUltimo },
    { type: 'separator' },
    {
      label: 'Microfone',
      submenu: [
        { label: 'Automático (microfone do Mac)', type: 'radio', checked: !micEscolhido, click: () => a.microfone('') },
        ...(microfones.length ? [{ type: 'separator' }] : []),
        ...microfones.map((m) => ({
          label: m.label || 'Microfone', type: 'radio', checked: m.deviceId === micEscolhido, click: () => a.microfone(m.deviceId)
        }))
      ]
    },
    {
      label: 'Idiomas',
      submenu: [
        { label: 'Português', type: 'radio', checked: idioma === 'pt', click: () => a.idioma('pt') },
        { label: 'English', type: 'radio', checked: idioma === 'en', click: () => a.idioma('en') },
        { label: 'Automático', type: 'radio', checked: idioma === 'auto', click: () => a.idioma('auto') }
      ]
    },
    { type: 'separator' },
    // Desligado, a pílula só aparece enquanto você dita.
    { label: 'Mostrar pílula na tela', type: 'checkbox', checked: mostrarPilula, click: () => a.pilula(!mostrarPilula) },
    { label: 'Ajustes…', accelerator: isMac ? 'Cmd+,' : 'Ctrl+,', click: a.ajustes },
    { type: 'separator' },
    { label: 'Sair do Dita Aí', accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q', click: a.sair }
  ]
}

export function createTray({
  getLast,
  getLanguage = () => 'pt',
  getMic = () => '',
  onOpen = () => {},
  onOpenSettings = () => {},
  onLanguageChange = () => {},
  onMicChange = () => {},
  onCopyLast = () => {},
  onPasteLast = () => {},
  getMostrarPilula = () => true,
  onMostrarPilula = () => {}
}) {
  const tray = new Tray(loadIcon())
  tray.setToolTip('Dita Aí')
  let microfones = []

  function refazer() {
    tray.setContextMenu(Menu.buildFromTemplate(montarModelo({
      ultimo: getLast()?.text || '',
      idioma: getLanguage(),
      microfones,
      micEscolhido: getMic(),
      mostrarPilula: getMostrarPilula(),
      acoes: {
        abrir: onOpen,
        ajustes: onOpenSettings,
        copiarUltimo: onCopyLast,
        colarUltimo: onPasteLast,
        idioma: (v) => { onLanguageChange(v); setTimeout(refazer, 50) },
        microfone: (id) => { onMicChange(id); setTimeout(refazer, 50) },
        pilula: (v) => { onMostrarPilula(v); setTimeout(refazer, 50) },
        sair: () => app.quit()
      }
    })))
  }
  refazer()

  // No Windows o clique esquerdo não abre menu nenhum por padrão; quem clica
  // no ícone espera que o app abra.
  if (!isMac) tray.on('click', () => onOpen())

  return {
    updateLastTranscript() { refazer() },
    setMicrofones(lista) { microfones = Array.isArray(lista) ? lista : []; refazer() },
    refazer
  }
}
