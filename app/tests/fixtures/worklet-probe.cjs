// Processo main de uso único, para tests/pcm-worklet.integration.test.js.
//
// Abre uma janela invisível, carrega o renderer JÁ CONSTRUÍDO pelo mesmo
// loadFile que o app empacotado usa (file://), e tenta carregar o AudioWorklet
// exatamente como ele saiu do build. Imprime um JSON no stdout e sai.
//
// Não precisa de microfone: OfflineAudioContext também tem `audioWorklet`, e
// renderiza por software.
const { app, BrowserWindow } = require('electron')
const { join } = require('path')
const fs = require('fs')

const RENDERER = process.argv[2]
const ASSETS = join(RENDERER, 'assets')

// O Vite decide sozinho, pelo tamanho do arquivo (assetsInlineLimit, 4 KB por
// padrão), se o worklet vira um `data:` embutido no bundle ou um .js separado
// em assets/. As duas saídas são válidas e o app tem que funcionar nas duas —
// então a sonda procura pelas duas, em vez de fixar uma e passar a testar uma
// coisa diferente do que o build produziu no dia.
function acharWorklet() {
  const arquivos = fs.readdirSync(ASSETS)

  for (const nome of arquivos) {
    if (!nome.endsWith('.js')) continue
    const texto = fs.readFileSync(join(ASSETS, nome), 'utf8')

    // caso 1: asset separado
    if (/registerProcessor\(\s*["']coletor-pcm["']/.test(texto) && nome !== 'index.js') {
      if (!/createRoot|useState/.test(texto)) return { forma: 'asset', url: './assets/' + nome }
    }

    // caso 2: embutido como data: URI dentro do bundle
    for (const m of texto.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)) {
      const fonte = Buffer.from(m[1], 'base64').toString('utf8')
      if (/registerProcessor\(\s*["']coletor-pcm["']/.test(fonte)) {
        return { forma: 'data-uri', url: m[0] }
      }
    }
  }
  return null
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const achado = acharWorklet()
  if (!achado) {
    process.stdout.write(JSON.stringify({ erro: 'worklet não encontrado no build' }))
    return app.exit(0)
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  await win.loadFile(join(RENDERER, 'index.html'))

  // Roda 2s de áudio a 16 kHz por dentro do worklet e conta o que ele posta.
  const codigo = `
    (async () => {
      const AMOSTRAS_POR_BLOCO = 4000
      const SEGUNDOS = 2
      const TAXA = 16000
      const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: TAXA * SEGUNDOS, sampleRate: TAXA })
      await ctx.audioWorklet.addModule(${JSON.stringify(achado.url)})

      const no = new AudioWorkletNode(ctx, 'coletor-pcm', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1, channelCountMode: 'explicit',
        processorOptions: { amostrasPorBloco: AMOSTRAS_POR_BLOCO }
      })

      const tamanhos = []
      no.port.onmessage = (e) => tamanhos.push(e.data.length)

      // Fonte ESTÉREO de propósito: se o rebaixamento para mono não estivesse
      // acontecendo no grafo, o worklet veria dois canais e leria só o esquerdo.
      const fonte = ctx.createBufferSource()
      const buf = ctx.createBuffer(2, TAXA * SEGUNDOS, TAXA)
      for (let c = 0; c < 2; c++) {
        const dados = buf.getChannelData(c)
        for (let i = 0; i < dados.length; i++) dados[i] = Math.sin(2 * Math.PI * 440 * i / TAXA)
      }
      fonte.buffer = buf
      fonte.connect(no)
      const mudo = ctx.createGain(); mudo.gain.value = 0
      no.connect(mudo).connect(ctx.destination)
      fonte.start()

      await ctx.startRendering()
      await new Promise((r) => setTimeout(r, 400))   // deixa as mensagens chegarem

      return JSON.stringify({
        forma: ${JSON.stringify(achado.forma)},
        pagina: location.protocol,
        canaisDoNo: no.channelCount,
        blocos: tamanhos.length,
        tamanhos: [...new Set(tamanhos)]
      })
    })()
  `

  try {
    process.stdout.write(await win.webContents.executeJavaScript(codigo))
  } catch (err) {
    process.stdout.write(JSON.stringify({ erro: String((err && err.message) || err) }))
  }
  app.exit(0)
})
