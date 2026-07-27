import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { safeStorage } from 'electron'
import {
  lerConfig, salvarChave, limparChave, registrarUso, percentualUso,
  configPath, hojeLocal, cifragemDisponivel, LIMITE_DIARIO
} from '../src/main/config-remoto.js'

// Cada teste escreve num diretório descartável: config-remoto grava de verdade
// no disco (é o ponto do módulo), e apontar pro AppData real do desenvolvedor
// apagaria a chave dele ao rodar a suíte.
const ORIGINAL_DATA_DIR = process.env.DITA_DATA_DIR
let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dita-config-'))
  process.env.DITA_DATA_DIR = dir
  safeStorage.__setEncryptionAvailable(true)
})

afterEach(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DITA_DATA_DIR
  else process.env.DITA_DATA_DIR = ORIGINAL_DATA_DIR
  safeStorage.__setEncryptionAvailable(true)
  rmSync(dir, { recursive: true, force: true })
})

const gravarBruto = (obj) => writeFileSync(configPath(), JSON.stringify(obj), 'utf8')
const lerBrutoTexto = () => readFileSync(configPath(), 'utf8')

describe('config-remoto — arquivo ausente ou corrompido', () => {
  it('config ausente vira config vazia, sem lançar', () => {
    expect(existsSync(configPath())).toBe(false)
    const cfg = lerConfig()
    expect(cfg.apiKey).toBe('')
    expect(cfg.usoDiario).toBe(0)
    expect(cfg.chaveCifrada).toBe(false)
  })

  it('não cria config.json só de ler', () => {
    lerConfig()
    expect(existsSync(configPath())).toBe(false)
  })

  it('JSON quebrado não derruba a leitura', () => {
    writeFileSync(configPath(), '{ isto nao e json', 'utf8')
    expect(() => lerConfig()).not.toThrow()
    expect(lerConfig().usoDiario).toBe(0)
  })

  it('JSON válido mas de tipo errado (array, número) também vira vazio', () => {
    writeFileSync(configPath(), '[1,2,3]', 'utf8')
    expect(lerConfig().apiKey).toBe('')
    writeFileSync(configPath(), '42', 'utf8')
    expect(lerConfig().apiKey).toBe('')
  })

  it('campos com tipo inesperado não contaminam o contador', () => {
    gravarBruto({ google_api_key: 123, uso_diario: 'muitos', ultima_data_uso: 7 })
    const cfg = lerConfig()
    expect(cfg.apiKey).toBe('')
    expect(cfg.usoDiario).toBe(0)
  })
})

describe('config-remoto — chave cifrada em repouso', () => {
  it('a chave dá a volta por salvar/ler', () => {
    salvarChave('AIzaSy-CHAVE-DE-TESTE-123')
    expect(lerConfig().apiKey).toBe('AIzaSy-CHAVE-DE-TESTE-123')
    expect(lerConfig().chaveCifrada).toBe(true)
  })

  it('o arquivo em disco NÃO contém a chave em texto puro', () => {
    salvarChave('AIzaSy-SEGREDO-QUE-NAO-PODE-VAZAR')
    const disco = lerBrutoTexto()
    expect(disco).not.toContain('AIzaSy-SEGREDO-QUE-NAO-PODE-VAZAR')
    expect(JSON.parse(disco).google_api_key.startsWith('enc:v1:')).toBe(true)
  })

  it('trim: espaço colado junto com a chave não vai pro disco', () => {
    salvarChave('  AIzaSy-COM-ESPACO \n')
    expect(lerConfig().apiKey).toBe('AIzaSy-COM-ESPACO')
  })

  it('sem safeStorage disponível grava em texto puro e sinaliza chaveCifrada=false', () => {
    safeStorage.__setEncryptionAvailable(false)
    expect(cifragemDisponivel()).toBe(false)
    salvarChave('CHAVE-SEM-DPAPI')
    expect(JSON.parse(lerBrutoTexto()).google_api_key).toBe('CHAVE-SEM-DPAPI')
    const cfg = lerConfig()
    expect(cfg.apiKey).toBe('CHAVE-SEM-DPAPI')
    expect(cfg.chaveCifrada).toBe(false)
  })

  it('lê um config.json antigo, gravado em texto puro, sem quebrar', () => {
    gravarBruto({ google_api_key: 'CHAVE-LEGADA', uso_diario: 3, ultima_data_uso: hojeLocal() })
    const cfg = lerConfig()
    expect(cfg.apiKey).toBe('CHAVE-LEGADA')
    expect(cfg.chaveCifrada).toBe(false)
  })

  it('bytes cifrados que esta máquina não abre viram "sem chave", não exceção', () => {
    gravarBruto({ google_api_key: 'enc:v1:' + Buffer.from('lixo de outro perfil').toString('base64') })
    const cfg = lerConfig()
    expect(cfg.apiKey).toBe('')
    expect(cfg.chaveCifrada).toBe(true)
  })

  it('limparChave apaga a chave e preserva o contador de uso', () => {
    salvarChave('CHAVE')
    registrarUso()
    limparChave()
    const cfg = lerConfig()
    expect(cfg.apiKey).toBe('')
    expect(cfg.usoDiario).toBe(1)
  })
})

