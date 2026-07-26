import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'net'
import { fileURLToPath } from 'url'
import { startWhisperServerWithFallback } from '../src/main/whisper.js'

// Nenhum teste aqui sobe um whisper-server de verdade: os "candidatos" são
// caminhos que não existem, então o spawn falha rápido com ENOENT (ver o
// listener de 'error' em startWhisperServer). Isso é suficiente pra testar o
// contrato do loop de fallback sem depender do binário real nem do modelo de
// 1,6GB.

// Arquivo qualquer que existe e é legível — só precisa passar em
// access(model, R_OK), o conteúdo não importa pra esses testes.
const ARQUIVO_LEGIVEL = fileURLToPath(import.meta.url)

function portaLivre() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

describe('startWhisperServerWithFallback', () => {
  it('falha rápido quando o modelo não existe, sem tentar nenhum candidato', async () => {
    const inicio = Date.now()
    await expect(startWhisperServerWithFallback({
      modelPath: 'C:/caminho/que/nao/existe/modelo.bin',
      port: 39001,
      candidates: ['C:/tambem/nao/existe/whisper-server.exe']
    })).rejects.toThrow(/modelo de transcrição não encontrado/)
    // a pré-checagem não passa pelo loop de spawn (que tem timeout de 60s);
    // uma falha "rápida" aqui é da ordem de milissegundos.
    expect(Date.now() - inicio).toBeLessThan(5000)
  })

  it('falha rápido quando a porta já está em uso, sem tentar nenhum candidato', async () => {
    const ocupada = createServer()
    const porta = await new Promise((resolve, reject) => {
      ocupada.on('error', reject)
      ocupada.listen(0, '127.0.0.1', () => resolve(ocupada.address().port))
    })

    try {
      const inicio = Date.now()
      await expect(startWhisperServerWithFallback({
        modelPath: ARQUIVO_LEGIVEL,
        port: porta,
        candidates: ['C:/tambem/nao/existe/whisper-server.exe']
      })).rejects.toThrow(/já está em uso/)
      expect(Date.now() - inicio).toBeLessThan(5000)
    } finally {
      await new Promise((r) => ocupada.close(r))
    }
  })

  it('tenta cada candidato em ordem quando a falha é específica de backend (ex: binário ausente)', async () => {
    const porta = await portaLivre()

    let error
    try {
      await startWhisperServerWithFallback({
        modelPath: ARQUIVO_LEGIVEL,
        port: porta,
        candidates: [
          'C:/fake/blas/whisper-server.exe',
          'C:/fake/cpu/whisper-server.exe'
        ]
      })
    } catch (err) {
      error = err
    }

    expect(error).toBeDefined()
    // os DOIS candidatos precisam aparecer no erro final — prova que o
    // segundo foi de fato tentado depois que o primeiro falhou, em vez do
    // loop parar na primeira falha.
    expect(error.message).toContain('C:/fake/blas/whisper-server.exe')
    expect(error.message).toContain('C:/fake/cpu/whisper-server.exe')
    expect(error.message).toContain('ENOENT')
  }, 10000)
})
