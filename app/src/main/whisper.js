import { spawn, execFile, execFileSync } from 'child_process'
import { writeFile, unlink, readFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const WHISPER_SERVER = '/opt/homebrew/opt/whisper-cpp/bin/whisper-server'
const MODEL_DIR = join(homedir(), 'Library/Application Support/dita-ai/models')
// large-v3-turbo sem quantização: mesma velocidade do q5_0 no Apple Silicon,
// com menos erro de palavra parecida. Pesa 1,6GB de RAM (folga num M4/16GB).
export const MODEL_PATH = join(MODEL_DIR, 'ggml-large-v3-turbo.bin')
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'
const PORT = 8971

// Contexto que o Whisper lê antes de decodificar. É o que faz ele escolher
// "Wispr Flow" em vez de "super flow": sem isso ele só conhece o dicionário
// comum do português.
//
// PERSONALIZE ISTO. Coloque aqui os nomes próprios, marcas e jargões que VOCÊ
// fala todo dia (nome da sua empresa, dos seus sócios, das ferramentas do seu
// stack, da sua cidade). É o ajuste que mais melhora a transcrição, e leva
// dois minutos. Limite de ~224 tokens: passou disso, o Whisper corta.
const VOCABULARIO = [
  'Transcrição em português do Brasil sobre tecnologia, automação e negócios.',
  'Termos comuns: Dita Aí, n8n, Supabase, Notion, Obsidian, Claude, Cursor, Electron,',
  'Vercel, Docker, Portainer, Traefik, Postgres, Redis, RabbitMQ, webhook, deploy,',
  'prompt, endpoint, LLM, MCP, API, landing page, carrossel, reels, funil, lead, copy.'
].join(' ')

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
    '--beam-size', '5', '--best-of', '5', '--entropy-thold', '2.8',
    // vocabulário do Felipe em todo segmento, não só no primeiro
    '--prompt', VOCABULARIO, '--carry-initial-prompt',
    // corta o "[BLANK_AUDIO]"/reticências que o modelo inventa no silêncio
    '--suppress-nst'
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

// O whisper corta segmento por token, não por palavra: "automatizar" sai como
// "...automat" + "izar". Cada segmento já traz o espaço inicial quando existe,
// então juntar CRU reconstrói a palavra. Era daí que vinha "cancel amento" e
// "automat izar": o campo .text junta os segmentos com \n e a gente virava
// esse \n em espaço, plantando um espaço no meio da palavra.
export function juntarSegmentos(data) {
  const segs = data && data.segments
  if (Array.isArray(segs) && segs.length) return segs.map((s) => s.text).join('').trim()
  return String((data && data.text) || '').trim()
}

export async function transcribe(webmBuffer, { port = PORT } = {}) {
  const wav = await webmToWav(webmBuffer)
  try {
    const form = new FormData()
    form.append('file', new Blob([await readFile(wav)]), 'audio.wav')
    form.append('response_format', 'verbose_json') // precisa dos segmentos
    const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`whisper HTTP ${res.status}`)
    return juntarSegmentos(await res.json())
  } finally {
    await unlink(wav).catch(() => {})
  }
}
