import { describe, it, expect } from 'vitest'
import {
  TAXA_ALVO, MS_POR_CHUNK,
  amostrasPorChunk, blocoParaPcm16, floatParaPcm16, reamostrar, taxaUtilizavel
} from '../src/renderer/src/pcm.js'

// pcm.js é o único ponto do app em que o formato do áudio remoto é decidido, e
// é um formato que NINGUÉM valida depois: o main repassa os bytes para o
// WebSocket do Gemini, e o Gemini aceita qualquer coisa. Mandar 48 kHz onde ele
// espera 16 kHz não gera erro em lugar nenhum — gera uma transcrição de
// palavras que o usuário não falou. Não há teste de integração possível sem
// microfone e sem chave de API, então estes testes são a única rede que existe
// para "os bytes estão certos".
//
// O que fica de fora daqui, de propósito: se o AudioWorklet CARREGA no build
// empacotado. Isso não é aritmética, é resolução de asset em file://, e está em
// tests/pcm-worklet.integration.test.js.

const pcm = (buffer) => new DataView(buffer)

describe('floatParaPcm16', () => {
  it('escreve 2 bytes por amostra', () => {
    expect(floatParaPcm16(new Float32Array(4)).byteLength).toBe(8)
    expect(floatParaPcm16(new Float32Array(0)).byteLength).toBe(0)
  })

  // O teste que pega troca de endianness.
  //
  // 0.375 é 3/8, exatamente representável em float32, então não há surpresa de
  // arredondamento no meio do caminho: 0.375 * 32767 = 12287,625, truncado dá
  // 12287 = 0x2FFF. O que importa é que os dois bytes são DIFERENTES (0xFF,
  // 0x2F) — com um valor simétrico (0, -1, 0x0100) o teste passaria tanto em
  // little quanto em big-endian e não provaria nada.
  it('grava little-endian de verdade, byte a byte', () => {
    const buf = floatParaPcm16(new Float32Array([0.375]))
    const bytes = new Uint8Array(buf)
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0x2f])
    expect(pcm(buf).getInt16(0, true)).toBe(0x2fff)
  })

  it('usa a escala assimétrica do int16 nos extremos', () => {
    const buf = floatParaPcm16(new Float32Array([1, -1, 0]))
    const v = pcm(buf)
    // +1.0 NÃO pode virar -32768 (o wrap que produz estalo em todo pico)
    expect(v.getInt16(0, true)).toBe(32767)
    expect(v.getInt16(2, true)).toBe(-32768)
    expect(v.getInt16(4, true)).toBe(0)
  })

  it('satura em vez de dar a volta quando o float estoura [-1, 1]', () => {
    const buf = floatParaPcm16(new Float32Array([4.2, -3.7]))
    const v = pcm(buf)
    expect(v.getInt16(0, true)).toBe(32767)
    expect(v.getInt16(2, true)).toBe(-32768)
  })

  it('mantém a forma de onda: meia escala vira meia escala', () => {
    const v = pcm(floatParaPcm16(new Float32Array([0.5, -0.5])))
    expect(v.getInt16(0, true)).toBe(16383)   // trunca para o zero
    expect(v.getInt16(2, true)).toBe(-16384)
  })
})

describe('amostrasPorChunk', () => {
  it('dá 250 ms na taxa alvo', () => {
    expect(amostrasPorChunk(TAXA_ALVO)).toBe(4000)
    expect((amostrasPorChunk(TAXA_ALVO) / TAXA_ALVO) * 1000).toBe(MS_POR_CHUNK)
  })

  // O worklet acumula na taxa de ENTRADA, então o bloco precisa valer 250 ms
  // naquela taxa — não 4000 amostras fixas, que a 48 kHz seriam 83 ms e
  // triplicariam as mensagens e os pacotes no WebSocket.
  it('acompanha a taxa de entrada, sempre valendo 250 ms', () => {
    for (const taxa of [16000, 22050, 44100, 48000, 96000]) {
      const n = amostrasPorChunk(taxa)
      expect(Math.abs((n / taxa) * 1000 - MS_POR_CHUNK)).toBeLessThan(0.05)
    }
  })

  it('nunca devolve bloco vazio', () => {
    expect(amostrasPorChunk(1)).toBeGreaterThan(0)
    expect(amostrasPorChunk(0)).toBeGreaterThan(0)
  })
})

describe('taxaUtilizavel', () => {
  it('aceita as taxas que um microfone real entrega', () => {
    for (const t of [16000, 44100, 48000, 96000]) expect(taxaUtilizavel(t)).toBe(true)
  })

  // Se isto passar batido, o app transmite lixo em silêncio em vez de deixar o
  // webm virar transcrição local.
  it('recusa o que não dá para reamostrar', () => {
    for (const t of [0, -1, NaN, Infinity, undefined, null, 4000]) expect(taxaUtilizavel(t)).toBe(false)
  })
})

