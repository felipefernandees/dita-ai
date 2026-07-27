import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { dataDir } from './paths.js'

// Configuração do motor remoto (Gemini Live). Mora num config.json ao lado do
// banco, e NÃO no SQLite de propósito: a chave da API é um segredo do sistema
// operacional (DPAPI no Windows, Keychain no macOS), e um arquivo separado
// deixa claro pro usuário o que apagar se quiser revogar tudo.
//
// Formato em disco (nomes snake_case são contrato com a UI e com os testes):
//   { "google_api_key": "...", "uso_diario": 0, "ultima_data_uso": "YYYY-MM-DD" }

export const LIMITE_DIARIO = 1500

// Prefixo que marca "isto aqui é base64 de bytes cifrados pelo safeStorage".
// Sem marcador não dá pra distinguir um arquivo novo (cifrado) de um arquivo
// antigo em texto puro — e uma chave em texto puro passada pro decryptString
// do DPAPI só devolve exceção. O 'v1' abre espaço pra trocar o esquema depois
// sem quebrar quem já tem arquivo gravado.
const MARCADOR = 'enc:v1:'

export function configPath() { return join(dataDir(), 'config.json') }

// Data LOCAL, não UTC. Um usuário ditando às 21h no Brasil está em 00h UTC do
// dia seguinte: com toISOString() a cota dele zeraria no meio da noite de
// trabalho, o que parece bug e ainda dá cota de graça. getFullYear/getMonth/
// getDate leem o fuso da máquina, que é o fuso em que o usuário pensa.
export function hojeLocal(agora = new Date()) {
  const dois = (n) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`
}

// safeStorage explode se chamado antes do app estar pronto (e simplesmente não
// existe em alguns Linux sem keyring). Envelopado porque a ausência de cifragem
// é um caso degradado previsto — nunca motivo pra derrubar o app.
export function cifragemDisponivel() {
  try { return Boolean(safeStorage.isEncryptionAvailable()) } catch { return false }
}

// Um config.json corrompido (disco cheio no meio de uma gravação, edição
// manual torta) não pode impedir o app de subir: vira "config vazia" e a UI
// pede a chave de novo.
function lerBruto() {
  try {
    const obj = JSON.parse(readFileSync(configPath(), 'utf8'))
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    return obj
  } catch {
    return {}
  }
}

function escrever(obj) {
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(obj, null, 2), 'utf8')
    return true
  } catch (err) {
    console.error('config-remoto: falha ao gravar config.json:', err.message)
    return false
  }
}

// Devolve { chave, cifrada }. `cifrada: true` com chave vazia significa "o
// arquivo tinha bytes cifrados que ESTA máquina/usuário não consegue abrir" —
// acontece se o AppData for copiado pra outro perfil do Windows. A UI trata
// igual a "sem chave", só que o usuário precisa colar de novo.
function decifrar(valor) {
  if (typeof valor !== 'string' || !valor) return { chave: '', cifrada: false }
  if (!valor.startsWith(MARCADOR)) return { chave: valor, cifrada: false }
  try {
    return { chave: safeStorage.decryptString(Buffer.from(valor.slice(MARCADOR.length), 'base64')), cifrada: true }
  } catch (err) {
    console.error('config-remoto: não consegui decifrar a chave salva:', err.message)
    return { chave: '', cifrada: true }
  }
}

function numeroSeguro(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

// `agora` é injetável só pros testes conseguirem atravessar a virada do dia
// sem dormir; em produção ninguém passa nada.
export function lerConfig({ agora = new Date() } = {}) {
  const bruto = lerBruto()
  const { chave, cifrada } = decifrar(bruto.google_api_key)
  const hoje = hojeLocal(agora)

  let usoDiario = numeroSeguro(bruto.uso_diario)
  const dataGravada = typeof bruto.ultima_data_uso === 'string' ? bruto.ultima_data_uso : ''

  if (dataGravada !== hoje) {
    usoDiario = 0
    // Persiste o zeramento só quando havia mesmo algo a corrigir. Assim uma
    // leitura de estado da UI num app recém-instalado não cria um config.json
    // do nada — o arquivo aparece quando o usuário salva a chave ou dita.
    if (dataGravada || numeroSeguro(bruto.uso_diario) > 0) {
      escrever({ ...bruto, uso_diario: 0, ultima_data_uso: hoje })
    }
  }

  return { apiKey: chave, usoDiario, ultimaDataUso: hoje, chaveCifrada: cifrada }
}

export function salvarChave(chave) {
  const limpa = String(chave ?? '').trim()
  const bruto = lerBruto()

  let armazenado = limpa
  let cifrada = false
  if (limpa && cifragemDisponivel()) {
    try {
      armazenado = MARCADOR + Buffer.from(safeStorage.encryptString(limpa)).toString('base64')
      cifrada = true
    } catch (err) {
      // Degradar pra texto puro é ruim, mas melhor que impedir o usuário de
      // usar o recurso; quem avisa é o `chaveCifrada: false` na UI.
      console.error('config-remoto: safeStorage falhou ao cifrar, gravando em texto puro:', err.message)
      armazenado = limpa
      cifrada = false
    }
  }

  bruto.google_api_key = armazenado
  escrever(bruto)
  return { ok: true, chaveCifrada: cifrada }
}

export function limparChave() {
  const bruto = lerBruto()
  bruto.google_api_key = ''
  escrever(bruto)
  return { ok: true }
}

// Contabiliza UMA sessão remota. Trava no teto pra que `usoDiario === LIMITE_DIARIO`
// seja sempre a leitura de "acabou a cota" — sem isso um contador que passasse
// do limite ainda seria >= e funcionaria, mas o percentual mostraria 137%.
export function registrarUso({ agora = new Date() } = {}) {
  const atual = lerConfig({ agora })
  const novo = Math.min(LIMITE_DIARIO, atual.usoDiario + 1)
  const bruto = lerBruto()
  bruto.uso_diario = novo
  bruto.ultima_data_uso = hojeLocal(agora)
  escrever(bruto)
  return novo
}

export function percentualUso(usoDiario) {
  const n = numeroSeguro(usoDiario)
  return Math.max(0, Math.min(100, Math.round((n / LIMITE_DIARIO) * 100)))
}
