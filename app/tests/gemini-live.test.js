import { describe, it, expect, vi } from 'vitest'
import {
  montarSetup, montarChunk, montarFimDeTurno, extrairTexto, normalizarFrame,
  ehTurnoCompleto, ehFimDaFala, ehSetupCompleto, extrairErro, descreverFechamento,
  urlSessao, modeloAtual, criarSessao, MODELO_PADRAO, MIME_PCM
} from '../src/main/gemini-live.js'

// Nada aqui toca a rede nem precisa de chave: as funções puras são testadas
// direto, e a fábrica recebe um socket falso por injeção.
//
// ATENÇÃO: os formatos de frame abaixo NÃO são invenção nossa — foram medidos
// contra o endpoint real do Google em 2026-07-27 (scripts/diag-gemini-audio.js).
// A versão anterior deste arquivo codificava o protocolo ERRADO e passava
// verdinha enquanto o app falhava em produção a cada ditado. Se você for
// "arrumar" uma expectativa daqui, prove com o diagnóstico antes.
function socketFalso() {
  const handlers = {}
  const enviados = []
  return {
    enviados,
    on(evento, fn) { (handlers[evento] ||= []).push(fn) },
    send(payload) { enviados.push(JSON.parse(payload)) },
    close: vi.fn(),
    // gatilhos de teste
    abrir() { (handlers.open || []).forEach((f) => f()) },
    receber(obj) { (handlers.message || []).forEach((f) => f(Buffer.from(JSON.stringify(obj)))) },
    falhar(err) { (handlers.error || []).forEach((f) => f(err)) },
    fechar(code, motivo) { (handlers.close || []).forEach((f) => f(code, motivo)) }
  }
}

const audio = (chunk) => chunk.realtimeInput.audio.data
// audioStreamEnd também mora em realtimeInput; filtrar por `.audio` separa
// áudio de verdade do sinal de fim.
const chunksDeAudio = (ws) => ws.enviados.filter((m) => m.realtimeInput && m.realtimeInput.audio)

describe('montarSetup', () => {
  it('usa um modelo Live que existe hoje, não o gemini-2.0-flash-exp aposentado', () => {
    const setup = montarSetup()
    expect(setup.setup.model).toBe(MODELO_PADRAO)
    expect(MODELO_PADRAO).toBe('models/gemini-3.1-flash-live-preview')
    // o id antigo fecha a sessão com 1008 "is not found for API version
    // v1alpha, or is not supported for bidiGenerateContent"
    expect(MODELO_PADRAO).not.toContain('2.0-flash-exp')
  })

  it('pede saída em ÁUDIO — pedir TEXT é recusado com close 1007', () => {
    // "The requested combination of response modalities (TEXT) is not
    // supported by the model". Os modelos Live só emitem áudio; o texto do
    // ditado vem por inputTranscription, não por aqui.
    expect(montarSetup().setup.generationConfig.responseModalities).toEqual(['AUDIO'])
  })

  it('liga inputAudioTranscription — sem isso a sessão conecta e não transcreve NADA', () => {
    expect(montarSetup().setup.inputAudioTranscription).toEqual({})
  })

  it('aceita um modelo explícito (os ids "preview" são aposentados sem aviso)', () => {
    expect(montarSetup('models/gemini-9.9-flash').setup.model).toBe('models/gemini-9.9-flash')
  })

  it('modelo vazio cai no padrão em vez de mandar string vazia ao servidor', () => {
    expect(montarSetup('').setup.model).toBe(MODELO_PADRAO)
    expect(montarSetup(null).setup.model).toBe(MODELO_PADRAO)
  })

  it('manda instrução de silêncio — sem ela o modelo RESPONDE ao usuário', () => {
    // Medido sem a instrução: o modelo devolveu "Entendido! Para fazer um bom
    // resumo, você poderia me passar..." em dezenas de partes de áudio que a
    // gente paga, recebe e descarta.
    const texto = montarSetup().setup.systemInstruction.parts[0].text.toLowerCase()
    expect(texto).toContain('nunca responda')
    expect(texto).toContain('silêncio')
    expect(montarSetup().setup.generationConfig.temperature).toBe(0)
  })

  it('não desliga a detecção automática de atividade', () => {
    // Desligar exige mandar activityStart/activityEnd na mão; sem isso o
    // servidor não considera que houve fala e devolve transcrição vazia.
    expect(montarSetup().setup.realtimeInputConfig).toBeUndefined()
  })

  it('DITA_GEMINI_MODEL sobrescreve o padrão', () => {
    const anterior = process.env.DITA_GEMINI_MODEL
    process.env.DITA_GEMINI_MODEL = 'models/teste-override'
    try {
      expect(modeloAtual()).toBe('models/teste-override')
      expect(montarSetup().setup.model).toBe('models/teste-override')
    } finally {
      if (anterior === undefined) delete process.env.DITA_GEMINI_MODEL
      else process.env.DITA_GEMINI_MODEL = anterior
    }
  })
})

