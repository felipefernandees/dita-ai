import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ATALHOS, teclasBase, validarToggle } from '../src/renderer/src/atalhos.js'

// O irmão macOS de helper-win.emit.test.js.
//
// A UI monta o spec (src/renderer/src/atalhos.js) e o helper Swift faz o parse
// dele (helper/ShortcutSpec.swift). São duas implementações da MESMA gramática,
// em linguagens diferentes, e nada impede que divirjam: a UI grava um valor, o
// helper não reconhece, cai no default, e o usuário só percebe que "o atalho
// não pegou" — sem erro em runtime, sem vermelho em build.
//
// Este teste alimenta os mesmos specs nos dois e compara veredicto com
// veredicto, usando o modo `parse` do helper de verdade.
const HERE = dirname(fileURLToPath(import.meta.url))
const HELPER = join(HERE, '../../helper/dita-hotkeys')

const temHelper = process.platform === 'darwin' && existsSync(HELPER)

function parseNativo(specs) {
  const saida = execFileSync(HELPER, ['parse', ...specs], { encoding: 'utf8', timeout: 20000 })
  return JSON.parse(saida)
}

function pttNativo(specs) {
  const saida = execFileSync(HELPER, ['ptt', ...specs], { encoding: 'utf8', timeout: 20000 })
  return JSON.parse(saida)
}

// Não é uma amostra ao acaso: cada linha existe por um motivo que já mordeu
// alguém — valor legado, alias, ordem trocada, tecla nua, reservada, spec da
// outra plataforma, lixo.
const CASOS = [
  // os quatro valores que qualquer usuário do app pode ter no settings.json
  'fn+space', 'opt+space', 'ctrl+space', 'f5',
  // aliases
  'alt+space', 'option+space', 'command+j', 'meta+j', 'win+j', 'control+space',
  // combinações que a lista fixa antiga não expressava
  'ctrl+opt+j', 'cmd+shift+d', 'fn+f5', 'opt+semicolon', 'ctrl+intlro', 'cmd+shift+opt+ctrl+f12',
  // ordem trocada e caixa alta: têm que canonicalizar igual nos dois
  'shift+ctrl+space', 'CTRL+Shift+Space', 'space+ctrl', 'tab+cmd',
  // teclas nuas
  'j', 'space', 'semicolon', '7', 'enter', 'up', 'f1', 'f20',
  // fora do vocabulário do macOS
  'f21', 'f24', 'insert',
  // reservadas
  'cmd+tab', 'cmd+q', 'cmd+w', 'ctrl+cmd+q',
  // só modificadores
  'ctrl', 'cmd', 'fn', 'ctrl+shift',
  // lixo
  '', '   ', 'ctrl++j', 'ctrl+a+b', 'ctrl+ctrl+j', 'ctrl+shift+banana'
]

describe.skipIf(!temHelper)('paridade entre o parser Swift e o espelho em JS', () => {
  it('os dois aceitam e recusam exatamente os mesmos specs', () => {
    const nativos = parseNativo(CASOS)
    expect(nativos.length).toBe(CASOS.length)

    for (let i = 0; i < CASOS.length; i++) {
      const spec = CASOS[i]
      const nativo = nativos[i]
      const js = validarToggle(spec, 'darwin')

      expect(nativo.ok, `divergência de veredicto em '${spec}': Swift ${nativo.ok}, JS ${js.ok}`).toBe(js.ok)
      if (js.ok) {
        // A forma canônica também precisa bater: é ela que o filtro de
        // reservadas compara e ela que a UI mostra.
        expect(nativo.canonico, `canônico diferente em '${spec}'`).toBe(js.spec)
      } else {
        expect(nativo.motivo, `motivo diferente em '${spec}'`).toBe(js.motivo)
      }
    }
  })

  it('todo token do vocabulário do JS existe na tabela do Swift', () => {
    // Um token que só existe de um lado é o pior caso: a UI oferece a tecla, o
    // usuário grava, e o helper cai no default sem dizer nada.
    const tokens = Object.values(teclasBase('darwin'))
    const nativos = parseNativo(tokens.map((t) => `ctrl+${t}`))
    for (let i = 0; i < tokens.length; i++) {
      expect(nativos[i].ok, `o Swift não conhece a tecla '${tokens[i]}'`).toBe(true)
      expect(nativos[i].keyCode, `keycode zerado para '${tokens[i]}'`).toBeGreaterThanOrEqual(0)
    }
  })

  it('cada tecla base tem um keycode ÚNICO no Swift', () => {
    // Duas teclas com o mesmo keycode significam que uma delas está errada na
    // tabela — e o sintoma seria um atalho disparando na tecla errada.
    const tokens = Object.values(teclasBase('darwin'))
    const nativos = parseNativo(tokens.map((t) => `ctrl+${t}`))
    const porCodigo = new Map()
    for (let i = 0; i < tokens.length; i++) {
      const anterior = porCodigo.get(nativos[i].keyCode)
      expect(anterior, `'${tokens[i]}' e '${anterior}' têm o mesmo keycode ${nativos[i].keyCode}`).toBeUndefined()
      porCodigo.set(nativos[i].keyCode, tokens[i])
    }
  })

  it('o helper aceita todas as opções de push-to-talk que a UI oferece', () => {
    const opcoes = ATALHOS.darwin.ptt.map(([v]) => v)
    const nativos = pttNativo(opcoes)
    for (let i = 0; i < opcoes.length; i++) {
      expect(nativos[i].ok, `o Swift não conhece o PTT '${opcoes[i]}'`).toBe(true)
    }
    // e as opções são teclas físicas distintas
    const codes = nativos.map((n) => n.keyCode)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('os aliases de push-to-talk vindos do Windows não viram erro', () => {
    const [ralt, lalt] = pttNativo(['ralt', 'lalt'])
    const [ropt, lopt] = pttNativo(['ropt', 'lopt'])
    expect(ralt.keyCode).toBe(ropt.keyCode)
    expect(lalt.keyCode).toBe(lopt.keyCode)
  })

  it('o default da UI é válido no parser nativo, nas duas pontas', () => {
    // O default é o único caminho que roda sem o usuário ter escolhido nada: se
    // ele não passasse pelo parser, TODO usuário novo cairia no fallback
    // interno do helper — que hoje coincide, mas coincidência não é contrato.
    const [toggle] = parseNativo([ATALHOS.darwin.padraoToggle])
    expect(toggle.ok).toBe(true)
    expect(toggle.canonico).toBe(ATALHOS.darwin.padraoToggle)

    const [ptt] = pttNativo([ATALHOS.darwin.padraoPtt])
    expect(ptt.ok).toBe(true)
  })

  it('os presets da UI são exatamente as combinações que a captura não alcança', () => {
    for (const [spec] of ATALHOS.darwin.presets) {
      // Válidos no parser nativo...
      expect(parseNativo([spec])[0].ok, `preset inválido: ${spec}`).toBe(true)
      // ...e todos com a tecla Fn, que é a única que o KeyboardEvent do
      // Chromium não entrega no macOS. Um preset sem Fn seria um botão a mais
      // para algo que o usuário já consegue capturar apertando.
      expect(spec.split('+'), `preset ${spec} não precisa ser preset`).toContain('fn')
    }
  })
})
