import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  ATALHOS, GRAMATICAS, modificadores, reservadas, teclasBase,
  avisoToggle, podeFicarSozinha, rotuloToggle, specDeEvento, validarToggle
} from '../src/renderer/src/atalhos.js'

// atalhos.js é o espelho em JS dos dois parsers nativos:
// helper-win/DitaHelper/ShortcutSpec.cs e helper/ShortcutSpec.swift. O renderer
// monta o spec, o helper faz o parse dele. São implementações da mesma
// gramática em linguagens diferentes, e nada impede que divirjam — a UI
// gravaria um valor que o helper recusa, silenciosamente, sem erro em runtime
// nem em build.
//
// A comparação DIRETA roda em helper-win.emit.test.js (C#) e
// helper-mac.parse.test.js (Swift), que alimentam os mesmos specs nos parsers
// de verdade. Mas os dois são pulados fora da sua plataforma, então este aqui
// guarda tudo o que dá para garantir só em JS: as regras de validação, as
// frases que o usuário vê, e o encaixe com os defaults do processo main.
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor)
})

// defaults.js calcula tudo em tempo de import a partir de process.platform,
// então trocar a plataforma depois do import não teria efeito. Troca, invalida
// o cache de módulos e reimporta — assim os dois branches são checados na mesma
// máquina, em vez de metade do contrato nunca ser exercitada.
async function loadDefaultsFor(platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  vi.resetModules()
  return import('../src/main/defaults.js')
}

// KeyboardEvent falso: só os campos que specDeEvento lê. `meta` é a tecla
// Windows num PC e a Command num Mac — é o mesmo bit do Chromium.
const ev = (code, mods = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta
})

