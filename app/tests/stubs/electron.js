// Stub mínimo do módulo 'electron' pros testes. Sob ELECTRON_RUN_AS_NODE
// (como a suíte roda) 'electron' resolveria pra uma string de caminho; este
// arquivo substitui isso via alias em vitest.config.js.
//
// Por que Proxy em vez de simplesmente não exportar o resto: testamos e
// confirmamos que um `import { X } from 'electron'` cujo nome não existe
// aqui não dá erro nenhum sob o transform de import do Vite/vitest — vira
// `undefined` em silêncio, sem warning. Então qualquer código novo em
// src/main/ que passasse a usar uma API do electron ainda não mockada aqui
// passaria pela suíte inteira e só quebraria de verdade rodando o app
// empacotado de verdade.
//
// A lista abaixo cobre TODOS os nomes que hoje aparecem em algum
// `import ... from 'electron'` dentro de src/main e src/preload (Notification,
// systemPreferences, BrowserWindow, Tray, Menu, nativeImage, globalShortcut,
// ipcMain, screen, contextBridge, ipcRenderer). Cada um vira um Proxy que
// explode assim que ALGUÉM tenta usá-lo de verdade — ler uma propriedade,
// chamar como função, dar `new` — nomeando exatamente qual API faltou.
//
// Limite conhecido: um `import` de um nome que nem está nesta lista ainda
// vira `undefined` silencioso (é o próprio transform do Vite que resolve
// assim, não tem trap de Proxy que alcance isso). Se isso acontecer, é sinal
// de que um arquivo novo passou a importar algo do electron — adicione o
// nome à lista abaixo.
function naoMockado(nome) {
  const mensagem = `tests/stubs/electron.js: '${nome}' do electron não está mockado — ` +
    'adicione um stub de verdade antes de testar código que o usa'
  function explode() { throw new Error(mensagem) }
  return new Proxy(explode, {
    get(_target, prop) {
      // Symbol.toPrimitive/toStringTag etc. podem ser lidos por engano em
      // formatação de erro/log; deixamos passar em silêncio só pra esses,
      // qualquer uso "de verdade" (uma propriedade normal) ainda explode.
      if (typeof prop === 'symbol') return undefined
      explode()
    },
    apply() { explode() },
    construct() { explode() }
  })
}

let texto = ''
export const clipboard = {
  readText: () => texto,
  writeText: (t) => { texto = String(t) }
}
export const app = { isPackaged: false, getPath: () => '' }

export const ipcMain = naoMockado('ipcMain')
export const systemPreferences = naoMockado('systemPreferences')
export const Notification = naoMockado('Notification')
export const Tray = naoMockado('Tray')
export const Menu = naoMockado('Menu')
export const nativeImage = naoMockado('nativeImage')
export const globalShortcut = naoMockado('globalShortcut')
export const BrowserWindow = naoMockado('BrowserWindow')
export const screen = naoMockado('screen')
export const contextBridge = naoMockado('contextBridge')
export const ipcRenderer = naoMockado('ipcRenderer')

export default {
  clipboard, app, ipcMain, systemPreferences, Notification, Tray, Menu,
  nativeImage, globalShortcut, BrowserWindow, screen, contextBridge, ipcRenderer
}
