import { describe, it, expect, afterEach } from 'vitest'
import { helperPath } from '../src/main/helper-path.js'

afterEach(() => { delete process.env.DITA_HELPER })

describe('helperPath', () => {
  it('respeita DITA_HELPER', () => {
    process.env.DITA_HELPER = 'C:/tmp/fake-helper.exe'
    expect(helperPath()).toBe('C:/tmp/fake-helper.exe')
  })

  it('usa o nome de executável certo por plataforma', () => {
    const p = helperPath().replace(/\\/g, '/')
    if (process.platform === 'win32') expect(p.endsWith('/dita-helper.exe')).toBe(true)
    else expect(p.endsWith('/dita-hotkeys')).toBe(true)
  })

  it('em dev aponta para a pasta do helper da plataforma', () => {
    const p = helperPath().replace(/\\/g, '/')
    if (process.platform === 'win32') expect(p).toContain('helper-win/dist')
    else expect(p).toContain('/helper/')
  })
})
