import { describe, it, expect, afterEach, vi } from 'vitest'
import { ATALHOS, validarToggle } from '../src/renderer/src/atalhos.js'

// Assim como em paths.test.js, o módulo calcula seus valores em tempo de
// import a partir de process.platform. Só trocar process.platform depois do
// import não teria efeito nenhum. Por isso cada teste troca a plataforma,
// invalida o cache de módulos do Vitest com resetModules() e reimporta
// dinamicamente — isso garante que os dois branches (darwin e win32) são
// verificados na mesma máquina, em vez de metade do contrato nunca ser
// exercitada dependendo de onde a suíte roda.
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor)
})

async function loadDefaultsFor(platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  vi.resetModules()
  return import('../src/main/defaults.js')
}

describe('defaults de atalho', () => {
  it('nunca oferece fn no Windows: Fn não chega ao hook de teclado', async () => {
    const { DEFAULT_TOGGLE } = await loadDefaultsFor('win32')
    expect(DEFAULT_TOGGLE).not.toContain('fn')
  })

  it('nunca usa right alt como PTT no Windows: AltGr no teclado ABNT2', async () => {
    const { DEFAULT_PTT } = await loadDefaultsFor('win32')
    expect(DEFAULT_PTT).not.toBe('ralt')
  })

  it('mantém fn+space e rcmd como default no macOS', async () => {
    const { DEFAULT_TOGGLE, DEFAULT_PTT } = await loadDefaultsFor('darwin')
    expect(DEFAULT_TOGGLE).toBe('fn+space')
    expect(DEFAULT_PTT).toBe('rcmd')
  })

  // TOGGLE_OPTIONS/PTT_OPTIONS saíram do defaults.js: no Windows o atalho
  // principal virou uma gramática, não uma lista, e o que sobrou de lista é
  // apresentação (com rótulo em português) e mora no atalhos.js do renderer.
  // O que continua sendo contrato aqui são os DEFAULTS — o index.js os passa
  // direto para a linha de comando do helper.
  it('não reintroduz listas de opções no processo main', async () => {
    const mod = await loadDefaultsFor('win32')
    expect(Object.keys(mod).sort()).toEqual(['DEFAULT_PTT', 'DEFAULT_TOGGLE'])
  })

  // O caminho do default é o único que roda sem o usuário ter escolhido nada:
  // se ele não passar pelo parser, TODO usuário novo cai no fallback interno do
  // helper — que hoje coincide, mas coincidência não é contrato.
  it.each(['win32', 'darwin'])('o default de %s é um spec válido pela gramática daquele helper', async (plataforma) => {
    const { DEFAULT_TOGGLE, DEFAULT_PTT } = await loadDefaultsFor(plataforma)
    expect(validarToggle(DEFAULT_TOGGLE, plataforma)).toEqual({ ok: true, spec: DEFAULT_TOGGLE })
    expect(ATALHOS[plataforma].ptt.map(([v]) => v)).toContain(DEFAULT_PTT)
  })

  // O default do macOS usa a tecla Fn, que o KeyboardEvent do Chromium não
  // entrega: sem um preset para ele, quem trocasse o atalho não teria como
  // voltar ao que o app sempre usou.
  it('o default do macOS é alcançável pela UI mesmo sem captura', async () => {
    const { DEFAULT_TOGGLE } = await loadDefaultsFor('darwin')
    expect(ATALHOS.darwin.presets.map(([v]) => v)).toContain(DEFAULT_TOGGLE)
  })
})
