import { spawn } from 'child_process'

import { dlog } from './log.js'

// Janela de decisão do Wispr Flow (DICTATION_DEBOUNCE_DELAY no código dele).
// Tudo o que diferencia "segurar", "toque duplo" e "toque triplo" sai deste
// número só, e ele é o mesmo nas três decisões de propósito: a sensação de
// "é igual ao Wispr" depende de os três tempos baterem com o que a mão já
// aprendeu lá.
export const DEBOUNCE_MS = 500

// Espera antes de cada nova tentativa de subir o helper. Cresce para não
// martelar um binário que está falhando por motivo permanente (arquivo ausente,
// antivírus em quarentena), e o comprimento do array É o número máximo de
// tentativas antes de desistir e avisar.
const BACKOFF_MS = [250, 500, 1000, 2000, 4000]

// Helper que sobreviveu a isto conta como "estável" e zera o contador. Sem
// isso, um app aberto por semanas somaria cinco quedas espaçadas em meses e
// desistiria de vez sem nunca ter tido um problema real.
const ESTAVEL_MS = 30000

// A máquina de estados do ditado, no comportamento do Wispr Flow:
//
//   Fn segurada por 500 ms ou mais e solta  → encerra e processa
//   Fn tocada rápido (menos de 500 ms)      → espera 500 ms por um 2º toque
//       2º toque chegou                     → TRAVA em mãos livres
//       não chegou                          → descarta, sem colar nada
//   travado + novo toque                    → encerra e processa
//   travado + toque em menos de 500 ms      → cancela (é o toque triplo)
//   Fn + Espaço                             → trava direto (de parado ou segurando)
//   Esc                                     → cancela
//
// O helper só relata o que a tecla fez (ptt_down, ptt_up, ptt_abort, toggle,
// esc). Decidir o que aquilo SIGNIFICA mora aqui, num lugar só e testável sem
// teclado: `agendar`/`desagendar` e `now` são injetáveis.
export function createHotkeyMachine({
  onStart,
  onStop,
  onCancel,
  onModo = () => {},
  now = () => Date.now(),
  agendar = setTimeout,
  desagendar = clearTimeout
}) {
  let state = 'idle'   // idle | recording
  let fase = null      // segurando | esperandoSegundo | travado
  let pttDesde = 0
  let travadoEm = 0
  let timer = null
  // O toque que travou ainda vai soltar a tecla: esse ptt_up não é um pedido.
  let ignorarProximoUp = false
  // Fn+Espaço chega como ptt_down, toggle e ptt_abort. Quando o ptt_down já
  // resolveu (encerrou o ditado travado), o toggle que vem colado nele não
  // pode abrir um ditado novo.
  let ignorarToggleAteSoltar = false
  // Em mãos livres a tecla de falar encerra o ditado, mas só num toque LIMPO:
  // apertou e soltou sem outra tecla no meio. Visto em 2026-11-17 com o ⌘
  // direito: o Felipe tirou um print (⌘⇧4) no meio do ditado e o ⌘ do atalho
  // encerrou tudo. Por isso a decisão espera o ptt_up; um ptt_abort (houve
  // outra tecla junto) mantém o ditado aberto.
  let encerrarNoUp = false
  let downTravadoEm = 0
  // Numera cada gravação. Quem sai daqui para fazer trabalho ASSÍNCRONO leva a
  // época consigo e a compara com `epocaAtual()` antes de aplicar qualquer
  // efeito: se ela já mudou, aquele ditado acabou e o efeito é descartado.
  // Sem isto um toque curto cancelava a máquina enquanto o `onStart` ainda
  // esperava resposta, e o popup subia num ditado que já não existia.
  let epoca = 0

  function limparTimer() { if (timer) { desagendar(timer); timer = null } }

  function start(modo) {
    encerrarNoUp = false
    state = 'recording'
    fase = modo === 'travado' ? 'travado' : 'segurando'
    pttDesde = now()
    travadoEm = pttDesde
    ignorarProximoUp = false
    epoca++
    onStart(epoca, modo)
  }

  function travar() {
    limparTimer()
    fase = 'travado'
    travadoEm = now()
    onModo('travado')
  }

  function finish() {
    limparTimer()
    state = 'idle'
    fase = null
    epoca++
    onStop()
  }

  function cancel(reason) {
    limparTimer()
    state = 'idle'
    fase = null
    epoca++
    onCancel(reason)
  }

  return {
    state: () => state,
    modo: () => (fase === 'travado' ? 'travado' : 'ptt'),
    epocaAtual: () => epoca,
    // acionados pelos botões da pílula (parar = finalizar, X = cancelar)
    stopExternally() { if (state === 'recording') finish() },
    cancelExternally(reason = 'button') { if (state === 'recording') cancel(reason) },
    handle(event) {
      if (event === 'ptt_down') {
        if (state === 'idle') { start('ptt'); return }
        if (fase === 'esperandoSegundo') { travar(); ignorarProximoUp = true; return }
        if (fase === 'travado') {
          ignorarToggleAteSoltar = true
          ignorarProximoUp = false
          encerrarNoUp = true
          downTravadoEm = now()
        }
        return
      }
      if (event === 'ptt_up' || event === 'ptt_abort') {
        ignorarToggleAteSoltar = false
        if (state !== 'recording') return
        if (encerrarNoUp) {
          encerrarNoUp = false
          if (event === 'ptt_abort') return // era um atalho (⌘⇧4, ⌘C): segue ditando
          if (downTravadoEm - travadoEm < DEBOUNCE_MS) cancel('triplo')
          else finish()
          return
        }
        if (ignorarProximoUp) { ignorarProximoUp = false; return }
        if (fase !== 'segurando') return
        // Atalho com a tecla de falar (⌘C, ⌘⇧4). Logo no começo é atalho mesmo
        // e descarta; depois de 500 ms segurando, a pessoa já estava ditando e
        // a fala não pode se perder: encerra e cola como num soltar normal.
        if (event === 'ptt_abort') {
          if (now() - pttDesde >= DEBOUNCE_MS) finish()
          else cancel('abort')
          return
        }
        if (now() - pttDesde >= DEBOUNCE_MS) { finish(); return }
        // Toque curto: o ditado continua aberto esperando o segundo toque.
        // Sem ele, é toque acidental e nada é colado.
        fase = 'esperandoSegundo'
        const minhaEpoca = epoca
        timer = agendar(() => {
          timer = null
          if (epoca === minhaEpoca && fase === 'esperandoSegundo') cancel('short')
        }, DEBOUNCE_MS)
        return
      }
      if (event === 'toggle') {
        // Fn+Espaço em mãos livres com a Fn sendo a tecla de falar: chega
        // ptt_down e toggle juntos, e o toggle é quem encerra.
        if (encerrarNoUp) { encerrarNoUp = false; finish(); return }
        if (ignorarToggleAteSoltar) return
        if (state === 'idle') { start('travado'); return }
        if (fase === 'segurando' || fase === 'esperandoSegundo') { travar(); ignorarProximoUp = true; return }
        finish()
        return
      }
      if (event === 'esc') {
        if (state === 'recording') cancel('esc')
      }
    }
  }
}

