// Vocabulário de atalhos do lado do renderer.
//
// Este arquivo é o ESPELHO EM JS dos dois parsers nativos:
// helper-win/DitaHelper/ShortcutSpec.cs (C#) e helper/ShortcutSpec.swift. Lá o
// helper faz o parse de --toggle=<spec> --ptt=<spec>; aqui a UI monta a mesma
// string a partir de um KeyboardEvent e explica em português por que uma
// combinação foi recusada. As três implementações precisam concordar sobre
// quais tokens existem e quais combinações são válidas.
//
// Nada na linguagem impede que divirjam, e a divergência é silenciosa: a UI
// grava um spec, o helper não reconhece, cai no default e o usuário só percebe
// que "o atalho não pegou". Quem paga esse preço são três testes —
// tests/atalhos.test.js (o que dá para verificar só em JS), o cenário `parse`
// de tests/helper-win.emit.test.js e tests/helper-mac.parse.test.js, que
// alimentam os MESMOS specs nos parsers nativos de verdade e comparam os
// veredictos. É por isso que este módulo é .js puro, sem JSX: para ser
// importável do Vitest sem pipeline de React.
//
// POR QUE A GRAMÁTICA É POR PLATAFORMA
//
// O formato é o mesmo nas duas (tokens minúsculos unidos por '+', zero ou mais
// modificadores na ordem canônica, seguidos de exatamente uma tecla base), mas
// o VOCABULÁRIO não pode ser: o Windows tem a tecla Windows e não entrega a Fn
// ao hook; o macOS tem Command e Option, entrega a Fn, e não tem Insert. Uma
// tabela só, com a união de tudo, deixaria a UI oferecer 'win+j' num Mac e
// 'cmd+j' num PC — atalhos que o helper daquela máquina jamais escutaria.
//
// Toda função pública recebe a plataforma explicitamente. Não existe default:
// no renderer não há `process.platform` (contextIsolation), a plataforma chega
// do processo main pelo IPC, e um default aqui seria a gramática errada
// escolhida em silêncio.

// --- tabelas de teclas base -------------------------------------------------
//
// KeyboardEvent.code -> token do spec.
//
// A chave é o `code` (posição física) e nunca o `key` (caractere produzido):
// tanto os VK_* do Windows quanto os virtual keycodes do macOS são posicionais,
// então gravar pelo caractere faria o mesmo atalho apontar para teclas
// diferentes conforme o layout ativo no momento da gravação. É por isso que as
// teclas OEM têm nome de legenda US ('semicolon') mesmo com rótulo de ABNT2
// ('Ç') logo abaixo.
function teclasComuns() {
  const t = {}
  for (let i = 0; i < 26; i++) t[`Key${String.fromCharCode(65 + i)}`] = String.fromCharCode(97 + i)
  for (let i = 0; i <= 9; i++) t[`Digit${i}`] = String(i)

  Object.assign(t, {
    Space: 'space',
    Enter: 'enter',
    Tab: 'tab',
    Escape: 'esc',
    Backspace: 'backspace',
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
    IntlRo: 'intlro'               // / ? (tecla extra do ABNT2/JIS)
  })
  return t
}

function teclasWin() {
  const t = teclasComuns()
  for (let i = 1; i <= 24; i++) t[`F${i}`] = `f${i}`
  t.Insert = 'insert'  // teclado de PC tem; o da Apple não
  return t
}

function teclasMac() {
  const t = teclasComuns()
  // O macOS só tem virtual keycode até F20. F21-F24 existiriam no spec mas
  // nunca casariam com tecla nenhuma — oferecer seria prometer o que o helper
  // não consegue escutar.
  for (let i = 1; i <= 20; i++) t[`F${i}`] = `f${i}`
  return t
}

