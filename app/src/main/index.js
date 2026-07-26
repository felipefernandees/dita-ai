import { app, ipcMain, clipboard, systemPreferences, Notification } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { createRecorderWindow } from './recorder-window.js'
import { createHotkeyMachine, startHotkeys } from './hotkeys.js'
import { ensureModel, startWhisperServerWithFallback, transcribe } from './whisper.js'
import { initDb, saveDictation, getLastDictation, listHistory, listDictionary, listSnippets, getSetting, setSetting } from './db.js'
import { polish } from './polish.js'
import { getFrontmostApp, pasteText } from './paster.js'
import { createTray } from './tray.js'
import { openSettingsWindow } from './settings-window.js'
import { helperPath } from './helper-path.js'
import { dataDir, dbPath } from './paths.js'

let rec, hotkeys, whisper, tray
let targetApp = ''
const dlog = (m) => { if (process.env.DITA_DEBUG) { try { require('fs').appendFileSync(require('path').join(require('os').homedir(), 'dita-debug.log'), new Date().toISOString() + ' ' + m + '\n') } catch {} } }

let recStartedAt = 0
let cancelled = false      // Esc marcou este ditado como cancelado
let pendingUndo = null     // texto guardado pra função Anular
let wantUndo = false       // Anular clicado antes da transcrição terminar

async function processDictation(webmBuffer) {
  const wasCancelled = cancelled
  cancelled = false
  if (!wasCancelled) rec.send('rec:phase', 'processing')
  try {
    const raw = await transcribe(webmBuffer, { port: whisper.port })
    const text = polish(raw, { dictionary: listDictionary(), snippets: listSnippets() })
    if (!text) { rec.hideAnimated(); return }

    // REGRA DE OURO: salva ANTES de colar
    const row = saveDictation({ text, rawText: raw, appName: targetApp, durationMs: Date.now() - recStartedAt })
    tray.updateLastTranscript(row.text)

    if (wasCancelled) {
      // Esc: não cola. Guarda pra Anular; se o Felipe já clicou Anular, cola agora.
      if (wantUndo) { wantUndo = false; await pasteText(text); rec.hideAnimated() }
      else { pendingUndo = text; setTimeout(() => { pendingUndo = null }, 6000) }
      return
    }

    const frontNow = await getFrontmostApp()
    const pasted = await pasteText(text)
    dlog('paste: targetApp=' + targetApp + ' frontNow=' + frontNow + ' pasted=' + pasted)
    if (pasted) {
      rec.send('rec:result', { text, pasted: true })   // só confirma "Colado"
      setTimeout(() => rec.hideAnimated(), 1100)
    } else {
      rec.expandResult()                                // vira o card grande
      rec.send('rec:result', { text, pasted: false })   // Copiar Ditado, persiste
    }
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
// Reforço do backgroundThrottling: o Chromium também "desliga" renderers de
// janelas sem foco/ocluídas por conta própria. Sem estes switches o popup
// congela e some enquanto o Felipe fala em outro app.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => openSettingsWindow())
  app.on('activate', () => openSettingsWindow())
}

app.whenReady().then(async () => {
  ckpt('ready')
  mkdirSync(dataDir(), { recursive: true })
  initDb(dbPath())
  ckpt('db')
  // não-bloqueante: se o prompt de mic ficar aberto, o resto do app sobe mesmo assim
  systemPreferences.askForMediaAccess('microphone').catch(() => {})
  ckpt('mic-async')

  rec = createRecorderWindow({ getScale: () => getSetting('popupScale', 'm') })
  ckpt('recorder-window')
  await ensureModel()
  ckpt('model')
  whisper = await startWhisperServerWithFallback({ language: getSetting('language', 'pt') })
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
      dlog('onStop')
      hotkeys.setRecordingState(false)
      rec.send('rec:stop') // renderer envia rec:audio quando fechar o MediaRecorder
    },
    onCancel: (reason) => {
      dlog('onCancel reason=' + reason)
      hotkeys.setRecordingState(false)
      if (reason === 'esc') {
        // cancela mas permite Anular: pega o áudio, transcreve em segundo plano,
        // mostra a tarja "Transcrição cancelada / Anular"
        cancelled = true
        wantUndo = false
        rec.send('rec:stop')       // captura o áudio (keep=true no renderer)
        rec.toast()                // dimensiona a tarja
        rec.send('rec:cancelled')  // troca só a fase pra tarja
        setTimeout(() => { if (!wantUndo) rec.hideAnimated() }, 6000)
      } else {
        rec.hideAnimated()
        rec.send('rec:cancel')     // descarta o áudio
      }
    }
  })

  ckpt('machine')
  const helperArgs = () => [
    `--toggle=${getSetting('toggleShortcut', 'fn+space')}`,
    `--ptt=${getSetting('pttShortcut', 'rcmd')}`
  ]
  hotkeys = startHotkeys({
    helperPath: helperPath(),
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
  ipcMain.on('rec:undo', async () => {
    if (pendingUndo) { const t = pendingUndo; pendingUndo = null; await pasteText(t); rec.hideAnimated() }
    else { wantUndo = true; rec.send('rec:phase', 'processing') } // transcrição ainda rodando: cola quando terminar
  })
  ipcMain.on('rec:finish', () => { dlog('IPC rec:finish state=' + machine.state()); machine.stopExternally() })
  ipcMain.on('rec:cancel-hard', () => { dlog('IPC rec:cancel-hard state=' + machine.state()); machine.cancelExternally() })
  ipcMain.on('rec:audio', () => dlog('IPC rec:audio'))
  ipcMain.on('rec:close', () => dlog('IPC rec:close'))

  async function restartWhisper(language) {
    setSetting('language', language)
    whisper.kill()
    whisper = await startWhisperServerWithFallback({ language })
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
      hotkeys = startHotkeys({ helperPath: helperPath(), args: helperArgs(), machine, onNoPermission: () => {} })
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