describe('montarChunk', () => {
  it('embrulha o PCM em realtimeInput.audio (mediaChunks foi deprecado)', () => {
    const chunk = montarChunk(Buffer.from([0x01, 0x02, 0x03, 0x04]))
    expect(chunk.realtimeInput.audio.mimeType).toBe(MIME_PCM)
    expect(MIME_PCM).toBe('audio/pcm;rate=16000')
    // o formato antigo derruba a sessão com 1007 "realtime_input.media_chunks
    // is deprecated. Use audio, video, or text instead"
    expect(chunk.realtimeInput.mediaChunks).toBeUndefined()
    expect(Object.keys(chunk.realtimeInput)).toEqual(['audio'])
  })

  it('o áudio vai em base64 e volta byte a byte igual', () => {
    const pcm = Buffer.from([0, 255, 128, 7, 0, 0])
    const voltou = Buffer.from(audio(montarChunk(pcm)), 'base64')
    expect(voltou.equals(pcm)).toBe(true)
  })

  it('aceita ArrayBuffer e TypedArray (é o que chega do renderer via IPC)', () => {
    const view = new Int16Array([1, -1, 32767, -32768])
    const doTyped = Buffer.from(audio(montarChunk(view)), 'base64')
    const doArrayBuffer = Buffer.from(audio(montarChunk(view.buffer)), 'base64')
    expect(doTyped.equals(Buffer.from(view.buffer))).toBe(true)
    expect(doArrayBuffer.equals(doTyped)).toBe(true)
  })

  it('buffer vazio não explode', () => {
    expect(audio(montarChunk(Buffer.alloc(0)))).toBe('')
  })
})

describe('extrairTexto', () => {
  it('lê a transcrição da ENTRADA (o que o usuário falou)', () => {
    expect(extrairTexto({ serverContent: { inputTranscription: { text: 'olá' } } })).toBe('olá')
  })

  // ESTE É O TESTE QUE NÃO PODE REGREDIR.
  //
  // modelTurn.parts[].text é a RESPOSTA do modelo ao usuário, não o ditado.
  // A versão anterior lia dali e teria colado a fala do robô no editor.
  it('IGNORA modelTurn — aquilo é a resposta do modelo, não o ditado', () => {
    const resposta = {
      serverContent: {
        modelTurn: { parts: [{ text: 'Entendido! Para fazer um bom resumo, você poderia me passar...' }] }
      }
    }
    expect(extrairTexto(resposta)).toBe('')
  })

  it('com os dois no mesmo frame, fica só com a transcrição da entrada', () => {
    const frame = {
      serverContent: {
        inputTranscription: { text: 'manda o resumo da reunião' },
        modelTurn: { parts: [{ text: 'Claro! Posso ajudar com isso.' }] }
      }
    }
    expect(extrairTexto(frame)).toBe('manda o resumo da reunião')
  })

  it('outputTranscription (a voz do modelo) também é ignorada', () => {
    expect(extrairTexto({ serverContent: { outputTranscription: { text: 'Entendido!' } } })).toBe('')
  })

  // Concatenação CRUA: o servidor já manda os espaços onde eles existem.
  // Inserir um separador aqui rachava palavra no meio ("automat" + "izar").
  it('vários frames acumulam quando o chamador soma os pedaços, sem separador', () => {
    const frames = [
      { serverContent: { inputTranscription: { text: 'Bom ' } } },
      { serverContent: { inputTranscription: { text: 'dia' } } },
      { serverContent: { inputTranscription: { text: ', Felipe.' } } }
    ]
    expect(frames.map(extrairTexto).join('')).toBe('Bom dia, Felipe.')
  })

  it('frame sem texto nenhum devolve string vazia', () => {
    expect(extrairTexto({ setupComplete: {} })).toBe('')
    expect(extrairTexto({ serverContent: { turnComplete: true } })).toBe('')
    expect(extrairTexto({ serverContent: { inputTranscription: {} } })).toBe('')
    expect(extrairTexto({ serverContent: {} })).toBe('')
  })

  it('frame malformado não lança — devolve vazio', () => {
    expect(extrairTexto('{ isto nao e json')).toBe('')
    expect(extrairTexto(null)).toBe('')
    expect(extrairTexto(undefined)).toBe('')
    expect(extrairTexto(Buffer.from('lixo binário  '))).toBe('')
    expect(extrairTexto({ serverContent: { inputTranscription: { text: 42 } } })).toBe('')
    expect(extrairTexto({ serverContent: { inputTranscription: null } })).toBe('')
  })

  it('aceita Buffer, string e objeto (o `ws` entrega Buffer)', () => {
    const frame = { serverContent: { inputTranscription: { text: 'ok' } } }
    expect(extrairTexto(Buffer.from(JSON.stringify(frame)))).toBe('ok')
    expect(extrairTexto(JSON.stringify(frame))).toBe('ok')
    expect(extrairTexto(frame)).toBe('ok')
  })
})