const ROTULOS_BASE_COMUNS = {
  space: 'Espaço',
  enter: 'Enter',
  tab: 'Tab',
  esc: 'Esc',
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

// --- as duas gramáticas -----------------------------------------------------

const GRAMATICA_WIN32 = {
  modificadores: ['ctrl', 'alt', 'shift', 'win'],
  // Nada a traduzir: os tokens do Windows já são os nomes das teclas.
  aliases: {},
  rotulosModificador: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', win: 'Win' },
  teclas: teclasWin(),
  rotulosBase: {
    ...ROTULOS_BASE_COMUNS,
    backspace: 'Backspace',
    insert: 'Insert',
    delete: 'Delete'
  },
  // Máximo de tecla de função que existe no vocabulário desta plataforma.
  maxTeclaDeFuncao: 24,
  // Combinações que o sistema operacional reserva. Não é preciosismo: o hook
  // low-level nem vê ctrl+alt+delete (o SAS é tratado antes, em kernel) nem
  // win+l (bloqueio de sessão), então esses atalhos nunca disparariam. alt+f4 e
  // alt+tab o hook vê, mas suprimi-las quebraria fechar e alternar janela no
  // sistema inteiro.
  reservadas: ['alt+f4', 'alt+tab', 'ctrl+alt+delete', 'win+l'],
  // KeyboardEvent -> modificadores. O Chromium reporta a tecla Windows como
  // metaKey.
  modificadoresDoEvento: (e) => {
    const mods = []
    if (e.ctrlKey) mods.push('ctrl')
    if (e.altKey) mods.push('alt')
    if (e.shiftKey) mods.push('shift')
    if (e.metaKey) mods.push('win')
    return mods
  },
  frases: {
    Reservada: 'O Windows reserva essa combinação para o sistema: o atalho nunca chegaria ao Dita Aí.'
  }
}

const GRAMATICA_DARWIN = {
  // Ordem canônica na convenção da Apple: fn ⌃ ⌥ ⇧ ⌘. Ela também é o que faz
  // 'fn+space' — o default histórico do app, gravado no settings.json de quem
  // já usa — continuar sendo sua própria forma canônica.
  modificadores: ['fn', 'ctrl', 'opt', 'shift', 'cmd'],
  // 'opt' é o token canônico (é o nome impresso na tecla, e é o que os specs
  // legados do app usam); 'alt' é aceito porque é o nome no resto do mundo, e
  // porque um settings.json vindo do Windows não pode virar erro.
  // 'win' entra na lista pelo mesmo motivo dos outros: um settings.json trazido
  // de um PC ('win+j') vira o atalho equivalente aqui em vez de erro.
  aliases: { alt: 'opt', option: 'opt', command: 'cmd', meta: 'cmd', win: 'cmd', control: 'ctrl' },
  rotulosModificador: { fn: 'fn', ctrl: '⌃', opt: '⌥', shift: '⇧', cmd: '⌘' },
  teclas: teclasMac(),
  rotulosBase: {
    ...ROTULOS_BASE_COMUNS,
    backspace: '⌫',
    delete: '⌦'
  },
  maxTeclaDeFuncao: 20,
  // No macOS o event tap fica ANTES do sistema, então tecnicamente daria para
  // roubar qualquer uma delas. É justamente por isso que a lista existe:
  // roubar ⌘Tab (alternar app), ⌘Q (sair) ou ⌘W (fechar janela) deixaria o Mac
  // sem essas funções em todos os programas, e ⌃⌘Q é o bloqueio de tela.
  reservadas: ['cmd+tab', 'cmd+q', 'cmd+w', 'ctrl+cmd+q'],
  // A tecla Fn NÃO aparece aqui: o Chromium no macOS não a expõe em
  // KeyboardEvent (não há `fnKey`, e getModifierState('Fn') é sempre false).
  // Por isso a UI do macOS oferece, ao lado da captura, presets para as
  // combinações com Fn — ver ATALHOS.darwin.presets.
  modificadoresDoEvento: (e) => {
    const mods = []
    if (e.ctrlKey) mods.push('ctrl')
    if (e.altKey) mods.push('opt')
    if (e.shiftKey) mods.push('shift')
    if (e.metaKey) mods.push('cmd')
    return mods
  },
  frases: {
    Reservada: 'O macOS usa essa combinação no sistema inteiro: roubá-la deixaria você sem ela em todos os programas.'
  }
}

export const GRAMATICAS = { win32: GRAMATICA_WIN32, darwin: GRAMATICA_DARWIN }

function gramatica(plataforma) {
  const g = GRAMATICAS[plataforma]
  if (!g) throw new Error(`atalhos.js: plataforma desconhecida '${plataforma}'`)
  return g
}

// Exportado para os testes e para quem precisar percorrer o vocabulário.
export function modificadores(plataforma) { return gramatica(plataforma).modificadores }
export function teclasBase(plataforma) { return gramatica(plataforma).teclas }
export function reservadas(plataforma) { return gramatica(plataforma).reservadas }

// Só teclas de função valem sozinhas. Qualquer outra base sem modificador seria
// suprimida pelo hook no sistema inteiro: configurar 'j' faria a letra J parar
// de funcionar em todos os programas — inclusive no campo onde o usuário
// tentaria desfazer.
export function podeFicarSozinha(token, plataforma) {
  const m = /^f(\d{1,2})$/.exec(String(token))
  if (!m) return false
  const n = Number(m[1])
  return n >= 1 && n <= gramatica(plataforma).maxTeclaDeFuncao
}

// Motivos espelham os enums MotivoRecusa dos dois parsers nativos — mesmos
// nomes de propósito, para os testes poderem comparar veredicto com veredicto.
const MENSAGENS = {
  Vazio: 'Combinação vazia.',
  TokenDesconhecido: 'Essa tecla não pode ser usada em atalhos.',
  SemBase: 'Falta a tecla principal: segure os modificadores e aperte uma tecla comum.',
  BaseDuplicada: 'Um atalho só pode ter uma tecla principal.',
  ModificadorRepetido: 'Modificador repetido na combinação.',
  PrecisaModificador:
    'Sozinha, essa tecla deixaria de funcionar em todos os programas. Junte um modificador — ou use uma tecla de função, que pode ficar sozinha.',
  Reservada: 'O sistema reserva essa combinação: o atalho nunca chegaria ao Dita Aí.'
}

function recusa(motivo, plataforma) {
  const propria = gramatica(plataforma).frases[motivo]
  return { ok: false, motivo, mensagem: propria || MENSAGENS[motivo] }
}

// Valida e canonicaliza um spec já em texto. Aceita ordem trocada de
// modificadores (os helpers também aceitam) e devolve sempre a forma canônica —
// entre outras coisas para que 'f4+alt' não escape do filtro de reservadas.
export function validarToggle(spec, plataforma) {
  const g = gramatica(plataforma)
  if (typeof spec !== 'string' || spec.trim() === '') return recusa('Vazio', plataforma)

  const vistos = new Set()
  let base = null

  for (const cru of spec.trim().toLowerCase().split('+')) {
    if (cru === '') return recusa('Vazio', plataforma)
    const parte = g.aliases[cru] || cru

    if (g.modificadores.includes(parte)) {
      if (vistos.has(parte)) return recusa('ModificadorRepetido', plataforma)
      vistos.add(parte)
      continue
    }
    if (!Object.values(g.teclas).includes(parte)) return recusa('TokenDesconhecido', plataforma)
    if (base !== null) return recusa('BaseDuplicada', plataforma)
    base = parte
  }

  if (base === null) return recusa('SemBase', plataforma)

  const usados = g.modificadores.filter((m) => vistos.has(m))
  if (usados.length === 0 && !podeFicarSozinha(base, plataforma)) {
    return recusa('PrecisaModificador', plataforma)
  }

  const canonico = [...usados, base].join('+')
  if (g.reservadas.includes(canonico)) return recusa('Reservada', plataforma)

  return { ok: true, spec: canonico }
}

// Traduz o que o usuário acabou de apertar. Devolve { pendente: true } enquanto
// só houver modificadores segurados: durante a captura isso é o estado normal,
// não um erro — o usuário está no meio da combinação.
//
// Atenção ao AltGr do ABNT2 no Windows: o Chromium reporta ctrlKey E altKey
// nele, porque é literalmente o que o Windows entrega. Não dá para distinguir
// de um Ctrl+Alt de verdade, então AltGr+tecla vira 'ctrl+alt+tecla' — que é o
// atalho que o helper vai de fato escutar, então a UI não está mentindo.
export function specDeEvento(e, plataforma) {
  const g = gramatica(plataforma)
  const base = g.teclas[e.code]
  if (base === undefined) {
    // Modificadores puros (ControlLeft, AltRight, ShiftLeft, MetaLeft…),
    // CapsLock e, no macOS, a própria Fn não estão na tabela: a combinação
    // ainda não terminou.
    if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(e.code) || e.code === 'CapsLock') {
      return { pendente: true }
    }
    if (plataforma === 'darwin' && e.code === 'Fn') return { pendente: true }
    return recusa('TokenDesconhecido', plataforma)
  }

  return validarToggle([...g.modificadoresDoEvento(e), base].join('+'), plataforma)
}

