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
//
// ─────────────────────────────────────────────────────────────────────────
// PROTOCOLO — NÃO "SIMPLIFIQUE" NADA DAQUI SEM MEDIR DE NOVO
// Verificado em 2026-07-27 contra o endpoint real do Google, com chave real
// e PCM16 16 kHz real. O script que prova cada item está em
// scripts/diag-gemini-audio.js — rode-o antes de mudar qualquer coisa.
// A versão anterior deste arquivo errava 3 dos 4 pontos abaixo, e o app caía
// calado no motor local a cada ditado.
//
//  1. MODELO: `models/gemini-2.0-flash-exp` NÃO EXISTE MAIS. O servidor fecha
//     com 1008 "is not found for API version v1alpha, or is not supported for
//     bidiGenerateContent". Os ids que esta chave aceita hoje em
//     bidiGenerateContent (via ListModels):
//       models/gemini-2.5-flash-native-audio-latest
//       models/gemini-2.5-flash-native-audio-preview-09-2025
//       models/gemini-2.5-flash-native-audio-preview-12-2025
//       models/gemini-3.1-flash-live-preview      <- o nosso padrão
//       models/gemini-3.5-live-translate-preview
//
//  2. responseModalities É ['AUDIO'], não ['TEXT']. Pedir TEXT fecha com 1007
//     "The requested combination of response modalities (TEXT) is not
//     supported by the model". Os modelos Live só emitem áudio — o texto que
//     a gente quer vem por outro caminho (item 4).
//
//  3. `realtimeInput.mediaChunks` foi DEPRECADO: 1007 "realtime_input.
//     media_chunks is deprecated. Use audio, video, or text instead". O frame
//     hoje é `{ realtimeInput: { audio: { mimeType, data } } }`.
//
//  4. O texto do ditado NÃO está em modelTurn.parts[].text — aquilo é a
//     RESPOSTA falada do modelo. O que interessa é
//     `serverContent.inputTranscription.text`, a transcrição do que o USUÁRIO
//     falou, habilitada por `inputAudioTranscription: {}` no setup. Sem esse
//     campo no setup a transcrição simplesmente nunca chega.
//
//  Ainda sobre o setup: a systemInstruction de "gravador silencioso" não é
//  enfeite. Sem ela o modelo RESPONDE ao usuário — medido: veio "Entendido!
//  Para fazer um bom resumo, você poderia me passar..." e dezenas de partes
//  de áudio que a gente paga, recebe e descarta. Com ela: zero modelTurn,
//  zero outputTranscription, fechamento limpo em 1000.
//
//  E `automaticActivityDetection` fica LIGADO (o padrão). Desligar exige
//  mandar activityStart/activityEnd na mão; sem isso o servidor não considera
//  que houve fala e não transcreve NADA — testado, deu string vazia.
//
//  Comportamento observado (não é bug nosso): a transcrição chega num único
//  frame no fim da fala, não palavra a palavra. O texto na pílula portanto
//  aparece de uma vez no final.
// ─────────────────────────────────────────────────────────────────────────

// ATENÇÃO: é ESTE o botão a girar quando parar de funcionar.
// Os ids "preview"/"latest" da Live API são aposentados sem aviso. Quando a
// sessão começar a fechar logo depois do setup com erro de modelo inválido,
// troque aqui por outro da lista acima — ou defina DITA_GEMINI_MODEL pra
// testar um id novo sem recompilar.
export const MODELO_PADRAO = 'models/gemini-3.1-flash-live-preview'

export function modeloAtual() {
  return process.env.DITA_GEMINI_MODEL || MODELO_PADRAO
}

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent'

// PCM 16 bits little-endian, 16 kHz, mono — o único formato de entrada que a
// Live API aceita hoje. Quem converte é o renderer (AudioWorklet); aqui o
// buffer chega pronto.
export const MIME_PCM = 'audio/pcm;rate=16000'

// O Gemini Live é um modelo de CONVERSA. Quem transcreve é o
// inputAudioTranscription do servidor, não o modelo — então o trabalho desta
// instrução é só um: calar o modelo. Sem ela ele responde ao usuário em áudio
// (medido em 2026-07-27), e a gente paga por cada token dessa resposta que vai
// direto pro lixo. Não troque por um texto de "transcritor literal": isso
// convida o modelo a falar de novo.
const INSTRUCAO_SILENCIO =
  'Você é um gravador silencioso. NUNCA responda, NUNCA comente, NUNCA gere áudio. Permaneça em silêncio absoluto sempre.'

export function urlSessao(apiKey) {
  return `${ENDPOINT}?key=${encodeURIComponent(String(apiKey ?? ''))}`
}