describe('reamostrar', () => {
  it('não toca no vetor quando já está na taxa alvo', () => {
    const entrada = new Float32Array([0.1, 0.2, 0.3])
    expect(reamostrar(entrada, TAXA_ALVO)).toBe(entrada)
  })

  it('48 kHz -> 16 kHz devolve exatamente um terço das amostras', () => {
    const saida = reamostrar(new Float32Array(4800), 48000)
    expect(saida.length).toBe(1600)
    expect(saida).toBeInstanceOf(Float32Array)
  })

  it('um bloco de 250 ms continua valendo 250 ms depois de reamostrado', () => {
    for (const taxa of [16000, 44100, 48000]) {
      const bloco = new Float32Array(amostrasPorChunk(taxa))
      const saida = reamostrar(bloco, taxa)
      // ~4000 amostras a 16 kHz, com folga de 1 amostra para o arredondamento
      expect(Math.abs(saida.length - 4000)).toBeLessThanOrEqual(1)
    }
  })

  // O ponto da média de janela. Decimando por escolha (1 a cada 3) a saída
  // seria [1, 1, 1] — o sinal alternado sumiria e viraria contínuo, que é
  // exatamente o aliasing que embaralha sibilância na transcrição.
  it('faz a média da janela em vez de escolher uma amostra', () => {
    const entrada = new Float32Array([1, 0, -1, 1, 0, -1, 1, 0, -1])
    const saida = reamostrar(entrada, 48000, 16000)
    expect(Array.from(saida)).toEqual([0, 0, 0])
  })

  it('preserva um sinal constante (nenhum ganho inventado)', () => {
    const entrada = new Float32Array(4800).fill(0.5)
    const saida = reamostrar(entrada, 48000)
    for (const v of saida) expect(v).toBeCloseTo(0.5, 6)
  })

  it('lida com taxa não múltipla (44,1 kHz) sem NaN nem estouro', () => {
    const entrada = new Float32Array(4410).fill(0.25)
    const saida = reamostrar(entrada, 44100)
    expect(saida.length).toBe(1600)
    for (const v of saida) {
      expect(Number.isNaN(v)).toBe(false)
      expect(v).toBeCloseTo(0.25, 6)
    }
  })

  // Taxa abaixo do alvo é o caso degenerado: a janela fecharia vazia e a
  // divisão daria NaN, que viraria 0 no setInt16 — silêncio absoluto, sem erro.
  it('não gera NaN quando a taxa de entrada é menor que a alvo', () => {
    const saida = reamostrar(new Float32Array([1, -1, 1, -1]), 8000, 16000)
    expect(saida.length).toBe(8)
    for (const v of saida) expect(Number.isNaN(v)).toBe(false)
  })
})

describe('blocoParaPcm16 (o caminho que roda em produção)', () => {
  // Este é O teste do contrato: um bloco de 250 ms, em QUALQUER taxa de
  // captura, tem que virar 4000 amostras de 16 bits = 8000 bytes. Se algum dia
  // isto der 24000 bytes, é porque alguém mandou 48 kHz para o Gemini.
  it('sempre entrega 8000 bytes = 4000 amostras a 16 kHz = 250 ms', () => {
    for (const taxa of [16000, 44100, 48000, 96000]) {
      const bloco = new Float32Array(amostrasPorChunk(taxa))
      const bytes = blocoParaPcm16(bloco, taxa).byteLength
      expect(Math.abs(bytes - 8000)).toBeLessThanOrEqual(2)
      // a duração é a prova real: bytes / 2 amostras / 16000 Hz
      expect((bytes / 2 / TAXA_ALVO) * 1000).toBeCloseTo(MS_POR_CHUNK, 1)
    }
  })

  it('reamostra ANTES de quantizar', () => {
    // Média de [1, 1, -1] = 0.333…; quantizar primeiro e depois mediar daria
    // um valor diferente do esperado por arredondamento acumulado.
    const buf = blocoParaPcm16(new Float32Array([1, 1, -1]), 48000)
    expect(buf.byteLength).toBe(2)
    expect(new DataView(buf).getInt16(0, true)).toBe(Math.trunc((1 / 3) * 0x7fff))
  })

  it('leva um seno de 48 kHz até PCM16 sem estourar a escala', () => {
    const taxa = 48000
    const bloco = new Float32Array(amostrasPorChunk(taxa))
    for (let i = 0; i < bloco.length; i++) bloco[i] = Math.sin((2 * Math.PI * 440 * i) / taxa)
    const v = new DataView(blocoParaPcm16(bloco, taxa))
    let pico = 0
    for (let i = 0; i < v.byteLength; i += 2) pico = Math.max(pico, Math.abs(v.getInt16(i, true)))
    // usa quase toda a escala (sinal cheio) mas nunca dá a volta
    expect(pico).toBeGreaterThan(30000)
    expect(pico).toBeLessThanOrEqual(32767)
  })
})
