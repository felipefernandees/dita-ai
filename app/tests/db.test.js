import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, saveDictation, getLastDictation, listHistory, listDictionary, getSetting, setSetting } from '../src/main/db.js'

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

describe('dicionário base', () => {
  it('semeia as correções de nome uma vez só e o polish aplica', async () => {
    const { polish } = await import('../src/main/polish.js')
    const db = initDb(':memory:')
    const antes = listDictionary().length
    expect(antes).toBeGreaterThan(0)
    initDb(':memory:') // banco novo: semeia de novo
    expect(listDictionary().length).toBe(antes)
    expect(polish('eu uso o M8n e o super flow', { dictionary: listDictionary() }))
      .toBe('Eu uso o n8n e o Wispr Flow')
    db.close()
  })

  // O glossário de dev chegou DEPOIS que o app já estava em uso. A semeadura
  // antiga gravava um booleano, então quem já tinha banco nunca receberia
  // termo novo — o glossário existiria só para instalação nova.
  it('semeia o glossário de dev num banco que já foi semeado antes', async () => {
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const { rmSync } = await import('fs')
    // Arquivo de verdade, não :memory: — o ponto do teste é REABRIR o mesmo
    // banco, e um banco em memória some junto com a conexão.
    const arquivo = join(tmpdir(), `dita-seed-${Date.now()}.db`)

    try {
      let db = initDb(arquivo)
      // Desfaz para o estado da versão anterior: só a semeadura antiga marcada.
      db.prepare('DELETE FROM dictionary').run()
      db.prepare("DELETE FROM settings WHERE key LIKE 'dictionarySeeded%'").run()
      db.prepare("INSERT INTO settings (key, value) VALUES ('dictionarySeeded', '1')").run()
      db.prepare('INSERT INTO dictionary (term, replacement) VALUES (?, ?)').run('m8n', 'n8n')
      db.close()

      // Reabrir é o que o app faz ao subir: a semeadura versionada precisa
      // perceber que o glossário de dev ainda não passou por aqui.
      db = initDb(arquivo)
      const termos = listDictionary().map((d) => d.term.toLowerCase())
      expect(termos).toContain('m8n')          // o que já existia continua
      expect(termos).toContain('web hook')     // e o glossário novo entrou
      expect(termos).toContain('docker compus')

      // Rodar de novo não pode duplicar nada.
      const antes = listDictionary().length
      db.close()
      db = initDb(arquivo)
      expect(listDictionary().length).toBe(antes)
      db.close()
    } finally {
      rmSync(arquivo, { force: true })
    }
  })

  it('corrige o jargão de dev que o ASR erra de verdade', async () => {
    const { polish } = await import('../src/main/polish.js')
    const db = initDb(':memory:')
    const dictionary = listDictionary()

    // Erros MEDIDOS numa transcrição real do Gemini (diag-vocabulario.js).
    expect(polish('rodei o docker compus ontem', { dictionary }))
      .toContain('docker compose')
    expect(polish('o web hook do supa base caiu', { dictionary }))
      .toBe('O webhook do Supabase caiu')
    expect(polish('subiu pelo git hub actions', { dictionary }))
      .toContain('GitHub')

    // E o contrário: palavra legítima do português não pode ser tocada.
    // "compus" sozinho é o verbo compor; só "docker compus" vira compose.
    expect(polish('eu compus uma música', { dictionary })).toBe('Eu compus uma música')
    db.close()
  })
})
