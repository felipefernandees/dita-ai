import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ Tray: class {}, Menu: {}, nativeImage: {}, app: { quit() {} } }))
const { montarModelo, resumo } = await import('../src/main/tray.js')

const rotulos = (m) => m.map((i) => i.label || (i.type === 'separator' ? '---' : ''))

describe('menu da barra de cima (ordem do Wispr Flow)', () => {
  it('mostra o último ditado e as ações de copiar e colar', () => {
    const copiar = vi.fn()
    const m = montarModelo({ ultimo: 'Oi Max, a proposta da Seviva sai hoje', acoes: { copiarUltimo: copiar } })
    expect(rotulos(m).slice(0, 5)).toEqual(['Abrir Dita Aí', '---', '“Oi Max, a proposta da Seviva sai hoje”', 'Copiar último ditado', 'Colar último ditado'])
    m.find((i) => i.label === 'Copiar último ditado').click()
    expect(copiar).toHaveBeenCalledOnce()
  })

  it('sem ditado ainda: copiar e colar desligados', () => {
    const m = montarModelo({ ultimo: '' })
    expect(m[2].label).toBe('Nenhum ditado ainda')
    expect(m.find((i) => i.label === 'Copiar último ditado').enabled).toBe(false)
  })

  it('microfone: automático marcado por padrão e a lista vem do sistema', () => {
    const m = montarModelo({ microfones: [{ deviceId: 'a', label: 'AirPods Pro' }] })
    const sub = m.find((i) => i.label === 'Microfone').submenu
    expect(sub[0]).toMatchObject({ label: 'Automático (microfone do Mac)', checked: true })
    expect(sub.at(-1)).toMatchObject({ label: 'AirPods Pro', checked: false })
  })

  it('resumo cabe numa linha', () => {
    expect(resumo('a\nb   c')).toBe('a b c')
    expect(resumo('x'.repeat(100))).toHaveLength(48)
  })

  it('Mostrar pílula na tela: caixa marcada conforme o ajuste e clique inverte', () => {
    const pilula = vi.fn()
    const itens = montarModelo({ mostrarPilula: false, acoes: { pilula } })
    const item = itens.find((i) => i.label === 'Mostrar pílula na tela')
    expect(item.type).toBe('checkbox')
    expect(item.checked).toBe(false)
    item.click()
    expect(pilula).toHaveBeenCalledWith(true)
  })
})
