// Mede o TEMPO entre "parei de falar" e "o texto esta pronto", e mostra cada
// frame que o servidor manda depois do audioStreamEnd, com carimbo de tempo.
//
// Serve para responder: existe algum sinal de "acabou" alem do turnComplete?
// Se nao existir, a sessao espera o prazo inteiro a toa em todo ditado.
//
//   npm run diag:gemini:tempo
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

if (process.env.DITA_APP_NAME) app.setName(process.env.DITA_APP_NAME)
const MODELO = process.env.DITA_GEMINI_MODEL || 'models/gemini-3.1-flash-live-preview'
const SILENCIO = 'Você é um gravador silencioso. NUNCA responda, NUNCA comente, NUNCA gere áudio. Permaneça em silêncio absoluto sempre.'

app.whenReady().then(async () => {
  const { lerConfig } = await import('../src/main/config-remoto.js')
  const chave = (lerConfig().apiKey || '').trim()
  if (!chave) { console.log('sem chave'); app.exit(1); return }

  const wav = path.join(process.env.TEMP, 'bench.wav')
  if (!fs.existsSync(wav)) { console.log('falta bench.wav — rode diag:gemini:audio antes'); app.exit(1); return }
  const pcm = fs.readFileSync(wav).subarray(44)

  const WebSocket = require('ws')
  const ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(chave))

  let tFim = 0
  const desde = () => tFim ? '+' + (Date.now() - tFim) + 'ms' : '(antes do fim)'

  ws.on('open', () => ws.send(JSON.stringify({
    setup: {
      model: MODELO,
      generationConfig: { responseModalities: ['AUDIO'], temperature: 0 },
      inputAudioTranscription: {},
      systemInstruction: { parts: [{ text: SILENCIO }] }
    }
  })))

  ws.on('message', (d) => {
    let j; try { j = JSON.parse(d.toString('utf8')) } catch { return }

    if (j.setupComplete) {
      console.log('setupComplete — mandando audio em tempo real (250ms por bloco)')
      const passo = 8000
      let i = 0
      const t = setInterval(() => {
        if (i >= pcm.length) {
          clearInterval(t)
          tFim = Date.now()
          console.log('\n>>> audioStreamEnd enviado (t=0)\n')
          ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
          return
        }
        ws.send(JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: pcm.subarray(i, i + passo).toString('base64') } } }))
        i += passo
      }, 250) // TEMPO REAL, para a medicao valer
      return
    }

    // imprime a forma do frame, nao o conteudo inteiro
    const sc = j.serverContent || {}
    const marcas = []
    if (sc.inputTranscription?.text) marcas.push('inputTranscription(' + sc.inputTranscription.text.length + ' chars)')
    if (sc.outputTranscription?.text) marcas.push('outputTranscription')
    if (sc.modelTurn) marcas.push('modelTurn')
    if (sc.turnComplete) marcas.push('TURN_COMPLETE')
    if (sc.generationComplete) marcas.push('GENERATION_COMPLETE')
    if (sc.interrupted) marcas.push('interrupted')
    if (sc.speechState) marcas.push('speechState=' + JSON.stringify(sc.speechState))
    if (j.usageMetadata) marcas.push('usageMetadata')
    const topo = Object.keys(j).join("+") + (j.serverContent ? " sc={" + Object.keys(sc).join(",") + "}" : "")
    console.log(`${desde().padStart(14)}  topo=${topo}  ${marcas.join(' ') || '(sem marca conhecida)'}`)
  })

  ws.on('close', (c) => { console.log(`${desde().padStart(14)}  CLOSE ${c}`); app.exit(0) })
  ws.on('error', (e) => { console.log('erro:', e.message); app.exit(1) })
  setTimeout(() => { console.log('\n(corte em 20s apos o fim)'); try { ws.close() } catch {} }, 25000)
})
