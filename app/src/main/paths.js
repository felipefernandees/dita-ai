import { homedir } from 'os'
import { join } from 'path'

// Fonte única do diretório de dados.
//
// Sem importar 'electron' de propósito: sob ELECTRON_RUN_AS_NODE (como a
// suíte roda) o módulo 'electron' é uma string de caminho, e o import
// nomeado quebraria. O resultado abaixo é idêntico ao de
// app.getPath('appData') nas três plataformas (darwin, win32 e Linux via
// XDG_CONFIG_HOME).
//
// E é 'appData' + o literal 'dita-ai', não 'userData': userData resolve para
// o productName ("Dita Aí") no macOS, o que mudaria o caminho dos usuários
// Mac existentes e abandonaria o banco deles.
export function dataDir() {
  if (process.env.DITA_DATA_DIR) return process.env.DITA_DATA_DIR
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'dita-ai')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'dita-ai')
  }
  // Linux e demais: mesmo cálculo que app.getPath('appData') faz lá.
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'dita-ai')
}

export function modelDir() { return join(dataDir(), 'models') }
export function dbPath() { return join(dataDir(), 'dita.db') }
