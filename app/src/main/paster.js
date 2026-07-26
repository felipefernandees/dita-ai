// Dispatcher de plataforma. Os imports são estáticos de propósito: o
// electron-vite faz bundle do processo main com rollup, que não resolve
// especificador dinâmico. Importar o módulo da outra plataforma é inofensivo
// — cada um só define funções, nada roda no import.
import * as darwin from './paster.darwin.js'
import * as win32 from './paster.win32.js'

const impl = process.platform === 'win32' ? win32 : darwin

export const getFrontmostApp = (...args) => impl.getFrontmostApp(...args)
export const pasteText = (...args) => impl.pasteText(...args)
