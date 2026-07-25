import { describe, it, expect } from 'vitest'
import { juntarSegmentos } from '../src/main/whisper.js'

describe('juntarSegmentos', () => {
  it('reconstrói palavra cortada entre segmentos (o bug do "automat izar")', () => {
    const data = {
      segments: [
        { text: ' A ideia é o cara identificar um processo e automat' },
        { text: 'izar ele.' }
      ]
    }
    expect(juntarSegmentos(data)).toBe('A ideia é o cara identificar um processo e automatizar ele.')
  })

  it('mantém o espaço quando o corte cai entre palavras', () => {
    const data = {
      segments: [
        { text: ' Eu preciso gravar os três módulos,' },
        { text: ' depois validar o sistema.' }
      ]
    }
    expect(juntarSegmentos(data)).toBe('Eu preciso gravar os três módulos, depois validar o sistema.')
  })

  it('cai pro campo text quando não vieram segmentos', () => {
    expect(juntarSegmentos({ text: ' olá ' })).toBe('olá')
    expect(juntarSegmentos({})).toBe('')
    expect(juntarSegmentos(null)).toBe('')
  })
})