describe('gramática do Windows (espelho do ShortcutSpec.cs)', () => {
  const v = (spec) => validarToggle(spec, 'win32')

  // Estes quatro valores podem estar gravados no settings.json de qualquer
  // usuário que já usou o app. Se o parser novo os rejeitasse, o atalho dele
  // mudaria sozinho na próxima atualização.
  it.each(['ctrl+shift+space', 'ctrl+space', 'alt+space', 'f5'])(
    'continua aceitando o valor legado %s, inalterado', (spec) => {
      expect(v(spec)).toEqual({ ok: true, spec })
    })

  it('aceita combinações que a lista fixa não expressava', () => {
    for (const spec of ['ctrl+alt+j', 'win+f9', 'ctrl+alt+shift+win+f12', 'alt+semicolon', 'ctrl+intlro']) {
      expect(v(spec).spec).toBe(spec)
    }
  })

  it('canonicaliza caixa e ordem dos modificadores', () => {
    // o filtro de reservadas compara com a forma canônica: sem normalizar,
    // 'f4+alt' escaparia dele
    expect(v('CTRL+Shift+Space').spec).toBe('ctrl+shift+space')
    expect(v('shift+ctrl+space').spec).toBe('ctrl+shift+space')
    expect(v('win+shift+alt+ctrl+j').spec).toBe('ctrl+alt+shift+win+j')
  })

  // Regra 1. É a mais importante das quatro: um atalho sem modificador em cima
  // de uma tecla comum é suprimido pelo hook no sistema INTEIRO — a letra J
  // pararia de funcionar em todos os programas, inclusive no campo onde o
  // usuário tentaria desfazer.
  it.each(['j', 'space', 'semicolon', '7', 'enter', 'up'])(
    'recusa %s sozinha: suprimiria a tecla no sistema inteiro', (spec) => {
      expect(v(spec)).toMatchObject({ ok: false, motivo: 'PrecisaModificador' })
    })

  it('abre exceção só para as teclas de função', () => {
    for (const f of ['f1', 'f5', 'f12', 'f24']) expect(v(f).ok).toBe(true)
    for (const t of Object.values(teclasBase('win32'))) {
      expect(podeFicarSozinha(t, 'win32')).toBe(v(t).ok)
    }
    // nem 'f' nem 'f0' nem 'f25' são teclas de função
    for (const naoF of ['f', 'f0', 'f25', 'f99']) expect(podeFicarSozinha(naoF, 'win32')).toBe(false)
  })

  // Regra 2: modificador não é tecla base.
  it.each(['ctrl', 'shift', 'win', 'ctrl+shift', 'ctrl+alt+shift+win'])(
    'recusa %s: falta a tecla principal', (spec) => {
      expect(v(spec)).toMatchObject({ ok: false, motivo: 'SemBase' })
    })

  // Regra 3. O hook nem vê ctrl+alt+delete (o SAS é tratado em kernel) nem
  // win+l; alt+f4 e alt+tab ele vê, mas suprimi-las quebraria fechar e
  // alternar janela no sistema inteiro.
  it.each(reservadas('win32'))('recusa %s: o SO reserva', (spec) => {
    expect(v(spec)).toMatchObject({ ok: false, motivo: 'Reservada' })
  })

  it('não deixa a ordem trocada furar o filtro de reservadas', () => {
    expect(v('f4+alt').motivo).toBe('Reservada')
    expect(v('l+win').motivo).toBe('Reservada')
  })

  // Os specs exclusivos do macOS nunca chegam ao helper do Windows (quem os
  // interpreta é o helper em Swift), mas um settings.json copiado de um Mac
  // chega — e não pode derrubar nem a UI nem o helper.
  it.each(['fn+space', 'opt+space', 'rcmd', 'ropt'])(
    'recusa o spec de macOS %s sem quebrar', (spec) => {
      expect(v(spec)).toMatchObject({ ok: false, motivo: 'TokenDesconhecido' })
      expect(() => rotuloToggle(spec, 'win32')).not.toThrow()
    })

  it.each([
    ['', 'Vazio'],
    ['   ', 'Vazio'],
    ['ctrl++j', 'Vazio'],
    ['ctrl+a+b', 'BaseDuplicada'],
    ['ctrl+ctrl+j', 'ModificadorRepetido'],
    ['ctrl+shift+banana', 'TokenDesconhecido'],
    [null, 'Vazio'],
    [undefined, 'Vazio']
  ])('recusa %s com o motivo %s', (spec, motivo) => {
    expect(v(spec)).toMatchObject({ ok: false, motivo })
  })
})

