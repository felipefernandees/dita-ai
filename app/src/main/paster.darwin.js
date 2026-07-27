import { clipboard } from 'electron'
import { execFile } from 'child_process'

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
  })
}

export async function getFrontmostApp() {
  try {
    return await osascript('tell application "System Events" to get name of first process whose frontmost is true')
  } catch { return '' }
}

export async function pasteText(text) {
  const previous = clipboard.readText()
  clipboard.writeText(text)
  try {
    await osascript('tell application "System Events" to keystroke "v" using command down')
  } catch {
    return false // sem permissão de acessibilidade ou keystroke falhou
  }
  // restaura o clipboard do usuário depois que o paste assentou
  setTimeout(() => {
    if (clipboard.readText() === text && previous) clipboard.writeText(previous)
  }, 400)
  return true
}
