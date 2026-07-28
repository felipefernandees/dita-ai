// Guarda de pré-build do empacotamento macOS. É o irmão de check-win-deps.mjs,
// pelo mesmo motivo e com a mesma regra.
//
// `deps:mac` NÃO entra na cadeia do `build:mac`: ele clona e compila o
// whisper.cpp, o que leva minutos, e encadeá-lo faria todo build repetir isso.
// O preço é que num clone limpo o `build:mac` sozinho empacotaria SEM o
// whisper-server — e o .app abriria normalmente, com bandeja, atalhos e tudo,
// mas seria incapaz de transcrever. Falha silenciosa no artefato final é o pior
// lugar possível para esse erro aparecer, então ele vira erro de build aqui.
//
// Nota histórica: enquanto o macOS usava o whisper-cpp do Homebrew, essa falha
// era invisível na máquina de quem construía o app (lá o Homebrew existe) e
// certeira na máquina de qualquer outra pessoa.
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const servidor = join(appDir, 'resources/mac/whisper/metal/whisper-server')

if (!existsSync(servidor)) {
  console.error(`
  ERRO: o whisper-server não está em
    ${servidor}

  Sem ele o .app é gerado, abre — e não transcreve nada. O binário é compilado
  a partir do whisper.cpp (o upstream não publica build de macOS) e fica fora
  do git, então num clone limpo é preciso construí-lo uma vez:

    npm run deps:mac      (precisa de cmake: brew install cmake)

  Depois rode o build de novo. A compilação é única; builds seguintes reusam.
`)
  process.exit(1)
}

console.log(`  • whisper presente: metal`)
