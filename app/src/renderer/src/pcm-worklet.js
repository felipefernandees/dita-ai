// AudioWorkletProcessor que junta o microfone em blocos de ~250 ms e manda cada
// bloco pronto para o thread principal.
//
// POR QUE UM WORKLET E NÃO UM ScriptProcessorNode
//
// O ScriptProcessorNode roda o callback NO THREAD PRINCIPAL, que é o mesmo
// thread do requestAnimationFrame que pinta o equalizador do popup. Os dois
// brigariam: um frame pesado do canvas atrasa o callback de áudio e o buffer
// estoura (o sintoma é áudio picotado, ou seja, transcrição com buracos), e um
// callback de áudio no meio do frame derruba a animação. O worklet roda no
// thread de renderização de áudio, com prioridade de tempo real, e o canvas
// deixa de ser um risco para a transcrição.
//
// POR QUE ACUMULAR AQUI DENTRO
//
// O `process` é chamado a cada 128 quadros — 125 vezes por segundo a 16 kHz,
// 375 a 48 kHz. Postar cada chamada seria centenas de mensagens por segundo
// atravessando a fronteira de threads só para o main remontar os pedaços.
// Acumulando aqui, o main recebe 4 mensagens por segundo.
//
// POR QUE A CONVERSÃO PARA INT16 NÃO ACONTECE AQUI
//
// Um AudioWorklet não importa módulos: o AudioWorkletGlobalScope carrega este
// arquivo e nada mais. Se a conversão morasse aqui, ela seria uma SEGUNDA cópia
// da lógica de pcm.js — e a cópia coberta por teste não seria a cópia que roda.
// Postando Float32 cru, pcm.js continua sendo o único caminho; ele roda 4 vezes
// por segundo sobre alguns milhares de números, o que não disputa frame nenhum
// com o canvas.

class ColetorPcm extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const pedido = options && options.processorOptions && options.processorOptions.amostrasPorBloco
    this.tamanho = Number.isFinite(pedido) && pedido > 0 ? Math.floor(pedido) : 4000
    this.buffer = new Float32Array(this.tamanho)
    this.usado = 0
  }

  process(inputs) {
    // Um único canal: o AudioWorkletNode é criado com channelCount 1 e
    // channelCountMode 'explicit', então um microfone estéreo já chega aqui
    // rebaixado para mono pelo próprio grafo. É daí que vem a garantia de mono,
    // e não de uma escolha feita neste arquivo.
    const canal = inputs[0] && inputs[0][0]
    // Sem entrada acontece entre o nó ser criado e a fonte ser conectada, e
    // depois que o track do microfone é parado. Devolver `true` mantém o
    // processador vivo — devolver `false` o mataria de vez, e o áudio que
    // viesse depois cairia no vazio sem erro nenhum.
    if (!canal || canal.length === 0) return true

    let lido = 0
    while (lido < canal.length) {
      const cabe = Math.min(this.tamanho - this.usado, canal.length - lido)
      this.buffer.set(canal.subarray(lido, lido + cabe), this.usado)
      this.usado += cabe
      lido += cabe

      if (this.usado === this.tamanho) {
        // `slice` copia. Transferir o próprio this.buffer o deixaria destacado
        // (byteLength 0) e a próxima chamada de process escreveria em nada, em
        // silêncio: a transmissão morreria depois do primeiro bloco e o usuário
        // veria só as primeiras palavras aparecerem.
        const bloco = this.buffer.slice(0)
        this.port.postMessage(bloco, [bloco.buffer])
        this.usado = 0
      }
    }
    return true
  }
}

registerProcessor('coletor-pcm', ColetorPcm)
