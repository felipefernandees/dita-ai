import { spawn, execFile, execFileSync } from 'child_process'
import { writeFile, unlink, readFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const WHISPER_SERVER = '/opt/homebrew/opt/whisper-cpp/bin/whisper-server'
const MODEL_DIR = join(homedir(), 'Library/Application Support/dita-ai/models')
export const MODEL_PATH = join(MODEL_DIR, 'ggml-large-v3-turbo-q5_0.bin')
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
const PORT = 8971

export function ensureModel() {
  if (!existsSync(MODEL_PATH)) {
    mkdirSync(MODEL_DIR, { recursive: true })
    execFileSync('curl', ['-L', '-o', MODEL_PATH + '.part', MODEL_URL], { stdio: 'inherit' })
    execFileSync('mv', [MODEL_PATH + '.part', MODEL_PATH])
  }
  return MODEL_PATH
}

export async function startWhisperServer({ modelPath = MODEL_PATH, language = 'pt', port = PORT } = {}) {
  const proc = spawn(WHISPER_SERVER, [
    '--model', modelPath, '--host', '127.0.0.1', '--port', String(port),
    '--language', language, '--threads', '4',
    // qualidade: beam search + mais candidatos reduzem palavra quebrada
    // (ex: "cancel amento"); entropy threshold evita fragmentar em pausas
    '--beam-size', '5', '--best-of', '5', '--entropy-thold', '2.8'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  // espera o server subir (modelo grande demora a carregar)
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`whisper-server morreu com código ${proc.exitCode}`)
    try {
      await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
      return { port, kill: () => proc.kill() }
    } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  proc.kill()
  throw new Error('whisper-server não subiu em 60s')
}

async function webmToWav(webmBuffer) {
  const base = join(tmpdir(), `dita-${Date.now()}`)
  const webm = `${base}.webm`
  const wav = `${base}.wav`
  await writeFile(webm, Buffer.from(webmBuffer))
  await new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-y', '-i', webm, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
      (err) => (err ? reject(err) : resolve()))
  })
  await unlink(webm).catch(() => {})
  return wav
}

export async function transcribe(webmBuffer, { port = PORT } = {}) {
  const wav = await webmToWav(webmBuffer)
  try {
    const form = new FormData()
    form.append('file', new Blob([await readFile(wav)]), 'audio.wav')
    form.append('response_format', 'json')
    const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`whisper HTTP ${res.status}`)
    const data = await res.json()
    return (data.text || '').trim()
  } finally {
    await unlink(wav).catch(() => {})
  }
}
