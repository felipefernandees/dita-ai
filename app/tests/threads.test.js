import { describe, it, expect } from 'vitest'
import { threadsDeInferencia } from '../src/main/whisper.js'

// A conta de threads é uma decisão de desempenho invisível: errada, ela não
// quebra nada — só deixa o ditado mais lento do que precisava, e ninguém
// desconfia. Estes casos fixam as duas premissas de hardware que ela mistura.
describe('threads de inferência', () => {
  it('no Apple Silicon usa os núcleos de PERFORMANCE, não metade do total', () => {
    // M4 base: 10 núcleos, 4 performance + 6 eficiência. Metade daria 5, e o
    // quinto thread cairia num E-core segurando o lote inteiro.
    expect(threadsDeInferencia({ plataforma: 'darwin', logicos: 10, performance: 4, env: {} })).toBe(4)
  })

  it('no Mac Intel, sem perflevel, volta a contar metade dos lógicos (lá o SMT é real)', () => {
    expect(threadsDeInferencia({ plataforma: 'darwin', logicos: 12, performance: 0, env: {} })).toBe(6)
  })

  it('no Windows continua com a medição do Ryzen: metade dos lógicos', () => {
    expect(threadsDeInferencia({ plataforma: 'win32', logicos: 16, performance: 0, env: {} })).toBe(8)
  })

  it('nunca passa de 8, nem numa máquina enorme', () => {
    expect(threadsDeInferencia({ plataforma: 'darwin', logicos: 32, performance: 16, env: {} })).toBe(8)
    expect(threadsDeInferencia({ plataforma: 'win32', logicos: 64, performance: 0, env: {} })).toBe(8)
  })

  it('nunca devolve zero numa máquina de 1 núcleo', () => {
    expect(threadsDeInferencia({ plataforma: 'win32', logicos: 1, performance: 0, env: {} })).toBe(1)
    expect(threadsDeInferencia({ plataforma: 'darwin', logicos: 1, performance: 1, env: {} })).toBe(1)
  })

  it('DITA_THREADS vence tudo: é o override de quem está medindo', () => {
    expect(threadsDeInferencia({ plataforma: 'darwin', logicos: 10, performance: 4, env: { DITA_THREADS: '2' } })).toBe(2)
  })

  it('nesta máquina devolve um número plausível de threads', () => {
    const n = threadsDeInferencia({ env: {} })
    expect(Number.isInteger(n)).toBe(true)
    expect(n).toBeGreaterThanOrEqual(1)
    expect(n).toBeLessThanOrEqual(8)
  })
})