describe('config-remoto — cota diária', () => {
  it('registrarUso incrementa e persiste entre leituras', () => {
    expect(registrarUso()).toBe(1)
    expect(registrarUso()).toBe(2)
    expect(lerConfig().usoDiario).toBe(2)
    expect(JSON.parse(lerBrutoTexto()).uso_diario).toBe(2)
  })

  it('registrarUso carimba a data de hoje', () => {
    registrarUso()
    expect(JSON.parse(lerBrutoTexto()).ultima_data_uso).toBe(hojeLocal())
  })

  it('trava no teto de 1500 em vez de passar', () => {
    gravarBruto({ uso_diario: LIMITE_DIARIO - 1, ultima_data_uso: hojeLocal() })
    expect(registrarUso()).toBe(LIMITE_DIARIO)
    expect(registrarUso()).toBe(LIMITE_DIARIO)
    expect(lerConfig().usoDiario).toBe(LIMITE_DIARIO)
  })

  it('um contador acima do teto no arquivo continua sendo "esgotado"', () => {
    gravarBruto({ uso_diario: 99999, ultima_data_uso: hojeLocal() })
    expect(lerConfig().usoDiario >= LIMITE_DIARIO).toBe(true)
  })
})

// O relógio é injetado (parâmetro `agora`), nunca esperado: um teste que
// dormisse até a meia-noite seria inútil, e um que usasse a data real não
// exercitaria a virada nenhuma vez em 24h.
describe('config-remoto — zeramento diário', () => {
  const ONTEM = new Date(2026, 2, 14, 21, 30)   // 14/03/2026 21h30 local
  const HOJE = new Date(2026, 2, 15, 9, 0)      // 15/03/2026 09h00 local

  it('zera o uso quando a data muda', () => {
    gravarBruto({ uso_diario: 42, ultima_data_uso: hojeLocal(ONTEM) })
    const cfg = lerConfig({ agora: HOJE })
    expect(cfg.usoDiario).toBe(0)
    expect(cfg.ultimaDataUso).toBe('2026-03-15')
  })

  it('o zeramento é persistido, não só devolvido', () => {
    gravarBruto({ uso_diario: 42, ultima_data_uso: hojeLocal(ONTEM) })
    lerConfig({ agora: HOJE })
    const disco = JSON.parse(lerBrutoTexto())
    expect(disco.uso_diario).toBe(0)
    expect(disco.ultima_data_uso).toBe('2026-03-15')
  })

  it('não zera dentro do mesmo dia local', () => {
    gravarBruto({ uso_diario: 42, ultima_data_uso: hojeLocal(ONTEM) })
    expect(lerConfig({ agora: new Date(2026, 2, 14, 23, 59) }).usoDiario).toBe(42)
  })

  it('o zeramento preserva a chave salva', () => {
    salvarChave('CHAVE-QUE-SOBREVIVE')
    gravarBruto({ ...JSON.parse(lerBrutoTexto()), uso_diario: 10, ultima_data_uso: hojeLocal(ONTEM) })
    const cfg = lerConfig({ agora: HOJE })
    expect(cfg.usoDiario).toBe(0)
    expect(cfg.apiKey).toBe('CHAVE-QUE-SOBREVIVE')
  })

  it('registrarUso depois da virada começa do 1, não do valor de ontem', () => {
    gravarBruto({ uso_diario: 1400, ultima_data_uso: hojeLocal(ONTEM) })
    expect(registrarUso({ agora: HOJE })).toBe(1)
  })

  // A razão de existir do hojeLocal(): 21h no Brasil (UTC-3) já é o dia
  // seguinte em UTC. Se o cálculo fosse por toISOString(), este ditado das 21h
  // ganharia cota nova todo fim de tarde.
  it('21h no fuso local ainda é o dia local corrente, não o dia UTC seguinte', () => {
    const noite = new Date(2026, 2, 14, 21, 30)
    expect(hojeLocal(noite)).toBe('2026-03-14')
    gravarBruto({ uso_diario: 5, ultima_data_uso: '2026-03-14' })
    expect(lerConfig({ agora: noite }).usoDiario).toBe(5)
  })

  it('hojeLocal preenche mês e dia com zero à esquerda', () => {
    expect(hojeLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('config-remoto — percentualUso', () => {
  it('limites', () => {
    expect(percentualUso(0)).toBe(0)
    expect(percentualUso(LIMITE_DIARIO)).toBe(100)
    expect(percentualUso(LIMITE_DIARIO / 2)).toBe(50)
  })

  it('nunca passa de 100 nem fica negativo', () => {
    expect(percentualUso(LIMITE_DIARIO + 500)).toBe(100)
    expect(percentualUso(-10)).toBe(0)
  })

  it('entrada inválida vira 0 em vez de NaN', () => {
    expect(percentualUso(undefined)).toBe(0)
    expect(percentualUso('abc')).toBe(0)
    expect(percentualUso(null)).toBe(0)
  })

  it('um único uso não arredonda para zero absoluto de forma errada', () => {
    expect(percentualUso(1)).toBe(0)     // 0,067% arredonda pra 0
    expect(percentualUso(15)).toBe(1)    // 1% exato
  })
})
