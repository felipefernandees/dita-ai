import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, saveDictation, getLastDictation, listHistory, getSetting, setSetting } from '../src/main/db.js'

describe('db', () => {
  beforeEach(() => initDb(':memory:'))

  it('salva ditado e calcula palavras e ppm', () => {
    const row = saveDictation({ text: 'olá mundo teste', rawText: 'olá mundo teste', appName: 'Notas', durationMs: 3000 })
    expect(row.id).toBe(1)
    expect(row.words).toBe(3)
    expect(row.ppm).toBe(60) // 3 palavras em 3s = 60 ppm
  })

  it('getLastDictation retorna o mais recente', () => {
    saveDictation({ text: 'primeiro', rawText: 'primeiro', appName: 'A', durationMs: 1000 })
    saveDictation({ text: 'segundo', rawText: 'segundo', appName: 'B', durationMs: 1000 })
    expect(getLastDictation().text).toBe('segundo')
  })

  it('listHistory limita e ordena desc', () => {
    for (let i = 1; i <= 5; i++) saveDictation({ text: `d${i}`, rawText: `d${i}`, appName: 'A', durationMs: 1000 })
    const rows = listHistory(3)
    expect(rows.map(r => r.text)).toEqual(['d5', 'd4', 'd3'])
  })

  it('settings com fallback', () => {
    expect(getSetting('language', 'pt')).toBe('pt')
    setSetting('language', 'en')
    expect(getSetting('language', 'pt')).toBe('en')
  })
})
