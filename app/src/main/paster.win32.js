import { clipboard } from 'electron'
import { execFile } from 'child_process'
import { helperPath } from './helper-path.js'

function helper(args) {
  return new Promise((resolve, reject) => {
    execFile(helperPath(), args, { windowsHide: true }, (err, stdout) =>
      (err ? reject(err) : resolve(stdout.trim())))
  })
}

export async function getFrontmostApp() {
  try { return await helper(['frontapp']) } catch { return '' }
}

export async function pasteText(text) {
  const previous = clipboard.readText()
  clipboard.writeText(text)
  try {
    // exit != 0 = SendInput bloqueado (janela em foco rodando como admin)
    await helper(['paste'])
  } catch {
    return false
  }
  // restaura o clipboard do usuário depois que o paste assentou
  setTimeout(() => {
    if (clipboard.readText() === text && previous) clipboard.writeText(previous)
  }, 400)
  return true
}
