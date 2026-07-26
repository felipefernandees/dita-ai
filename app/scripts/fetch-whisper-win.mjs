// Baixa os binários oficiais do whisper.cpp e os deixa em
// app/resources/win/whisper/{vulkan,cpu}/whisper-server.exe (+ DLLs).
// Os nomes dos assets mudam entre releases, então casamos por regex e
// imprimimos o que foi escolhido — assim, quando um release renomear as
// coisas, o log já mostra contra o que ajustar o regex.
import { execFileSync } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../resources/win/whisper')
const TMP = join(HERE, '../.tmp-whisper')
const API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest'

// A ordem aqui espelha whisperServerCandidates() em src/main/binaries.js:
// a primeira pasta que existir é a primeira tentativa de subir o servidor.
const FLAVORS = [
  // O upstream NÃO publica build Vulkan para Windows — conferimos os 30
  // releases mais recentes (v1.4.3 até v1.9.1) e nenhum traz asset com esse
  // nome; os únicos acelerados são os cublas-*, que são NVIDIA e pesam
  // 280MB/680MB. Deixamos a entrada aqui, opcional, para que no dia em que
  // publicarem um build Vulkan o `npm run deps:win` passe a pegá-lo sozinho,
  // sem tocar em código. Enquanto isso a pasta simplesmente não é criada e
  // binaries.js cai direto no candidato de CPU.
  { name: 'vulkan', match: /vulkan/i, required: false },
  // Único build x64 que roda em qualquer máquina, sem depender de GPU nem de
  // runtime de terceiros. É o piso obrigatório: sem ele o app não transcreve.
  { name: 'cpu', match: /^whisper-bin-x64\.zip$/i, required: true }
]

async function baixar(url, destino) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dita-ai-build' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destino))
}

// Expand-Archive evita uma dependência npm só para descompactar. Aspas simples
// são dobradas porque o caminho vai literal dentro de uma string PowerShell.
function extrair(zip, destino) {
  const q = (s) => `'${s.replace(/'/g, "''")}'`
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(destino)} -Force`],
    { stdio: 'inherit' })
}

// O exe do servidor mudou de nome entre versões (server.exe -> whisper-server.exe)
// e mora dentro de uma subpasta (hoje `Release/`), então procuramos recursivo.
function acharServidor(raiz) {
  for (const entry of readdirSync(raiz, { withFileTypes: true })) {
    const full = join(raiz, entry.name)
    if (entry.isDirectory()) {
      const found = acharServidor(full)
      if (found) return found
    } else if (/^(whisper-)?server\.exe$/i.test(entry.name)) {
      return full
    }
  }
  return null
}

function tamanhoDaPasta(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    total += entry.isDirectory() ? tamanhoDaPasta(full) : statSync(full).size
  }
  return total
}

const res = await fetch(API, { headers: { 'User-Agent': 'dita-ai-build' } })
if (!res.ok) throw new Error(`API do GitHub respondeu HTTP ${res.status}`)
const release = await res.json()
console.log(`release: ${release.tag_name}`)
console.log('assets disponíveis:')
for (const a of release.assets) console.log('  -', a.name)

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
mkdirSync(OUT, { recursive: true })

try {
  for (const flavor of FLAVORS) {
    const asset = release.assets.find((a) => a.name.endsWith('.zip')
      && /x64/i.test(a.name)
      && flavor.match.test(a.name))

    if (!asset) {
      const msg = `nenhum asset ${flavor.name} neste release`
      if (flavor.required) throw new Error(msg + ' — conferir a lista acima e ajustar o regex')
      console.log(`  (pulando ${flavor.name}: ${msg})`)
      continue
    }

    console.log(`\n${flavor.name}: ${asset.name} (${(asset.size / 1e6).toFixed(1)}MB)`)
    const zip = join(TMP, asset.name)
    const desempacotado = join(TMP, flavor.name)

    await baixar(asset.browser_download_url, zip)
    extrair(zip, desempacotado)

    const servidor = acharServidor(desempacotado)
    if (!servidor) throw new Error(`${asset.name} não contém server.exe nem whisper-server.exe`)

    // Não copiamos a pasta inteira: o zip traz ~15 executáveis que não usamos
    // (test-*, wchess, talk-llama, parakeet, stream...) e que acabariam dentro
    // do instalador. Levamos o servidor e TODAS as DLLs vizinhas, porque o
    // whisper-server carrega whisper.dll/ggml.dll e escolhe o backend de CPU
    // (ggml-cpu-*.dll) em runtime conforme o processador — filtrar DLL por nome
    // quebraria em máquinas com outro conjunto de instruções.
    const pastaDoExe = dirname(servidor)
    const destino = join(OUT, flavor.name)
    rmSync(destino, { recursive: true, force: true })
    mkdirSync(destino, { recursive: true })

    let dlls = 0
    for (const nome of readdirSync(pastaDoExe)) {
      if (!nome.toLowerCase().endsWith('.dll')) continue
      copyFileSync(join(pastaDoExe, nome), join(destino, nome))
      dlls++
    }

    // Renomear na cópia normaliza o nome que binaries.js espera.
    const alvo = join(destino, 'whisper-server.exe')
    copyFileSync(servidor, alvo)
    if (!existsSync(alvo)) throw new Error(`falhou ao copiar o servidor para ${alvo}`)

    console.log(`  -> ${alvo}`)
    console.log(`     ${dlls} DLLs, ${(tamanhoDaPasta(destino) / 1e6).toFixed(1)}MB`)
  }
} finally {
  // Mesmo se algo estourar no meio, não deixamos ~200MB de zip pelo caminho.
  rmSync(TMP, { recursive: true, force: true })
}

console.log('\npronto.')