describe('gramática do macOS (espelho do ShortcutSpec.swift)', () => {
  const v = (spec) => validarToggle(spec, 'darwin')

  // Os quatro valores que a lista fixa antiga oferecia. Quem usa o app tem um
  // deles gravado: se o parser novo os recusasse, o atalho mudaria sozinho na
  // atualização — que é exatamente o que ninguém espera de um app de ditado.
  it.each(['fn+space', 'opt+space', 'ctrl+space', 'f5'])(
    'continua aceitando o valor legado %s, inalterado', (spec) => {
      expect(v(spec)).toEqual({ ok: true, spec })
    })

  it('aceita combinações que a lista fixa não expressava', () => {
    for (const spec of ['ctrl+opt+j', 'shift+cmd+d', 'fn+f5', 'opt+semicolon', 'shift+cmd+f12']) {
      expect(v(spec).spec).toBe(spec)
    }
  })

  // 'opt' é o token canônico porque é o nome impresso na tecla e é o que os
  // specs antigos usam; os apelidos existem para um settings.json vindo de um
  // PC (ou escrito à mão) não virar erro.
  it('traduz os apelidos para o vocabulário do Mac', () => {
    expect(v('alt+space').spec).toBe('opt+space')
    expect(v('option+space').spec).toBe('opt+space')
    expect(v('command+j').spec).toBe('cmd+j')
    expect(v('meta+j').spec).toBe('cmd+j')
    expect(v('win+j').spec).toBe('cmd+j')     // settings.json trazido de um PC
    expect(v('control+space').spec).toBe('ctrl+space')
  })

  it('canonicaliza na ordem da Apple: fn ⌃ ⌥ ⇧ ⌘', () => {
    expect(v('cmd+shift+opt+ctrl+fn+j').spec).toBe('fn+ctrl+opt+shift+cmd+j')
    expect(v('space+ctrl').spec).toBe('ctrl+space')
    expect(v('CMD+Shift+D').spec).toBe('shift+cmd+d')
  })

  it.each(['j', 'space', 'semicolon', '7', 'enter', 'up'])(
    'recusa %s sozinha: suprimiria a tecla no sistema inteiro', (spec) => {
      expect(v(spec)).toMatchObject({ ok: false, motivo: 'PrecisaModificador' })
    })

  // O macOS não tem virtual keycode para F21-F24: oferecê-las seria prometer um
  // atalho que nunca dispara.
  it('conhece as teclas de função até F20, e só até lá', () => {
    for (const f of ['f1', 'f5', 'f12', 'f20']) expect(v(f).ok).toBe(true)
    for (const f of ['f21', 'f24']) expect(v(f)).toMatchObject({ ok: false, motivo: 'TokenDesconhecido' })
    for (const t of Object.values(teclasBase('darwin'))) {
      expect(podeFicarSozinha(t, 'darwin')).toBe(v(t).ok)
    }
  })

  // Teclas que existem no PC e não no teclado da Apple. Recusar é melhor do que
  // aceitar um spec que o helper jamais casaria com tecla nenhuma.
  it('não conhece as teclas que o teclado da Apple não tem', () => {
    expect(v('ctrl+insert')).toMatchObject({ ok: false, motivo: 'TokenDesconhecido' })
    expect(v('win+j').spec).toBe('cmd+j')  // 'win' é apelido, não tecla
  })

  it.each(reservadas('darwin'))('recusa %s: o macOS reserva', (spec) => {
    expect(v(spec)).toMatchObject({ ok: false, motivo: 'Reservada' })
  })

  it('não deixa a ordem trocada furar o filtro de reservadas', () => {
    expect(v('tab+cmd').motivo).toBe('Reservada')
    expect(v('q+cmd+ctrl').motivo).toBe('Reservada')
  })

  it.each(['ctrl', 'cmd', 'fn', 'ctrl+shift', 'fn+ctrl+opt+shift+cmd'])(
    'recusa %s: falta a tecla principal', (spec) => {
      expect(v(spec)).toMatchObject({ ok: false, motivo: 'SemBase' })
    })

  it.each([
    ['', 'Vazio'],
    ['   ', 'Vazio'],
    ['ctrl++j', 'Vazio'],
    ['ctrl+a+b', 'BaseDuplicada'],
    ['ctrl+ctrl+j', 'ModificadorRepetido'],
    ['cmd+shift+banana', 'TokenDesconhecido'],
    [null, 'Vazio'],
    [undefined, 'Vazio']
  ])('recusa %s com o motivo %s', (spec, motivo) => {
    expect(v(spec)).toMatchObject({ ok: false, motivo })
  })
})