/**
 * Sobe o helper de teclado e MANTÉM ELE VIVO.
 *
 * POR QUE ISTO PRECISA DE SUPERVISÃO
 *
 * O helper é o único caminho dos atalhos globais. A versão anterior fazia
 * `spawn` e escutava só o stdout: se o processo morresse — crash, antivírus, ou
 * o próprio Windows desregistrando o hook por estouro do LowLevelHooksTimeout —
 * nada percebia. A janela continuava, o ícone da bandeja continuava, e os
 * atalhos simplesmente paravam de responder. Sem log, sem aviso, sem jeito de o
 * usuário saber o que aconteceu.
 *
 * Silêncio é o pior comportamento possível aqui, porque o sintoma ("o app está
 * aberto e não faz nada") é indistinguível de tudo funcionando.
 *
 * Faltava também listener de 'error'. `spawn` emite esse evento de forma
 * ASSÍNCRONA quando o binário não existe ou não pode ser executado, e um
 * 'error' sem listener é exceção não tratada: derrubava o processo main inteiro
 * em vez de virar uma falha reportável.
 *
 * `spawnFn`, `agendar` e `agora` são injetáveis para o teste exercitar queda,
 * backoff e desistência sem um helper de verdade e sem esperar tempo real.
 */
export function startHotkeys({
  helperPath,
  args = [],
  machine,
  onNoPermission = () => {},
  onHelperCaiu = () => {},
  onHelperVoltou = () => {},
  spawnFn = spawn,
  agendar = setTimeout,
  agora = () => Date.now()
} = {}) {
  let proc = null
  let encerrando = false   // kill() pedido pelo app: não reiniciar
  let tentativas = 0
  let iniciadoEm = 0
  let gravando = false     // último estado enviado, reaplicado no restart

  function conectar() {
    let buffer = ''
    iniciadoEm = agora()

    // windowsHide: o helper é um app de CONSOLE (precisa ser: o contrato com ele
    // é JSON no stdout). Sem isto o Windows abre uma janela de prompt junto com o
    // app e ela fica lá o tempo todo. No macOS a opção é ignorada.
    const filho = spawnFn(helperPath, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
    proc = filho

    filho.stdout?.on('data', (chunk) => {
      buffer += chunk.toString()
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        try {
          const { event } = JSON.parse(line)
          dlog('helper event: ' + event + ' (state=' + machine.state() + ')')
          if (event === 'no_permission') onNoPermission()
          else if (event !== 'ready' && event !== 'combo') machine.handle(event)
        } catch { dlog('linha inválida do helper: ' + line) }
      }
    })

    // Os dois caminhos de morte terminam no mesmo lugar. 'error' cobre o binário
    // que nem chegou a executar; 'exit' cobre o que morreu depois.
    filho.on('error', (err) => caiu(`erro ao executar: ${err.message}`))
    filho.on('exit', (code, signal) => caiu(`saiu com código ${code}${signal ? ` (sinal ${signal})` : ''}`))
  }

  function caiu(motivo) {
    if (encerrando) return
    // 'error' e 'exit' podem chegar os DOIS para a mesma morte. Sem esta guarda,
    // um único crash consumiria duas tentativas do backoff.
    if (proc === null) return
    proc = null

    dlog(`helper caiu: ${motivo}`)

    // Um helper que ficou de pé tempo suficiente não conta para o limite: a
    // queda de agora é incidente novo, não continuação de uma sequência.
    if (agora() - iniciadoEm >= ESTAVEL_MS) tentativas = 0

    // Gravação em curso morre junto: o usuário estava falando e agora não tem
    // como encerrar pelo atalho — ficaria preso num ditado que nunca termina.
    //
    // CANCELA em vez de finalizar, de propósito. A fala foi cortada no meio por
    // um crash, não concluída pelo usuário. Finalizar colaria uma frase truncada
    // no documento onde o cursor está — e a colagem NÃO depende deste processo
    // (paster.win32.js sobe um helper efêmero próprio), então ela aconteceria de
    // verdade. Texto truncado num documento não tem desfazer; perder alguns
    // segundos de fala é só repetir.
    if (machine.state() === 'recording') machine.cancelExternally('helper_caiu')

    const espera = BACKOFF_MS[tentativas]
    if (espera === undefined) {
      dlog(`helper desistiu após ${tentativas} tentativas`)
      onHelperCaiu({ motivo, tentativas })
      return
    }

    tentativas++
    agendar(() => {
      if (encerrando) return
      dlog(`reiniciando helper (tentativa ${tentativas})`)
      conectar()
      // O helper novo nasce sem saber que o app estava no meio de um ditado.
      if (gravando) enviarEstado(gravando)
      onHelperVoltou({ tentativa: tentativas })
    }, espera)
  }

  function enviarEstado(on) {
    try { proc?.stdin?.write(`state ${on ? 'on' : 'off'}\n`) } catch { /* helper morto */ }
  }

  conectar()

  return {
    setRecordingState(on) {
      gravando = !!on
      enviarEstado(gravando)
    },
    kill() {
      encerrando = true
      const atual = proc
      proc = null
      try { atual?.kill() } catch { /* já morto */ }
    },
    // diagnóstico e teste
    vivo: () => proc !== null,
    tentativas: () => tentativas
  }
}
