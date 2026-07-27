// Vocabulário de atalhos do lado do renderer.
//
// Este arquivo é o ESPELHO EM JS de helper-win/DitaHelper/ShortcutSpec.cs. Lá o
// helper faz o parse de --toggle=<spec> --ptt=<spec>; aqui a UI monta a mesma
// string a partir de um KeyboardEvent e explica em português por que uma
// combinação foi recusada. As duas implementações precisam concordar sobre
// quais tokens existem e quais combinações são válidas.
//
// Nada na linguagem impede que divirjam, e a divergência é silenciosa: a UI
// grava um spec, o helper não reconhece, cai no default e o usuário só percebe
// que "o atalho não pegou". Quem paga esse preço são dois testes —
// tests/atalhos.test.js (o que dá para verificar só em JS) e o cenário `parse`
// de tests/helper-win.emit.test.js, que alimenta os MESMOS specs no
// ShortcutSpec.cs de verdade e compara os dois veredictos. É por isso que este
// módulo é .js puro, sem JSX: para ser importável do Vitest sem pipeline de
// React.
//
// Formato: tokens minúsculos unidos por '+', zero ou mais modificadores nesta
// ordem exata, seguidos de exatamente uma tecla base. Ex.: 'ctrl+shift+space'.
export const MODIFICADORES = ['ctrl', 'alt', 'shift', 'win']

const ROTULO_MODIFICADOR = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', win: 'Win' }

// KeyboardEvent.code -> token do spec.
//
// A chave é o `code` (posição física) e nunca o `key` (caractere produzido):
// os VK_* do Windows também são posicionais, então gravar pelo caractere faria
// o mesmo atalho apontar para teclas diferentes conforme o layout ativo no
// momento da gravação. É por isso que as teclas OEM têm nome de legenda US
// ('semicolon') mesmo com rótulo de ABNT2 ('Ç') logo abaixo.
export const TECLAS_BASE = montarTeclas()

// Os tokens são únicos por construção (nenhuma posição física compartilha nome
// com outra), então o Set tem o mesmo tamanho da tabela.
const TOKENS_BASE = new Set(Object.values(TECLAS_BASE))

function montarTeclas() {
  const t = {}
  for (let i = 0; i < 26; i++) t[`Key${String.fromCharCode(65 + i)}`] = String.fromCharCode(97 + i)
  for (let i = 0; i <= 9; i++) t[`Digit${i}`] = String(i)
  for (let i = 1; i <= 24; i++) t[`F${i}`] = `f${i}`

  Object.assign(t, {
    Space: 'space',
    Enter: 'enter',
    Tab: 'tab',
    Escape: 'esc',
    Backspace: 'backspace',
    Insert: 'insert',
    Delete: 'delete',
    Home: 'home',
    End: 'end',
    PageUp: 'pageup',
    PageDown: 'pagedown',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',

    // OEM. O rótulo entre parênteses é a legenda ABNT2 daquela posição.
    Semicolon: 'semicolon',        // Ç
    Slash: 'slash',                // ; :
    Backquote: 'backquote',        // ' "
    BracketLeft: 'bracketleft',    // ´ ` (tecla morta)
    Backslash: 'backslash',        // ] }
    BracketRight: 'bracketright',  // [ {
    Quote: 'quote',                // ~ ^ (tecla morta)
    Minus: 'minus',                // - _
    Equal: 'equal',                // = +
    Comma: 'comma',                // , <
    Period: 'period',              // . >
    IntlBackslash: 'intlbackslash', // \ | (tecla extra ISO)
    IntlRo: 'intlro'               // / ? (tecla extra do ABNT2)
  })
  return t
}

// token -> rótulo mostrado no botão de atalho. As teclas OEM são rotuladas com
// a legenda do ABNT2, que é o teclado do usuário — 'semicolon' não diz nada a
// quem tem um Ç impresso ali.
const ROTULO_BASE = {
  space: 'Espaço',
  enter: 'Enter',
  tab: 'Tab',
  esc: 'Esc',
  backspace: 'Backspace',
  insert: 'Insert',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  semicolon: 'Ç',
  slash: ';',
  backquote: "'",
  bracketleft: '´',
  backslash: ']',
  bracketright: '[',
  quote: '~',
  minus: '-',
  equal: '=',
  comma: ',',
  period: '.',
  intlbackslash: '\\',
  intlro: '/'
}

// Só teclas de função valem sozinhas. Qualquer outra base sem modificador seria
// suprimida pelo hook no sistema inteiro: configurar 'j' faria a letra J parar
// de funcionar em todos os programas — inclusive no campo onde o usuário
// tentaria desfazer.
export function podeFicarSozinha(token) {
  return /^f([1-9]|1\d|2[0-4])$/.test(token)
}

// Combinações que o sistema operacional reserva. Não é preciosismo: o hook
// low-level nem vê ctrl+alt+delete (o SAS é tratado antes, em kernel) nem
// win+l (bloqueio de sessão), então esses atalhos nunca disparariam. alt+f4 e
// alt+tab o hook vê, mas suprimi-las quebraria fechar e alternar janela no
// sistema inteiro.
export const RESERVADAS = ['alt+f4', 'alt+tab', 'ctrl+alt+delete', 'win+l']

