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

// TOGGLE_OPTIONS/PTT_OPTIONS foram removidos daqui.
//
// No Windows o atalho principal deixou de ser uma escolha entre quatro strings
// e passou a ser uma GRAMÁTICA (modificadores + tecla base, ver
// helper-win/DitaHelper/ShortcutSpec.cs): não existe mais lista para congelar.
// O que sobrou — as opções de push-to-talk e a lista fixa que o macOS ainda
// usa — é apresentação, com rótulo em português colado no valor, e mora em
// src/renderer/src/atalhos.js. Manter meia lista aqui só porque ela existia
// antes deixaria dois lugares dizendo qual é o vocabulário, que é exatamente o
// tipo de divergência silenciosa que este contrato precisa evitar.
