import { clipboard } from 'electron'
import { execFile } from 'child_process'

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

export async function pasteText(text) {
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
