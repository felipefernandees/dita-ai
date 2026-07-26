import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureModel, startWhisperServerWithFallback, transcribe } from '../src/main/whisper.js'
import { ffmpegPath } from '../src/main/binaries.js'

const run = process.env.RUN_WHISPER === '1' ? describe : describe.skip

const FRASE = 'O rato roeu a roupa do rei de Roma'

// Gera a mesma fala sintética em cada plataforma: no macOS via `say` (voz do
// sistema), no Windows via SAPI (SpeechSynthesizer do .NET, sem dependência
// externa). O ffmpeg então converte pro webm que o pipeline real recebe do
// MediaRecorder do renderer.
function gerarAudioSintetico() {
  const wav = join(tmpdir(), 'dita-test.wav')
  const webm = join(tmpdir(), 'dita-test.webm')

  if (process.platform === 'win32') {
    const script = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile('${wav}')
$synth.Speak('${FRASE}')
$synth.Dispose()
`
    execFileSync('powershell', ['-NoProfile', '-Command', script])
  } else {
    execFileSync('say', ['-v', 'Luciana', '-o', wav.replace('.wav', '.aiff'), FRASE])
  }

  const origem = process.platform === 'win32' ? wav : wav.replace('.wav', '.aiff')
  execFileSync(ffmpegPath(), ['-y', '-i', origem, webm])
  return webm
}

run('whisper integração', () => {
  it('transcreve fala sintética em português', { timeout: 120000 }, async () => {
    const webm = gerarAudioSintetico()
    await ensureModel()
    const server = await startWhisperServerWithFallback({})
    try {
      const text = await transcribe(readFileSync(webm), { port: server.port })
      expect(text.toLowerCase()).toContain('rato roeu')
    } finally {
      server.kill()
    }
  })
})
