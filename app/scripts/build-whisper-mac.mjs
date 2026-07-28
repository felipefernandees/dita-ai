// Compila o whisper.cpp para dentro do app e deixa o resultado em
// app/resources/mac/whisper/metal/whisper-server.
//
// POR QUE COMPILAR, SE NO WINDOWS BASTA BAIXAR
//
// O upstream publica binário pronto para Windows (é o que fetch-whisper-win.mjs
// pega), mas NÃO publica para macOS: conferido nos releases, os assets são
// whisper-bin-x64.zip, whisper-blas-bin-x64.zip e os cublas — todos Windows.
// Para o Mac, ou o usuário instala o `whisper-cpp` do Homebrew (era o que o app
// exigia, e é por isso que ele só rodava na máquina de quem o desenvolveu), ou
// o binário vem compilado dentro do pacote. Este script é a segunda opção.
//
// AS DUAS FLAGS QUE IMPORTAM
//
//   BUILD_SHARED_LIBS=OFF        — sem isto o build gera libwhisper.dylib e
//                                  libggml*.dylib, que o executável procura por
//                                  caminho absoluto do diretório de compilação.
//                                  Dentro do .app, esse caminho não existe.
//   GGML_METAL_EMBED_LIBRARY=ON  — o shader do Metal (ggml-metal.metal) vira
//                                  parte do binário em vez de um .metallib solto
//                                  ao lado. Sem isto o whisper sobe, não acha o
//                                  shader e cai para CPU — mais lento, e em
//                                  silêncio, que é o pior jeito de ficar lento.
//
// O binário sai com ~2MB e roda em qualquer Mac Apple Silicon, sem Homebrew,
// sem dylib solta e sem shader externo.
import { execFileSync, spawnSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(HERE, '..')
const OUT = join(RAIZ, 'resources/mac/whisper/metal')
const TMP = join(RAIZ, '.tmp-whisper-mac')

// Tag fixa, não `master`: o que entra no app do usuário não pode mudar porque
// alguém fez merge no upstream entre um build e outro. Subir de versão passa a
// ser uma decisão, com o teste de transcrição rodado depois.
const TAG = 'v1.9.1'
const REPO = 'https://github.com/ggml-org/whisper.cpp.git'

function rodar(cmd, args, cwd) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

function exigir(bin, comoInstalar) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' })
  } catch {
    throw new Error(`'${bin}' não encontrado. ${comoInstalar}`)
  }
}

if (process.platform !== 'darwin') {
  console.error('este script só roda no macOS (no Windows use `npm run deps:win`)')
  process.exit(1)
}

exigir('cmake', 'Instale com: brew install cmake')
exigir('git', 'Instale as Command Line Tools: xcode-select --install')

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

const fonte = join(TMP, 'whisper.cpp')
rodar('git', ['clone', '--depth', '1', '--branch', TAG, REPO, fonte])

const build = join(fonte, 'build')
rodar('cmake', [
  '-B', build,
  '-S', fonte,
  '-DCMAKE_BUILD_TYPE=Release',
  '-DBUILD_SHARED_LIBS=OFF',
  '-DGGML_METAL=ON',
  '-DGGML_METAL_EMBED_LIBRARY=ON',
  // O servidor é a única coisa que o app usa; o resto do repo são exemplos,
  // benchmarks e testes que só fariam o build demorar mais.
  '-DWHISPER_BUILD_EXAMPLES=ON',
  '-DWHISPER_BUILD_TESTS=OFF',
  '-DWHISPER_BUILD_SERVER=ON'
])
rodar('cmake', ['--build', build, '--config', 'Release', '--target', 'whisper-server', '-j'])

const compilado = join(build, 'bin/whisper-server')
if (!existsSync(compilado)) {
  throw new Error(`o build terminou mas não produziu ${compilado} — conferir a saída acima`)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const destino = join(OUT, 'whisper-server')
cpSync(compilado, destino)

// Sem assinatura ad-hoc, um binário copiado para dentro do .app quebra a
// assinatura do pacote inteiro e o Gatekeeper mata o app na abertura — o mesmo
// motivo pelo qual scripts/after-pack.cjs re-assina o bundle.
rodar('codesign', ['--force', '--sign', '-', destino])

// Prova de que o binário roda AQUI, agora, antes de virar parte de um pacote —
// e de que ele entende TODAS as opções que src/main/whisper.js passa na linha
// de comando. Subir a tag do whisper.cpp um dia pode renomear ou remover uma
// delas; sem esta conferência, o sintoma seria o whisper-server morrendo no
// boot do app do usuário, e o motivo estaria numa mensagem que ninguém lê.
// stdout E stderr: o whisper-server imprime a ajuda no stderr, então ler só o
// stdout devolveria string vazia e faria esta conferência acusar que TODAS as
// flags sumiram.
const ajuda = spawnSync(destino, ['--help'], { encoding: 'utf8', timeout: 20000 })
const saida = `${ajuda.stdout || ''}${ajuda.stderr || ''}`
const FLAGS_QUE_O_APP_USA = [
  '--model', '--host', '--port', '--language', '--threads',
  '--beam-size', '--best-of', '--entropy-thold',
  '--prompt', '--carry-initial-prompt', '--suppress-nst'
]
const faltando = FLAGS_QUE_O_APP_USA.filter((f) => !saida.includes(f))
if (faltando.length) {
  throw new Error(
    `o whisper-server ${TAG} não conhece ${faltando.join(', ')} — ` +
    'src/main/whisper.js passa essas opções e o servidor morreria no boot do app'
  )
}

rmSync(TMP, { recursive: true, force: true })

console.log(`\npronto: ${destino} (${(statSync(destino).size / 1e6).toFixed(1)}MB, whisper.cpp ${TAG})`)