// Aviso NÃO-bloqueante: a combinação funciona, mas tem um efeito colateral que
// o usuário merece saber antes de gravar.
export function avisoToggle(spec, plataforma) {
  const r = validarToggle(spec, plataforma)
  if (!r.ok) return null
  const partes = r.spec.split('+')

  if (plataforma === 'win32') {
    if (partes.includes('win')) {
      // O hook engole a tecla base, então o shell vê a tecla Windows como se
      // tivesse sido apertada sozinha e abre o menu Iniciar ao soltá-la.
      return 'A tecla Windows abre o menu Iniciar ao ser solta — o atalho funciona, mas o menu aparece junto.'
    }
    return null
  }

  // Spotlight. Funciona (o event tap vê antes), mas o usuário fica sem
  // Spotlight nessa combinação e precisa saber disso ANTES de gravar.
  if (r.spec === 'cmd+space') {
    return 'Essa é a combinação do Spotlight: o Dita Aí passa na frente e o Spotlight deixa de abrir com ela.'
  }
  if (partes.includes('fn')) {
    // O caso já mordeu o Felipe uma vez: com a tecla globo configurada para
    // "Mostrar Emoji e Símbolos" ou "Iniciar Ditado", o painel da Apple aparece
    // por cima do ditado.
    return 'Se a tecla globo estiver configurada para emojis ou para o ditado da Apple, o painel dela aparece junto. Ajustes > Teclado > “Pressionar a tecla globo para” = Não Fazer Nada.'
  }
  const funcaoSozinha = partes.length === 1 && /^f\d{1,2}$/.test(partes[0])
  if (funcaoSozinha && Number(partes[0].slice(1)) <= 12) {
    // Com "Usar F1, F2 etc. como teclas de função" desligado (o padrão da
    // Apple), a tecla nua manda brilho/volume e o F só chega com a Fn junto.
    // O helper aceita os dois casos, mas o usuário precisa saber por que às
    // vezes precisa da Fn.
    return 'Nos teclados da Apple essa tecla controla brilho/volume por padrão: pode ser preciso segurar a tecla Fn junto. O Dita Aí aceita das duas formas.'
  }
  return null
}

