import { spawn, execFile } from 'child_process'
import { writeFile, unlink, readFile, rename, access } from 'fs/promises'
import { createWriteStream, existsSync, mkdirSync, constants as fsConstants } from 'fs'
import { createServer } from 'net'
import { cpus, tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { modelDir } from './paths.js'
import { ffmpegPath, whisperServerCandidates, vulkanUtilizavel } from './binaries.js'

// large-v3-turbo sem quantização: mesma velocidade do q5_0 no Apple Silicon,
// com menos erro de palavra parecida. Pesa 1,6GB de RAM.
const MODEL_FILE = 'ggml-large-v3-turbo.bin'
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'
const PORT = 8971

// função, não constante: modelDir() depende de env que só existe em runtime
export function modelPath() { return join(modelDir(), MODEL_FILE) }

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

// Download em stream com arquivo .part: uma queda de rede no meio não deixa
// um modelo truncado de 1,6GB parecendo válido no disco.
export async function ensureModel() {
  const target = modelPath()
  if (existsSync(target)) return target

  mkdirSync(modelDir(), { recursive: true })
  const partial = target + '.part'

  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`download do modelo falhou: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial))
  await rename(partial, target)

  return target
}

// O '4' fixo vinha do tuning de Apple Silicon, onde o trabalho pesado é do
// Metal e sobram os núcleos de eficiência. No Windows a inferência inteira é
// CPU, e 4 threads deixavam metade do processador parado.
//
// Núcleos FÍSICOS, não lógicos: medido num Ryzen 7 5700G (8C/16T) com áudio de
// 11,4s — 4 threads 22,0s | 8 threads 17,8s | 16 threads 27,3s. Passar dos
// físicos faz os threads de SMT brigarem pelas mesmas unidades de execução e
// fica pior que o ponto de partida.
function threadsDeInferencia() {
  if (process.env.DITA_THREADS) return Number(process.env.DITA_THREADS)
  const logicos = cpus().length || 4
  return Math.max(1, Math.min(8, Math.floor(logicos / 2)))
}

export async function startWhisperServer({
  binPath,
  modelPath: model = modelPath(),
  language = 'pt',
  port = PORT
} = {}) {
  const bin = binPath || whisperServerCandidates()[0]
  if (!bin) throw new Error('nenhum whisper-server encontrado: rode `npm run deps:win`')

  const proc = spawn(bin, [
    '--model', model, '--host', '127.0.0.1', '--port', String(port),
    '--language', language, '--threads', String(threadsDeInferencia()),
    // qualidade: beam search + mais candidatos reduzem palavra quebrada
    // (ex: "cancel amento"); entropy threshold evita fragmentar em pausas
    '--beam-size', '5', '--best-of', '5', '--entropy-thold', '2.8',
    // vocabulário do Felipe em todo segmento, não só no primeiro
    '--prompt', VOCABULARIO, '--carry-initial-prompt',
    // corta o "[BLANK_AUDIO]"/reticências que o modelo inventa no silêncio
    '--suppress-nst'
    // windowsHide: o whisper-server é app de console e fica vivo a sessão
    // inteira — sem isto o usuário ganha uma janela de prompt permanente ao
    // lado do app. Ignorado no macOS.
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

  // Sem isso, um binário ausente/corrompido (ENOENT, EACCES) sobe como
  // 'error' assíncrono sem listener — o processo da suíte/app inteiro
  // derruba com exceção não tratada em vez de virar uma rejeição normal que
  // o loop de fallback consegue capturar.
  let spawnError = null
  proc.on('error', (err) => { spawnError = err })

  // espera o server subir (modelo grande demora a carregar)
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`whisper-server (${bin}) falhou ao iniciar: ${spawnError.message}`)
    if (proc.exitCode !== null) throw new Error(`whisper-server (${bin}) morreu com código ${proc.exitCode}`)
    try {
      await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
      return { port, kill: () => proc.kill() }
    } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  proc.kill()
  throw new Error(`whisper-server (${bin}) não subiu em 60s`)
}

// Confere condições que são as MESMAS pra qualquer candidato — se falharem,
// trocar de backend (BLAS/CPU) não muda nada, então não faz sentido esperar
// até 60s por tentativa só pra descobrir isso nem tentar a próxima variante.
// Hoje: modelo ausente/sem permissão de leitura, e a porta já ocupada por
// outro processo (inclusive uma instância nossa presa de uma execução
// anterior). Sem essa checagem antecipada, os dois casos ficam
// indistinguíveis de "todo backend de whisper-server é incompatível com esta
// máquina", e o usuário só veria o erro (enganoso) depois de 60s x N
// candidatos.
async function assertModelReadable(model) {
  try {
    await access(model, fsConstants.R_OK)
  } catch {
    throw new Error(`modelo de transcrição não encontrado ou sem permissão de leitura: ${model} (rode \`ensureModel()\`/baixe o modelo antes de iniciar o whisper-server)`)
  }
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`porta ${port} já está em uso por outro processo — trocar o backend de whisper-server não resolve isso`))
      } else {
        reject(err)
      }
    })
    probe.once('listening', () => probe.close(() => resolve()))
    probe.listen(port, '127.0.0.1')
  })
}

