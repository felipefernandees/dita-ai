import WebSocket from 'ws'

// Cliente do Gemini Live (BidiGenerateContent) por WebSocket.
//
// Por que o pacote `ws` e não o WebSocket global: o Electron 34 roda Node
// 20.19 no processo main, e lá `globalThis.WebSocket` não existe (só chegou
// estável no Node 22). Verificado nesta máquina — sem o `ws` o módulo quebra
// em runtime e passa despercebido na suíte.
//
// O arquivo é dividido de propósito em duas metades: as funções PURAS
// (montarSetup, montarChunk, extrairTexto, ehTurnoCompleto, extrairErro), que
// os testes exercitam sem rede nem chave, e a fábrica criarSessao(), que só
// costura socket + fila + callbacks em volta delas.

// ATENÇÃO: é ESTE o botão a girar quando parar de funcionar.
// Os ids de modelo experimentais do Gemini rodam e são aposentados sem aviso
// (o "-exp" no nome é literalmente isso). Quando a sessão começar a fechar
// logo depois do setup com erro de modelo inválido, troque aqui — ou defina
// DITA_GEMINI_MODEL pra testar um id novo sem recompilar.
export const MODELO_PADRAO = 'models/gemini-2.0-flash-exp'

export function modeloAtual() {
  return process.env.DITA_GEMINI_MODEL || MODELO_PADRAO
}

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent'

// PCM 16 bits little-endian, 16 kHz, mono — o único formato de entrada que a
// Live API aceita hoje. Quem converte é o renderer (AudioWorklet); aqui o
// buffer chega pronto.
export const MIME_PCM = 'audio/pcm;rate=16000'

// O Gemini é um modelo de conversa, não um transcritor: sem esta instrução ele
// RESPONDE ao que ouviu ("Claro! Posso ajudar com isso") em vez de escrever o
// que foi dito. É o que transforma a Live API num motor de ditado.
const INSTRUCAO_TRANSCRICAO = [
  'Você é um transcritor literal de fala em português do Brasil.',
  'Escreva EXATAMENTE o que o usuário falar, com pontuação e acentuação corretas.',
  'Nunca responda, nunca comente, nunca faça perguntas, nunca traduza.',
  'Não acrescente prefixos, aspas, marcações nem explicações.',
  'Se não houver fala audível, não escreva nada.'
].join(' ')

export function urlSessao(apiKey) {
  return `${ENDPOINT}?key=${encodeURIComponent(String(apiKey ?? ''))}`
}

// Primeiro frame da conexão. `responseModalities: ['TEXT']` é obrigatório:
// o padrão da Live API é ÁUDIO, e sem isso o servidor devolve voz sintetizada
// em vez do texto que a gente precisa colar.
export function montarSetup(model = modeloAtual()) {
  return {
    setup: {
      model: String(model || MODELO_PADRAO),
      generationConfig: {
        responseModalities: ['TEXT'],
        // ditado não é criatividade: qualquer temperatura acima de zero vira
        // paráfrase do que foi falado
        temperature: 0
      },
      systemInstruction: { parts: [{ text: INSTRUCAO_TRANSCRICAO }] }
    }
  }
}

function paraBuffer(pcm16) {
  if (Buffer.isBuffer(pcm16)) return pcm16
  if (pcm16 instanceof ArrayBuffer) return Buffer.from(new Uint8Array(pcm16))
  if (ArrayBuffer.isView(pcm16)) return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
  return Buffer.from(pcm16 ?? [])
}

export function montarChunk(pcm16) {
  return {
    realtimeInput: {
      mediaChunks: [{ mimeType: MIME_PCM, data: paraBuffer(pcm16).toString('base64') }]
    }
  }
}

// Frame de "acabei de falar". Fecha o turno pro modelo emitir o resto do texto
// em vez de ficar esperando mais áudio.
export function montarFimDeTurno() {
  return { clientContent: { turns: [], turnComplete: true } }
}