// 'ctrl+shift+space' -> 'Ctrl + Shift + Espaço' (Windows)
// 'opt+space'        -> '⌥ + Espaço'            (macOS)
export function rotuloToggle(spec, plataforma) {
  const g = gramatica(plataforma)
  const r = validarToggle(spec, plataforma)
  // Spec inválido (ex.: um valor de macOS num settings.json copiado): mostra o
  // texto cru em vez de inventar um rótulo bonito para algo que não vai valer.
  if (!r.ok) return spec || '—'
  return r.spec
    .split('+')
    .map((p) => g.rotulosModificador[p] || g.rotulosBase[p] || p.toUpperCase())
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

// Os tokens do macOS são os mesmos de sempre ('rcmd', 'ropt'): o valor já está
// gravado no settings.json de quem usa o app, e renomear para 'ralt' só para
// combinar com o Windows trocaria o push-to-talk de todo mundo na atualização.
// O parser Swift aceita 'ralt'/'lalt' como alias, para um settings.json vindo
// de um PC não virar erro.
const PTT_DARWIN = [
  ['rcmd', '⌘ direito'],
  ['lcmd', '⌘ esquerdo'],
  ['rctrl', '⌃ direito'],
  ['lctrl', '⌃ esquerdo'],
  ['rshift', '⇧ direito'],
  ['lshift', '⇧ esquerdo'],
  ['ropt', '⌥ direito'],
  ['lopt', '⌥ esquerdo'],
  ['fn', 'fn / 🌐', 'A tecla globo pode abrir emojis ou o ditado da Apple ao ser solta. Ajustes > Teclado > “Pressionar a tecla globo para” = Não Fazer Nada.']
]

export const ATALHOS = {
  darwin: {
    capturaToggle: true,
    // O que a captura NÃO alcança: o Chromium não entrega a tecla Fn em
    // KeyboardEvent nenhum no macOS. Sem estes botões, o default histórico do
    // app (fn+space) seria impossível de escolher de volta depois de trocado.
    presets: [
      ['fn+space', 'fn + Espaço'],
      ['fn+f5', 'fn + F5']
    ],
    toggle: null,
    ptt: PTT_DARWIN,
    padraoToggle: 'fn+space',
    padraoPtt: 'rcmd'
  },
  win32: {
    capturaToggle: true,
    presets: null,
    toggle: null,
    ptt: PTT_WIN32,
    padraoToggle: 'ctrl+shift+space',
    padraoPtt: 'rctrl'
  }
}