describe('sinais de controle', () => {
  // Este é o sinal que o servidor REALMENTE manda quando o modelo está
  // silenciado — medido em 2026-07-27: inputTranscription e speechState
  // NON_SPEECH chegam juntos em ~445ms, e turnComplete nunca vem. Sem ele a
  // sessão esperava o prazo inteiro (4s) com o texto já pronto.
  it('ehFimDaFala reconhece o NON_SPEECH e ignora o resto', () => {
    expect(ehFimDaFala({ serverContent: { speechState: 'NON_SPEECH' } })).toBe(true)
    // durante a fala o mesmo campo vale SPEECH: encerrar aqui cortaria o ditado
    expect(ehFimDaFala({ serverContent: { speechState: 'SPEECH' } })).toBe(false)
    expect(ehFimDaFala({ serverContent: {} })).toBe(false)
    expect(ehFimDaFala({ sessionResumptionUpdate: {} })).toBe(false)
    expect(ehFimDaFala(null)).toBe(false)
    // aceita o frame cru, como chega do socket
    expect(ehFimDaFala(JSON.stringify({ serverContent: { speechState: 'NON_SPEECH' } }))).toBe(true)
  })

  it('ehTurnoCompleto', () => {
    expect(ehTurnoCompleto({ serverContent: { turnComplete: true } })).toBe(true)
    expect(ehTurnoCompleto({ serverContent: { turnComplete: false } })).toBe(false)
    expect(ehTurnoCompleto({ serverContent: {} })).toBe(false)
    expect(ehTurnoCompleto('lixo')).toBe(false)
  })

  it('ehSetupCompleto', () => {
    expect(ehSetupCompleto({ setupComplete: {} })).toBe(true)
    expect(ehSetupCompleto({ serverContent: {} })).toBe(false)
  })

  it('extrairErro cobre erro em string, em objeto e ausência de erro', () => {
    expect(extrairErro({ error: { message: 'API key not valid' } })).toBe('API key not valid')
    expect(extrairErro({ error: 'quota exceeded' })).toBe('quota exceeded')
    expect(extrairErro({ error: { code: 429 } })).toContain('429')
    expect(extrairErro({ serverContent: {} })).toBe('')
    expect(extrairErro('nao e json')).toBe('')
  })

  it('normalizarFrame devolve null pro que não é JSON', () => {
    expect(normalizarFrame('{{{')).toBe(null)
    expect(normalizarFrame(null)).toBe(null)
    expect(normalizarFrame({ a: 1 })).toEqual({ a: 1 })
  })

  it('montarFimDeTurno usa audioStreamEnd, não um turno de conversa vazio', () => {
    // Com a detecção automática de atividade ligada (o padrão, que a gente
    // mantém), é audioStreamEnd que diz "acabei de falar".
    expect(montarFimDeTurno()).toEqual({ realtimeInput: { audioStreamEnd: true } })
  })
})