// Os frames chegam como Buffer (é o que o `ws` entrega); aceitar string e
// objeto também deixa os testes escreverem o caso direto, sem serializar.
export function normalizarFrame(frame) {
  if (frame == null) return null
  if (typeof frame === 'object' && !Buffer.isBuffer(frame) && !(frame instanceof ArrayBuffer) && !ArrayBuffer.isView(frame)) {
    return frame
  }
  try {
    return JSON.parse(paraBuffer(frame).toString('utf8'))
  } catch {
    return null
  }
}

// O texto vem fatiado: várias `parts` no mesmo frame E vários frames no mesmo
// turno. Concatenar CRU (sem separador) é o certo — o modelo já manda os
// espaços onde eles existem, e inserir um por conta própria racharia palavra
// no meio, o mesmo bug que o whisper tinha em juntarSegmentos().
export function extrairTexto(frame) {
  const obj = normalizarFrame(frame)
  const partes = obj && obj.serverContent && obj.serverContent.modelTurn
    ? obj.serverContent.modelTurn.parts
    : null
  if (!Array.isArray(partes)) return ''
  let texto = ''
  for (const p of partes) {
    if (p && typeof p.text === 'string') texto += p.text
  }
  return texto
}

export function ehTurnoCompleto(frame) {
  const obj = normalizarFrame(frame)
  return Boolean(obj && obj.serverContent && obj.serverContent.turnComplete)
}

export function ehSetupCompleto(frame) {
  const obj = normalizarFrame(frame)
  return Boolean(obj && obj.setupComplete)
}

// Erros de aplicação (chave inválida, cota) vêm como frame normal, não como
// erro de socket.
export function extrairErro(frame) {
  const obj = normalizarFrame(frame)
  if (!obj) return ''
  if (obj.error) {
    if (typeof obj.error === 'string') return obj.error
    if (typeof obj.error.message === 'string') return obj.error.message
    return JSON.stringify(obj.error)
  }
  return ''
}

// Traduz o código de fechamento do WebSocket pro que o usuário precisa fazer.
// 1008 é o que o Google usa pra chave inválida e pra cota estourada.
export function descreverFechamento(code, motivo) {
  const extra = motivo ? ` (${motivo})` : ''
  if (code === 1000) return ''
  if (code === 1008) return `O Google recusou a sessão — confira se a chave da API é válida e se ainda há cota${extra}.`
  if (code === 1011) return `O servidor do Gemini falhou no meio da sessão${extra}.`
  return `A conexão com o Gemini caiu (código ${code})${extra}.`
}

// Teto da fila de pré-handshake. 16 kHz mono PCM16 = 32 KB/s; ~600 chunks de
// 100ms seriam quase um minuto de fala. Existe só pra um handshake que nunca
// completa não virar vazamento de memória enquanto o usuário fala sem parar.
const MAX_FILA = 600

// Se o setupComplete nunca chegar, a fila fica presa e o usuário perde a fala
// INTEIRA. Preferimos despejar o áudio às cegas depois deste prazo: no pior
// caso o servidor rejeita e o erro aparece; no melhor, a sessão funciona.
const PRAZO_HANDSHAKE_MS = 2500

// Depois de encerrar(), quanto esperamos pelo turnComplete/close antes de
// entregar o que já temos. Sem uma espera o último trecho da frase se perde;
// com uma espera longa demais o popup fica pendurado.
const PRAZO_FIM_MS = 1800

