import { describe, it, expect, vi } from 'vitest'
import { createHotkeyMachine } from '../src/main/hotkeys.js'

function makeMachine(nowValues = []) {
  let i = 0
  const now = () => nowValues[Math.min(i++, nowValues.length - 1)] ?? 0
  const cbs = { onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn() }
  return { m: createHotkeyMachine({ ...cbs, now }), cbs }
}

describe('hotkey machine', () => {
  it('toggle liga e desliga', () => {
    const { m, cbs } = makeMachine([0, 5000])
    m.handle('toggle')
    expect(cbs.onStart).toHaveBeenCalledOnce()
    expect(m.state()).toBe('recording')
    m.handle('toggle')
    expect(cbs.onStop).toHaveBeenCalledOnce()
    expect(m.state()).toBe('idle')
  })

  it('ptt segura e solta com duração válida', () => {
    const { m, cbs } = makeMachine([0, 2000])
    m.handle('ptt_down')
    expect(cbs.onStart).toHaveBeenCalledOnce()
    m.handle('ptt_up')
    expect(cbs.onStop).toHaveBeenCalledOnce()
  })

  it('ptt curto demais cancela em vez de processar', () => {
    const { m, cbs } = makeMachine([0, 150])
    m.handle('ptt_down')
    m.handle('ptt_up')
    expect(cbs.onStop).not.toHaveBeenCalled()
    expect(cbs.onCancel).toHaveBeenCalledOnce()
  })

  it('ptt_abort (combo) cancela', () => {
    const { m, cbs } = makeMachine([0, 2000])
    m.handle('ptt_down')
    m.handle('ptt_abort')
    expect(cbs.onCancel).toHaveBeenCalledOnce()
    expect(m.state()).toBe('idle')
  })

  it('esc cancela gravação em andamento', () => {
    const { m, cbs } = makeMachine([0, 2000])
    m.handle('toggle')
    m.handle('esc')
    expect(cbs.onCancel).toHaveBeenCalledOnce()
    expect(m.state()).toBe('idle')
  })

  it('ptt_down ignorado se já gravando por toggle', () => {
    const { m, cbs } = makeMachine([0, 1000, 2000])
    m.handle('toggle')
    m.handle('ptt_down')
    expect(cbs.onStart).toHaveBeenCalledOnce()
  })
})
