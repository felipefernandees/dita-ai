// Mede se a instrucao de sistema realmente muda a transcricao de jargao de
// dev. Roda a MESMA frase duas vezes: sem glossario e com glossario, e mostra
// as duas saidas lado a lado.
//
//   npm run diag:vocabulario
//
// DITA_APP_NAME="Dita Aí" e obrigatorio (safeStorage amarra a chave ao userData).
const { app } = require('electron')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

if (process.env.DITA_APP_NAME) app.setName(process.env.DITA_APP_NAME)
const MODELO = process.env.DITA_GEMINI_MODEL || 'models/gemini-3.1-flash-live-preview'

// Frase densa de jargao: nomes de ferramenta, anglicismo aportuguesado e
// termo que o portugues comum "corrige" errado (deploy -> "deploi", branch ->
// "branche", commit -> "comite", Vercel -> "vercel/versel").
const FRASE = 'Fiz o deploy na Vercel, abri um pull request na branch de homologação, ' +
  'rodei o docker compose e o webhook do Supabase caiu no endpoint errado, ' +
  'então dei rollback no commit e subi de novo pelo Git Hub Actions.'

const GLOSSARIO =
  'O áudio é de um desenvolvedor de software brasileiro falando sobre trabalho. ' +
  'Espere jargão técnico e anglicismos pronunciados à brasileira. Grafe corretamente, ' +
  'sem traduzir e sem aportuguesar: deploy, build, commit, push, pull request, merge, branch, ' +
  'rollback, hotfix, endpoint, webhook, payload, backend, frontend, full stack, framework, ' +
  'container, Docker, Kubernetes, Vercel, Supabase, Postgres, Redis, RabbitMQ, GitHub, GitLab, ' +
  'Node, React, Next.js, Vite, Electron, Python, TypeScript, API, REST, GraphQL, SDK, CLI, CI/CD, ' +
  'pipeline, log, deploy em produção, staging, homologação, sprint, backlog, code review, ' +
  'refatorar, debugar, subir, prompt, token, LLM, MCP, n8n, Notion, Obsidian, Claude, Cursor.'

function falar(destino) {
  const bruto = path.join(process.env.TEMP, 'vocab-raw.wav')
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$s.SetOutputToWaveFile('${bruto}'); $s.Speak('${FRASE.replace(/'/g, "''")}'); $s.Dispose()`])
  execFileSync(path.join(__dirname, '../node_modules/ffmpeg-static/ffmpeg.exe'),
    ['-y', '-i', bruto, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', destino], { stdio: 'ignore' })
}

function transcrever(chave, pcm, instrucao) {
  return new Promise((resolve) => {
    const WebSocket = require('ws')
    const ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(chave))
    let texto = ''
    const encerrar = () => { try { ws.close() } catch {} ; resolve(texto) }

    ws.on('open', () => ws.send(JSON.stringify({
      setup: {
        model: MODELO,
        generationConfig: { responseModalities: ['AUDIO'], temperature: 0 },
        inputAudioTranscription: {},
        systemInstruction: { parts: [{ text: instrucao }] }
      }
    })))

    ws.on('message', (d) => {
      let j; try { j = JSON.parse(d.toString('utf8')) } catch { return }
      if (j.setupComplete) {
        const passo = 8000
        let i = 0
        const t = setInterval(() => {
          if (i >= pcm.length) {
            clearInterval(t)
            ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
            setTimeout(encerrar, 7000)
            return
          }
          ws.send(JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: pcm.subarray(i, i + passo).toString('base64') } } }))
          i += passo
        }, 80)
        return
      }
      const t = j.serverContent?.inputTranscription?.text
      if (t) texto += t
    })
    ws.on('error', () => resolve(texto))
    ws.on('close', () => resolve(texto))
  })
}

const SILENCIO = 'Você é um gravador silencioso. NUNCA responda, NUNCA comente, NUNCA gere áudio. Permaneça em silêncio absoluto sempre.'

app.whenReady().then(async () => {
  const { lerConfig } = await import('../src/main/config-remoto.js')
  const chave = (lerConfig().apiKey || '').trim()
  if (!chave) { console.log('sem chave'); app.exit(1); return }

  const wav = path.join(process.env.TEMP, 'vocab.wav')
  if (!fs.existsSync(wav)) { console.log('gerando audio...'); falar(wav) }
  const pcm = fs.readFileSync(wav).subarray(44)

  console.log('ESPERADO :', FRASE, '\n')

  const semGloss = await transcrever(chave, pcm, SILENCIO)
  console.log('SEM gloss:', semGloss, '\n')

  const comGloss = await transcrever(chave, pcm, SILENCIO + '\n\n' + GLOSSARIO)
  console.log('COM gloss:', comGloss, '\n')

  const termos = ['deploy', 'Vercel', 'pull request', 'branch', 'docker', 'webhook', 'Supabase', 'endpoint', 'rollback', 'commit', 'GitHub']
  const conta = (t) => termos.filter((x) => t.toLowerCase().includes(x.toLowerCase())).length
  console.log('termos corretos SEM glossario:', conta(semGloss) + '/' + termos.length)
  console.log('termos corretos COM glossario:', conta(comGloss) + '/' + termos.length)
  app.exit(0)
})
