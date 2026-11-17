import { app, ipcMain, clipboard, systemPreferences, Notification, net, nativeTheme } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { createRecorderWindow } from './recorder-window.js'
import { createHotkeyMachine, startHotkeys } from './hotkeys.js'
import { ensureModel, startWhisperServerWithFallback, transcribe } from './whisper.js'
import { initDb, saveDictation, getLastDictation, listHistory, listDictionary, listSnippets, getSetting, setSetting, addDictionaryWord, removeDictionaryWord, deleteDictation, clearHistory, estatisticas } from './db.js'
import { polish, acharSnippet, aplicarDicionario } from './polish.js'
import { capturarContexto } from './contexto.js'
import { limparTexto, aquecerConexao } from './limpeza.js'
import { ajustarParaColar } from './ajuste-colagem.js'
import { execFileSync } from 'child_process'
import { getFrontmostApp, pasteText } from './paster.js'
import { createTray } from './tray.js'
import { openSettingsWindow } from './settings-window.js'
import { helperPath } from './helper-path.js'
import { dataDir, dbPath } from './paths.js'
import { DEFAULT_TOGGLE, DEFAULT_PTT } from './defaults.js'
import { lerConfig, salvarChave, limparChave, registrarUso, percentualUso, LIMITE_DIARIO } from './config-remoto.js'
import { criarSessao } from './gemini-live.js'

let rec, hotkeys, whisper, tray
// Nome do app em foco quando o ditado começou. É uma PROMESSA, não uma string,
// porque descobri-lo custa um osascript ao System Events (100 a 180ms medidos
// nesta máquina, sem teto quando ele está ocupado) e o dado só alimenta o
// histórico — nada no ditado depende dele. Enquanto era aguardado no `onStart`,
// ele atrasava o popup em TODO ditado e, quando o System Events engasgava,
// segurava o começo da gravação até depois de o usuário já ter desistido.
let appEmFoco = Promise.resolve('')
// Contexto do ditado (app, URL, texto em volta do cursor, palavras da tela),
// capturado no INÍCIO pelo helper e aguardado só na hora de entregar o texto.
// Mesma lógica do appEmFoco: promessa com prazo próprio, nunca na frente do popup.
let contextoAtual = Promise.resolve(null)
// Último texto entregue, pra limpeza continuar a frase quando a pessoa dita em
// dois tempos no mesmo campo.
let ultimoDitado = { texto: '', app: '', em: 0 }
const JANELA_CONTINUIDADE_MS = 2 * 60 * 1000
import { dlog } from './log.js'

let recStartedAt = 0
let cancelled = false      // Esc marcou este ditado como cancelado
let pendingUndo = null     // texto guardado pra função Anular
let wantUndo = false       // Anular clicado antes da transcrição terminar
let dictationSeq = 0       // numera cada ditado processado
let todosAjustesFora = () => ({})
const TEMA_ELECTRON = { sistema: 'system', claro: 'light', escuro: 'dark' }
let abortedSeq = 0         // até que número o usuário mandou descartar
let webmAtrasadoCancelado = false // o webm que ainda vai chegar é de um ditado cancelado
// O Gemini já entregou o texto deste ditado: o webm de reserva que chegar
// depois NÃO pode virar uma segunda transcrição. Visto em 2026-11-17: a mesma
// fala colada duas vezes, com diferenças miúdas ("da gente" x "de a gente"),
// uma do Gemini e outra do whisper, porque o webm chegou depois de o Gemini
// encerrar e de o bloquearWebm já ter sido liberado.
let descartarWebm = false

