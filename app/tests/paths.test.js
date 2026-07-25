import { describe, it, expect, afterEach } from 'vitest'
import { dataDir, modelDir, dbPath } from '../src/main/paths.js'

const ORIGINAL = process.env.DITA_DATA_DIR

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DITA_DATA_DIR
  else process.env.DITA_DATA_DIR = ORIGINAL
})

describe('paths', () => {
  it('respeita DITA_DATA_DIR quando definido', () => {
    process.env.DITA_DATA_DIR = '/tmp/dita-teste'
    expect(dataDir()).toBe('/tmp/dita-teste')
  })

  it('deriva modelDir e dbPath de dataDir', () => {
    process.env.DITA_DATA_DIR = '/tmp/dita-teste'
    expect(modelDir()).toContain('models')
    expect(modelDir().replace(/\\/g, '/').startsWith('/tmp/dita-teste')).toBe(true)
    expect(dbPath()).toContain('dita.db')
    expect(dbPath().replace(/\\/g, '/').startsWith('/tmp/dita-teste')).toBe(true)
  })

  it('sem override, aponta para uma pasta chamada dita-ai', () => {
    delete process.env.DITA_DATA_DIR
    expect(dataDir().replace(/\\/g, '/')).toContain('/dita-ai')
  })
})
