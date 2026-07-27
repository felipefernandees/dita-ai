import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { clipboard } from 'electron'
import { pasteText, getFrontmostApp } from '../src/main/paster.win32.js'

// Testes de contrato de verdade, não só "a função existe" (era o que
// paster-dispatch.test.js cobria). Ver tests/stubs/dita-helper-stub.cjs pra
// como o "helper" fake funciona.
const HERE = dirname(fileURLToPath(import.meta.url))
const STUB = join(HERE, 'stubs/dita-helper-stub.cjs')

function configurarHelper({ exitCode = 0, stdout = '' } = {}) {
  process.env.DITA_HELPER = process.execPath
  process.env.NODE_OPTIONS = `--require ${JSON.stringify(STUB)}`
  process.env.DITA_HELPER_STUB_EXIT = String(exitCode)
  process.env.DITA_HELPER_STUB_STDOUT = stdout
}

afterEach(() => {
  delete process.env.DITA_HELPER
  delete process.env.NODE_OPTIONS
  delete process.env.DITA_HELPER_STUB_EXIT
  delete process.env.DITA_HELPER_STUB_STDOUT
  vi.useRealTimers()
})

describe('paster.win32 — getFrontmostApp', () => {
  it('devolve o stdout do helper quando ele sai com código 0', async () => {
    configurarHelper({ exitCode: 0, stdout: 'Code.exe' })
    expect(await getFrontmostApp()).toBe('Code.exe')
  })

  it('devolve string vazia (não lança) quando o helper sai com código != 0', async () => {
    configurarHelper({ exitCode: 1 })
    expect(await getFrontmostApp()).toBe('')
  })
})

describe('paster.win32 — pasteText', () => {
  beforeEach(() => {
    // Timers falsos no bloco inteiro, não só nos testes que avançam o relógio:
    // pasteText SEMPRE agenda a restauração de 400ms. Um único teste com timer
    // real deixa esse setTimeout pendente, ele dispara no meio de um teste
    // seguinte e restaura o clipboard por baixo dele. O afterEach volta pra
    // timers reais e descarta o que ficou pendente.
    vi.useFakeTimers()
    clipboard.writeText('')
  })

  it('salva o clipboard anterior, escreve o texto novo e devolve true quando o helper sai com 0', async () => {
    configurarHelper({ exitCode: 0 })
    clipboard.writeText('texto antigo do usuário')

    const ok = await pasteText('texto ditado')

    expect(ok).toBe(true)
    expect(clipboard.readText()).toBe('texto ditado')
  })

  it('restaura o clipboard anterior 400ms depois, se ele ainda tiver o texto colado', async () => {
    vi.useFakeTimers()
    configurarHelper({ exitCode: 0 })
    clipboard.writeText('texto antigo do usuário')

    await pasteText('texto ditado')
    expect(clipboard.readText()).toBe('texto ditado')

    await vi.advanceTimersByTimeAsync(400)

    expect(clipboard.readText()).toBe('texto antigo do usuário')
  })

  it('NÃO restaura se o usuário já sobrescreveu o clipboard antes dos 400ms', async () => {
    vi.useFakeTimers()
    configurarHelper({ exitCode: 0 })
    clipboard.writeText('texto antigo do usuário')

    await pasteText('texto ditado')
    clipboard.writeText('usuário copiou outra coisa nesse meio tempo')

    await vi.advanceTimersByTimeAsync(400)

    expect(clipboard.readText()).toBe('usuário copiou outra coisa nesse meio tempo')
  })

  it('NÃO restaura quando não havia clipboard anterior (string vazia)', async () => {
    vi.useFakeTimers()
    configurarHelper({ exitCode: 0 })
    clipboard.writeText('') // nada antes de colar

    await pasteText('texto ditado')
    await vi.advanceTimersByTimeAsync(400)

    // guard é `if (... && previous)`: previous vazio nunca restaura
    expect(clipboard.readText()).toBe('texto ditado')
  })

  it('devolve false e NÃO agenda restauração quando o helper sai com código != 0', async () => {
    vi.useFakeTimers()
    configurarHelper({ exitCode: 1 }) // SendInput bloqueado, ex: janela elevada
    clipboard.writeText('texto antigo do usuário')

    const ok = await pasteText('texto ditado')

    expect(ok).toBe(false)
    // clipboard já tinha sido escrito ANTES do helper rodar; a falha não
    // desfaz isso, só não agenda a restauração dos 400ms.
    expect(clipboard.readText()).toBe('texto ditado')

    await vi.advanceTimersByTimeAsync(1000)
    expect(clipboard.readText()).toBe('texto ditado') // nada mudou depois
  })
})