export function criarSessao({
  apiKey,
  onTexto = () => {},
  onErro = () => {},
  onFim = () => {},
  model = modeloAtual(),
  // injetável só pra teste: recebe a URL e devolve algo com a interface do `ws`
  criarSocket = (url) => new WebSocket(url)
} = {}) {
  let texto = ''
  let pronto = false        // setup confirmado: pode mandar áudio
  let encerrada = false
  let finalizada = false
  const fila = []
  let descartados = 0
  let resolverFim = null
  let timerHandshake = null
  let timerFim = null

  const ws = criarSocket(urlSessao(apiKey))

  function avisarErro(msg) {
    if (!msg) return
    try { onErro(msg) } catch (err) { console.error('gemini-live: onErro estourou:', err.message) }
  }

  function enviarJson(obj) {
    try {
      ws.send(JSON.stringify(obj))
      return true
    } catch (err) {
      avisarErro(`Não consegui enviar áudio ao Gemini: ${err.message}`)
      return false
    }
  }

  // O socket pode ainda estar abrindo quando o primeiro chunk chega — e os
  // primeiros 250ms de fala são justamente onde mora a primeira palavra. Então
  // nada é descartado: fica na fila e sai daqui na ordem assim que o
  // handshake fecha.
  function liberarFila(motivo) {
    if (timerHandshake) { clearTimeout(timerHandshake); timerHandshake = null }
    if (pronto) return
    pronto = true
    if (motivo) console.error(`gemini-live: liberando fila sem setupComplete (${motivo})`)
    while (fila.length) enviarJson(fila.shift())
    if (descartados) {
      avisarErro(`A conexão demorou demais e ${descartados} trechos de áudio foram descartados.`)
      descartados = 0
    }
  }

  function terminar() {
    if (finalizada) return
    finalizada = true
    if (timerHandshake) { clearTimeout(timerHandshake); timerHandshake = null }
    if (timerFim) { clearTimeout(timerFim); timerFim = null }
    try { onFim(texto) } catch (err) { console.error('gemini-live: onFim estourou:', err.message) }
    if (resolverFim) { const r = resolverFim; resolverFim = null; r(texto) }
  }

  ws.on('open', () => {
    enviarJson(montarSetup(model))
    timerHandshake = setTimeout(() => liberarFila('tempo esgotado'), PRAZO_HANDSHAKE_MS)
  })

  ws.on('message', (dados) => {
    const erro = extrairErro(dados)
    if (erro) { avisarErro(`Gemini: ${erro}`); return }

    if (ehSetupCompleto(dados)) { liberarFila(); return }

    const pedaco = extrairTexto(dados)
    if (pedaco) {
      texto += pedaco
      try { onTexto(texto) } catch (err) { console.error('gemini-live: onTexto estourou:', err.message) }
    }

    // turnComplete depois do encerrar() é o sinal de "não vem mais nada":
    // devolve na hora em vez de esperar o PRAZO_FIM_MS inteiro.
    if (ehTurnoCompleto(dados) && encerrada) terminar()
  })

  ws.on('error', (err) => {
    avisarErro(`Falha de conexão com o Gemini: ${err && err.message ? err.message : err}`)
    liberarFila('erro de socket')
    terminar()
  })

  ws.on('close', (code, motivo) => {
    const texto1 = descreverFechamento(Number(code), motivo ? String(motivo) : '')
    // Fechamento inesperado no meio do ditado é erro; fechamento depois do
    // encerrar() é o fluxo normal.
    if (texto1 && !encerrada) avisarErro(texto1)
    liberarFila('socket fechado')
    terminar()
  })

  return {
    enviarAudio(pcm16) {
      if (encerrada) return false
      const chunk = montarChunk(pcm16)
      if (!pronto) {
        if (fila.length >= MAX_FILA) { fila.shift(); descartados++ }
        fila.push(chunk)
        return true
      }
      return enviarJson(chunk)
    },

    // Devolve o texto final. Resolve no turnComplete/close, ou no prazo — o
    // popup nunca fica pendurado por causa de um servidor mudo.
    encerrar({ esperarMs = PRAZO_FIM_MS } = {}) {
      if (finalizada) return Promise.resolve(texto)
      encerrada = true
      liberarFila()
      enviarJson(montarFimDeTurno())
      return new Promise((resolve) => {
        resolverFim = resolve
        timerFim = setTimeout(() => {
          try { ws.close() } catch {}
          terminar()
        }, esperarMs)
      })
    },

    // Corta tudo sem esperar nada (Esc "duro"): não interessa mais o texto.
    abortar() {
      encerrada = true
      try { ws.close() } catch {}
      terminar()
    },

    textoAcumulado() { return texto }
  }
}