// Motivos espelham o enum MotivoRecusa do ShortcutSpec.cs — mesmos nomes de
// propósito, para os dois testes poderem comparar veredicto com veredicto.
const MENSAGENS = {
  Vazio: 'Combinação vazia.',
  TokenDesconhecido: 'Essa tecla não pode ser usada em atalhos.',
  SemBase: 'Falta a tecla principal: segure os modificadores e aperte uma tecla comum.',
  BaseDuplicada: 'Um atalho só pode ter uma tecla principal.',
  ModificadorRepetido: 'Modificador repetido na combinação.',
  PrecisaModificador:
    'Sozinha, essa tecla deixaria de funcionar em todos os programas. Junte Ctrl, Alt, Shift ou Win — ou use uma tecla de função (F1 a F24), que pode ficar sozinha.',
  Reservada: 'O Windows reserva essa combinação para o sistema: o atalho nunca chegaria ao Dita Aí.'
}

function recusa(motivo) {
  return { ok: false, motivo, mensagem: MENSAGENS[motivo] }
}

// Valida e canonicaliza um spec já em texto. Aceita ordem trocada de
// modificadores (o helper também aceita) e devolve sempre a forma canônica —
// entre outras coisas para que 'f4+alt' não escape do filtro de reservadas.
export function validarToggle(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return recusa('Vazio')

  const mods = { ctrl: false, alt: false, shift: false, win: false }
  let base = null

  for (const parte of spec.trim().toLowerCase().split('+')) {
    if (parte === '') return recusa('Vazio')
    if (parte in mods) {
      if (mods[parte]) return recusa('ModificadorRepetido')
      mods[parte] = true
      continue
    }
    if (!TOKENS_BASE.has(parte)) return recusa('TokenDesconhecido')
    if (base !== null) return recusa('BaseDuplicada')
    base = parte
  }

  if (base === null) return recusa('SemBase')

  const usados = MODIFICADORES.filter((m) => mods[m])
  if (usados.length === 0 && !podeFicarSozinha(base)) return recusa('PrecisaModificador')

  const canonico = [...usados, base].join('+')
  if (RESERVADAS.includes(canonico)) return recusa('Reservada')

  return { ok: true, spec: canonico }
}

// Traduz o que o usuário acabou de apertar. Devolve { pendente: true } enquanto
// só houver modificadores segurados: durante a captura isso é o estado normal,
// não um erro — o usuário está no meio da combinação.
//
// Atenção ao AltGr do ABNT2: o Chromium reporta ctrlKey E altKey nele, porque é
// literalmente o que o Windows entrega. Não dá para distinguir de um Ctrl+Alt
// de verdade, então AltGr+tecla vira 'ctrl+alt+tecla' — que é o atalho que o
// helper vai de fato escutar, então a UI não está mentindo.
export function specDeEvento(e) {
  const base = TECLAS_BASE[e.code]
  if (base === undefined) {
    // Modificadores puros (ControlLeft, AltRight, ShiftLeft, MetaLeft…) e
    // CapsLock não estão na tabela: a combinação ainda não terminou.
    if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(e.code) || e.code === 'CapsLock') {
      return { pendente: true }
    }
    return recusa('TokenDesconhecido')
  }

  const mods = []
  if (e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey) mods.push('shift')
  if (e.metaKey) mods.push('win')

  return validarToggle([...mods, base].join('+'))
}

// Aviso NÃO-bloqueante: a combinação funciona, mas tem um efeito colateral que
// o usuário merece saber antes de gravar.
export function avisoToggle(spec) {
  const r = validarToggle(spec)
  if (!r.ok) return null
  if (r.spec.startsWith('win+') || r.spec.includes('+win+')) {
    // O hook engole a tecla base, então o shell vê a tecla Windows como se
    // tivesse sido apertada sozinha e abre o menu Iniciar ao soltá-la.
    return 'A tecla Windows abre o menu Iniciar ao ser solta — o atalho funciona, mas o menu aparece junto.'
  }
  return null
}

// 'ctrl+shift+space' -> 'Ctrl + Shift + Espaço'
export function rotuloToggle(spec) {
  const r = validarToggle(spec)
  // Spec inválido (ex.: um valor de macOS num settings.json copiado): mostra o
  // texto cru em vez de inventar um rótulo bonito para algo que não vai valer.
  if (!r.ok) return spec || '—'
  return r.spec
    .split('+')
    .map((p) => ROTULO_MODIFICADOR[p] || ROTULO_BASE[p] || p.toUpperCase())
    .join(' + ')
}

// --- push-to-talk -----------------------------------------------------------
//
// PTT é sempre UM modificador segurado, nunca uma combinação: segurar
// 'ctrl+shift' para falar exigiria duas mãos e travaria os dois modificadores
// durante todo o ditado. Por isso continua sendo uma lista de botões, e não uma
// captura — a captura seria uma promessa falsa.
//
// NÃO reintroduzir 'rwin'/'lwin': um toque solto abre o menu Iniciar, e teclas
// de PTT nunca são suprimidas (o usuário ainda precisa delas para os atalhos
// normais do sistema).
const PTT_WIN32 = [
  ['rctrl', 'Ctrl direito'],
  ['lctrl', 'Ctrl esquerdo'],
  ['rshift', 'Shift direito'],
  ['lshift', 'Shift esquerdo'],
  ['ralt', 'Alt direito', 'É o AltGr do teclado ABNT2 — usar como PTT atrapalha ç, º e ₢.'],
  ['lalt', 'Alt esquerdo', 'Soltar o Alt sozinho ativa a barra de menus do programa em foco.']
]

export const ATALHOS = {
  darwin: {
    // No macOS quem faz o parse é o helper em Swift, que continua com uma lista
    // fixa — a gramática de specs deste arquivo é do helper do Windows. Por
    // isso lá a UI segue sendo um <select>.
    capturaToggle: false,
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
  },
  win32: {
    capturaToggle: true,
    toggle: null,
    ptt: PTT_WIN32,
    padraoToggle: 'ctrl+shift+space',
    padraoPtt: 'rctrl',
  }
}
