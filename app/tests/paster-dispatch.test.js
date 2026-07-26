import { describe, it, expect } from 'vitest'
import * as paster from '../src/main/paster.js'

describe('paster (dispatcher)', () => {
  it('exporta a mesma superfície pública nas duas plataformas', () => {
    expect(typeof paster.getFrontmostApp).toBe('function')
    expect(typeof paster.pasteText).toBe('function')
  })

  it('getFrontmostApp devolve string e nunca lança', async () => {
    const name = await paster.getFrontmostApp()
    expect(typeof name).toBe('string')
  })
})