// `cancelado` vem de quem já consumiu o `cancelled` antes (o finalizarGemini,
// quando o Gemini não devolve texto e o áudio guardado cai pro whisper). Sem
// ele, um Esc logo no começo do ditado virava texto colado: visto em
// 2026-11-17, fala de 1 s cancelada e colada 10 s depois.
async function processDictation(webmBuffer, { cancelado = false } = {}) {
  const seq = ++dictationSeq
  const wasCancelled = cancelled || cancelado
  cancelled = false
  if (!wasCancelled) rec.send('rec:phase', 'processing')
  dlog(`whisper: transcrevendo o webm (${webmBuffer?.byteLength || 0} bytes)`)
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
// Nome de quem dita, pra a limpeza grafar certo quando a pessoa fala o próprio
// nome. Vem do ajuste (fase 3) ou, até lá, do nome completo da conta do Mac.
let nomeDaConta = null
function nomeUsuario() {
  const salvo = getSetting('nomeUsuario', '')
  if (salvo) return salvo
  if (nomeDaConta === null) {
    nomeDaConta = ''
    if (process.platform === 'darwin') {
      try { nomeDaConta = execFileSync('id', ['-F'], { encoding: 'utf8', timeout: 500 }).trim() } catch {}
    }
  }
  return nomeDaConta
}

// Do texto cru ao texto que vai pro campo. Três camadas, cada uma com rede:
//   1. polish: o caminho antigo (dicionário, atalhos de texto, listas). É o
//      resultado garantido e o que vale se a IA falhar.
//   2. limpeza por IA com o contexto (só com chave do Gemini salva).
//   3. ajuste fino com o texto em volta do cursor (maiúscula, espaço, ponto).
// A rede do Chromium (net.fetch) e não a do Node: ela reaproveita a conexão
// aberta pelo aquecerConexao() no começo do ditado.
const fetchDaRede = (url, opcoes) => net.fetch(url, opcoes)

async function prepararTexto(raw) {
  const dicionario = listDictionary()
  const snippets = listSnippets()
  const garantido = polish(raw, { dictionary: dicionario, snippets })
  if (!garantido) return { text: '', colar: '' }
  // Atalho de texto é literal: nem IA nem ajuste mexem nele.
  if (acharSnippet(garantido, snippets) !== null || snippets.some((s) => s.content === garantido)) {
    return { text: garantido, colar: garantido }
  }

  const ctx = await contextoAtual.catch(() => null)
  let text = garantido

  const cfg = lerConfig()
  if (cfg.apiKey && getSetting('limpezaIA', 'true') === 'true') {
    const continua = ctx && ultimoDitado.app === ctx.app && Date.now() - ultimoDitado.em < JANELA_CONTINUIDADE_MS
    const r = await limparTexto({
      fetchFn: fetchDaRede,
      apiKey: cfg.apiKey,
      textoCru: raw,
      contexto: ctx,
      dicionario: dicionario.map((d) => d.replacement || d.term),
      nomeUsuario: nomeUsuario(),
      anterior: continua ? ultimoDitado.texto : ''
    })
    dlog(`limpeza: ${r.motivo} em ${r.ms}ms (app=${ctx?.app || '?'} categoria=${ctx?.categoria || '?'} palavras=${ctx?.palavras?.length ?? 0})`)
    if (r.texto) text = aplicarDicionario(r.texto, dicionario)
  }

  let colar = text
  if (ctx?.leuCampo) {
    const nomes = [...(ctx.palavras || []), ...dicionario.map((d) => d.replacement || d.term), ...nomeUsuario().split(/\s+/)]
    colar = ajustarParaColar(text, {
      antes: ctx.antes,
      depois: ctx.depois,
      selecionado: ctx.selecionado,
      nomesProprios: nomes.filter(Boolean),
      mensagem: ctx.categoria === 'pessoal'
    })
  }
  ultimoDitado = { texto: text, app: ctx?.app || '', em: Date.now() }
  return { text, colar, senha: Boolean(ctx?.senha) }
}

async function entregarTexto(raw, { seq, wasCancelled }) {
  const { text, colar, senha } = await prepararTexto(raw)
  if (!text) { rec.hideAnimated(); return }

  // REGRA DE OURO: salva ANTES de colar
  const targetApp = await appEmFoco
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
    if (wantUndo) { wantUndo = false; await pasteText(colar); rec.hideAnimated() }
    else { pendingUndo = colar; setTimeout(() => { pendingUndo = null }, 6000) }
    return
  }

  // Campo de senha: nunca cola ditado ali. Vira o card com "Copiar Ditado".
  const pasted = senha ? false : await pasteText(colar)
  dlog('paste: targetApp=' + targetApp + ' pasted=' + pasted + (senha ? ' (campo de senha)' : ''))
  if (pasted) {
    // Como no Wispr: colou, a pílula volta direto a ficar parada. O texto
    // aparecendo no campo já é a confirmação.
    rec.hideAnimated()
  } else {
    // Sem campo pra colar (ou campo de senha). Como no Wispr, a pílula vira o
    // cartão "Selecione um campo de texto primeiro"; diferente do Wispr, o
    // texto já vai pro clipboard na hora (pedido do Felipe, 2026-11-17), então
    // o cartão chega dizendo "Copiado!" e basta clicar no campo e dar Cmd+V.
    clipboard.writeText(colar)
    rec.expandResult()
    rec.send('rec:result', { text: colar, pasted: false, copiado: true, senha })
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
    // Se o webm ainda não chegou, ele vai chegar: fica marcado pra descarte.
    descartarWebm = webmPendente === null
    webmPendente = null
    dlog(`gemini entregou ${raw.length} caracteres`)
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
  if (guardado) { processDictation(guardado, { cancelado: wasCancelled }); return }
  webmAtrasadoCancelado = wasCancelled

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

  rec = createRecorderWindow({ mostrarParada: () => getSetting('mostrarPilula', 'true') !== 'false' })
  ckpt('recorder-window')
  await ensureModel()
  ckpt('model')
  whisper = await startWhisperServerWithFallback({ language: getSetting('language', 'pt') })
  ckpt('whisper')

  const machine = createHotkeyMachine({
    // SÍNCRONO DE PROPÓSITO — não coloque `await` aqui dentro.
    //
    // Tudo o que o usuário percebe como "o app abriu" mora nas três últimas
    // linhas. Enquanto o nome do app em foco era aguardado no topo, essas
    // linhas rodavam 100 a 180ms depois do atalho (medido), e um System Events
    // ocupado podia adiá-las indefinidamente — era a causa do popup que não
    // aparecia. Trabalho lento vai para uma promessa aguardada mais tarde
    // (`appEmFoco`), nunca na frente do `rec.show()`.
    onStart: (epoca, modo = 'ptt') => {
      recStartedAt = Date.now()
      webmAtrasadoCancelado = false
      descartarWebm = false
      // O contexto já traz o nome do app; o osascript só roda se ele falhar.
      contextoAtual = capturarContexto({ helperPath: helperPath() })
      if (lerConfig().apiKey && getSetting('limpezaIA', 'true') === 'true') aquecerConexao(fetchDaRede)
      appEmFoco = contextoAtual.then((c) => c?.app || getFrontmostApp()).catch(() => '')
      // Sobra do ditado anterior (troca de motor no meio, erro sem fim) não
      // pode continuar consumindo áudio do novo.
      abortarGemini()
      const motor = escolherMotor() === 'gemini' ? abrirSessaoGemini() : 'local'

      // Guarda de época. Nada acima é assíncrono hoje, mas `escolherMotor()` lê
      // disco e `abrirSessaoGemini()` abre socket: se um dia qualquer um dos
      // dois ceder e virar assíncrono, esta comparação impede que o popup e o
      // microfone subam num ditado que o usuário já cancelou — que é
      // exatamente o bug do toque acidental no Cmd direito.
      if (epoca !== machine.epocaAtual()) { abortarGemini(); return }

      hotkeys.setRecordingState(true)
      rec.show()
      // O payload diz ao renderer se ele deve, além do MediaRecorder de sempre,
      // abrir o AudioWorklet e mandar PCM por rt:audio.
      rec.send('rec:start', { engine: motor, modo })
    },
    // Toque duplo ou Fn+Espaço no meio do ditado: a pílula troca para o modo
    // mãos livres (botões de cancelar e parar dos lados).
    onModo: (modo) => rec.send('rec:modo', modo),
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
  // Opções compartilhadas pelos DOIS pontos que sobem o helper (o boot e a troca
  // de atalho). Enquanto eram literais duplicados, só o primeiro tinha aviso —
  // trocar de atalho deixava o app sem supervisão pelo resto da sessão.
  const opcoesHelper = () => ({
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
    },
    // O helper caiu e não voltou depois das tentativas. A partir daqui NENHUM
    // atalho funciona, e sem este aviso o app fica aberto, com ícone na bandeja,
    // parecendo saudável e sem responder a nada.
    onHelperCaiu: ({ motivo }) => {
      new Notification({
        title: 'Os atalhos do Dita Aí pararam',
        body: 'O componente de teclado caiu e não voltou. Feche e abra o Dita Aí para retomar os atalhos.'
      }).show()
      console.error('helper de atalhos desistiu:', motivo)
    }
  })

  hotkeys = startHotkeys(opcoesHelper())

  ckpt('hotkeys')
  // Durante um ditado remoto o renderer continua gravando o webm de sempre — ele
  // fica guardado como rede de segurança e só vira transcrição local se o
  // Gemini não entregar texto nenhum (ver finalizarGemini).
  ipcMain.on('rec:audio', (_e, buf) => {
    if (bloquearWebm) { webmPendente = buf; return }
    if (descartarWebm) { descartarWebm = false; dlog('webm de reserva descartado (o Gemini já entregou)'); return }
    const cancelado = webmAtrasadoCancelado
    webmAtrasadoCancelado = false
    processDictation(buf, { cancelado })
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
  // Pílula: o ponteiro entrou/saiu (liga o clique só nela) e o clique na
  // pílula parada, que abre um ditado em mãos livres, como no Wispr.
  ipcMain.on('rec:mouse', (_e, dentro) => rec.mouseDentro(!!dentro))
  ipcMain.on('rec:clique-pilula', () => { if (machine.state() === 'idle') machine.handle('toggle') })
  ipcMain.on('rec:finish', () => { dlog('IPC rec:finish state=' + machine.state()); machine.stopExternally() })
  ipcMain.on('rec:cancel-hard', () => {
    dlog('IPC rec:cancel-hard state=' + machine.state())
    if (machine.state() === 'recording') { machine.cancelExternally(); return }

    // Ainda gravando o X para a gravação. Mas quando o popup mostra
    // "Transcrevendo…" a máquina JÁ saiu de 'recording' — o áudio acabou e o
    // whisper está processando. Nesse ponto cancelExternally() não tinha o que
    // cancelar e o botão ficava inerte, que era o sintoma relatado.
    abortedSeq = dictationSeq

    // SEGUNDA CAMADA: solta o microfone incondicionalmente.
    //
    // A guarda de época já impede o estado que tornava este caminho necessário
    // (popup gravando com a máquina em 'idle'), mas o X é o botão de emergência
    // do app — ele não pode depender de o resto estar coerente para funcionar.
    // Qualquer caminho futuro que deixe o renderer gravando sem a máquina saber
    // custaria de novo um microfone aberto até o watchdog de 30 minutos.
    //
    // Canal próprio, e não o `rec:cancel`: aquele também esconde o popup, o que
    // engoliria a tarja "Transcrição cancelada" logo abaixo.
    rec.send('rec:soltar-mic')
    abortarGemini()

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

  // Medidas que o renderer manda (tempo para abrir o microfone etc.) entram
  // no mesmo log de diagnóstico do main.
  ipcMain.on('rec:medida', (_e, texto) => dlog(String(texto).slice(0, 200)))
  nativeTheme.themeSource = TEMA_ELECTRON[getSetting('tema', 'sistema')] || 'system'
  ipcMain.handle('settings:get-all', () => todosAjustes())
  todosAjustesFora = todosAjustes
  function todosAjustes() { return {
    platform: process.platform,
    versao: app.getVersion(),
    tema: getSetting('tema', 'sistema'),
    sons: getSetting('sons', 'true'),
    limpezaIA: getSetting('limpezaIA', 'true'),
    language: getSetting('language', 'pt'),
    micDeviceId: getSetting('micDeviceId', ''),
    openAtLogin: getSetting('openAtLogin', 'true'),
    mostrarPilula: getSetting('mostrarPilula', 'true'),
    popupScale: getSetting('popupScale', 'm'),
    waveColor: getSetting('waveColor', '#F4F2EC'),
    popupBg: getSetting('popupBg', '#221C33'),
    popupRadius: getSetting('popupRadius', '999'),
    toggleShortcut: getSetting('toggleShortcut', DEFAULT_TOGGLE),
    pttShortcut: getSetting('pttShortcut', DEFAULT_PTT),
    transcriptionEngine: getSetting('transcriptionEngine', 'local')
  } }
  ipcMain.handle('settings:set', async (_e, key, value) => {
    if (key === 'language') {
      await restartWhisper(value)
      return
    }
    setSetting(key, value)
    // A pílula guarda os ajustes em memória (o início do ditado não espera
    // IPC); avisa ela da mudança.
    rec?.send('settings:mudou', todosAjustes())
    // Tema claro/escuro/sistema, igual ao do Wispr: o themeSource muda o
    // prefers-color-scheme de todas as janelas, e o tema.css segue sozinho.
    if (key === 'tema') nativeTheme.themeSource = TEMA_ELECTRON[value] || 'system'
    if (key === 'mostrarPilula') { rec?.aplicarParada(); tray?.refazer() }
    if (key === 'openAtLogin' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: value === 'true' })
    }
    if (key === 'toggleShortcut' || key === 'pttShortcut') {
      hotkeys.kill()
      hotkeys = startHotkeys(opcoesHelper())
    }
  })
  ipcMain.handle('history:list', () => listHistory(300))
  ipcMain.handle('history:clear', () => { clearHistory(); tray?.updateLastTranscript(); return true })
  ipcMain.handle('history:delete', (_e, id) => { deleteDictation(id); tray?.updateLastTranscript(); return true })
  // Tela de Início: nome pra saudação + os três números do topo.
  ipcMain.handle('hub:resumo', () => ({ nome: nomeUsuario().split(/\s+/)[0] || '', ...estatisticas() }))
  ipcMain.handle('dict:list', () => listDictionary())
  ipcMain.handle('dict:add', (_e, termo, troca) => addDictionaryWord(termo, troca))
  ipcMain.handle('dict:remove', (_e, id) => { removeDictionaryWord(id); return true })

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
    getMic: () => getSetting('micDeviceId', ''),
    onLanguageChange: restartWhisper,
    onMicChange: (id) => { setSetting('micDeviceId', id || ''); rec?.send('settings:mudou', todosAjustesFora()) },
    onOpen: () => openSettingsWindow(),
    onOpenSettings: () => openSettingsWindow('ajustes'),
    onCopyLast: () => { const t = getLastDictation()?.text; if (t) clipboard.writeText(t) },
    // O menu fecha e o foco volta pro app que estava na frente; a espera curta
    // garante que o Cmd+V caia nele e não no menu ainda fechando.
    onPasteLast: () => { const t = getLastDictation()?.text; if (t) setTimeout(() => pasteText(t), 250) },
    getMostrarPilula: () => getSetting('mostrarPilula', 'true') !== 'false',
    onMostrarPilula: (v) => {
      setSetting('mostrarPilula', String(v))
      rec?.send('settings:mudou', todosAjustes())
      rec?.aplicarParada()
    }
  })
  ipcMain.on('rec:microfones', (_e, lista) => tray.setMicrofones(
    (Array.isArray(lista) ? lista : []).slice(0, 20).map((m) => ({ deviceId: String(m.deviceId || ''), label: String(m.label || '').slice(0, 80) }))
  ))

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
    appEmFoco = Promise.resolve('SmokeTest')
    recStartedAt = Date.now() - 3000
    rec.show()
    await processDictation(readFileSync(webm))
    console.log('SMOKE_RESULT:', JSON.stringify(getLastDictation()))
  }
})

app.on('window-all-closed', () => {})
app.on('will-quit', () => { hotkeys?.kill(); whisper?.kill() })
