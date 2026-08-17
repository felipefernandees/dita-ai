import { spawn } from 'child_process'
import { appendFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const DEBUG = !!process.env.DITA_DEBUG
const LOG = join(homedir(), 'dita-debug.log')
function dlog(m) { if (DEBUG) { try { appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n') } catch {} } }

const MIN_PTT_MS = 300

// Espera antes de cada nova tentativa de subir o helper. Cresce para não
// martelar um binário que está falhando por motivo permanente (arquivo ausente,
// antivírus em quarentena), e o comprimento do array É o número máximo de
// tentativas antes de desistir e avisar.
const BACKOFF_MS = [250, 500, 1000, 2000, 4000]

// Helper que sobreviveu a isto conta como "estável" e zera o contador. Sem
// isso, um app aberto por semanas somaria cinco quedas espaçadas em meses e
// desistiria de vez sem nunca ter tido um problema real.
const ESTAVEL_MS = 30000

export function createHotkeyMachine({ onStart, onStop, onCancel, now = () => Date.now() }) {
  let state = 'idle' // idle | recording
  let source = null  // toggle | ptt
  let startedAt = 0
  // Numera cada gravação. Quem sai daqui para fazer trabalho ASSÍNCRONO leva a
  // época consigo e a compara com `epocaAtual()` antes de aplicar qualquer
  // efeito — se ela já mudou, aquele ditado acabou (foi cancelado ou concluído)
  // e o efeito precisa ser descartado.
  //
  // Sem isto, encostar no Cmd direito cancelava a máquina enquanto o `onStart`
  // ainda esperava o `getFrontmostApp()`; o osascript respondia depois e ligava
  // o popup e o microfone com o estado já em `idle`. Como o X e o check só
  // agem quando o estado é `recording`, os dois viravam no-op: popup preso na
  // tela, microfone aberto, e nada além do watchdog de 30 minutos para
  // derrubar.
  let epoca = 0

  function start(src) {
    state = 'recording'
    source = src
    startedAt = now()
    epoca++
    onStart(epoca)
  }

  function finish() {
    state = 'idle'
    source = null
    epoca++
    onStop()
  }

  function cancel(reason) {
    state = 'idle'
    source = null
    epoca++
    onCancel(reason)
  }

  return {
    state: () => state,
    epocaAtual: () => epoca,
    // acionados pelos botões do popup (check = finalizar, X = cancelar)
    stopExternally() { if (state === 'recording') finish() },
    cancelExternally(reason = 'button') { if (state === 'recording') cancel(reason) },
    handle(event) {
      if (event === 'toggle') {
        if (state === 'idle') start('toggle')
        else finish()
      } else if (event === 'ptt_down') {
        if (state === 'idle') start('ptt')
      } else if (event === 'ptt_up') {
        if (state === 'recording' && source === 'ptt') {
          if (now() - startedAt < MIN_PTT_MS) cancel('short')
          else finish()
        }
      } else if (event === 'ptt_abort') {
        if (state === 'recording' && source === 'ptt') cancel('abort')
      } else if (event === 'esc') {
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
