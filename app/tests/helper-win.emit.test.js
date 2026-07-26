import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Um hook WH_KEYBOARD_LL tem orçamento de LowLevelHooksTimeout (~300ms) por
// chamada; estourou, o Windows desregistra o hook em silêncio e os atalhos do
// usuário morrem pelo resto da sessão. O Emit() precisa então ser não-bloqueante
// mesmo com o stdout entupido — e isso não dá para verificar por inspeção.
//
// O harness em tests/fixtures/emit-harness compila os .cs REAIS do helper
// (Compile Include apontando para helper-win/DitaHelper), troca o Console.Out
// por um writer que nunca completa uma escrita, sobe a thread escritora do
// helper e chama o HookCallback privado 2000 vezes, medindo cada chamada.
//
// O harness também mede um CONTROLE: uma escrita direta no Console.Out — o que
// o Emit antigo fazia de dentro do callback — não pode completar em 1s. Sem
// esse controle o teste passaria mesmo se o writer bloqueante não bloqueasse,
// e não estaria provando nada.
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJ = join(HERE, 'fixtures/emit-harness/EmitHarness.csproj')

const hasDotnet = process.platform === 'win32' &&
  spawnSync('dotnet', ['--version'], { encoding: 'utf8' }).status === 0

function buildHarness() {
  // bin/ e obj/ vão para o temp: o diretório de fixtures fica limpo.
  const work = join(tmpdir(), 'dita-emit-harness')
  mkdirSync(work, { recursive: true })
  const outDir = join(work, 'bin').replace(/\\/g, '/')
  const objDir = join(work, 'obj').replace(/\\/g, '/')

  const build = spawnSync('dotnet', [
    'build', PROJ, '-c', 'Release',
    '-o', outDir,
    `-p:BaseIntermediateOutputPath=${objDir}/`
  ], { encoding: 'utf8' })

  expect(build.status, `falha ao compilar o harness:\n${build.stdout}\n${build.stderr}`).toBe(0)

  const exe = join(outDir, 'emit-harness.exe')
  expect(existsSync(exe)).toBe(true)
  return exe
}

describe.skipIf(!hasDotnet)('HookCallback não bloqueia no stdout', () => {
  it('emite 2000 eventos sem ninguém drenando o stdout', () => {
    // timeout curto de propósito: se o processo pendurar (thread escritora
    // presa e não-background, ou Emit bloqueando), queremos falha, não espera.
    const run = spawnSync(buildHarness(), [], { encoding: 'utf8', timeout: 30000 })

    const line = (run.stderr || '').split('\n').find((l) => l.startsWith('HARNESS '))
    expect(line, `harness não reportou nada. stderr=${run.stderr} status=${run.status}`).toBeTruthy()

    const r = JSON.parse(line.slice('HARNESS '.length))

    // 1. o fixture é real: escrever direto no stdout entupido trava mesmo.
    expect(r.controlBlocked).toBe(true)
    // 2. e ainda assim o callback devolve o controle imediatamente.
    expect(r.events).toBe(2000)
    expect(r.worstMs).toBeLessThan(50)   // vs. os ~300ms do LowLevelHooksTimeout
    expect(r.totalMs).toBeLessThan(1000)
    // 3. o processo saiu sozinho: a thread escritora, presa para sempre numa
    //    escrita, é IsBackground e não segura o processo.
    expect(run.status).toBe(0)
  }, 240000)

  // A thread escritora é IsBackground, então o runtime não espera por ela na
  // saída. O caminho do "no_permission" enfileira uma linha e retorna 1 logo
  // em seguida — sem o CompleteAdding() + Join() do Drain(), o Electron nunca
  // veria esse evento.
  it('Drain() esvazia a fila antes do processo sair', () => {
    const run = spawnSync(buildHarness(), ['drain'], { encoding: 'utf8', timeout: 30000 })
    expect(run.status, `stderr=${run.stderr}`).toBe(0)
    expect(run.stdout).toBe('{"event":"no_permission"}\n')
  }, 240000)
})
