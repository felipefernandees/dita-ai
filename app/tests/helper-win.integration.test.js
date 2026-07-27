import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Os testes rodam como ESM sob o vitest, onde __dirname não existe.
const HERE = dirname(fileURLToPath(import.meta.url))
const HELPER = join(HERE, '../../helper-win/dist/dita-helper.exe')
const run = process.platform === 'win32' && existsSync(HELPER)

// Lê o stdout do helper linha a linha e resolve quando `predicate` aceitar o
// acumulado, ou com null no timeout.
function waitFor(proc, predicate, ms) {
  return new Promise((resolve) => {
    let buffer = ''
    const timer = setTimeout(() => resolve(null), ms)
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      if (predicate(buffer)) { clearTimeout(timer); resolve(buffer.trim()) }
    })
  })
}

describe.skipIf(!run)('dita-helper.exe hotkeys', () => {
  it('emite {"event":"ready"} em menos de 5s e sobrevive ao stdin', async () => {
    const proc = spawn(HELPER, ['hotkeys', '--toggle=f5', '--ptt=rctrl'],
      { stdio: ['pipe', 'pipe', 'pipe'] })

    const ready = await waitFor(proc, (b) => b.includes('"ready"'), 5000)

    expect(ready).toBe('{"event":"ready"}')

    proc.stdin.write('state on\nstate off\n')
    await new Promise((r) => setTimeout(r, 300))
    expect(proc.exitCode).toBe(null)

    proc.kill()
  }, 10000)

  // Teclas sintetizadas por SendInput chegam ao hook com LLKHF_INJECTED e são
  // deliberadamente ignoradas (é o que impede o nosso próprio Ctrl+V de virar
  // "combo"). Para exercitar a supressão de verdade seria preciso um evento
  // não-injetado — só um teclado físico produz isso. Este teste então cobre
  // só o que dá para automatizar: o hook instala, ignora o injetado e o
  // processo continua vivo (não trava nem morre ao ver tráfego de teclado).
  it('ignora teclas injetadas e permanece vivo', async () => {
    const proc = spawn(HELPER, ['hotkeys', '--toggle=f5', '--ptt=rctrl'],
      { stdio: ['pipe', 'pipe', 'pipe'] })

    let out = ''
    proc.stdout.on('data', (c) => { out += c.toString() })
    await waitFor(proc, (b) => b.includes('"ready"'), 5000)

    // F5 down/up via SendInput, fora de qualquer janela de texto.
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('{F5}')
    `], { stdio: 'ignore' })
    await new Promise((r) => ps.on('exit', r))
    await new Promise((r) => setTimeout(r, 500))

    expect(out.trim()).toBe('{"event":"ready"}') // nada além do ready
    expect(proc.exitCode).toBe(null)

    proc.kill()
  }, 15000)
})