// Primeiro frame da conexão. Cada campo aqui foi arrancado do servidor na
// marra; leia o bloco PROTOCOLO no topo antes de mexer.
export function montarSetup(model = modeloAtual()) {
  return {
    setup: {
      model: String(model || MODELO_PADRAO),
      generationConfig: {
        // ['TEXT'] é RECUSADO (close 1007). Modelo Live só emite áudio.
        responseModalities: ['AUDIO'],
        // ditado não é criatividade: qualquer temperatura acima de zero vira
        // paráfrase do que foi falado
        temperature: 0
      },
      // O PULO DO GATO: é isto que faz o servidor mandar
      // serverContent.inputTranscription.text — o texto do que o USUÁRIO
      // falou. Sem este campo a sessão conecta, funciona e não transcreve nada.
      inputAudioTranscription: {},
      systemInstruction: { parts: [{ text: INSTRUCAO_SILENCIO }] }
    }
  }
}

function paraBuffer(pcm16) {
  if (Buffer.isBuffer(pcm16)) return pcm16
  if (pcm16 instanceof ArrayBuffer) return Buffer.from(new Uint8Array(pcm16))
  if (ArrayBuffer.isView(pcm16)) return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
  return Buffer.from(pcm16 ?? [])
}

// `realtimeInput.mediaChunks` (um ARRAY) foi deprecado e hoje derruba a sessão
// com 1007. O formato vivo é um único objeto `audio`.
export function montarChunk(pcm16) {
  return {
    realtimeInput: {
      audio: { mimeType: MIME_PCM, data: paraBuffer(pcm16).toString('base64') }
    }
  }
}

// Frame de "acabei de falar". Com a detecção automática de atividade ligada é
// `audioStreamEnd` que fecha o turno — o antigo clientContent.turnComplete
// mandava um turno de conversa vazio, que não é o que a gente quer dizer.
export function montarFimDeTurno() {
  return { realtimeInput: { audioStreamEnd: true } }
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

// A transcrição do que o USUÁRIO falou. É `serverContent.inputTranscription`,
// e SÓ ela.
//
// Nunca leia `serverContent.modelTurn.parts[].text`: aquilo é a RESPOSTA do
// modelo ao usuário ("Entendido! Para fazer um bom resumo..."). Um app de
// ditado que cola aquele texto cola a fala do robô no lugar da fala da pessoa.
// A INSTRUCAO_SILENCIO já faz o modelTurn nunca aparecer, mas ignorar aqui
// também é cinto de segurança: se um dia a instrução for enfraquecida, o pior
// que acontece é gastar tokens à toa, não escrever besteira no editor do
// usuário. `outputTranscription` (a transcrição da voz do modelo) fica de fora
// pelo mesmo motivo.
//
// Concatenar CRU (sem separador) na hora de somar frames é o certo — o
// servidor já manda os espaços onde eles existem, e inserir um por conta
// própria racharia palavra no meio, o mesmo bug que o whisper tinha em
// juntarSegmentos().
export function extrairTexto(frame) {
  const obj = normalizarFrame(frame)
  const t = obj && obj.serverContent && obj.serverContent.inputTranscription
    ? obj.serverContent.inputTranscription.text
    : null
  return typeof t === 'string' ? t : ''
}

export function ehTurnoCompleto(frame) {
  const obj = normalizarFrame(frame)
  return Boolean(obj && obj.serverContent && obj.serverContent.turnComplete)
}

// O sinal que realmente marca "a transcrição acabou" no nosso caso.
//
// MEDIDO em 2026-07-27 (scripts/diag-gemini-tempo.js), com o áudio enviado em
// tempo real e o modelo silenciado:
//
//   +445ms  serverContent.inputTranscription  <- o texto, pronto
//   +445ms  serverContent.speechState = "NON_SPEECH"
//   +1103ms sessionResumptionUpdate  (e só keepalive daí pra frente, pra sempre)
//
// turnComplete NUNCA chega — o modelo está instruído a ficar calado, então não
// existe turno dele pra completar. Esperar por ele significava aguardar o
// PRAZO_FIM_MS inteiro em TODO ditado, com o texto pronto desde os 445ms.
// Durante a fala o mesmo campo vale "SPEECH"; ele vira "NON_SPEECH" quando o
// servidor considera a entrada encerrada.
export function ehFimDaFala(frame) {
  const obj = normalizarFrame(frame)
  const estado = obj && obj.serverContent && obj.serverContent.speechState
  return estado === 'NON_SPEECH'
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
//
// Por que 4s e não os 1,8s de antes: o servidor NÃO transcreve incrementalmente
// (ver bloco PROTOCOLO). A transcrição inteira chega num frame só depois do
// audioStreamEnd, então este prazo não é "o rabinho da última palavra" — é a
// frase toda. Estourar aqui significa devolver vazio e cair no motor local,
// que é exatamente o bug que este arquivo existe pra consertar.
const PRAZO_FIM_MS = 4000

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

    // Depois do encerrar(), qualquer um dos dois sinais quer dizer "não vem
    // mais nada" — devolve na hora em vez de esperar o PRAZO_FIM_MS inteiro.
    //
    // speechState=NON_SPEECH é o que acontece na prática (445ms); turnComplete
    // fica como rede para o caso de alguém afrouxar a instrução de silêncio e
    // o modelo voltar a produzir turno.
    if (encerrada && (ehFimDaFala(dados) || ehTurnoCompleto(dados))) terminar()
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
