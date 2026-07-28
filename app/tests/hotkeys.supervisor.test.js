import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { startHotkeys } from '../src/main/hotkeys.js'

// Dublê do processo filho. Precisa ser EventEmitter de verdade: o que está
// sendo testado é justamente a reação a 'exit' e 'error'.
function filhoFalso() {
  const ee = new EventEmitter()
  ee.stdout = new EventEmitter()
  ee.stdin = { write: vi.fn() }
  ee.kill = vi.fn()
  return ee
}

// Agendador controlado: o backoff é a regra sob teste, e esperar 4s de verdade
// tornaria a suíte lenta e instável.
function agendador() {
  let fila = []
  return {
    agendar: (fn, ms) => fila.push({ fn, ms }),
    esperas: () => fila.map((t) => t.ms),
    disparar: () => { const q = fila; fila = []; q.forEach((t) => t.fn()) }
  }
}

function montar({ maquinaGravando = false } = {}) {
  const filhos = []
  const spawnFn = vi.fn(() => { const f = filhoFalso(); filhos.push(f); return f })
  const relogio = agendador()
  let t = 0

  const cancelExternally = vi.fn()
  const machine = {
    state: () => (maquinaGravando ? 'recording' : 'idle'),
    handle: vi.fn(),
    cancelExternally
  }

  const onHelperCaiu = vi.fn()
  const onHelperVoltou = vi.fn()

  const h = startHotkeys({
    helperPath: 'fake.exe',
    args: ['hotkeys'],
    machine,
    onHelperCaiu,
    onHelperVoltou,
    spawnFn,
    agendar: relogio.agendar,
    agora: () => t
  })

  return {
    h, filhos, spawnFn, relogio, machine, cancelExternally, onHelperCaiu, onHelperVoltou,
    avancar: (ms) => { t += ms },
    ultimo: () => filhos[filhos.length - 1]
  }
}

describe('supervisor do helper', () => {
  it('sobe o helper na criação', () => {
    const c = montar()
    expect(c.spawnFn).toHaveBeenCalledOnce()
    expect(c.h.vivo()).toBe(true)
  })

  it('reinicia quando o helper morre', () => {
    const c = montar()
    c.ultimo().emit('exit', 1, null)
    expect(c.h.vivo()).toBe(false)

    c.relogio.disparar()
    expect(c.spawnFn).toHaveBeenCalledTimes(2)
    expect(c.h.vivo()).toBe(true)
    expect(c.onHelperVoltou).toHaveBeenCalledOnce()
  })

  it('espera mais a cada queda seguida (backoff)', () => {
    const c = montar()
    const esperas = []
    for (let i = 0; i < 5; i++) {
      c.ultimo().emit('exit', 1, null)
      esperas.push(c.relogio.esperas()[0])
      c.relogio.disparar()
    }
    expect(esperas).toEqual([250, 500, 1000, 2000, 4000])
  })

  it('desiste depois de esgotar as tentativas e AVISA', () => {
    const c = montar()
    for (let i = 0; i < 5; i++) { c.ultimo().emit('exit', 1, null); c.relogio.disparar() }
    expect(c.onHelperCaiu).not.toHaveBeenCalled()

    c.ultimo().emit('exit', 1, null)
    expect(c.onHelperCaiu).toHaveBeenCalledOnce()
    expect(c.onHelperCaiu.mock.calls[0][0].tentativas).toBe(5)
    // silêncio é o que estamos consertando: nada de reiniciar para sempre calado
    expect(c.relogio.esperas()).toEqual([])
  })

  it('helper estável zera o contador de tentativas', () => {
    const c = montar()
    c.ultimo().emit('exit', 1, null)
    c.relogio.disparar()
    expect(c.h.tentativas()).toBe(1)

    c.avancar(30000) // sobreviveu ao limiar de estabilidade
    c.ultimo().emit('exit', 1, null)
    // zerou antes de contar esta queda
    expect(c.h.tentativas()).toBe(1)
    expect(c.relogio.esperas()[0]).toBe(250)
  })

  it('error e exit da MESMA morte consomem só uma tentativa', () => {
    // spawn de binário ausente emite os dois; sem guarda, um crash gastaria duas
    const c = montar()
    const f = c.ultimo()
    f.emit('error', new Error('ENOENT'))
    f.emit('exit', null, null)
    expect(c.relogio.esperas()).toHaveLength(1)
    expect(c.h.tentativas()).toBe(1)
  })

  it("'error' de spawn não derruba o processo", () => {
    // Sem listener, um 'error' de child_process é exceção não tratada e mata o
    // main inteiro. Este teste falharia com throw, não com asserção.
    const c = montar()
    expect(() => c.ultimo().emit('error', new Error('EACCES'))).not.toThrow()
    expect(c.onHelperCaiu).not.toHaveBeenCalled() // ainda há tentativas
  })

  it('kill() encerra de vez e não reinicia', () => {
    const c = montar()
    c.h.kill()
    expect(c.h.vivo()).toBe(false)

    c.ultimo().emit('exit', 0, null)
    c.relogio.disparar()
    expect(c.spawnFn).toHaveBeenCalledOnce()
    expect(c.onHelperCaiu).not.toHaveBeenCalled()
  })

  it('reaplica o estado de gravação no helper novo', () => {
    const c = montar()
    c.h.setRecordingState(true)
    expect(c.ultimo().stdin.write).toHaveBeenCalledWith('state on\n')

    const antigo = c.ultimo()
    antigo.emit('exit', 1, null)
    c.relogio.disparar()

    expect(c.ultimo()).not.toBe(antigo)
    expect(c.ultimo().stdin.write).toHaveBeenCalledWith('state on\n')
  })

  it('cancela o ditado em curso quando o helper cai', () => {
    // Cancelar e não finalizar: a fala foi cortada por um crash, e finalizar
    // colaria frase truncada no documento do usuário — isso não tem desfazer.
    const c = montar({ maquinaGravando: true })
    c.ultimo().emit('exit', 1, null)
    expect(c.cancelExternally).toHaveBeenCalledWith('helper_caiu')
  })

  it('não mexe na máquina quando não havia ditado em curso', () => {
    const c = montar({ maquinaGravando: false })
    c.ultimo().emit('exit', 1, null)
    expect(c.cancelExternally).not.toHaveBeenCalled()
  })

  it('continua entregando eventos do helper reiniciado', () => {
    const c = montar()
    c.ultimo().emit('exit', 1, null)
    c.relogio.disparar()

    c.ultimo().stdout.emit('data', Buffer.from('{"event":"toggle"}\n'))
    expect(c.machine.handle).toHaveBeenCalledWith('toggle')
  })
})
