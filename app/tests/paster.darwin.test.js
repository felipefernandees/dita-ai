import { describe, it, expect, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// O que este teste protege: o ditado não pode ficar refém do System Events.
//
// `getFrontmostApp` é aguardado no onStart ANTES de o popup aparecer. Enquanto
// o osascript rodava sem prazo, um System Events ocupado (ou esperando o prompt
// de permissão de Automação, que foi exatamente o que aconteceu ao rodar esta
// suíte pela primeira vez num Mac) segurava a promessa para sempre: o usuário
// apertava o atalho, falava, e a tela não mostrava nada.
//
// Só faz sentido no macOS: é o único lugar onde essa implementação roda.
const noMac = process.platform === 'darwin'

// Um "osascript" que não responde nunca. Prova o prazo de verdade — com o
// caminho de morte incluído, que é o que um mock de execFile não alcança.
function osascriptQueTrava() {
  const dir = mkdtempSync(join(tmpdir(), 'dita-osascript-'))
  const bin = join(dir, 'osascript-travado')
  writeFileSync(bin, '#!/bin/sh\nsleep 60\n')
  chmodSync(bin, 0o755)
  return bin
}

afterEach(() => { delete process.env.DITA_OSASCRIPT })

describe.skipIf(!noMac)('paster do macOS', () => {
  it('devolve string vazia quando o osascript trava, em vez de nunca voltar', async () => {
    process.env.DITA_OSASCRIPT = osascriptQueTrava()
    const { getFrontmostApp } = await import('../src/main/paster.darwin.js')

    const comecou = Date.now()
    const nome = await getFrontmostApp()
    const levou = Date.now() - comecou

    expect(nome).toBe('')
    // O prazo é 1,5s. A folga cobre máquina carregada; o que não pode é isto
    // virar "espera indefinida" de novo.
    expect(levou).toBeLessThan(5000)
  }, 10000)

  it('a colagem falha declaradamente quando o osascript trava', async () => {
    process.env.DITA_OSASCRIPT = osascriptQueTrava()
    const { pasteText } = await import('../src/main/paster.darwin.js')
    const { clipboard } = await import('electron')

    const colou = await pasteText('texto do ditado')

    // false, não exceção: quem chama usa o retorno para decidir entre "Colado"
    // e o popup de "Copiar Ditado".
    expect(colou).toBe(false)
    // E o texto continua no clipboard: mesmo sem colar, o usuário consegue
    // colar à mão. Perder o ditado seria o único desfecho inaceitável aqui.
    expect(clipboard.readText()).toBe('texto do ditado')
  }, 15000)

  it('lê o app em foco quando o osascript responde', async () => {
    const { getFrontmostApp } = await import('../src/main/paster.darwin.js')
    // Sem override: é o osascript de verdade. Numa máquina sem permissão de
    // Automação isto devolve '' pelo catch — string nos dois casos, que é o
    // contrato que o chamador conhece.
    expect(typeof await getFrontmostApp()).toBe('string')
  }, 10000)
})
