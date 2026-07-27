import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  ATALHOS, MODIFICADORES, RESERVADAS, TECLAS_BASE,
  avisoToggle, podeFicarSozinha, rotuloToggle, specDeEvento, validarToggle
} from '../src/renderer/src/atalhos.js'

// atalhos.js é o espelho em JS de helper-win/DitaHelper/ShortcutSpec.cs: o
// renderer monta o spec, o helper faz o parse dele. São duas implementações da
// mesma gramática, em linguagens diferentes, e nada impede que divirjam — a UI
// gravaria um valor que o helper recusa, silenciosamente, sem erro em runtime
// nem em build.
//
// A comparação DIRETA entre as duas roda em helper-win.emit.test.js, que
// alimenta os mesmos specs no ShortcutSpec.cs de verdade. Mas aquele arquivo é
// pulado onde não há dotnet, então este aqui guarda tudo o que dá para garantir
// só em JS: as regras de validação, as frases que o usuário vê, e o encaixe com
// os defaults do processo main.
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

// KeyboardEvent falso: só os campos que specDeEvento lê.
const ev = (code, mods = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.win
})

describe('gramática de atalhos (espelho do ShortcutSpec.cs)', () => {
  // Estes quatro valores podem estar gravados no settings.json de qualquer
  // usuário que já usou o app. Se o parser novo os rejeitasse, o atalho dele
  // mudaria sozinho na próxima atualização.
  it.each(['ctrl+shift+space', 'ctrl+space', 'alt+space', 'f5'])(
    'continua aceitando o valor legado %s, inalterado', (spec) => {
      expect(validarToggle(spec)).toEqual({ ok: true, spec })
    })

  it('aceita combinações que a lista fixa não expressava', () => {
    for (const spec of ['ctrl+alt+j', 'win+f9', 'ctrl+alt+shift+win+f12', 'alt+semicolon', 'ctrl+intlro']) {
      expect(validarToggle(spec).spec).toBe(spec)
    }
  })

  it('canonicaliza caixa e ordem dos modificadores', () => {
    // o filtro de reservadas compara com a forma canônica: sem normalizar,
    // 'f4+alt' escaparia dele
    expect(validarToggle('CTRL+Shift+Space').spec).toBe('ctrl+shift+space')
    expect(validarToggle('shift+ctrl+space').spec).toBe('ctrl+shift+space')
    expect(validarToggle('win+shift+alt+ctrl+j').spec).toBe('ctrl+alt+shift+win+j')
  })

  // Regra 1. É a mais importante das quatro: um atalho sem modificador em cima
  // de uma tecla comum é suprimido pelo hook no sistema INTEIRO — a letra J
  // pararia de funcionar em todos os programas, inclusive no campo onde o
  // usuário tentaria desfazer.
  it.each(['j', 'space', 'semicolon', '7', 'enter', 'up'])(
    'recusa %s sozinha: suprimiria a tecla no sistema inteiro', (spec) => {
      expect(validarToggle(spec)).toMatchObject({ ok: false, motivo: 'PrecisaModificador' })
    })

  it('abre exceção só para as teclas de função', () => {
    for (const f of ['f1', 'f5', 'f12', 'f24']) expect(validarToggle(f).ok).toBe(true)
    for (const t of Object.values(TECLAS_BASE)) {
      expect(podeFicarSozinha(t)).toBe(validarToggle(t).ok)
    }
    // nem 'f' nem 'f0' nem 'f25' são teclas de função
    for (const naoF of ['f', 'f0', 'f25', 'f99']) expect(podeFicarSozinha(naoF)).toBe(false)
  })

  // Regra 2: modificador não é tecla base.
  it.each(['ctrl', 'shift', 'win', 'ctrl+shift', 'ctrl+alt+shift+win'])(
    'recusa %s: falta a tecla principal', (spec) => {
      expect(validarToggle(spec)).toMatchObject({ ok: false, motivo: 'SemBase' })
    })

  // Regra 3. O hook nem vê ctrl+alt+delete (o SAS é tratado em kernel) nem
  // win+l; alt+f4 e alt+tab ele vê, mas suprimi-las quebraria fechar e
  // alternar janela no sistema inteiro.
  it.each(RESERVADAS)('recusa %s: o SO reserva', (spec) => {
    expect(validarToggle(spec)).toMatchObject({ ok: false, motivo: 'Reservada' })
  })

  it('não deixa a ordem trocada furar o filtro de reservadas', () => {
    expect(validarToggle('f4+alt').motivo).toBe('Reservada')
    expect(validarToggle('l+win').motivo).toBe('Reservada')
  })

  // Os specs do macOS nunca chegam ao helper do Windows (quem os interpreta é
  // o helper em Swift), mas um settings.json copiado de um Mac chega — e não
  // pode derrubar nem a UI nem o helper.
  it.each(['fn+space', 'opt+space', 'rcmd', 'ropt'])(
    'recusa o spec de macOS %s sem quebrar', (spec) => {
      expect(validarToggle(spec)).toMatchObject({ ok: false, motivo: 'TokenDesconhecido' })
      expect(() => rotuloToggle(spec)).not.toThrow()
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
    expect(validarToggle(spec)).toMatchObject({ ok: false, motivo })
  })

  // Regra 4: a UI tem que EXPLICAR a recusa. Uma recusa muda é indistinguível
  // de um botão quebrado.
  it('toda recusa vem com uma frase em português, não só um código', () => {
    const recusados = ['j', 'ctrl', 'alt+f4', 'fn+space', '', 'ctrl+a+b', 'ctrl+ctrl+j']
    const vistas = new Set()
    for (const spec of recusados) {
      const r = validarToggle(spec)
      expect(r.ok).toBe(false)
      expect(typeof r.mensagem).toBe('string')
      expect(r.mensagem.length).toBeGreaterThan(15)
      vistas.add(r.motivo)
    }
    // e cada motivo tem a SUA frase: reaproveitar uma mensagem genérica
    // devolveria o usuário ao "simplesmente não funciona"
    const frases = recusados.map((s) => validarToggle(s).mensagem)
    expect(new Set(frases).size).toBe(vistas.size)
  })
})

