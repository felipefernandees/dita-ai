import { clipboard } from 'electron'
import { execFile, spawn } from 'child_process'
import { helperPath } from './helper-path.js'

// POR QUE ESTAS CHAMADAS PRECISAM DE PRAZO
//
// O `osascript` conversa com o System Events, que é um processo de fora do nosso
// controle: ele pode estar ocupado, esperando o usuário responder o prompt de
// permissão de Automação, ou simplesmente travado. Sem prazo, a promessa nunca
// assenta — e `getFrontmostApp` é esperado no `onStart` do ditado ANTES de o
// popup aparecer. O sintoma seria o pior possível: o usuário aperta o atalho,
// fala, e nada acontece na tela, sem erro nenhum.
//
// Passado o prazo, o processo é MORTO e a falha vira o mesmo `catch` que já
// existia. Perder o nome do app em foco custa o registro de onde o ditado foi
// colado; travar o ditado custa o ditado.
//
// SIGKILL, não o SIGTERM padrão: um osascript preso esperando resposta do
// System Events ignora o TERM e continuaria vivo depois do prazo.
const LIMITE_FRONTMOST_MS = 1500

// A colagem tem prazo mais folgado por ser a operação que o usuário está
// esperando de verdade: só existe para não deixar um processo pendurado para
// sempre num app que ficou surdo ao Apple Event.
const LIMITE_PASTE_MS = 5000

function osascript(script, limite) {
  return new Promise((resolve, reject) => {
    // DITA_OSASCRIPT existe para o teste conseguir apontar para um binário que
    // trava de propósito — é assim que o prazo acima é exercitado de verdade,
    // em vez de no papel.
    execFile(
      process.env.DITA_OSASCRIPT || 'osascript',
      ['-e', script],
      { timeout: limite, killSignal: 'SIGKILL' },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))
    )
  })
}

export async function getFrontmostApp() {
  try {
    return await osascript(
      'tell application "System Events" to get name of first process whose frontmost is true',
      LIMITE_FRONTMOST_MS
    )
  } catch { return '' }
}

// Colagem pelo helper nativo (`dita-hotkeys colar`): o texto vai pelo stdin,
// o helper põe no clipboard, manda Cmd+V direto pro sistema e depois devolve o
// clipboard ORIGINAL inteiro (imagem, arquivo, rich text). Pelo osascript eram
// 100 a 180 ms só pra falar com o System Events, e a restauração era só de
// texto puro: quem tinha copiado uma imagem perdia a imagem.
//
// Resolve true quando o helper confirma o Cmd+V, false em qualquer falha, e
// nunca espera a restauração (o helper sai sozinho depois dela).
const LIMITE_HELPER_MS = 1500

export function colarViaHelper(text, { binario = helperPath(), spawnFn = spawn, limite = LIMITE_HELPER_MS } = {}) {
  return new Promise((resolve) => {
    let feito = false
    let saida = ''
    const fim = (ok) => { if (!feito) { feito = true; clearTimeout(timer); resolve(ok) } }
    let filho
    try {
      filho = spawnFn(binario, ['colar'], { stdio: ['pipe', 'pipe', 'ignore'] })
    } catch { resolve(false); return }
    const timer = setTimeout(() => { try { filho.kill('SIGKILL') } catch {} ; fim(false) }, limite)
    filho.stdout?.on('data', (c) => {
      saida += c.toString()
      if (saida.includes('"colado"')) fim(true)
      else if (saida.includes('"erro"')) fim(false)
    })
    filho.on('error', () => fim(false))
    filho.on('close', () => fim(false))
    try { filho.stdin.end(text) } catch { fim(false) }
  })
}

export async function pasteText(text) {
  // DITA_OSASCRIPT é a porta dos testes para o caminho antigo; sem ela, o
  // helper nativo vem primeiro e o osascript fica de reserva.
  if (!process.env.DITA_OSASCRIPT && await colarViaHelper(text)) return true
  return pasteViaOsascript(text)
}

async function pasteViaOsascript(text) {
  const previous = clipboard.readText()
  clipboard.writeText(text)
  try {
    await osascript('tell application "System Events" to keystroke "v" using command down', LIMITE_PASTE_MS)
  } catch {
    return false // sem permissão de acessibilidade, keystroke falhou ou estourou o prazo
  }
  // restaura o clipboard do usuário depois que o paste assentou
  setTimeout(() => {
    if (clipboard.readText() === text && previous) clipboard.writeText(previous)
  }, 400)
  return true
}
