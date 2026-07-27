// Prova de ponta a ponta do CLIENTE QUE VAI EMBARCADO (src/main/gemini-live.js),
// nao de um reimplemento paralelo. Os outros dois diagnosticos falam com a API
// por conta propria; este passa audio real pelo mesmo codigo que o app usa.
//
//   npm run diag:gemini:cliente
//   # equivale a:
//   DITA_APP_NAME="Dita Aí" npx electron scripts/diag-gemini-cliente.js
//
// DITA_APP_NAME NAO E OPCIONAL: o safeStorage amarra a cifragem da chave ao
// userData, que o Electron deriva do productName. Sem isso a chave nao decifra
// e o script mente dizendo que nao ha chave.
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

if (process.env.DITA_APP_NAME) app.setName(process.env.DITA_APP_NAME)

app.whenReady().then(async () => {
  const { lerConfig } = await import('../src/main/config-remoto.js')
  const { criarSessao, modeloAtual } = await import('../src/main/gemini-live.js')

  const cfg = lerConfig()
  if (!cfg.apiKey) { console.log('sem chave salva'); app.exit(1); return }

  const wav = path.join(process.env.TEMP, 'bench.wav')
  if (!fs.existsSync(wav)) { console.log('falta ' + wav + ' — rode diag:gemini:audio antes'); app.exit(1); return }
  const pcm = fs.readFileSync(wav).subarray(44) // pula cabecalho do wav

  console.log('modelo :', typeof modeloAtual === 'function' ? modeloAtual() : '(nao exportado)')
  console.log('audio  :', (pcm.length / 32000).toFixed(1) + 's')

  let ultimo = ''
  let erro = ''
  const sessao = criarSessao({
    apiKey: cfg.apiKey,
    onTexto: (t) => { ultimo = t; console.log('  [onTexto]', JSON.stringify(t.slice(0, 120))) },
    onErro: (m) => { erro = m; console.log('  [onErro]', m) },
    onFim: () => console.log('  [onFim]')
  })

  // Alimenta em blocos de 250ms, como o renderer faz.
  const passo = 8000
  for (let i = 0; i < pcm.length; i += passo) {
    sessao.enviarAudio(pcm.subarray(i, i + passo))
    await new Promise((r) => setTimeout(r, 250)) // TEMPO REAL: e assim que o renderer alimenta
  }

  console.log('>>> encerrando sessao')
  const t0 = Date.now()
  const texto = await sessao.encerrar()
  console.log('espera apos soltar a tecla:', (Date.now() - t0) + 'ms')

  console.log('\n=== RESULTADO ===')
  console.log('texto      :', JSON.stringify(texto || ultimo))
  console.log('erro       :', erro || '(nenhum)')
  const ok = Boolean((texto || ultimo).trim()) && !erro
  console.log('veredito   :', ok ? 'CLIENTE DO APP FUNCIONA' : 'FALHOU')
  app.exit(ok ? 0 : 1)
})
