import { describe, it, expect, beforeAll } from 'vitest'
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

  // Regressão: com push-to-talk no Right Alt (a opção de quem tem teclado 60%),
  // em layout ABNT2 essa tecla É o AltGr, e o Windows injeta um LeftCtrl junto
  // que auto-repete enquanto ela está segurada. A regra antiga tratava qualquer
  // tecla como "combo" e abortava — o AltGr abortava a si mesmo e o PTT
  // simplesmente não gravava nada nesse layout.
  it('AltGr como PTT: modificador não aborta, tecla de ação aborta', () => {
    const run = spawnSync(buildHarness(), ['altgr'], { encoding: 'utf8', timeout: 30000 })
    expect(run.status, `stderr=${run.stderr}`).toBe(0)

    const eventos = run.stdout.trim().split('\n').map((l) => JSON.parse(l).event)

    expect(eventos).toEqual([
      'ptt_down',  // segurou o AltGr
      'ptt_up',    // soltou: o LeftCtrl injetado e o Shift NÃO abortaram
      'ptt_down',  // segurou de novo
      'combo',     // agora sim, tecla de ação junto
      'ptt_abort'  // e por isso aborta
    ])
  }, 240000)
})

// O formato dos specs de atalho é contrato de fio entre o renderer (que monta
// a string a partir de um KeyboardEvent) e o helper (que faz o parse e instala
// o hook). Divergência entre os dois não dá erro em lugar nenhum: a UI grava um
// valor, o helper não reconhece, cai no default, e o usuário só descobre que
// "o atalho não pegou". Este bloco fala com o ShortcutSpec.cs REAL, via o
// cenário `parse` do harness.
describe.skipIf(!hasDotnet)('ShortcutSpec: vocabulário de atalhos', () => {
  // Uma única invocação do harness para todos os casos: cada build+spawn custa
  // segundos, e o cenário é puro (sem estado entre specs).
  function parse(specs) {
    const run = spawnSync(buildHarness(), ['parse', ...specs], { encoding: 'utf8', timeout: 30000 })
    expect(run.status, `stderr=${run.stderr}`).toBe(0)
    const linhas = run.stdout.trim().split('\n').map((l) => JSON.parse(l))
    expect(linhas.length).toBe(specs.length)
    const porSpec = new Map()
    for (const l of linhas) porSpec.set(`${l.kind}:${l.spec}`, l)
    return porSpec
  }

  // Virtual-keys esperados, do WinUser.h. Escritos aqui em vez de importados
  // do C# de propósito: se a tabela do helper mudar, o teste tem que reclamar.
  const VK_SPACE = 0x20
  const VK_F5 = 0x74
  const VK_F9 = 0x78
  const VK_F12 = 0x7b
  const VK_J = 0x4a
  const VK_OEM_1 = 0xba   // posição do ';' US = Ç no ABNT2
  const VK_ABNT_C1 = 0xc1 // tecla extra do ABNT2, '/' '?'
  const VK_RCONTROL = 0xa3

  // O default para onde toda entrada inválida cai.
  const PADRAO = { vk: VK_SPACE, ctrl: true, alt: false, shift: true, win: false }

  const VALIDOS = [
    // --- os quatro valores que já podem estar gravados em settings.json ---
    ['ctrl+shift+space', { vk: VK_SPACE, ctrl: true, alt: false, shift: true, win: false }],
    ['ctrl+space', { vk: VK_SPACE, ctrl: true, alt: false, shift: false, win: false }],
    ['alt+space', { vk: VK_SPACE, ctrl: false, alt: true, shift: false, win: false }],
    ['f5', { vk: VK_F5, ctrl: false, alt: false, shift: false, win: false }],
    // --- combinações novas que o formato antigo não conseguia expressar ---
    ['ctrl+alt+j', { vk: VK_J, ctrl: true, alt: true, shift: false, win: false }],
    ['win+f9', { vk: VK_F9, ctrl: false, alt: false, shift: false, win: true }],
    ['ctrl+alt+shift+win+f12', { vk: VK_F12, ctrl: true, alt: true, shift: true, win: true }],
    ['alt+semicolon', { vk: VK_OEM_1, ctrl: false, alt: true, shift: false, win: false }],
    ['ctrl+intlro', { vk: VK_ABNT_C1, ctrl: true, alt: false, shift: false, win: false }]
  ]

  const INVALIDOS = [
    // Rule 1: tecla comum sozinha suprimiria a letra no sistema inteiro — e o
    // usuário não conseguiria nem digitar nas Preferências para desfazer.
    ['j', 'PrecisaModificador'],
    ['space', 'PrecisaModificador'],
    ['semicolon', 'PrecisaModificador'],
    // Rule 2: modificador não é tecla base.
    ['ctrl', 'SemBase'],
    ['ctrl+shift', 'SemBase'],
    ['win', 'SemBase'],
    // Rule 3: o SO reserva estas — o hook nem vê ctrl+alt+delete/win+l, e
    // suprimir alt+f4/alt+tab quebraria fechar e alternar janela.
    ['alt+f4', 'Reservada'],
    ['alt+tab', 'Reservada'],
    ['ctrl+alt+delete', 'Reservada'],
    ['win+l', 'Reservada'],
    // Ordem não-canônica não é escapatória do filtro de reservadas.
    ['f4+alt', 'Reservada'],
    // Specs do macOS num settings.json copiado de um Mac: quem os interpreta é
    // o helper em Swift. Aqui não podem derrubar nada, só cair no default.
    ['fn+space', 'TokenDesconhecido'],
    ['opt+space', 'TokenDesconhecido'],
    ['rcmd', 'TokenDesconhecido'],
    // Lixo estrutural.
    ['', 'Vazio'],
    ['ctrl++j', 'Vazio'],
    ['ctrl+a+b', 'BaseDuplicada'],
    ['ctrl+ctrl+j', 'ModificadorRepetido'],
    ['f25', 'TokenDesconhecido'],
    ['ctrl+shift+banana', 'TokenDesconhecido']
  ]

  const PTT = [
    ['rctrl', 0xa3], ['lctrl', 0xa2],
    ['rshift', 0xa1], ['lshift', 0xa0],
    ['ralt', 0xa5], ['lalt', 0xa4]
  ]

  // 'rwin'/'lwin' não entram: um toque solto abre o menu Iniciar e teclas de
  // PTT nunca são suprimidas. Um settings.json antigo com rwin tem que cair no
  // rctrl, não ficar com push-to-talk morto.
  const PTT_INVALIDOS = ['rwin', 'lwin', 'rcmd', 'ropt', 'ctrl+shift', '']

  const TODOS = [
    ...VALIDOS.map(([s]) => `toggle:${s}`),
    ...INVALIDOS.map(([s]) => `toggle:${s}`),
    'toggle:CTRL+Shift+Space',
    'toggle:shift+ctrl+space',
    ...PTT.map(([s]) => `ptt:${s}`),
    ...PTT_INVALIDOS.map((s) => `ptt:${s}`)
  ]

  let R
  beforeAll(() => { R = parse(TODOS) }, 240000)

  it.each(VALIDOS)('aceita %s', (spec, esperado) => {
    const r = R.get(`toggle:${spec}`)
    expect(r.ok, `motivo=${r.motivo}`).toBe(true)
    expect({ vk: r.vk, ctrl: r.ctrl, alt: r.alt, shift: r.shift, win: r.win }).toEqual(esperado)
    // round-trip: o que o helper entendeu, serializado de volta, é a mesma
    // string que a UI teria gravado
    expect(r.canon).toBe(spec)
  })

  it.each(INVALIDOS)('recusa %s (%s) e cai no default', (spec, motivo) => {
    const r = R.get(`toggle:${spec}`)
    expect(r.ok).toBe(false)
    expect(r.motivo).toBe(motivo)
    expect({ vk: r.vk, ctrl: r.ctrl, alt: r.alt, shift: r.shift, win: r.win }).toEqual(PADRAO)
  })

  // A garantia mais importante da regra 1, dita ao contrário: nenhuma entrada
  // recusada pode virar um spec SEM modificador em cima de uma tecla comum.
  // Um bug aqui não daria erro — daria uma letra que para de funcionar no
  // Windows inteiro enquanto o Dita Aí estiver aberto.
  it('nenhuma recusa produz um atalho sem modificador numa tecla comum', () => {
    for (const [spec] of INVALIDOS) {
      const r = R.get(`toggle:${spec}`)
      expect(r.ctrl || r.alt || r.shift || r.win, `${spec} virou ${r.canon}`).toBe(true)
    }
  })

  it('normaliza caixa e ordem dos modificadores', () => {
    for (const spec of ['CTRL+Shift+Space', 'shift+ctrl+space']) {
      const r = R.get(`toggle:${spec}`)
      expect(r.ok, `motivo=${r.motivo}`).toBe(true)
      expect(r.canon).toBe('ctrl+shift+space')
      expect(r.vk).toBe(VK_SPACE)
    }
  })

  it.each(PTT)('push-to-talk %s -> vk %i', (spec, vk) => {
    const r = R.get(`ptt:${spec}`)
    expect(r.ok).toBe(true)
    expect(r.vk).toBe(vk)
  })

  it.each(PTT_INVALIDOS)('push-to-talk %s cai no rctrl', (spec) => {
    const r = R.get(`ptt:${spec}`)
    expect(r.ok).toBe(false)
    expect(r.vk).toBe(VK_RCONTROL)
  })
})