describe('captura a partir do KeyboardEvent', () => {
  it('monta o spec com os modificadores segurados', () => {
    expect(specDeEvento(ev('Space', { ctrl: true, shift: true })).spec).toBe('ctrl+shift+space')
    expect(specDeEvento(ev('KeyJ', { ctrl: true, alt: true })).spec).toBe('ctrl+alt+j')
    expect(specDeEvento(ev('F9', { win: true })).spec).toBe('win+f9')
    expect(specDeEvento(ev('F5')).spec).toBe('f5')
  })

  // Chaveia pelo `code` (posição física) e nunca pelo `key` (caractere): os
  // VK_* do Windows também são posicionais, então gravar pelo caractere faria o
  // mesmo atalho apontar para teclas diferentes conforme o layout ativo.
  it('usa a posição física, não o caractere produzido', () => {
    // no ABNT2 esta posição é o Ç; num teclado US é o ';'. Mesmo spec, mesma
    // tecla física, os dois layouts.
    expect(specDeEvento(ev('Semicolon', { alt: true })).spec).toBe('alt+semicolon')
    expect(specDeEvento(ev('IntlRo', { ctrl: true })).spec).toBe('ctrl+intlro')
  })

  it('fica pendente enquanto só há modificadores segurados', () => {
    for (const code of ['ControlLeft', 'ControlRight', 'ShiftLeft', 'AltRight', 'MetaLeft', 'CapsLock']) {
      expect(specDeEvento(ev(code, { ctrl: true })), code).toEqual({ pendente: true })
    }
  })

  it('recusa teclas que o helper não sabe escutar', () => {
    // teclado numérico, teclas de mídia, Fn: nenhuma está na tabela
    for (const code of ['Numpad5', 'AudioVolumeUp', 'Fn', 'ScrollLock']) {
      expect(specDeEvento(ev(code, { ctrl: true }))).toMatchObject({ ok: false, motivo: 'TokenDesconhecido' })
    }
  })

  it('recusa a tecla nua e diz por quê', () => {
    const r = specDeEvento(ev('KeyJ'))
    expect(r.ok).toBe(false)
    expect(r.motivo).toBe('PrecisaModificador')
    expect(r.mensagem).toMatch(/todos os programas/)
  })

  // Esc com modificador é combinação legítima; o cancelamento da captura (Esc
  // puro) é decidido no Settings.jsx, antes de chegar aqui.
  it('trata ctrl+esc como combinação, não como cancelamento', () => {
    expect(specDeEvento(ev('Escape', { ctrl: true })).spec).toBe('ctrl+esc')
  })
})

