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
import { lerConfig, salvarChave, limparChave, registrarUso, percentualUso, LIMITE_DIARIO } from './config-remoto.js'
import { criarSessao } from './gemini-live.js'

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
    await entregarTexto(raw, { seq, wasCancelled })
  } catch (err) {
    console.error('pipeline:', err)
    rec.send('rec:phase', 'error')
    setTimeout(() => rec.hideAnimated(), 2500)
  }
}

// Tudo o que acontece DEPOIS de existir um texto cru, seja ele do whisper local
// ou do Gemini. Extraído em função própria justamente pra não haver duas
// versões desta sequência: a regra de ouro (salvar antes de colar), o Anular e
// as fases do popup precisam se comportar igual nos dois motores.
async function entregarTexto(raw, { seq, wasCancelled }) {
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
}

// ---------------------------------------------------------------------------
// Motor remoto (Gemini Live)
// ---------------------------------------------------------------------------

let ditadoGemini = null    // { sessao, erro } enquanto uma sessão remota roda
let webmPendente = null    // webm que o renderer mandou enquanto o Gemini decidia
let bloquearWebm = false   // ignora o rec:audio do whisper durante ditado remoto

function estadoMotor() {
  const cfg = lerConfig()
  return {
    engine: getSetting('transcriptionEngine', 'local'),
    temChave: Boolean(cfg.apiKey),
    chaveCifrada: cfg.chaveCifrada,
    usoDiario: cfg.usoDiario,
    limite: LIMITE_DIARIO,
    percentual: percentualUso(cfg.usoDiario)
  }
}

// Decide qual motor usar NESTE ditado. Toda desistência do remoto cai no
// whisper local — nunca em "não grava nada".
//
// Cota estourada: AVISA e usa o local. Recusar a gravação puniria o usuário
// duas vezes (perde a cota E perde a fala) por um limite que é nosso, não
// dele; o whisper local é o motor padrão do app, roda offline e sempre está
// carregado. A notificação existe pra ele entender por que ficou lento de
// repente, em vez de achar que o Gemini quebrou.
function escolherMotor() {
  if (getSetting('transcriptionEngine', 'local') !== 'gemini') return 'local'

  const cfg = lerConfig()
  if (!cfg.apiKey) {
    new Notification({
      title: 'Dita Aí está usando a transcrição local',
      body: 'O motor Gemini está selecionado, mas nenhuma chave de API foi salva. Abra as configurações para colar a sua chave.'
    }).show()
    return 'local'
  }

  if (cfg.usoDiario >= LIMITE_DIARIO) {
    new Notification({
      title: 'Cota diária do Gemini esgotada',
      body: `Você já usou ${LIMITE_DIARIO} transcrições hoje. O Dita Aí volta para a transcrição local até amanhã — nada do que você falar será perdido.`
    }).show()
    return 'local'
  }

  return 'gemini'
}

// Abre a sessão remota. Devolve 'gemini' se conseguiu, 'local' se não.
function abrirSessaoGemini() {
  const cfg = lerConfig()
  // Contabiliza ANTES de abrir: uma sessão que o Google recusa também consumiu
  // uma tentativa, e contar depois abriria a porta pra estourar a cota real do
  // usuário sem o nosso contador perceber.
  registrarUso()

  const ctx = { sessao: null, erro: '' }
  try {
    ctx.sessao = criarSessao({
      apiKey: cfg.apiKey,
      onTexto: (texto) => rec.send('rt:texto', texto),
      onErro: (msg) => {
        ctx.erro = msg
        dlog('gemini erro: ' + msg)
        rec.send('rt:erro', msg)
      },
      onFim: () => dlog('gemini fim')
    })
  } catch (err) {
    console.error('gemini: não consegui abrir a sessão:', err)
    new Notification({
      title: 'Dita Aí está usando a transcrição local',
      body: 'Não foi possível conectar ao Gemini agora. Sua fala continua sendo transcrita normalmente.'
    }).show()
    return 'local'
  }

  ditadoGemini = ctx
  webmPendente = null
  bloquearWebm = true
  return 'gemini'
}