// O candidato Vulkan é o único que precisa ser checado ANTES de tentar, porque
// numa máquina sem GPU compatível ele não falha — sobe rodando em CPU sem
// OpenBLAS, mais lento que o candidato `blas` que viria depois. Como o laço
// abaixo só reage a processo morto, ele nunca perceberia a troca ruim.
//
// Descartar aqui, e não em binaries.js, mantém whisperServerCandidates() como
// uma função pura de caminhos (barata, síncrona, testável sem executar nada) e
// paga os ~160ms da sonda só quando o servidor vai realmente subir.
function descartarVulkanInutil(candidates) {
  return candidates.filter((bin) => {
    if (!/[\\/]vulkan[\\/]/i.test(bin)) return true
    if (vulkanUtilizavel(bin)) return true
    console.error(`vulkan descartado (nenhum dispositivo compatível): ${bin}`)
    return false
  })
}

// Tenta cada variante na ordem de whisperServerCandidates() (Vulkan, BLAS,
// depois CPU puro). BLAS depende da DLL do OpenBLAS que vem no zip: se ela não
// carregar (falta de instrução de CPU compatível, DLL ausente por algum
// motivo, release futuro que pare de publicar o asset blas) o processo morre
// no boot sem erro de rede nenhum pra distinguir — por isso qualquer falha
// realmente específica de backend simplesmente tenta o próximo candidato
// (ver assertModelReadable/assertPortFree acima pras exceções a essa regra).
//
// `candidates` é injetável (além do override DITA_WHISPER_SERVER em
// binaries.js, que só permite testar UM candidato) para os testes poderem
// exercitar o loop de fallback com múltiplos candidatos falsos sem depender
// de um whisper-server de verdade.
export async function startWhisperServerWithFallback({ candidates: candidatesOverride, ...opts } = {}) {
  const candidates = descartarVulkanInutil(candidatesOverride || whisperServerCandidates())
  if (!candidates.length) throw new Error('nenhum whisper-server encontrado: rode `npm run deps:win`')

  const model = opts.modelPath || modelPath()
  const port = opts.port || PORT
  await assertModelReadable(model)
  await assertPortFree(port)

  const falhas = []
  for (const binPath of candidates) {
    try {
      return await startWhisperServer({ ...opts, binPath, modelPath: model, port })
    } catch (err) {
      falhas.push(`${binPath}: ${err.message}`)
      console.error(`whisper-server falhou em ${binPath}:`, err.message)
    }
  }
  throw new Error(`nenhum whisper-server subiu. Candidatos tentados:\n${falhas.map((f) => `  - ${f}`).join('\n')}`)
}

async function webmToWav(webmBuffer) {
  const base = join(tmpdir(), `dita-${Date.now()}`)
  const webm = `${base}.webm`
  const wav = `${base}.wav`
  await writeFile(webm, Buffer.from(webmBuffer))
  await new Promise((resolve, reject) => {
    // windowsHide: sem isto o ffmpeg pisca uma janela de console A CADA ditado
    execFile(ffmpegPath(), ['-y', '-i', webm, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
      { windowsHide: true },
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
