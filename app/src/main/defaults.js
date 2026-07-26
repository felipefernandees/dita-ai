// Defaults de atalho por plataforma. Consumido por index.js e pela UI de
// Preferências (tarefas futuras) e pelo helper C# do Windows, que faz parse
// dos valores literais aqui (ex.: --toggle=ctrl+shift+space, --ptt=rctrl) —
// os valores abaixo são contrato, não apenas conveniência.
const isWin = process.platform === 'win32'

// Windows não entrega a tecla Fn ao WH_KEYBOARD_LL (o firmware do teclado a
// consome), então fn+space não é portável. ctrl+shift+space é o default por
// não colidir com o alternador de IME (ctrl+space) nem com o menu de janela
// (alt+space).
export const DEFAULT_TOGGLE = isWin ? 'ctrl+shift+space' : 'fn+space'

// Right Alt é AltGr em teclado ABNT2 — usá-lo como push-to-talk quebraria
// ç, º e ₢. Right Ctrl é o análogo seguro do Right Command do macOS.
export const DEFAULT_PTT = isWin ? 'rctrl' : 'rcmd'

// Congeladas: são singletons de módulo, e o consumidor previsto é um <select>
// no renderer. Um `.sort()` sem cópia lá corromperia a lista para o processo
// inteiro — inclusive quebrando a invariante "o default está entre as opções".
export const TOGGLE_OPTIONS = Object.freeze(isWin
  ? ['ctrl+shift+space', 'ctrl+space', 'alt+space', 'f5']
  : ['fn+space', 'opt+space', 'ctrl+space', 'f5'])

// 'rwin' não está aqui de propósito: um toque solto na tecla Windows direita
// abre o menu Iniciar toda vez, e teclas de push-to-talk nunca são suprimidas
// (o usuário ainda precisa delas para os atalhos normais) — então rwin é
// inutilizável como PTT. 'ralt' entra no lugar, mas nunca como default: em
// teclado ABNT2 o Right Alt é o AltGr (ç, º, ₢), então só serve para quem
// está num layout US e escolhe deliberadamente.
export const PTT_OPTIONS = Object.freeze(isWin
  ? ['rctrl', 'rshift', 'ralt']
  : ['rcmd', 'ropt'])
