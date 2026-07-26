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

  it('devolve os candidatos de whisper-server na ordem certa', () => {
    const c = whisperServerCandidates()
    expect(Array.isArray(c)).toBe(true)
    if (process.platform === 'win32') {
      const idxVulkan = c.findIndex((p) => p.includes('vulkan'))
      const idxCpu = c.findIndex((p) => p.includes('cpu'))
      if (idxVulkan >= 0 && idxCpu >= 0) expect(idxVulkan).toBeLessThan(idxCpu)
    } else {
      expect(c[0]).toContain('whisper-server')
    }
  })
})
