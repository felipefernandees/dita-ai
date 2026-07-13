import { app, ipcMain, clipboard, systemPreferences, Notification } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { createRecorderWindow } from './recorder-window.js'
import { createHotkeyMachine, startHotkeys } from './hotkeys.js'
import { ensureModel, startWhisperServer, transcribe } from './whisper.js'
import { initDb, saveDictation, getLastDictation, listDictionary, listSnippets, getSetting, setSetting } from './db.js'
import { polish } from './polish.js'
import { getFrontmostApp, pasteText } from './paster.js'
import { createTray } from './tray.js'

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
    if (pasted) setTimeout(() => rec.hide(), 4000) // Copiar Ditado fica à mão por 4s
    // se não colou, o popup persiste com Copiar Ditado
  } catch (err) {
    console.error('pipeline:', err)
    rec.send('rec:phase', 'error')
    setTimeout(() => rec.hide(), 2500)
  }
}

app.whenReady().then(async () => {
  mkdirSync(DATA_DIR, { recursive: true })
  initDb(join(DATA_DIR, 'dita.db'))
  await systemPreferences.askForMediaAccess('microphone')

  rec = createRecorderWindow()
  ensureModel()
  whisper = await startWhisperServer({ language: getSetting('language', 'pt') })

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
      rec.send('rec:cancel')
      rec.hide()
    }
  })

  hotkeys = startHotkeys({
    helperPath: HELPER,
    machine,
    onNoPermission: () => {
      new Notification({
        title: 'Dita Aí precisa de permissão',
        body: 'Ajustes > Privacidade e Segurança > Acessibilidade: ative o Dita Aí e reabra o app.'
      }).show()
    }
  })

  ipcMain.on('rec:audio', (_e, buf) => processDictation(buf))
  ipcMain.on('rec:copy', (_e, text) => clipboard.writeText(text))
  ipcMain.on('rec:close', () => { machine.handle('esc'); rec.hide() })

  async function restartWhisper(language) {
    setSetting('language', language)
    whisper.kill()
    whisper = await startWhisperServer({ language })
  }

  tray = createTray({
    getLast: () => getLastDictation(),
    getLanguage: () => getSetting('language', 'pt'),
    onLanguageChange: restartWhisper,
    onPasteLast: async () => {
      const last = getLastDictation()
      if (last) await pasteText(last.text)
    }
  })

  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true })

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
