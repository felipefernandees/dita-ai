import { join } from 'path'
import { existsSync } from 'fs'
import { spawnSync } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'

const isWin = process.platform === 'win32'

// Equivalente a app.isPackaged sem importar 'electron' (que sob
// ELECTRON_RUN_AS_NODE resolve para uma string). Mesmo padrão de
// helper-path.js: reaproveitado aqui de propósito, não reinventado.
function isPackaged() {
  if (process.defaultApp) return false            // rodando via `electron .`
  if (process.env.ELECTRON_RUN_AS_NODE) return false // rodando a suíte
  return !!process.resourcesPath
}

// __dirname existe no bundle CJS que o electron-vite gera (app/out/main),
// mas não sob vitest em ESM.
function baseDir() {
  return typeof __dirname !== 'undefined' ? __dirname : join(process.cwd(), 'out/main')
}

export function ffmpegPath() {
  if (process.env.DITA_FFMPEG) return process.env.DITA_FFMPEG
  // com asar:false o caminho já é real, mas manter o replace deixa o módulo
  // correto caso o asar volte a ser ligado
  return String(ffmpegStatic).replace('app.asar', 'app.asar.unpacked')
}

// Onde o whisper-server empacotado mora, com e sem o app empacotado. O nome da
// pasta de origem difere por plataforma (resources/win, resources/mac) porque
// cada uma é produzida por um script diferente e nenhuma das duas deve viajar
// dentro do instalador da outra; dentro do .app/instalador as duas chegam como
// `whisper`, que é o que o electron-builder.yml declara.
function raizEmpacotada(plataforma) {
  return isPackaged()
    ? join(process.resourcesPath, 'whisper')
    : join(baseDir(), `../../resources/${plataforma}/whisper`)
}

// Ordem de preferência. No Windows, BLAS não é aceleração de GPU — é a mesma
// CPU fazendo a álgebra de matriz via OpenBLAS, mais rápido que o build
// ingênuo. O chamador tenta um a um porque o build BLAS depende de uma DLL de
// terceiro (a do OpenBLAS) que pode não estar presente (release futuro parou de
// publicar o asset `blas`) ou não carregar numa máquina específica; nesse caso
// o build `cpu` puro, sem dependência nenhuma além do Windows, assume.
//
// No macOS há um candidato só (`metal`, compilado por scripts/build-whisper-mac.mjs)
// e, atrás dele, o whisper-cpp do Homebrew. O Homebrew NÃO é fallback de
// produção: ele existe para quem está desenvolvendo e ainda não rodou
// `npm run deps:mac`. Foi justamente depender dele que fazia o app só funcionar
// na máquina de quem o construiu.
export function whisperServerCandidates() {
  if (process.env.DITA_WHISPER_SERVER) return [process.env.DITA_WHISPER_SERVER]

  if (!isWin) {
    return [
      join(raizEmpacotada('mac'), 'metal', 'whisper-server'),
      '/opt/homebrew/opt/whisper-cpp/bin/whisper-server'
    ].filter((p) => existsSync(p))
  }

  const root = raizEmpacotada('win')
  return ['vulkan', 'blas', 'cpu']
    .map((flavor) => join(root, flavor, 'whisper-server.exe'))
    .filter((p) => existsSync(p))
}

// O build Vulkan NÃO pode ser escolhido por tentativa e erro como os outros.
//
// Numa máquina sem GPU compatível ele não falha: imprime "Found 0 Vulkan
// devices" e sobe normalmente, caindo no backend de CPU embutido — que é o
// ggml-cpu genérico, SEM OpenBLAS. Ou seja, ele funcionaria, e funcionaria pior
// que o candidato `blas` que viria depois. O laço de fallback, que só reage a
// processo morto, jamais perceberia isso: o usuário sem GPU ficaria com a pior
// das três opções, em silêncio.
//
// Por isso sondamos antes. A sonda roda o PRÓPRIO binário que seria usado, na
// máquina real, e lê quantos dispositivos o ggml enxergou — em vez de inferir
// de vulkan-1.dll ou do fabricante da GPU, que responderiam outra pergunta.
// Custa ~160ms, uma vez, na subida do app.
export function vulkanUtilizavel(binPath) {
  try {
    const r = spawnSync(binPath, ['--help'], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true
    })
    const saida = `${r.stdout || ''}${r.stderr || ''}`
    const m = saida.match(/Found (\d+) Vulkan devices/i)
    return !!m && Number(m[1]) > 0
  } catch {
    // sonda falhou (binário corrompido, timeout): trata como indisponível e
    // deixa o próximo candidato assumir
    return false
  }
}
