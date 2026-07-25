import { describe, it, expect, afterEach, vi } from 'vitest'

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
    const { DEFAULT_TOGGLE, TOGGLE_OPTIONS } = await loadDefaultsFor('win32')
    expect(DEFAULT_TOGGLE).not.toContain('fn')
    expect(TOGGLE_OPTIONS).not.toContain('fn+space')
  })

  it('nunca usa right alt como PTT no Windows: AltGr no teclado ABNT2', async () => {
    const { DEFAULT_PTT } = await loadDefaultsFor('win32')
    expect(DEFAULT_PTT).not.toBe('ralt')
  })

  it('o default sempre está entre as opções oferecidas, no Windows e no macOS', async () => {
    for (const platform of ['win32', 'darwin']) {
      const { DEFAULT_TOGGLE, DEFAULT_PTT, TOGGLE_OPTIONS, PTT_OPTIONS } = await loadDefaultsFor(platform)
      expect(TOGGLE_OPTIONS).toContain(DEFAULT_TOGGLE)
      expect(PTT_OPTIONS).toContain(DEFAULT_PTT)
    }
  })

  it('mantém fn+space e rcmd como default no macOS', async () => {
    const { DEFAULT_TOGGLE, DEFAULT_PTT } = await loadDefaultsFor('darwin')
    expect(DEFAULT_TOGGLE).toBe('fn+space')
    expect(DEFAULT_PTT).toBe('rcmd')
  })
})