describe('rótulos e avisos', () => {
  it('traduz o spec para o teclado do usuário', () => {
    expect(rotuloToggle('ctrl+shift+space')).toBe('Ctrl + Shift + Espaço')
    expect(rotuloToggle('f5')).toBe('F5')
    expect(rotuloToggle('ctrl+alt+j')).toBe('Ctrl + Alt + J')
    // legenda do ABNT2, que é o teclado que o usuário tem na frente
    expect(rotuloToggle('alt+semicolon')).toBe('Alt + Ç')
    expect(rotuloToggle('ctrl+intlro')).toBe('Ctrl + /')
  })

  it('nunca devolve rótulo vazio, nem para spec inválido', () => {
    for (const spec of Object.values(TECLAS_BASE).map((t) => `ctrl+${t}`)) {
      expect(rotuloToggle(spec)).toBeTruthy()
      expect(rotuloToggle(spec)).not.toMatch(/undefined/)
    }
    expect(rotuloToggle('fn+space')).toBe('fn+space')
    expect(rotuloToggle('')).toBe('—')
  })

  // Aviso, não recusa: o atalho FUNCIONA, mas o hook engole a tecla base, então
  // o shell vê a tecla Windows como se tivesse sido apertada sozinha e abre o
  // menu Iniciar ao soltá-la. Recusar seria exagero; calar seria mentira.
  it('avisa sobre o menu Iniciar em atalhos com a tecla Windows', () => {
    expect(avisoToggle('win+f9')).toMatch(/menu Iniciar/)
    expect(avisoToggle('ctrl+alt+shift+win+f12')).toMatch(/menu Iniciar/)
    expect(avisoToggle('ctrl+shift+space')).toBeNull()
    expect(avisoToggle('ctrl+win9')).toBeNull() // spec inválido não gera aviso
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

      it('dá um rótulo não-vazio e único para cada opção de push-to-talk', () => {
        // um rótulo faltando não quebra nada em runtime — o botão só aparece
        // em branco, o que é pior que quebrar
        const rotulos = ATALHOS[platform].ptt.map(([, r]) => r)
        for (const r of rotulos) expect(r).toBeTruthy()
        expect(new Set(rotulos).size).toBe(rotulos.length)
      })
    })
  }

  it('cobre todas as plataformas que defaults.js conhece', () => {
    // se um dia entrar 'linux' em defaults.js, o fallback silencioso
    // `ATALHOS[settings.platform] || ATALHOS.darwin` do Settings.jsx mostraria
    // atalhos de Mac para o usuário errado
    expect(Object.keys(ATALHOS).sort()).toEqual(['darwin', 'win32'])
  })

  // No macOS quem faz o parse é o helper em Swift, que continua com uma lista
  // fixa — a gramática deste módulo é do helper do Windows. Por isso lá a UI
  // segue sendo um <select>, e a lista precisa continuar existindo.
  it('só o Windows usa captura livre; o macOS mantém a lista fixa', () => {
    expect(ATALHOS.win32.capturaToggle).toBe(true)
    expect(ATALHOS.win32.toggle).toBeNull()
    expect(ATALHOS.darwin.capturaToggle).toBe(false)
    expect(ATALHOS.darwin.toggle.length).toBeGreaterThan(0)
    for (const [valor, rotulo] of ATALHOS.darwin.toggle) {
      expect(valor).toBeTruthy()
      expect(rotulo).toBeTruthy()
    }
    expect(ATALHOS.darwin.toggle.map(([v]) => v)).toContain(ATALHOS.darwin.padraoToggle)
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

  // As duas teclas Alt têm efeito colateral: a direita é o AltGr do ABNT2 (ç,
  // º, ₢) e soltar a esquerda sozinha ativa a barra de menus. Como PTT nunca é
  // suprimido, os dois acontecem de verdade — o usuário precisa saber antes.
  it('avisa sobre as duas opções de Alt no push-to-talk', () => {
    for (const alt of ['ralt', 'lalt']) {
      const opcao = ATALHOS.win32.ptt.find(([v]) => v === alt)
      expect(opcao[2], `${alt} sem aviso`).toBeTruthy()
    }
    expect(ATALHOS.win32.ptt.find(([v]) => v === 'ralt')[2]).toMatch(/AltGr/)
    // e o default não é nenhuma delas
    expect(ATALHOS.win32.padraoPtt).toBe('rctrl')
  })

  it('a ordem canônica dos modificadores é estável', () => {
    // é a ordem em que o spec é serializado; mudá-la faria todo valor já
    // gravado deixar de bater com o que a UI monta
    expect(MODIFICADORES).toEqual(['ctrl', 'alt', 'shift', 'win'])
  })
})