describe('as recusas explicam', () => {
  // Regra 4: a UI tem que EXPLICAR a recusa. Uma recusa muda é indistinguível
  // de um botão quebrado.
  it.each([
    ['win32', ['j', 'ctrl', 'alt+f4', 'fn+space', '', 'ctrl+a+b', 'ctrl+ctrl+j']],
    ['darwin', ['j', 'ctrl', 'cmd+tab', 'ctrl+insert', '', 'ctrl+a+b', 'ctrl+ctrl+j']]
  ])('em %s, toda recusa vem com uma frase em português, não só um código', (plataforma, recusados) => {
    const vistas = new Set()
    for (const spec of recusados) {
      const r = validarToggle(spec, plataforma)
      expect(r.ok, spec).toBe(false)
      expect(typeof r.mensagem).toBe('string')
      expect(r.mensagem.length).toBeGreaterThan(15)
      vistas.add(r.motivo)
    }
    // e cada motivo tem a SUA frase: reaproveitar uma mensagem genérica
    // devolveria o usuário ao "simplesmente não funciona"
    const frases = recusados.map((s) => validarToggle(s, plataforma).mensagem)
    expect(new Set(frases).size).toBe(vistas.size)
  })

  it('a frase de reservada fala do sistema certo', () => {
    expect(validarToggle('alt+f4', 'win32').mensagem).toMatch(/Windows/)
    expect(validarToggle('cmd+q', 'darwin').mensagem).toMatch(/macOS/)
  })

  it('plataforma desconhecida estoura em vez de escolher uma gramática no escuro', () => {
    // Silenciar isto seria oferecer atalhos de Mac a um usuário de PC.
    expect(() => validarToggle('ctrl+j', 'linux')).toThrow(/plataforma desconhecida/)
  })
})

describe('captura a partir do KeyboardEvent', () => {
  it('monta o spec com os modificadores segurados (Windows)', () => {
    expect(specDeEvento(ev('Space', { ctrl: true, shift: true }), 'win32').spec).toBe('ctrl+shift+space')
    expect(specDeEvento(ev('KeyJ', { ctrl: true, alt: true }), 'win32').spec).toBe('ctrl+alt+j')
    expect(specDeEvento(ev('F9', { meta: true }), 'win32').spec).toBe('win+f9')
    expect(specDeEvento(ev('F5'), 'win32').spec).toBe('f5')
  })

  it('monta o spec com os modificadores segurados (macOS)', () => {
    // o MESMO evento vira spec diferente em cada plataforma: metaKey é a tecla
    // Windows num PC e a Command num Mac
    expect(specDeEvento(ev('KeyJ', { meta: true, shift: true }), 'darwin').spec).toBe('shift+cmd+j')
    expect(specDeEvento(ev('Space', { alt: true }), 'darwin').spec).toBe('opt+space')
    expect(specDeEvento(ev('KeyD', { ctrl: true, alt: true }), 'darwin').spec).toBe('ctrl+opt+d')
    expect(specDeEvento(ev('F5'), 'darwin').spec).toBe('f5')
  })

  // Chaveia pelo `code` (posição física) e nunca pelo `key` (caractere): tanto
  // os VK_* do Windows quanto os keycodes do macOS são posicionais, então
  // gravar pelo caractere faria o mesmo atalho apontar para teclas diferentes
  // conforme o layout ativo.
  it('usa a posição física, não o caractere produzido', () => {
    // no ABNT2 esta posição é o Ç; num teclado US é o ';'. Mesmo spec, mesma
    // tecla física, os dois layouts.
    expect(specDeEvento(ev('Semicolon', { alt: true }), 'win32').spec).toBe('alt+semicolon')
    expect(specDeEvento(ev('Semicolon', { alt: true }), 'darwin').spec).toBe('opt+semicolon')
    expect(specDeEvento(ev('IntlRo', { ctrl: true }), 'win32').spec).toBe('ctrl+intlro')
    expect(specDeEvento(ev('IntlRo', { ctrl: true }), 'darwin').spec).toBe('ctrl+intlro')
  })

  it('fica pendente enquanto só há modificadores segurados', () => {
    for (const plataforma of ['win32', 'darwin']) {
      for (const code of ['ControlLeft', 'ControlRight', 'ShiftLeft', 'AltRight', 'MetaLeft', 'CapsLock']) {
        expect(specDeEvento(ev(code, { ctrl: true }), plataforma), `${plataforma}/${code}`).toEqual({ pendente: true })
      }
    }
  })

  it('recusa teclas que o helper não sabe escutar', () => {
    // teclado numérico, teclas de mídia: nenhuma está na tabela
    for (const code of ['Numpad5', 'AudioVolumeUp', 'ScrollLock']) {
      expect(specDeEvento(ev(code, { ctrl: true }), 'win32')).toMatchObject({ ok: false, motivo: 'TokenDesconhecido' })
      expect(specDeEvento(ev(code, { ctrl: true }), 'darwin')).toMatchObject({ ok: false, motivo: 'TokenDesconhecido' })
    }
    // a Fn é desconhecida no Windows (o hook nem a recebe) e, no macOS, é
    // combinação incompleta — lá ela É um modificador válido, só que o
    // Chromium nunca a entrega junto da tecla base. Ver ATALHOS.darwin.presets.
    expect(specDeEvento(ev('Fn', { ctrl: true }), 'win32')).toMatchObject({ ok: false, motivo: 'TokenDesconhecido' })
    expect(specDeEvento(ev('Fn', { ctrl: true }), 'darwin')).toEqual({ pendente: true })
  })

  it('recusa a tecla nua e diz por quê', () => {
    for (const plataforma of ['win32', 'darwin']) {
      const r = specDeEvento(ev('KeyJ'), plataforma)
      expect(r.ok).toBe(false)
      expect(r.motivo).toBe('PrecisaModificador')
      expect(r.mensagem).toMatch(/todos os programas/)
    }
  })

  // Esc com modificador é combinação legítima; o cancelamento da captura (Esc
  // puro) é decidido no Settings.jsx, antes de chegar aqui.
  it('trata ctrl+esc como combinação, não como cancelamento', () => {
    expect(specDeEvento(ev('Escape', { ctrl: true }), 'win32').spec).toBe('ctrl+esc')
    expect(specDeEvento(ev('Escape', { ctrl: true }), 'darwin').spec).toBe('ctrl+esc')
  })
})

