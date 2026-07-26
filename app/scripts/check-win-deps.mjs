// Guarda de pré-build do empacotamento Windows.
//
// `deps:win` NÃO entra na cadeia do `build:win` de propósito: ele baixa ~60MB
// de release do GitHub, e encadeá-lo faria todo build repetir o download. O
// preço disso é que num clone limpo o `build:win` sozinho empacotaria sem os
// binários do whisper — e o app instalado abriria normalmente, com bandeja,
// atalhos e tudo, mas seria incapaz de transcrever qualquer coisa. Falha
// silenciosa no artefato final é o pior lugar possível pra esse erro
// aparecer, então ele vira erro de build aqui, antes dos minutos gastos
// compilando o helper .NET.
//
// O critério é "pelo menos um flavor" e não "os dois" de propósito: é o mesmo
// contrato que binaries.js aplica em runtime (ele filtra por existsSync e cai
// de blas pra cpu), e um release futuro do whisper.cpp pode parar de publicar
// o asset `blas` sem que isso quebre o app.
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const whisperRoot = join(appDir, 'resources/win/whisper')

const flavors = ['blas', 'cpu']
const found = flavors.filter((f) => existsSync(join(whisperRoot, f, 'whisper-server.exe')))

if (found.length === 0) {
  console.error(`
  ERRO: nenhum binário do whisper encontrado em
    ${whisperRoot}

  Sem ele o instalador é gerado, instala e abre — mas não transcreve nada.
  Os binários são de terceiros e ficam fora do git (ver .gitignore), então
  num clone limpo é preciso buscá-los uma vez:

    npm run deps:win

  Depois rode o build de novo. O download é único; builds seguintes reusam.
`)
  process.exit(1)
}

console.log(`  • whisper presente: ${found.join(', ')}`)
