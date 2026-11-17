import { describe, it, expect } from 'vitest'
import { ajustarParaColar, terminaNoMeioDaFrase, tirarPontoDeMensagem } from '../src/main/ajuste-colagem.js'

// O que este arquivo protege: o ditado tem que ENCAIXAR no texto que já está
// no campo. Cada caso aqui é uma correção que a pessoa teria que fazer à mão.

describe('ajuste antes de colar', () => {
  it('campo vazio: mantém a maiúscula e põe espaço no fim pra emendar o próximo ditado', () => {
    expect(ajustarParaColar('Tudo certo por aqui.', {})).toBe('Tudo certo por aqui. ')
  })

  it('no meio da frase: minúscula no começo e espaço antes', () => {
    expect(ajustarParaColar('Tudo certo por aqui.', { antes: 'Oi Max,' })).toBe(' tudo certo por aqui. ')
  })

  it('já tem espaço antes do cursor: não duplica', () => {
    expect(ajustarParaColar('Tudo certo.', { antes: 'Oi Max, ' })).toBe('tudo certo. ')
  })

  it('depois de ponto final: maiúscula fica', () => {
    expect(ajustarParaColar('Amanhã eu vejo.', { antes: 'Fechado.' })).toBe(' Amanhã eu vejo. ')
  })

  it('nome próprio no começo não vira minúscula no meio da frase', () => {
    expect(ajustarParaColar('Max vai junto.', { antes: 'Falei que o', nomesProprios: ['Max'] })).toBe(' Max vai junto. ')
  })

  it('sigla no começo é preservada', () => {
    expect(ajustarParaColar('API caiu de novo.', { antes: 'Avisa que a' })).toBe(' API caiu de novo. ')
  })

  it('texto depois continua a frase: tira o ponto final do ditado', () => {
    expect(ajustarParaColar('Amanhã cedo.', { antes: 'A reunião é ', depois: 'e não hoje' })).toBe('amanhã cedo ')
  })

  it('só a linha atual decide: o que está na linha de cima não conta', () => {
    expect(ajustarParaColar('Segundo item.', { antes: 'Primeiro item,\n' })).toBe('Segundo item. ')
  })

  it('substituindo seleção: herda minúscula e os espaços dela', () => {
    expect(ajustarParaColar('Quinta-feira.', { selecionado: ' amanhã ', antes: 'A gente se vê', depois: 'de manhã' })).toBe(' quinta-feira ')
  })

  it('reconhece meio de frase atravessando vírgula e aspas', () => {
    expect(terminaNoMeioDaFrase('ele disse "oi",')).toBe(true)
    expect(terminaNoMeioDaFrase('Pronto!')).toBe(false)
    expect(terminaNoMeioDaFrase('')).toBe(false)
  })
})

describe('ponto final em mensagem', () => {
  it('zap com até 2 frases: sem ponto final', () => {
    expect(ajustarParaColar('Chego às 16h.', { mensagem: true })).toBe('Chego às 16h ')
  })

  it('zap com 3 frases: o ponto fica', () => {
    const t = 'Chego às 16h. Levo a proposta. Me espera.'
    expect(tirarPontoDeMensagem(t, { mensagem: true })).toBe(t)
  })

  it('pergunta mantém a interrogação', () => {
    expect(ajustarParaColar('Você vem?', { mensagem: true })).toBe('Você vem? ')
  })

  it('fora de app de mensagem o ponto fica', () => {
    expect(ajustarParaColar('Chego às 16h.', {})).toBe('Chego às 16h. ')
  })

  it('estilo formal nunca tira', () => {
    expect(tirarPontoDeMensagem('Chego às 16h.', { mensagem: true, estilo: 'formal' })).toBe('Chego às 16h.')
  })
})
