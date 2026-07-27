// Diagnostico da conexao com o Gemini Live, usando a chave JA SALVA.
//
// Roda como processo principal do Electron (sem abrir janela) porque a chave
// esta cifrada com safeStorage, que so existe com o app pronto.
//
//   npm run diag:gemini
//   # equivale a:
//   DITA_APP_NAME="Dita Aí" npx electron scripts/diag-gemini.js
//
// O DITA_APP_NAME NAO E OPCIONAL. O Electron deriva o userData do productName
// ("Dita Aí"), e o safeStorage amarra a chave de cifragem AO userData. Sem
// isso o userData vira "app"/"Electron", a decifragem falha e o diagnostico
// mente dizendo que nao ha chave salva. As linhas "identidade do processo"
// abaixo existem justamente para voce conferir isso a olho nu.
//
// A chave NUNCA e impressa: so o tamanho e o prefixo, o suficiente para
// distinguir "chave vazia" de "chave com espaco no fim" sem vazar credencial.
const { app } = require('electron')

// O safeStorage do Chromium guarda a chave de criptografia DENTRO do userData
// do app. Se este diagnóstico rodar com um userData diferente do app real, a
// decifragem falha por motivo trivial e a gente acusa o código errado.
if (process.env.DITA_APP_NAME) app.setName(process.env.DITA_APP_NAME)
if (process.env.DITA_USER_DATA) app.setPath('userData', process.env.DITA_USER_DATA)

app.whenReady().then(async () => {
  const { safeStorage } = require('electron')
  console.log('--- identidade do processo ---')
  console.log('app.getName()   :', app.getName())
  console.log('userData        :', app.getPath('userData'))
  console.log('cifragem OK?    :', safeStorage.isEncryptionAvailable())
  try {
    const ida = safeStorage.encryptString('teste-de-ida-e-volta')
    const volta = safeStorage.decryptString(ida)
    console.log('ida e volta     :', volta === 'teste-de-ida-e-volta' ? 'OK' : 'FALHOU')
  } catch (e) {
    console.log('ida e volta     : EXPLODIU —', e.message)
  }
  console.log('')

  const { lerConfig } = await import('../out/main/config-remoto.js').catch(() => ({}))
    .then((m) => m.lerConfig ? m : import('../src/main/config-remoto.js'))

  const cfg = lerConfig()
  const chave = cfg.apiKey || ''

  console.log('--- chave ---')
  console.log('presente :', Boolean(chave))
  console.log('cifrada  :', cfg.chaveCifrada)
  console.log('tamanho  :', chave.length)
  console.log('prefixo  :', chave.slice(0, 4) + '...')
  console.log('espacos  :', chave !== chave.trim() ? 'SIM (a chave tem espaco/quebra nas pontas!)' : 'nao')
  if (!chave) { app.exit(1); return }

  // Mesmo padrao do app. O antigo 'models/gemini-2.0-flash-exp' foi aposentado
  // e hoje so devolve close 1008 — este diagnostico acusaria "chave ruim"
  // quando o problema e o id do modelo.
  const modelo = process.env.DITA_GEMINI_MODEL || 'models/gemini-3.1-flash-live-preview'
  const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(chave.trim())

  console.log('\n--- conexao ---')
  console.log('modelo   :', modelo)
  console.log('endpoint : ...BidiGenerateContent?key=<oculta>')

  const WebSocket = require('ws')
  const ws = new WebSocket(url)
  let respondeu = false

  const fim = (codigo) => { try { ws.close() } catch {} ; setTimeout(() => app.exit(codigo), 300) }

  ws.on('open', () => {
    console.log('socket   : ABERTO')
    // responseModalities ['TEXT'] e RECUSADO pelos modelos Live (close 1007).
    // Este e o setup minimo que realmente completa o handshake.
    const setup = { setup: { model: modelo, generationConfig: { responseModalities: ['AUDIO'] } } }
    console.log('enviando setup:', JSON.stringify(setup))
    ws.send(JSON.stringify(setup))
  })

  ws.on('message', (dados) => {
    respondeu = true
    const texto = dados.toString('utf8')
    console.log('\n--- frame recebido ---')
    console.log(texto.slice(0, 900))
    try {
      const j = JSON.parse(texto)
      console.log('chaves do topo:', Object.keys(j).join(', '))
    } catch { console.log('(nao e JSON — pode ser binario)') }
    fim(0)
  })

  ws.on('error', (err) => {
    console.log('\n--- ERRO ---')
    console.log(err && err.message)
    fim(1)
  })

  ws.on('close', (codigo, motivo) => {
    console.log('\n--- fechou ---')
    console.log('codigo:', codigo, '| motivo:', String(motivo || '').slice(0, 300))
    if (!respondeu) console.log('(fechou sem responder nada ao setup)')
    setTimeout(() => app.exit(respondeu ? 0 : 1), 200)
  })

  setTimeout(() => { if (!respondeu) { console.log('\n(sem resposta em 15s)'); fim(1) } }, 15000)
})
