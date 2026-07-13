import { app, ipcMain, clipboard, systemPreferences, Notification } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { createRecorderWindow } from './recorder-window.js'
import { createHotkeyMachine, startHotkeys } from './hotkeys.js'
import { ensureModel, startWhisperServer, transcribe } from './whisper.js'
import { initDb, saveDictation, getLastDictation, listHistory, listDictionary, listSnippets, getSetting, setSetting } from './db.js'
import { polish } from './polish.js'
import { getFrontmostApp, pasteText } from './paster.js'
import { createTray } from './tray.js'
import { openSettingsWindow } from './settings-window.js'

const DATA_DIR = join(homedir(), 'Library/Application Support/dita-ai')
const HELPER = app.isPackaged
  ? join(process.resourcesPath, 'dita-hotkeys')
  : join(__dirname, '../../../helper/dita-hotkeys')

let rec, hotkeys, whisper, tray
let targetApp = ''
let recStartedAt = 0

async function processDictation(webmBuffer) {
  rec.send('rec:phase', 'processing')
  try {
    const raw = await transcribe(webmBuffer, { port: whisper.port })
    const text = polish(raw, { dictionary: listDictionary(), snippets: listSnippets() })
    if (!text) { rec.hide(); return }

    // REGRA DE OURO: salva ANTES de colar
    const row = saveDictation({ text, rawText: raw, appName: targetApp, durationMs: Date.now() - recStartedAt })
    tray.updateLastTranscript(row.text)

    const pasted = await pasteText(text)
    rec.send('rec:result', { text })
    if (pasted) setTimeout(() => rec.hideAnimated(), 4000) // Copiar Ditado fica à mão por 4s
    // se não colou, o popup persiste com Copiar Ditado
  } catch (err) {
    console.error('pipeline:', err)
    rec.send('rec:phase', 'error')
    setTimeout(() => rec.hideAnimated(), 2500)
  }
}

const CKPT = process.env.DITA_CHECKPOINT
function ckpt(tag) {
  if (CKPT) require('fs').appendFileSync(CKPT, tag + '\n')
}

// Instância única: se o app já roda e o Felipe abre de novo (Finder/Dock),
// em vez de subir outra cópia, traz a janela de configurações pra frente.
// Isso garante acesso às configurações mesmo com o ícone da barra escondido.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => openSettingsWindow())
  app.on('activate', () => openSettingsWindow())
}

app.whenReady().then(async () => {
  ckpt('ready')
  mkdirSync(DATA_DIR, { recursive: true })
  initDb(join(DATA_DIR, 'dita.db'))
  ckpt('db')
  // não-bloqueante: se o prompt de mic ficar aberto, o resto do app sobe mesmo assim
  systemPreferences.askForMediaAccess('microphone').catch(() => {})
  ckpt('mic-async')

  rec = createRecorderWindow({ getScale: () => getSetting('popupScale', 'm') })
  ckpt('recorder-window')
  ensureModel()
  ckpt('model')
  whisper = await startWhisperServer({ language: getSetting('language', 'pt') })
  ckpt('whisper')

  const machine = createHotkeyMachine({
    onStart: async () => {
      targetApp = await getFrontmostApp()
      recStartedAt = Date.now()
      hotkeys.setRecordingState(true)
      rec.show()
      rec.send('rec:start')
    },
    onStop: () => {
      hotkeys.setRecordingState(false)
      rec.send('rec:stop') // renderer envia rec:audio quando fechar o MediaRecorder
    },
    onCancel: () => {
      hotkeys.setRecordingState(false)
      rec.hideAnimated() // rec:closing anima a saída; o releaseMic acontece no rec:cancel
      rec.send('rec:cancel')
    }
  })

  ckpt('machine')
  const helperArgs = () => [
    `--toggle=${getSetting('toggleShortcut', 'fn+space')}`,
    `--ptt=${getSetting('pttShortcut', 'rcmd')}`
  ]
  hotkeys = startHotkeys({
    helperPath: HELPER,
    args: helperArgs(),
    machine,
    onNoPermission: () => {
      new Notification({
        title: 'Dita Aí precisa de permissão',
        body: 'Ajustes > Privacidade e Segurança > Acessibilidade: ative o Dita Aí. Os atalhos ligam sozinhos em seguida.'
      }).show()
    }
  })

  ckpt('hotkeys')
  ipcMain.on('rec:audio', (_e, buf) => processDictation(buf))
  ipcMain.on('rec:copy', (_e, text) => clipboard.writeText(text))
  ipcMain.on('rec:close', () => { machine.handle('esc'); rec.hideAnimated() })

  async function restartWhisper(language) {
    setSetting('language', language)
    whisper.kill()
    whisper = await startWhisperServer({ language })
  }

  ipcMain.handle('settings:get-all', () => ({
    language: getSetting('language', 'pt'),
    micDeviceId: getSetting('micDeviceId', ''),
    openAtLogin: getSetting('openAtLogin', 'true'),
    popupScale: getSetting('popupScale', 'm'),
    waveColor: getSetting('waveColor', '#F4F2EC'),
    popupBg: getSetting('popupBg', '#221C33'),
    popupRadius: getSetting('popupRadius', '999'),
    toggleShortcut: getSetting('toggleShortcut', 'fn+space'),
    pttShortcut: getSetting('pttShortcut', 'rcmd')
  }))
  ipcMain.handle('settings:set', async (_e, key, value) => {
    if (key === 'language') {
      await restartWhisper(value)
      return
    }
    setSetting(key, value)
    if (key === 'openAtLogin' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: value === 'true' })
    }
    if (key === 'toggleShortcut' || key === 'pttShortcut') {
      hotkeys.kill()
      hotkeys = startHotkeys({ helperPath: HELPER, args: helperArgs(), machine, onNoPermission: () => {} })
    }
  })
  ipcMain.handle('history:list', () => listHistory(300))

  ckpt('pre-tray')
  tray = createTray({
    getLast: () => getLastDictation(),
    getLanguage: () => getSetting('language', 'pt'),
    onLanguageChange: restartWhisper,
    onOpenSettings: () => openSettingsWindow(),
    onPasteLast: async () => {
      const last = getLastDictation()
      if (last) await pasteText(last.text)
    }
  })

  ckpt('tray')
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: getSetting('openAtLogin', 'true') === 'true' })
  ckpt('done')

  // Smoke test do pipeline sem atalhos: DITA_TEST_DICTATION=1 npm run dev
  if (process.env.DITA_TEST_DICTATION) {
    const { execFileSync } = await import('child_process')
    const { readFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const aiff = join(tmpdir(), 'dita-smoke.aiff')
    const webm = join(tmpdir(), 'dita-smoke.webm')
    execFileSync('say', ['-v', 'Luciana', '-o', aiff, 'Teste do pipeline completo do Dita Aí'])
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-i', aiff, webm], { stdio: 'ignore' })
    targetApp = 'SmokeTest'
    recStartedAt = Date.now() - 3000
    rec.show()
    await processDictation(readFileSync(webm))
    console.log('SMOKE_RESULT:', JSON.stringify(getLastDictation()))
  }
})

app.on('window-all-closed', () => {})
app.on('will-quit', () => { hotkeys?.kill(); whisper?.kill() })
