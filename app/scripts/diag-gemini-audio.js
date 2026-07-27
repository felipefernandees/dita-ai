// Prova de protocolo: conecta na Live API, manda audio PCM16 16kHz real e
// mostra CADA frame que volta. Serve para descobrir o formato certo antes de
// mexer no app. Foi ele que provou o protocolo hoje implementado em
// src/main/gemini-live.js (medicao de 2026-07-27).
//
//   npm run diag:gemini:audio
//   # equivale a:
//   DITA_APP_NAME="Dita Aí" npx electron scripts/diag-gemini-audio.js
//
// O DITA_APP_NAME NAO E OPCIONAL. O Electron deriva o userData do productName
// ("Dita Aí"), e a chave salva esta cifrada com safeStorage, que amarra a
// chave de cifragem AO userData. Rodando sem isso o userData vira "app" ou
// "Electron", a decifragem falha e o script mente dizendo "sem chave" —
// voce vai caçar um bug de credencial que nao existe.
//
// Usa %TEMP%\bench.wav (16 kHz mono PCM16) se existir; senao gera um com SAPI.
// A chave nunca e impressa.
const { app } = require('electron')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

if (process.env.DITA_APP_NAME) app.setName(process.env.DITA_APP_NAME)

const MODELO = process.env.DITA_GEMINI_MODEL || 'models/gemini-3.1-flash-live-preview'

app.whenReady().then(async () => {
  const { lerConfig } = await import('../src/main/config-remoto.js')
  const chave = (lerConfig().apiKey || '').trim()
  if (!chave) { console.log('sem chave'); app.exit(1); return }

  const wav = path.join(process.env.TEMP, 'bench.wav')
  if (!fs.existsSync(wav)) {
    console.log('gerando audio de teste com SAPI...')
    const bruto = path.join(process.env.TEMP, 'diag-raw.wav')
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
      `$s.SetOutputToWaveFile('${bruto}'); $s.Speak('Preciso mandar o resumo da reuniao para o time hoje'); $s.Dispose()`])
    execFileSync(path.join(__dirname, '../node_modules/ffmpeg-static/ffmpeg.exe'),
      ['-y', '-i', bruto, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { stdio: 'ignore' })
  }

  // pula o cabecalho de 44 bytes do wav; o resto ja e PCM16 16k mono
  const pcm = fs.readFileSync(wav).subarray(44)
  console.log('audio:', (pcm.length / 32000).toFixed(1) + 's de PCM16 16kHz mono')

  const WebSocket = require('ws')
  const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(chave)
  const ws = new WebSocket(url)

  const setup = {
    setup: {
      model: MODELO,
      generationConfig: { responseModalities: ['AUDIO'], temperature: 0 },
      // O PULO DO GATO: pede a transcricao da ENTRADA. E o texto do que o
      // usuario falou, nao uma resposta do modelo.
      inputAudioTranscription: {},
      // Sem isto o modelo RESPONDE a fala (gera audio de conversa que a gente
      // paga, recebe e joga fora). O ditado nao quer interlocutor.
      systemInstruction: {
        parts: [{ text: 'Você é um gravador silencioso. NUNCA responda, NUNCA comente, NUNCA gere áudio. Permaneça em silêncio absoluto sempre.' }]
      },
      // Deteccao automatica LIGADA (padrao). Desligar exige mandar
      // activityStart/activityEnd na mao; sem isso o servidor nao considera
      // que houve fala e nao transcreve nada — testado, deu string vazia.
    }
  }

  let transcricao = ''
  ws.on('open', () => {
    console.log('socket ABERTO; setup:', JSON.stringify(setup))
    ws.send(JSON.stringify(setup))
  })

  ws.on('message', (d) => {
    const txt = d.toString('utf8')
    let j
    try { j = JSON.parse(txt) } catch { console.log('frame nao-JSON:', txt.slice(0, 120)); return }

    if (j.setupComplete) {
      console.log('\n>>> setupComplete recebido — enviando audio em blocos de 250ms')
      const passo = 8000 // 250ms
      let i = 0
      const timer = setInterval(() => {
        if (i >= pcm.length) {
          clearInterval(timer)
          console.log('>>> audio terminou; sinalizando fim de turno')
          ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
          setTimeout(() => { console.log('>>> encerrando por tempo'); try { ws.close() } catch {} }, 6000)
          return
        }
        const bloco = pcm.subarray(i, i + passo)
        i += passo
        ws.send(JSON.stringify({
          realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: bloco.toString('base64') } }
        }))
      }, 120) // mais rapido que tempo real so pra encurtar o teste
      return
    }

    const sc = j.serverContent || {}
    if (sc.inputTranscription && sc.inputTranscription.text) {
      transcricao += sc.inputTranscription.text
      console.log('  [transcricao da entrada] +' + JSON.stringify(sc.inputTranscription.text))
    }
    if (sc.outputTranscription && sc.outputTranscription.text) {
      console.log('  [transcricao da saida  ] +' + JSON.stringify(sc.outputTranscription.text))
    }
    if (sc.modelTurn) {
      const partes = (sc.modelTurn.parts || []).map((p) => Object.keys(p).join('+')).join(', ')
      console.log('  [modelTurn] partes:', partes || '(vazio)')
    }
    if (sc.turnComplete) {
      console.log('\n>>> turnComplete')
      console.log('TRANSCRICAO FINAL:', JSON.stringify(transcricao))
      ws.close()
    }
  })

  ws.on('error', (e) => { console.log('ERRO:', e.message); app.exit(1) })
  ws.on('close', (c, m) => {
    console.log('fechou:', c, String(m || '').slice(0, 200))
    console.log('transcricao acumulada:', JSON.stringify(transcricao))
    setTimeout(() => app.exit(transcricao ? 0 : 1), 200)
  })

  setTimeout(() => { console.log('(timeout 60s)'); try { ws.close() } catch {} }, 60000)
})