describe('rótulos e avisos', () => {
  it('traduz o spec para o teclado do usuário (Windows)', () => {
    expect(rotuloToggle('ctrl+shift+space', 'win32')).toBe('Ctrl + Shift + Espaço')
    expect(rotuloToggle('f5', 'win32')).toBe('F5')
    expect(rotuloToggle('ctrl+alt+j', 'win32')).toBe('Ctrl + Alt + J')
    // legenda do ABNT2, que é o teclado que o usuário tem na frente
    expect(rotuloToggle('alt+semicolon', 'win32')).toBe('Alt + Ç')
    expect(rotuloToggle('ctrl+intlro', 'win32')).toBe('Ctrl + /')
  })

  it('usa os símbolos da Apple no macOS', () => {
    expect(rotuloToggle('fn+space', 'darwin')).toBe('fn + Espaço')
    expect(rotuloToggle('opt+space', 'darwin')).toBe('⌥ + Espaço')
    expect(rotuloToggle('shift+cmd+d', 'darwin')).toBe('⇧ + ⌘ + D')
    expect(rotuloToggle('ctrl+space', 'darwin')).toBe('⌃ + Espaço')
    expect(rotuloToggle('f5', 'darwin')).toBe('F5')
  })

  it('nunca devolve rótulo vazio, nem para spec inválido', () => {
    for (const plataforma of ['win32', 'darwin']) {
      for (const spec of Object.values(teclasBase(plataforma)).map((t) => `ctrl+${t}`)) {
        expect(rotuloToggle(spec, plataforma)).toBeTruthy()
        expect(rotuloToggle(spec, plataforma)).not.toMatch(/undefined/)
      }
      expect(rotuloToggle('', plataforma)).toBe('—')
    }
    // spec da outra plataforma: mostra o texto cru em vez de inventar rótulo
    expect(rotuloToggle('cmd+j', 'win32')).toBe('cmd+j')
    expect(rotuloToggle('win+j', 'darwin')).toBe('⌘ + J')  // 'win' é apelido no Mac
  })

  // Aviso, não recusa: o atalho FUNCIONA, mas tem um efeito colateral. Recusar
  // seria exagero; calar seria mentira.
  it('avisa sobre o menu Iniciar em atalhos com a tecla Windows', () => {
    expect(avisoToggle('win+f9', 'win32')).toMatch(/menu Iniciar/)
    expect(avisoToggle('ctrl+alt+shift+win+f12', 'win32')).toMatch(/menu Iniciar/)
    expect(avisoToggle('ctrl+shift+space', 'win32')).toBeNull()
    expect(avisoToggle('ctrl+win9', 'win32')).toBeNull() // spec inválido não gera aviso
  })

  it('avisa sobre Spotlight, tecla globo e teclas de função no macOS', () => {
    expect(avisoToggle('cmd+space', 'darwin')).toMatch(/Spotlight/)
    // o caso que já mordeu: com a tecla globo ligada a emojis/ditado da Apple,
    // o painel deles aparece por cima
    expect(avisoToggle('fn+space', 'darwin')).toMatch(/globo/)
    expect(avisoToggle('f5', 'darwin')).toMatch(/brilho\/volume/)
    // F13+ não existe em teclado da Apple com função de mídia
    expect(avisoToggle('f13', 'darwin')).toBeNull()
    expect(avisoToggle('ctrl+opt+j', 'darwin')).toBeNull()
  })
})

