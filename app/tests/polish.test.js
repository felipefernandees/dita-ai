import { describe, it, expect } from 'vitest'
import { polish } from '../src/main/polish.js'

describe('polish', () => {
  it('remove marcadores de áudio vazio do whisper', () => {
    expect(polish('[BLANK_AUDIO]', {})).toBe('')
    expect(polish(' [MÚSICA] olá ', {})).toBe('Olá')
  })

  it('colapsa espaços e capitaliza primeira letra', () => {
    expect(polish('  oi   tudo bem  ', {})).toBe('Oi tudo bem')
  })

  it('aplica dicionário com fronteira de palavra, case-insensitive', () => {
    const dictionary = [{ term: 'btw', replacement: 'by the way' }, { term: 'wisper', replacement: 'Wispr' }]
    expect(polish('BTW o wisper é caro', { dictionary })).toBe('By the way o Wispr é caro')
    expect(polish('obtw não muda', { dictionary })).toBe('Obtw não muda')
  })

  it('expande snippet quando o texto é o gatilho', () => {
    const snippets = [{ trigger: 'meu email', content: 'felipetambara@gmail.com' }]
    expect(polish('meu email', { snippets })).toBe('felipetambara@gmail.com')
    expect(polish('Meu email.', { snippets })).toBe('felipetambara@gmail.com')
  })
})

describe('tópicos', () => {
  it('vira lista numerada quando o Felipe fala uma sequência', () => {
    const fala = 'Primeiro eu subo a VPS. Segundo, instalo o n8n. Terceiro, ligo o RabbitMQ.'
    expect(polish(fala, {})).toBe('1. Eu subo a VPS.\n2. Instalo o n8n.\n3. Ligo o RabbitMQ.')
  })

  it('preserva o que foi dito antes da sequência como introdução', () => {
    const fala = 'O plano é esse. Primeiro eu gravo. Segundo eu edito. Terceiro eu publico.'
    expect(polish(fala, {})).toBe('O plano é esse.\n\n1. Eu gravo.\n2. Eu edito.\n3. Eu publico.')
  })

  it('não lista quando a sequência tem menos de três itens', () => {
    const fala = 'Primeiro eu gravo. Segundo eu edito.'
    expect(polish(fala, {})).toBe('Primeiro eu gravo. Segundo eu edito.')
  })

  it('não lista quando o ordinal é só parte da frase', () => {
    const fala = 'O primeiro cliente pagou e o segundo sumiu, mas o terceiro fechou.'
    expect(polish(fala, {})).toBe('O primeiro cliente pagou e o segundo sumiu, mas o terceiro fechou.')
  })

  it('vira bullets quando o comando "em tópicos" abre a fala', () => {
    const fala = 'Em tópicos: cobrar a Seviva. Gravar o módulo cinco. Pagar a fatura.'
    expect(polish(fala, {})).toBe('- Cobrar a Seviva\n- Gravar o módulo cinco\n- Pagar a fatura')
  })

  it('aceita as variações do comando de tópicos', () => {
    expect(polish('Faz uma lista: um, dois. Três.', {})).toBe('- Um, dois\n- Três')
    expect(polish('Abre tópicos. Comprar pão. Comprar leite.', {})).toBe('- Comprar pão\n- Comprar leite')
  })

  it('não confunde uma menção qualquer a tópicos com o comando', () => {
    const fala = 'Eu queria falar em tópicos com você sobre isso.'
    expect(polish(fala, {})).toBe('Eu queria falar em tópicos com você sobre isso.')
  })
})
