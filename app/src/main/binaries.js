import { join } from 'path'
import { existsSync } from 'fs'
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

// Ordem de preferência. BLAS não é aceleração de GPU — é a mesma CPU fazendo
// a álgebra de matriz via OpenBLAS, mais rápido que o build ingênuo. O
// chamador tenta um a um porque o build BLAS depende de uma DLL de terceiro
// (a do OpenBLAS) que pode não estar presente (release futuro parou de
// publicar o asset `blas`) ou não carregar numa máquina específica; nesse
// caso o build `cpu` puro, sem dependência nenhuma além do Windows, assume.
export function whisperServerCandidates() {
  if (process.env.DITA_WHISPER_SERVER) return [process.env.DITA_WHISPER_SERVER]
  if (!isWin) return ['/opt/homebrew/opt/whisper-cpp/bin/whisper-server']

  const root = isPackaged()
    ? join(process.resourcesPath, 'whisper')
    : join(baseDir(), '../../resources/win/whisper')

  return ['blas', 'cpu']
    .map((flavor) => join(root, flavor, 'whisper-server.exe'))
    .filter((p) => existsSync(p))
}
