import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

// A razão de existir deste módulo é a divergência entre plataformas, então
// cada branch precisa de um teste que fixa process.platform e afirma o
// formato exato do caminho — senão um CI de plataforma única nunca pegaria
// uma troca acidental entre os branches do darwin e do win32.
describe('dataDir por plataforma', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalAppData = process.env.APPDATA
  const originalXdgConfig = process.env.XDG_CONFIG_HOME

  beforeEach(() => {
    delete process.env.DITA_DATA_DIR
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', platformDescriptor)
    if (originalAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = originalAppData
    if (originalXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalXdgConfig
  })

  it('darwin usa Library/Application Support', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    expect(dataDir().replace(/\\/g, '/')).toContain('Library/Application Support/dita-ai')
  })

  it('win32 honra APPDATA quando definido', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    process.env.APPDATA = 'C:\\Users\\teste\\AppData\\Roaming'
    expect(dataDir().replace(/\\/g, '/')).toBe('C:/Users/teste/AppData/Roaming/dita-ai')
  })

  it('win32 sem APPDATA cai para ~/AppData/Roaming', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    delete process.env.APPDATA
    expect(dataDir().replace(/\\/g, '/')).toContain('AppData/Roaming/dita-ai')
  })

  it('linux (e demais) usa XDG_CONFIG_HOME ou ~/.config', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    delete process.env.XDG_CONFIG_HOME
    expect(dataDir().replace(/\\/g, '/')).toContain('.config/dita-ai')
  })
})
