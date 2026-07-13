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
