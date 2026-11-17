// Log curto do ditado, sempre ligado (antes só existia com DITA_DEBUG, e os
// problemas vistos no uso real não deixavam rastro nenhum). Fica só nesta
// máquina, em ~/Library/Logs/Dita AI/ditado.log, e nunca leva o texto ditado:
// só eventos de tecla, tempos e o nome do app. Passou de 1 MB, o atual vira
// ditado.log.1 e começa outro, então ele nunca cresce sem limite.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const PASTA = process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Logs', 'Dita AI')
  : join(process.env.LOCALAPPDATA || homedir(), 'Dita AI', 'logs')
export const ARQUIVO_LOG = join(PASTA, 'ditado.log')
const LIMITE = 1024 * 1024
let escritas = 0

export function dlog(m) {
  if (process.env.VITEST) return // os testes não sujam o log de verdade
  try {
    if (escritas++ === 0) mkdirSync(PASTA, { recursive: true })
    if (escritas % 200 === 0) {
      try { if (statSync(ARQUIVO_LOG).size > LIMITE) renameSync(ARQUIVO_LOG, ARQUIVO_LOG + '.1') } catch {}
    }
    appendFileSync(ARQUIVO_LOG, new Date().toISOString() + ' ' + m + '\n')
  } catch {}
}