describe('tabela de apresentação x contrato do main process', () => {
  for (const platform of ['win32', 'darwin']) {
    describe(platform, () => {
      it('usa o mesmo default que o main process', async () => {
        const { DEFAULT_TOGGLE, DEFAULT_PTT } = await loadDefaultsFor(platform)
        // se divergirem, a UI abre mostrando um atalho diferente do que o
        // helper já está escutando: a tela mente sobre o estado real
        expect(ATALHOS[platform].padraoToggle).toBe(DEFAULT_TOGGLE)
        expect(ATALHOS[platform].padraoPtt).toBe(DEFAULT_PTT)
      })

      it('o default é um spec válido pela própria gramática', async () => {
        const { DEFAULT_TOGGLE, DEFAULT_PTT } = await loadDefaultsFor(platform)
        expect(validarToggle(DEFAULT_TOGGLE, platform)).toEqual({ ok: true, spec: DEFAULT_TOGGLE })
        expect(ATALHOS[platform].ptt.map(([v]) => v)).toContain(DEFAULT_PTT)
      })

      it('dá um rótulo não-vazio e único para cada opção de push-to-talk', () => {
        // um rótulo faltando não quebra nada em runtime — o botão só aparece
        // em branco, o que é pior que quebrar
        const rotulos = ATALHOS[platform].ptt.map(([, r]) => r)
        for (const r of rotulos) expect(r).toBeTruthy()
        expect(new Set(rotulos).size).toBe(rotulos.length)
      })

      it('a captura livre está ligada e não sobrou lista fixa de toggle', () => {
        expect(ATALHOS[platform].capturaToggle).toBe(true)
        expect(ATALHOS[platform].toggle).toBeNull()
      })
    })
  }

  it('cobre todas as plataformas que defaults.js conhece', () => {
    // se um dia entrar 'linux' em defaults.js, o fallback do Settings.jsx
    // mostraria atalhos de Mac para o usuário errado
    expect(Object.keys(ATALHOS).sort()).toEqual(['darwin', 'win32'])
    expect(Object.keys(GRAMATICAS).sort()).toEqual(['darwin', 'win32'])
  })

  // Presets existem por uma limitação concreta: o Chromium não entrega a tecla
  // Fn em KeyboardEvent nenhum no macOS. Sem eles, quem trocasse o atalho não
  // teria como voltar ao fn+Espaço, que é o default histórico do app.
  it('só o macOS tem presets, e todos com a tecla que a captura não alcança', () => {
    expect(ATALHOS.win32.presets).toBeNull()
    expect(ATALHOS.darwin.presets.length).toBeGreaterThan(0)
    for (const [spec, rotulo] of ATALHOS.darwin.presets) {
      expect(validarToggle(spec, 'darwin')).toEqual({ ok: true, spec })
      expect(spec.split('+')).toContain('fn')
      expect(rotulo).toBeTruthy()
    }
    expect(ATALHOS.darwin.presets.map(([s]) => s)).toContain(ATALHOS.darwin.padraoToggle)
  })

  // 'rwin'/'lwin' fora de propósito: um toque solto abre o menu Iniciar, e
  // teclas de PTT nunca são suprimidas (o usuário ainda precisa delas para os
  // atalhos normais do sistema). A lista é contrato com o helper C#, por isso a
  // comparação é exata: um valor a mais aqui vira um --ptt=<algo> que o helper
  // precisa saber parsear.
  it('oferece exatamente os seis modificadores de PTT no Windows', () => {
    expect(ATALHOS.win32.ptt.map(([v]) => v))
      .toEqual(['rctrl', 'lctrl', 'rshift', 'lshift', 'ralt', 'lalt'])
    expect(ATALHOS.win32.ptt.map(([v]) => v)).not.toContain('rwin')
    expect(ATALHOS.win32.ptt.map(([v]) => v)).not.toContain('lwin')
  })

  // No Mac os tokens de PTT continuam 'rcmd'/'ropt' (e não 'ralt') porque é o
  // que já está gravado no settings.json de quem usa o app: renomear só para
  // combinar com o Windows trocaria o push-to-talk de todo mundo na
  // atualização. Quem oferece as duas grafias é o parser Swift, por alias.
  it('mantém os tokens históricos de PTT no macOS e acrescenta os dois lados', () => {
    const opcoes = ATALHOS.darwin.ptt.map(([v]) => v)
    expect(opcoes).toContain('rcmd')
    expect(opcoes).toContain('ropt')
    expect(opcoes).not.toContain('ralt')
    // cada modificador com os dois lados, mais a tecla globo
    expect(opcoes).toEqual(['fn', 'rcmd', 'lcmd', 'rctrl', 'lctrl', 'rshift', 'lshift', 'ropt', 'lopt'])
  })

  // As duas teclas Alt têm efeito colateral: a direita é o AltGr do ABNT2 (ç,
  // º, ₢) e soltar a esquerda sozinha ativa a barra de menus. Como PTT nunca é
  // suprimido, os dois acontecem de verdade — o usuário precisa saber antes.
  it('avisa sobre as duas opções de Alt no push-to-talk do Windows', () => {
    for (const alt of ['ralt', 'lalt']) {
      const opcao = ATALHOS.win32.ptt.find(([v]) => v === alt)
      expect(opcao[2], `${alt} sem aviso`).toBeTruthy()
    }
    expect(ATALHOS.win32.ptt.find(([v]) => v === 'ralt')[2]).toMatch(/AltGr/)
    // e o default não é nenhuma delas
    expect(ATALHOS.win32.padraoPtt).toBe('rctrl')
  })

  // Desde 2026-11-17 a Fn é o padrão (igual ao Wispr Flow) e o helper engole
  // o evento dela, então o macOS não abre emoji nem ditado: o aviso que pedia
  // para mexer nos Ajustes do sistema deixou de ser verdade e saiu.
  it('a Fn é o push-to-talk padrão do macOS e vem primeiro na lista', () => {
    expect(ATALHOS.darwin.padraoPtt).toBe('fn')
    expect(ATALHOS.darwin.ptt[0][0]).toBe('fn')
  })

  it('a ordem canônica dos modificadores é estável', () => {
    // é a ordem em que o spec é serializado; mudá-la faria todo valor já
    // gravado deixar de bater com o que a UI monta
    expect(modificadores('win32')).toEqual(['ctrl', 'alt', 'shift', 'win'])
    // no Mac, a convenção da Apple — e é ela que mantém 'fn+space', o default
    // histórico, sendo sua própria forma canônica
    expect(modificadores('darwin')).toEqual(['fn', 'ctrl', 'opt', 'shift', 'cmd'])
  })
})