describe('urlSessao', () => {
  it('aponta pro endpoint v1alpha do BidiGenerateContent', () => {
    const url = urlSessao('abc')
    expect(url.startsWith('wss://generativelanguage.googleapis.com/ws/')).toBe(true)
    expect(url).toContain('BidiGenerateContent')
    expect(url).toContain('?key=abc')
  })

  it('escapa a chave (uma chave com caractere especial não pode quebrar a URL)', () => {
    expect(urlSessao('a b&c=d')).toContain('key=a%20b%26c%3Dd')
  })
})

// Esta é a parte que não dá pra cobrir só com função pura: o socket ainda está
// abrindo quando a primeira palavra já foi falada.
describe('criarSessao — fila do handshake', () => {
  it('o setup é o PRIMEIRO frame da conexão', () => {
    const ws = socketFalso()
    criarSessao({ apiKey: 'k', criarSocket: () => ws })
    ws.abrir()
    expect(ws.enviados[0].setup).toBeTruthy()
  })

  it('áudio que chega antes do setupComplete é enfileirado, não descartado', () => {
    const ws = socketFalso()
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws })

    // usuário já falando enquanto o socket abre
    s.enviarAudio(Buffer.from([1, 1]))
    s.enviarAudio(Buffer.from([2, 2]))
    ws.abrir()
    s.enviarAudio(Buffer.from([3, 3]))
    expect(chunksDeAudio(ws)).toHaveLength(0)   // nada saiu ainda

    ws.receber({ setupComplete: {} })
    const saiu = chunksDeAudio(ws)
    expect(saiu).toHaveLength(3)
    // e SEM trocar a ordem: áudio fora de ordem vira frase embaralhada
    expect(saiu.map((c) => Buffer.from(audio(c), 'base64')[0])).toEqual([1, 2, 3])
  })

  it('depois do handshake o áudio sai na hora, sem bufferizar até o fim', () => {
    const ws = socketFalso()
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    s.enviarAudio(Buffer.from([9]))
    expect(chunksDeAudio(ws)).toHaveLength(1)
    s.enviarAudio(Buffer.from([9]))
    expect(chunksDeAudio(ws)).toHaveLength(2)
  })

  it('se o setupComplete nunca vier, a fila é despejada no prazo em vez de sumir', async () => {
    vi.useFakeTimers()
    try {
      const ws = socketFalso()
      const s = criarSessao({ apiKey: 'k', criarSocket: () => ws })
      ws.abrir()
      s.enviarAudio(Buffer.from([7]))
      expect(chunksDeAudio(ws)).toHaveLength(0)
      vi.advanceTimersByTime(3000)
      expect(chunksDeAudio(ws)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('criarSessao — acúmulo de texto e término', () => {
  it('acumula texto entre frames e avisa o chamador a cada pedaço', () => {
    const ws = socketFalso()
    const vistos = []
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws, onTexto: (t) => vistos.push(t) })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    ws.receber({ serverContent: { inputTranscription: { text: 'Bom ' } } })
    ws.receber({ serverContent: { inputTranscription: { text: 'dia.' } } })
    ws.receber({ serverContent: { turnComplete: true } })   // frame sem texto

    expect(s.textoAcumulado()).toBe('Bom dia.')
    expect(vistos).toEqual(['Bom ', 'Bom dia.'])
  })

  // Na prática o servidor manda a transcrição num frame só, no fim da fala —
  // medido, não é bug nosso. A sessão tem que funcionar nesse caso também.
  it('transcrição que chega num único frame no fim vale igual', () => {
    const ws = socketFalso()
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    s.enviarAudio(Buffer.from([1, 2]))
    ws.receber({ serverContent: { inputTranscription: { text: 'Preciso mandar o resumo da reunião hoje.' } } })
    expect(s.textoAcumulado()).toBe('Preciso mandar o resumo da reunião hoje.')
  })

  // Se a INSTRUCAO_SILENCIO um dia enfraquecer e o modelo voltar a responder,
  // a resposta dele NÃO pode acabar no editor do usuário.
  it('resposta falada do modelo não contamina o texto acumulado', () => {
    const ws = socketFalso()
    const vistos = []
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws, onTexto: (t) => vistos.push(t) })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    ws.receber({ serverContent: { modelTurn: { parts: [{ text: 'Entendido! Posso ajudar com isso.' }] } } })
    ws.receber({ serverContent: { outputTranscription: { text: 'Entendido!' } } })
    ws.receber({ serverContent: { inputTranscription: { text: 'faz o resumo' } } })

    expect(s.textoAcumulado()).toBe('faz o resumo')
    expect(vistos).toEqual(['faz o resumo'])
  })

  it('encerrar resolve com o texto assim que chega o turnComplete', async () => {
    const ws = socketFalso()
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    ws.receber({ serverContent: { inputTranscription: { text: 'pronto' } } })

    const p = s.encerrar()
    expect(ws.enviados.at(-1)).toEqual(montarFimDeTurno())
    ws.receber({ serverContent: { turnComplete: true } })
    await expect(p).resolves.toBe('pronto')
  })

  it('encerrar não fica pendurado se o servidor emudecer', async () => {
    const ws = socketFalso()
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    ws.receber({ serverContent: { inputTranscription: { text: 'parcial' } } })
    await expect(s.encerrar({ esperarMs: 5 })).resolves.toBe('parcial')
    expect(ws.close).toHaveBeenCalled()
  })

  it('close do servidor no meio do ditado resolve o encerrar com o que já veio', async () => {
    const ws = socketFalso()
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    ws.receber({ serverContent: { inputTranscription: { text: 'metade' } } })
    const p = s.encerrar()
    ws.fechar(1000, '')
    await expect(p).resolves.toBe('metade')
  })

  it('abortar corta a sessão e faz o encerrar seguinte resolver na hora', async () => {
    const ws = socketFalso()
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    ws.receber({ serverContent: { inputTranscription: { text: 'x' } } })
    s.abortar()
    expect(ws.close).toHaveBeenCalled()
    await expect(s.encerrar()).resolves.toBe('x')
    expect(s.enviarAudio(Buffer.from([1]))).toBe(false)
  })
})

