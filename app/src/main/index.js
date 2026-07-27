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
import { DEFAULT_TOGGLE, DEFAULT_PTT } from './defaults.js'

let rec, hotkeys, whisper, tray
let targetApp = ''
const dlog = (m) => { if (process.env.DITA_DEBUG) { try { require('fs').appendFileSync(require('path').join(require('os').homedir(), 'dita-debug.log'), new Date().toISOString() + ' ' + m + '\n') } catch {} } }

let recStartedAt = 0
let cancelled = false      // Esc marcou este ditado como cancelado
let pendingUndo = null     // texto guardado pra função Anular
let wantUndo = false       // Anular clicado antes da transcrição terminar
let dictationSeq = 0       // numera cada ditado processado
let abortedSeq = 0         // até que número o usuário mandou descartar

async function processDictation(webmBuffer) {
  const seq = ++dictationSeq
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

    // X apertado durante o "Transcrevendo…". Trata igual ao Esc: não cola,
    // mas SALVA (a regra de ouro vale aqui também — um clique errado não pode
    // custar meio minuto de fala) e deixa o texto disponível pro Anular.
    //
    // A comparação é por número de sequência, não por booleano: se a
    // transcrição demorar e o usuário já tiver começado outro ditado, um
    // "cancela" antigo não pode derrubar o ditado novo.
    const abortado = seq <= abortedSeq

    if (wasCancelled || abortado) {
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
  // macOS pede permissão por app; Windows é um toggle global do sistema
  // (Configurações > Privacidade > Microfone > "Permitir que aplicativos de
  // área de trabalho acessem seu microfone"), sem API de prompt.
  // não-bloqueante: se o prompt de mic ficar aberto, o resto do app sobe mesmo assim
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {})
  }
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
  const helperArgs = () => {
    const flags = [
      `--toggle=${getSetting('toggleShortcut', DEFAULT_TOGGLE)}`,
      `--ptt=${getSetting('pttShortcut', DEFAULT_PTT)}`
    ]
    // o helper Windows é multi-comando; o Swift só faz hotkeys
    return process.platform === 'win32' ? ['hotkeys', ...flags] : flags
  }
  hotkeys = startHotkeys({
    helperPath: helperPath(),
    args: helperArgs(),
    machine,
    onNoPermission: () => {
      new Notification({
        title: 'Dita Aí não conseguiu registrar o atalho',
        body: process.platform === 'darwin'
          ? 'Ajustes > Privacidade e Segurança > Acessibilidade: ative o Dita Aí. Os atalhos ligam sozinhos em seguida.'
          : 'O atalho global falhou ao instalar. Feche outros apps de captura de teclado e reabra o Dita Aí.'
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
  ipcMain.on('rec:cancel-hard', () => {
    dlog('IPC rec:cancel-hard state=' + machine.state())
    if (machine.state() === 'recording') { machine.cancelExternally(); return }

    // Ainda gravando o X para a gravação. Mas quando o popup mostra
    // "Transcrevendo…" a máquina JÁ saiu de 'recording' — o áudio acabou e o
    // whisper está processando. Nesse ponto cancelExternally() não tinha o que
    // cancelar e o botão ficava inerte, que era o sintoma relatado.
    abortedSeq = dictationSeq

    // Mostra a tarja "Transcrição cancelada" em vez de simplesmente sumir: sem
    // ela o popup fecharia sem confirmar nada e o usuário ficaria sem saber se
    // o clique pegou. Os 2s dão tempo de ler e de clicar em Anular, que cola o
    // texto assim que a transcrição terminar.
    rec.toast()
    rec.send('rec:cancelled')
    setTimeout(() => { if (!wantUndo) rec.hideAnimated() }, 2000)
  })
  ipcMain.on('rec:audio', () => dlog('IPC rec:audio'))
  ipcMain.on('rec:close', () => dlog('IPC rec:close'))

  async function restartWhisper(language) {
    setSetting('language', language)
    whisper.kill()
    whisper = await startWhisperServerWithFallback({ language })
  }

  ipcMain.handle('settings:get-all', () => ({
    platform: process.platform,
    language: getSetting('language', 'pt'),
    micDeviceId: getSetting('micDeviceId', ''),
    openAtLogin: getSetting('openAtLogin', 'true'),
    popupScale: getSetting('popupScale', 'm'),
    waveColor: getSetting('waveColor', '#F4F2EC'),
    popupBg: getSetting('popupBg', '#221C33'),
    popupRadius: getSetting('popupRadius', '999'),
    toggleShortcut: getSetting('toggleShortcut', DEFAULT_TOGGLE),
    pttShortcut: getSetting('pttShortcut', DEFAULT_PTT)
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
    const { ffmpegPath } = await import('./binaries.js')
    const phrase = 'Teste do pipeline completo do Dita Aí'
    const webm = join(tmpdir(), 'dita-smoke.webm')
    if (process.platform === 'darwin') {
      const aiff = join(tmpdir(), 'dita-smoke.aiff')
      execFileSync('say', ['-v', 'Luciana', '-o', aiff, phrase])
      execFileSync(ffmpegPath(), ['-y', '-i', aiff, webm], { stdio: 'ignore' })
    } else {
      // sem `say` no Windows: sintetiza via SAPI (System.Speech) e grava WAV;
      // aspas simples dobradas escapam a frase dentro do -Command do PowerShell
      const wav = join(tmpdir(), 'dita-smoke.wav')
      const psPhrase = phrase.replace(/'/g, "''")
      const psWav = wav.replace(/'/g, "''")
      const psCommand = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${psWav}'); $s.Speak('${psPhrase}'); $s.Dispose()`
      execFileSync('powershell', ['-NoProfile', '-Command', psCommand])
      execFileSync(ffmpegPath(), ['-y', '-i', wav, webm], { stdio: 'ignore' })
    }
    targetApp = 'SmokeTest'
    recStartedAt = Date.now() - 3000
    rec.show()
    await processDictation(readFileSync(webm))
    console.log('SMOKE_RESULT:', JSON.stringify(getLastDictation()))
  }
})

app.on('window-all-closed', () => {})
app.on('will-quit', () => { hotkeys?.kill(); whisper?.kill() })
