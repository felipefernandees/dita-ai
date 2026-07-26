import { join } from 'path'

const EXE = process.platform === 'win32' ? 'dita-helper.exe' : 'dita-hotkeys'
const DEV_SUBDIR = process.platform === 'win32' ? 'helper-win/dist' : 'helper'

// Equivalente a app.isPackaged sem importar 'electron' (que sob
// ELECTRON_RUN_AS_NODE resolve para uma string).
//
// A checagem de ELECTRON_RUN_AS_NODE não é opcional: a suíte roda assim, e
// nela process.resourcesPath TAMBÉM está definido — sem ela todo teste cairia
// no ramo "empacotado" e o teste de caminho de dev falharia.
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

export function helperPath() {
  if (process.env.DITA_HELPER) return process.env.DITA_HELPER
  if (isPackaged()) return join(process.resourcesPath, EXE)
  // out/main -> app/ -> raiz do repo
  return join(baseDir(), '../../..', DEV_SUBDIR, EXE)
}