describe('criarSessao — erros reportados por callback', () => {
  it('erro de aplicação (chave inválida) vira onErro, não exceção', () => {
    const ws = socketFalso()
    const erros = []
    criarSessao({ apiKey: 'k', criarSocket: () => ws, onErro: (m) => erros.push(m) })
    ws.abrir()
    ws.receber({ error: { message: 'API key not valid' } })
    expect(erros).toHaveLength(1)
    expect(erros[0]).toContain('API key not valid')
  })

  it('queda de rede vira onErro e libera a fila em vez de travar', () => {
    const ws = socketFalso()
    const erros = []
    const s = criarSessao({ apiKey: 'k', criarSocket: () => ws, onErro: (m) => erros.push(m) })
    ws.abrir()
    s.enviarAudio(Buffer.from([1]))
    ws.falhar(new Error('ECONNRESET'))
    expect(erros[0]).toContain('ECONNRESET')
  })

  it('fechamento inesperado do servidor vira onErro e onFim', () => {
    const ws = socketFalso()
    const erros = []
    const fins = []
    criarSessao({ apiKey: 'k', criarSocket: () => ws, onErro: (m) => erros.push(m), onFim: (t) => fins.push(t) })
    ws.abrir()
    ws.receber({ setupComplete: {} })
    ws.fechar(1008, 'quota')
    expect(erros[0]).toContain('chave da API')
    expect(fins).toEqual([''])
  })

  it('onFim dispara uma única vez, mesmo com error + close seguidos', () => {
    const ws = socketFalso()
    const fins = []
    criarSessao({ apiKey: 'k', criarSocket: () => ws, onErro: () => {}, onFim: () => fins.push(1) })
    ws.abrir()
    ws.falhar(new Error('boom'))
    ws.fechar(1006, '')
    expect(fins).toHaveLength(1)
  })

  it('descreverFechamento traduz os códigos que interessam', () => {
    expect(descreverFechamento(1000, '')).toBe('')
    expect(descreverFechamento(1008, 'quota')).toContain('chave da API')
    expect(descreverFechamento(1011, '')).toContain('servidor')
    expect(descreverFechamento(1006, '')).toContain('1006')
  })
})
