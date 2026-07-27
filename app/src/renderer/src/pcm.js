// Conversão do áudio do microfone para o formato que o Gemini Live exige:
// PCM linear, 16 bits com sinal, little-endian, 16 kHz, mono.
//
// POR QUE ISTO É UM MÓDULO SEPARADO, SEM NADA DE DOM
//
// Nada no processo main valida o formato do que chega em `rt:audio`. Mandar
// 48 kHz onde o Google espera 16 kHz não vira erro em lugar nenhum: vira uma
// transcrição de palavras que o usuário não falou, três vezes mais rápida do
// que ele falou. O sintoma não aponta para a causa, e o único jeito de garantir
// a conversão é testá-la — para isso ela não pode depender de AudioContext, de
// AudioWorklet nem de microfone. Daí ser .js puro, igual ao atalhos.js.
//
// O AudioWorklet (pcm-worklet.js) só ACUMULA Float32 e posta; toda a aritmética
// que decide os bytes finais mora aqui, para que o código testado seja
// exatamente o código executado.

// Taxa que o Gemini Live espera na entrada. Não é configurável do outro lado.
export const TAXA_ALVO = 16000

// Tamanho de bloco em milissegundos. 250 ms é o meio-termo: menor que isso
// multiplica mensagens entre threads e pacotes no WebSocket sem o Google
// responder mais rápido; maior que isso o texto começa a chegar em soluços
// visíveis no popup, que é justamente o que o modo tempo real vende.
export const MS_POR_CHUNK = 250

// Quantas amostras da TAXA DE ENTRADA fecham um bloco de MS_POR_CHUNK.
// É calculado na taxa de entrada (não na de saída) porque quem acumula é o
// worklet, e ele só conhece a taxa do contexto em que foi criado.
export function amostrasPorChunk(taxaEntrada, ms = MS_POR_CHUNK) {
  return Math.max(1, Math.round((taxaEntrada * ms) / 1000))
}

// `new AudioContext({ sampleRate: 16000 })` é um PEDIDO, não uma garantia: o
// navegador pode devolver a taxa do dispositivo. Reamostrar de 44,1/48 kHz é
// trivial, mas uma taxa absurda (0, NaN, 4 kHz de um driver quebrado) só
// produziria lixo — nesses casos é mais honesto não transmitir nada e deixar o
// webm que grava em paralelo virar transcrição local.
export function taxaUtilizavel(taxa) {
  return Number.isFinite(taxa) && taxa >= 8000 && taxa <= 384000
}

// Reamostragem para TAXA_ALVO por média de janela.
//
// Cada amostra de saída é a MÉDIA das amostras de entrada que caem no intervalo
// dela, não a primeira delas. Decimar escolhendo 1 a cada 3 (o caminho óbvio de
// 48 k para 16 k) é o mesmo que amostrar sem filtro anti-aliasing: tudo o que
// existe acima de 8 kHz — sibilância de "s" e "ch", ruído de teclado — dobra
// para dentro da banda da voz e vira chiado que o reconhecedor lê como sílaba.
// A média é um passa-baixa grosseiro, mas é um passa-baixa, e custa uma soma
// por amostra.
export function reamostrar(amostras, taxaEntrada, taxaSaida = TAXA_ALVO) {
  if (taxaEntrada === taxaSaida) return amostras
  const razao = taxaEntrada / taxaSaida
  const total = Math.floor(amostras.length / razao)
  const saida = new Float32Array(Math.max(0, total))

  for (let i = 0; i < saida.length; i++) {
    const inicio = Math.floor(i * razao)
    // O `max(inicio + 1, ...)` cobre a subida de taxa (razao < 1), em que a
    // janela fecharia vazia e a divisão daria NaN — aí cada saída repete a
    // entrada mais próxima, que é o melhor que dá para fazer sem inventar
    // informação que o microfone não capturou.
    const fim = Math.min(amostras.length, Math.max(inicio + 1, Math.floor((i + 1) * razao)))
    let soma = 0
    for (let j = inicio; j < fim; j++) soma += amostras[j]
    saida[i] = soma / (fim - inicio)
  }
  return saida
}

// Float32 [-1, 1] -> ArrayBuffer de int16 little-endian.
//
// O DataView com `true` no terceiro argumento é o que torna o little-endian
// EXPLÍCITO. Um `new Int16Array(...)` daria os mesmos bytes em x86 e ARM (que
// já são little-endian) e bytes trocados em qualquer máquina big-endian, sem
// nenhum aviso — o tipo de bug que não aparece na máquina de quem escreveu.
export function floatParaPcm16(amostras) {
  const buffer = new ArrayBuffer(amostras.length * 2)
  const view = new DataView(buffer)

  for (let i = 0; i < amostras.length; i++) {
    // Clampa ANTES de escalar. Ganho automático de driver entrega float fora de
    // [-1, 1] com alguma frequência, e o setInt16 de um valor estourado não
    // satura: ele trunca os bits de cima, então um pico positivo vira um pico
    // NEGATIVO. O resultado é um estalo no áudio exatamente onde o usuário
    // falou mais alto.
    const s = Math.max(-1, Math.min(1, amostras[i]))
    // Escalas diferentes para os dois lados de propósito: o int16 vai de
    // -32768 a +32767. Multiplicar +1.0 por 32768 daria 32768, que não cabe e
    // vira -32768 — o mesmo estalo, só que em toda amostra de pico.
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

// Caminho completo, do bloco cru do worklet aos bytes que vão no IPC.
// Existe para que o Popup não tenha que lembrar a ordem (reamostrar ANTES de
// converter — converter primeiro faria a média acontecer sobre inteiros já
// quantizados) e para que o teste exercite a mesma sequência que roda em
// produção.
export function blocoParaPcm16(amostras, taxaEntrada) {
  return floatParaPcm16(reamostrar(amostras, taxaEntrada, TAXA_ALVO))
}
