import { describe, it, expect, vi } from 'vitest'
import { createHotkeyMachine, DEBOUNCE_MS } from '../src/main/hotkeys.js'

// Cada caso aqui é uma regra do atalho do Wispr Flow. O relógio e os timers são
// de mentira: `t` avança à mão e `rodarTimers()` dispara o que venceu.
function maquina() {
  let t = 0
  let timers = []
  const cbs = { onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(), onModo: vi.fn() }
  const m = createHotkeyMachine({
    ...cbs,
    now: () => t,
    agendar: (fn, ms) => { const h = { fn, quando: t + ms }; timers.push(h); return h },
    desagendar: (h) => { timers = timers.filter((x) => x !== h) }
  })
  const avancar = (ms) => {
    t += ms
    const vencidos = timers.filter((h) => h.quando <= t)
    timers = timers.filter((h) => h.quando > t)
    vencidos.forEach((h) => h.fn())
  }
  return { m, cbs, avancar }
}

describe('atalho igual ao Wispr Flow', () => {
  it('segurar a Fn por 500 ms ou mais e soltar: processa', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down')
    expect(cbs.onStart).toHaveBeenCalledWith(1, 'ptt')
    avancar(800)
    m.handle('ptt_up')
    expect(cbs.onStop).toHaveBeenCalledOnce()
    expect(m.state()).toBe('idle')
  })

  it('toque curto sem segundo toque: descarta depois de 500 ms, não cola nada', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down')
    avancar(120)
    m.handle('ptt_up')
    expect(m.state()).toBe('recording') // ainda esperando o segundo toque
    avancar(DEBOUNCE_MS)
    expect(cbs.onCancel).toHaveBeenCalledWith('short')
    expect(cbs.onStop).not.toHaveBeenCalled()
  })

  it('toque duplo: trava em mãos livres e soltar a tecla não encerra', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down'); avancar(100); m.handle('ptt_up')
    avancar(150)
    m.handle('ptt_down')
    expect(cbs.onModo).toHaveBeenCalledWith('travado')
    expect(m.modo()).toBe('travado')
    avancar(100); m.handle('ptt_up')
    avancar(5000)
    expect(m.state()).toBe('recording')
    expect(cbs.onStart).toHaveBeenCalledOnce()
  })

  it('travado: novo toque encerra e processa (ao soltar a tecla)', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down'); avancar(100); m.handle('ptt_up'); avancar(100); m.handle('ptt_down'); m.handle('ptt_up')
    avancar(4000)
    m.handle('ptt_down')
    expect(cbs.onStop).not.toHaveBeenCalled()
    avancar(90); m.handle('ptt_up')
    expect(cbs.onStop).toHaveBeenCalledOnce()
    expect(m.state()).toBe('idle')
    expect(cbs.onStart).toHaveBeenCalledOnce()
  })

  it('toque triplo: o terceiro toque logo depois de travar cancela', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down'); avancar(80); m.handle('ptt_up'); avancar(80)
    m.handle('ptt_down'); avancar(60); m.handle('ptt_up'); avancar(80)
    m.handle('ptt_down'); avancar(60); m.handle('ptt_up')
    expect(cbs.onCancel).toHaveBeenCalledWith('triplo')
    expect(cbs.onStop).not.toHaveBeenCalled()
  })

  it('Fn + Espaço parado: trava direto', () => {
    const { m, cbs } = maquina()
    m.handle('toggle')
    expect(cbs.onStart).toHaveBeenCalledWith(1, 'travado')
    expect(m.modo()).toBe('travado')
  })

  it('Fn + Espaço chega como ptt_down, toggle e ptt_abort: um ditado travado só', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down'); avancar(40); m.handle('toggle'); avancar(80); m.handle('ptt_abort')
    avancar(3000)
    expect(cbs.onStart).toHaveBeenCalledOnce()
    expect(m.state()).toBe('recording')
    expect(m.modo()).toBe('travado')
  })

  it('Fn + Espaço de novo encerra sem reabrir um ditado', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('toggle')
    avancar(3000)
    m.handle('ptt_down'); m.handle('toggle'); m.handle('ptt_abort')
    expect(cbs.onStop).toHaveBeenCalledOnce()
    expect(cbs.onStart).toHaveBeenCalledOnce()
    expect(m.state()).toBe('idle')
  })

  it('tecla de falar + outra tecla logo de cara (⌘C) é atalho: descarta', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down'); avancar(200); m.handle('ptt_abort')
    expect(cbs.onCancel).toHaveBeenCalledWith('abort')
    expect(cbs.onStop).not.toHaveBeenCalled()
  })

  it('já ditando e usa um atalho (⌘⇧4 no meio da fala): a fala não se perde', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down'); avancar(3000); m.handle('ptt_abort')
    expect(cbs.onStop).toHaveBeenCalledOnce()
    expect(cbs.onCancel).not.toHaveBeenCalled()
  })

  it('mãos livres + atalho com a tecla de falar (print com ⌘⇧4): segue ditando', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down'); avancar(100); m.handle('ptt_up'); avancar(100); m.handle('ptt_down'); m.handle('ptt_up')
    avancar(5000)
    m.handle('ptt_down'); avancar(400); m.handle('ptt_abort')
    avancar(3000)
    expect(m.state()).toBe('recording')
    expect(cbs.onStop).not.toHaveBeenCalled()
    expect(cbs.onCancel).not.toHaveBeenCalled()
    // e um toque limpo depois ainda encerra
    m.handle('ptt_down'); avancar(80); m.handle('ptt_up')
    expect(cbs.onStop).toHaveBeenCalledOnce()
  })

  it('Esc cancela', () => {
    const { m, cbs } = maquina()
    m.handle('toggle')
    m.handle('esc')
    expect(cbs.onCancel).toHaveBeenCalledWith('esc')
    expect(m.state()).toBe('idle')
  })

  it('o timer do toque curto não derruba um ditado mais novo', () => {
    const { m, cbs, avancar } = maquina()
    m.handle('ptt_down'); avancar(100); m.handle('ptt_up')
    m.cancelExternally('button')
    m.handle('toggle')
    avancar(DEBOUNCE_MS * 2)
    expect(m.state()).toBe('recording')
    expect(cbs.onCancel).toHaveBeenCalledTimes(1)
  })
})
