// Rótulos em português das opções de atalho, por plataforma.
//
// Esta tabela é deliberadamente separada de src/main/defaults.js: lá ficam os
// VALORES, que são contrato de fio com o helper C# (ele faz parse literal de
// --toggle=ctrl+shift+space, --ptt=rctrl); aqui fica só a apresentação, que o
// helper nunca vê. Juntar os dois obrigaria o processo main a carregar texto
// de UI, e traduzir um rótulo viraria mudança no contrato.
//
// O preço da separação é que nada na linguagem impede os dois arquivos de
// divergirem — renomear uma opção só aqui faria a UI gravar um valor que o
// helper ignora, sem erro nenhum. Quem paga esse preço é tests/atalhos.test.js,
// que ancora os valores desta tabela em TOGGLE_OPTIONS/PTT_OPTIONS. É por isso
// que este módulo é .js puro, sem JSX: para ser importável do Vitest sem
// precisar de pipeline de React.
//
// Fn não chega a nenhum hook no Windows, e o Right Alt é o AltGr do teclado
// ABNT2 — por isso as listas divergem em vez de serem traduzidas.
export const ATALHOS = {
  darwin: {
    toggle: [
      ['fn+space', 'Fn + Espaço'],
      ['opt+space', '⌥ Option + Espaço'],
      ['ctrl+space', '⌃ Control + Espaço'],
      ['f5', 'F5']
    ],
    ptt: [
      ['rcmd', '⌘ Command direito'],
      ['ropt', '⌥ Option direito']
    ],
    padraoToggle: 'fn+space',
    padraoPtt: 'rcmd',
    colarUltimo: '⌃⌘V'
  },
  win32: {
    toggle: [
      ['ctrl+shift+space', 'Ctrl + Shift + Espaço'],
      ['ctrl+space', 'Ctrl + Espaço'],
      ['alt+space', 'Alt + Espaço'],
      ['f5', 'F5']
    ],
    // NÃO reintroduzir 'rwin': um toque solto abre o menu Iniciar, e teclas
    // de PTT nunca são suprimidas.
    ptt: [
      ['rctrl', 'Ctrl direito'],
      ['rshift', 'Shift direito'],
      ['ralt', 'Alt direito (AltGr — evite em teclado ABNT2)']
    ],
    padraoToggle: 'ctrl+shift+space',
    padraoPtt: 'rctrl',
    colarUltimo: 'Ctrl+Alt+V'
  }
}
