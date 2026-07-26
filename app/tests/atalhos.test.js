import { describe, it, expect, afterEach, vi } from 'vitest'
import { ATALHOS } from '../src/renderer/src/atalhos.js'

// A tabela de rótulos do renderer (atalhos.js) e o contrato de fio com o
// helper C# (main/defaults.js) são dois arquivos por decisão de projeto — um
// carrega português, o outro carrega os literais que o helper faz parse. Nada
// na linguagem impede que divirjam: renomear 'rctrl' só em um dos dois faria o
// <select> gravar um valor que o helper ignora, silenciosamente, sem erro em
// runtime nem em build. Este arquivo é o único lugar que percebe.
//
// defaults.js calcula tudo em tempo de import a partir de process.platform,
// então trocar a plataforma depois do import não teria efeito. Mesmo idioma de
// shortcut-defaults.test.js: troca a plataforma, invalida o cache de módulos e
// reimporta — assim os dois branches são checados na mesma máquina, em vez de
// metade do contrato nunca ser exercitada dependendo de onde a suíte roda.
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor)
})

async function loadDefaultsFor(platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  vi.resetModules()
  return import('../src/main/defaults.js')
}

// atalhos.js não depende de process.platform (chaveia as duas plataformas de
// uma vez), então só defaults.js precisa ser reimportado por plataforma.
const valores = (pares) => pares.map(([valor]) => valor)

describe('rótulos de Preferências x contrato de atalhos', () => {
  for (const platform of ['win32', 'darwin']) {
    describe(platform, () => {
      it('oferece exatamente as opções de toggle do contrato, na mesma ordem', async () => {
        const { TOGGLE_OPTIONS } = await loadDefaultsFor(platform)
        // ordem importa: é a ordem em que o <select> lista, e a primeira é o
        // que o usuário vê antes de abrir o menu
        expect(valores(ATALHOS[platform].toggle)).toEqual([...TOGGLE_OPTIONS])
      })

      it('oferece exatamente as opções de push-to-talk do contrato, na mesma ordem', async () => {
        const { PTT_OPTIONS } = await loadDefaultsFor(platform)
        expect(valores(ATALHOS[platform].ptt)).toEqual([...PTT_OPTIONS])
      })

      it('usa o mesmo default que o main process', async () => {
        const { DEFAULT_TOGGLE, DEFAULT_PTT } = await loadDefaultsFor(platform)
        // se divergirem, o <select> abre pré-selecionado num valor diferente
        // do que o helper já está escutando: a UI mente sobre o estado real
        expect(ATALHOS[platform].padraoToggle).toBe(DEFAULT_TOGGLE)
        expect(ATALHOS[platform].padraoPtt).toBe(DEFAULT_PTT)
      })

      it('dá um rótulo não-vazio e único para cada opção', async () => {
        // um rótulo faltando não quebra nada em runtime — o <option> só
        // aparece em branco, o que é pior que quebrar
        const rotulos = [...ATALHOS[platform].toggle, ...ATALHOS[platform].ptt].map(([, r]) => r)
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
})