// Fim do ditado remoto. Degradação: o usuário NUNCA perde a fala.
//   1. Se o Gemini entregou texto (mesmo parcial, mesmo tendo dado erro depois),
//      esse texto segue pelo mesmo caminho do whisper — parcial vale mais que nada.
//   2. Se não veio texto nenhum, o webm que o renderer gravou em paralelo cai
//      no whisper local, que é o comportamento de sempre.
//   3. Se nem webm existir, aí sim mostra a fase de erro.
async function finalizarGemini() {
  const ctx = ditadoGemini
  if (!ctx) return
  ditadoGemini = null

  const seq = ++dictationSeq
  const wasCancelled = cancelled
  cancelled = false
  if (!wasCancelled) rec.send('rec:phase', 'processing')

  let raw = ''
  try {
    raw = await ctx.sessao.encerrar()
  } catch (err) {
    console.error('gemini: encerrar falhou:', err)
    raw = ctx.sessao.textoAcumulado()
  }

  // A partir daqui o whisper volta a poder receber áudio do renderer.
  bloquearWebm = false

  if (raw && raw.trim()) {
    webmPendente = null
    try {
      await entregarTexto(raw, { seq, wasCancelled })
    } catch (err) {
      console.error('pipeline (gemini):', err)
      rec.send('rec:phase', 'error')
      setTimeout(() => rec.hideAnimated(), 2500)
    }
    return
  }

  const guardado = webmPendente
  webmPendente = null
  if (guardado) { processDictation(guardado); return }

  // Nem texto nem áudio ainda: o webm pode estar a caminho (o renderer fecha o
  // MediaRecorder de forma assíncrona). Dá uma janela pra ele chegar sozinho —
  // com bloquearWebm já em false ele entra direto no processDictation.
  const marca = dictationSeq
  setTimeout(() => {
    if (dictationSeq !== marca) return   // o webm chegou e virou outro ditado
    if (ctx.erro) rec.send('rt:erro', ctx.erro)
    rec.send('rec:phase', 'error')
    setTimeout(() => rec.hideAnimated(), 2500)
  }, 3000)
}

function abortarGemini() {
  const ctx = ditadoGemini
  ditadoGemini = null
  bloquearWebm = false
  webmPendente = null
  if (ctx) { try { ctx.sessao.abortar() } catch {} }
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
      // Sobra do ditado anterior (troca de motor no meio, erro sem fim) não
      // pode continuar consumindo áudio do novo.
      abortarGemini()
      const motor = escolherMotor() === 'gemini' ? abrirSessaoGemini() : 'local'
      hotkeys.setRecordingState(true)
      rec.show()
      // O payload diz ao renderer se ele deve, além do MediaRecorder de sempre,
      // abrir o AudioWorklet e mandar PCM por rt:audio.
      rec.send('rec:start', { engine: motor })
    },
    onStop: () => {
      dlog('onStop')
      hotkeys.setRecordingState(false)
      rec.send('rec:stop') // renderer envia rec:audio quando fechar o MediaRecorder
      if (ditadoGemini) finalizarGemini()
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
        // Esc mantém o Anular funcionando também no motor remoto: o texto é
        // finalizado e guardado, só não é colado.
        if (ditadoGemini) finalizarGemini()
        setTimeout(() => { if (!wantUndo) rec.hideAnimated() }, 6000)
      } else {
        rec.hideAnimated()
        rec.send('rec:cancel')     // descarta o áudio
        abortarGemini()
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
  // Durante um ditado remoto o renderer continua gravando o webm de sempre — ele
  // fica guardado como rede de segurança e só vira transcrição local se o
  // Gemini não entregar texto nenhum (ver finalizarGemini).
  ipcMain.on('rec:audio', (_e, buf) => {
    if (bloquearWebm) { webmPendente = buf; return }
    processDictation(buf)
  })
  ipcMain.on('rec:copy', (_e, text) => clipboard.writeText(text))

  // Chunks de PCM16 16kHz mono, enviados enquanto o usuário ainda fala.
  ipcMain.on('rt:audio', (_e, buf) => {
    if (!ditadoGemini) return
    try {
      ditadoGemini.sessao.enviarAudio(Buffer.from(buf))
    } catch (err) {
      console.error('rt:audio:', err)
    }
  })
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
    pttShortcut: getSetting('pttShortcut', DEFAULT_PTT),
    transcriptionEngine: getSetting('transcriptionEngine', 'local')
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

  // --- motor de transcrição (contrato com a tela de configurações) ---
  ipcMain.handle('motor:estado', () => estadoMotor())
  ipcMain.handle('motor:set-engine', (_e, engine) => {
    // Lista fechada: qualquer valor estranho vira 'local', que é o motor que
    // nunca depende de rede nem de chave.
    setSetting('transcriptionEngine', engine === 'gemini' ? 'gemini' : 'local')
    return { ok: true }
  })
  ipcMain.handle('motor:set-chave', (_e, chave) => {
    const limpa = String(chave ?? '').trim()
    if (!limpa) return { ok: false, erro: 'Cole a chave da API do Google antes de salvar.' }
    try {
      salvarChave(limpa)
      return { ok: true }
    } catch (err) {
      console.error('motor:set-chave:', err)
      return { ok: false, erro: 'Não consegui gravar a chave no disco.' }
    }
  })
  ipcMain.handle('motor:limpar-chave', () => {
    limparChave()
    return { ok: true }
  })

  ckpt('pre-tray')
  tray = createTray({
    getLast: () => getLastDictation(),
    getLanguage: () => getSetting('language', 'pt'),
    onLanguageChange: restartWhisper,
    onOpenSettings: () => openSettingsWindow()
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
