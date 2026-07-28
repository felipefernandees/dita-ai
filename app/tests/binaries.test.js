import { describe, it, expect, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { ffmpegPath, whisperServerCandidates } from '../src/main/binaries.js'

afterEach(() => {
  delete process.env.DITA_FFMPEG
  delete process.env.DITA_WHISPER_SERVER
})

describe('binaries', () => {
  it('respeita os overrides de ambiente', () => {
    process.env.DITA_FFMPEG = '/tmp/ffmpeg'
    process.env.DITA_WHISPER_SERVER = '/tmp/whisper-server'
    expect(ffmpegPath()).toBe('/tmp/ffmpeg')
    expect(whisperServerCandidates()).toEqual(['/tmp/whisper-server'])
  })

  it('o ffmpeg resolvido existe em disco', () => {
    expect(existsSync(ffmpegPath())).toBe(true)
  })

  // O empacotado PRECISA vir antes do Homebrew. Se o Homebrew ganhasse, o app
  // continuaria funcionando na máquina de quem o construiu (onde a fórmula
  // existe) e o binário que viaja dentro do .app — o único que qualquer outra
  // pessoa tem — nunca seria exercitado em desenvolvimento.
  it.skipIf(process.platform !== 'darwin')('no macOS, o whisper embutido vem antes do Homebrew', () => {
    const c = whisperServerCandidates()
    const embutido = c.findIndex((p) => p.includes('resources/mac/whisper'))
    const brew = c.findIndex((p) => p.includes('/opt/homebrew/'))
    // depois de `npm run deps:mac` o embutido existe; sem ele, esta parte do
    // contrato não tem como ser verificada e o teste diz isso em vez de passar
    // por acidente
    expect(embutido, 'rode `npm run deps:mac` para exercitar este contrato').toBeGreaterThanOrEqual(0)
    if (brew >= 0) expect(embutido).toBeLessThan(brew)
  })

  it('devolve os candidatos de whisper-server na ordem certa', () => {
    const c = whisperServerCandidates()
    expect(Array.isArray(c)).toBe(true)
    if (process.platform === 'win32') {
      const idxBlas = c.findIndex((p) => p.includes('blas'))
      const idxCpu = c.findIndex((p) => p.includes('cpu'))
      // Depois de `npm run deps:win` as duas pastas existem de verdade (blas
      // é opcional só no download, não no teste): se só uma aparecer aqui, o
      // fetch não rodou ou quebrou, e é isso que queremos pegar.
      expect(idxBlas).toBeGreaterThanOrEqual(0)
      expect(idxCpu).toBeGreaterThanOrEqual(0)
      expect(idxBlas).toBeLessThan(idxCpu)
    } else {
      expect(c[0]).toContain('whisper-server')
    }
  })
})
