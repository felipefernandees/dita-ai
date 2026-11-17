import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { categoriaDoApp, palavrasDaTela, normalizarContexto, capturarContexto } from '../src/main/contexto.js'

describe('categoria do app', () => {
  it('casa por bundle id e por domínio', () => {
    expect(categoriaDoApp({ bundleId: 'net.whatsapp.WhatsApp' })).toBe('pessoal')
    expect(categoriaDoApp({ bundleId: 'com.google.Chrome', url: 'https://web.whatsapp.com/' })).toBe('pessoal')
    expect(categoriaDoApp({ bundleId: 'com.google.Chrome', url: 'https://mail.google.com/mail/u/0/' })).toBe('email')
    expect(categoriaDoApp({ bundleId: 'com.tinyspeck.slackmacgap' })).toBe('trabalho')
    expect(categoriaDoApp({ bundleId: 'com.apple.TextEdit' })).toBe('outro')
  })

  it('domínio parecido não engana', () => {
    expect(categoriaDoApp({ url: 'https://notx.com.br' })).toBe('outro')
  })
})

describe('palavras da tela', () => {
  it('fica com o que a IA poderia grafar errado e ordena por frequência', () => {
    const p = palavrasDaTela(['Max Carrau online', 'Max: a proposta da Seviva', 'n8n caiu', 'reunião amanhã'])
    expect(p[0]).toBe('Max')
    expect(p).toEqual(expect.arrayContaining(['Carrau', 'Seviva', 'n8n']))
    expect(p).not.toContain('reunião')
    expect(p).not.toContain('online')
  })

  it('respeita o limite', () => {
    const muitas = Array.from({ length: 300 }, (_, i) => `Nome${i}`)
    expect(palavrasDaTela(muitas, { limite: 150 })).toHaveLength(150)
  })
})

describe('normalizar contexto', () => {
  it('converte a saída do helper', () => {
    const c = normalizarContexto({
      ok: true, app: 'WhatsApp', bundleId: 'net.whatsapp.WhatsApp',
      campo: { leu: true, editavel: true, antes: 'Oi', depois: '', selecionado: '' },
      textos: ['Max Carrau']
    })
    expect(c).toMatchObject({ app: 'WhatsApp', categoria: 'pessoal', leuCampo: true, antes: 'Oi', palavras: ['Max', 'Carrau'] })
  })

  it('helper sem app vira null', () => {
    expect(normalizarContexto({ ok: false })).toBe(null)
    expect(normalizarContexto(null)).toBe(null)
  })
})

describe('capturarContexto', () => {
  function filhoFalso() {
    const f = new EventEmitter()
    f.stdout = new EventEmitter()
    f.kill = () => { f.morto = true }
    return f
  }

  it('lê a primeira linha do helper', async () => {
    const f = filhoFalso()
    const p = capturarContexto({ helperPath: '/x', plataforma: 'darwin', spawnFn: () => f })
    f.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, app: 'Notas', bundleId: 'com.apple.Notes' }) + '\n'))
    expect(await p).toMatchObject({ app: 'Notas', categoria: 'outro' })
  })

  it('helper mudo: mata no prazo e devolve null, o ditado segue', async () => {
    const f = filhoFalso()
    const r = await capturarContexto({ helperPath: '/x', plataforma: 'darwin', prazoMs: 50, spawnFn: () => f })
    expect(r).toBe(null)
    expect(f.morto).toBe(true)
  })

  it('fora do macOS nem tenta', async () => {
    let chamou = false
    const r = await capturarContexto({ helperPath: '/x', plataforma: 'win32', spawnFn: () => { chamou = true } })
    expect(r).toBe(null)
    expect(chamou).toBe(false)
  })
})
