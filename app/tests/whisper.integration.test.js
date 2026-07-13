import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureModel, startWhisperServer, transcribe } from '../src/main/whisper.js'

const run = process.env.RUN_WHISPER === '1' ? describe : describe.skip

run('whisper integração', () => {
  it('transcreve fala sintética em português', { timeout: 120000 }, async () => {
    const aiff = join(tmpdir(), 'dita-test.aiff')
    const webm = join(tmpdir(), 'dita-test.webm')
    execFileSync('say', ['-v', 'Luciana', '-o', aiff, 'O rato roeu a roupa do rei de Roma'])
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-i', aiff, webm])
    ensureModel()
    const server = await startWhisperServer({})
    try {
      const text = await transcribe(readFileSync(webm), { port: server.port })
      expect(text.toLowerCase()).toContain('rato roeu')
    } finally {
      server.kill()
    }
  })
})
