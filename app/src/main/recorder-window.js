import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

const isMac = process.platform === 'darwin'

// no macOS mantém o popup acima de apps em tela cheia e fora da troca de
// espaços; no Windows o alwaysOnTop 'screen-saver' já basta
function keepOnAllWorkspaces(win) {
  if (!isMac) return
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
}

// Tamanhos fixos, clonados do Wispr Flow (sem personalização)
const SIZE = {
  rec: { w: 214, h: 40 },      // pílula de gravação
  result: { w: 432, h: 188 },  // card "sem campo focado" + Copiar Ditado
  toast: { w: 264, h: 44 }     // tarja "Transcrição cancelada / Anular"
}
const MARGIN_BOTTOM = 46

export function createRecorderWindow() {
  const win = new BrowserWindow({
    width: SIZE.rec.w, height: SIZE.rec.h,
    frame: false, transparent: true, alwaysOnTop: true,
    // transparent:true sozinho não basta no Windows. Sem um backgroundColor
    // explicitamente 100% transparente (os dois primeiros dígitos são o alfa),
    // o Electron mantém um fundo opaco por baixo, e ele reaparece quando o
    // Chromium troca de modo de composição — o sintoma é a pílula virar um
    // retângulo sólido ao sair da gravação, que é justo quando o <canvas> do
    // equalizador sai do DOM.
    backgroundColor: '#00000000',
    // O Windows 11 arredonda janelas sem moldura por conta própria e pinta um
    // backdrop OPACO atrás delas. Era esse backdrop — não o CSS, não o
    // backgroundColor — que aparecia como um retângulo em volta da pílula.
    // Desligar devolve o controle do formato pro border-radius do CSS, que é
    // quem sabe que a pílula muda de raio entre as fases (999 na gravação, 22
    // no card grande). Comprovado por captura de tela: com roundedCorners
    // ligado o retângulo aparece, desligado as quinas ficam transparentes.
    // No macOS a opção é ignorada, então não muda nada lá.
    roundedCorners: false,
    focusable: false, skipTaskbar: true, show: false, resizable: false, hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // a janela nunca recebe foco; sem isso o macOS a marca como ocluída,
      // o Chromium congela o renderer e o popup para de pintar (some da tela)
      // com a gravação ainda rolando
      backgroundThrottling: false
    }
  })
  // visível em todos os espaços, inclusive por cima de apps em tela cheia;
  // skipTransformProcessType evita o app "roubar" ativação e sumir de espaço
  keepOnAllWorkspaces(win)
  // DITA_INPUT_DEBUG=1 registra os eventos de mouse que realmente chegam ao
  // renderer. Foi o que revelou por que os botões do popup não respondiam no
  // Windows: 1 mouseDown para 27 mouseUp, porque uma janela WS_EX_NOACTIVATE
  // tem o mouse-down descartado pelo Chromium (MA_NOACTIVATEANDEAT). Sem medir
  // isso não dá para distinguir "o clique não chega" de "o clique chega e o
  // handler não roda" — as duas hipóteses pedem correções opostas.
  if (process.env.DITA_INPUT_DEBUG) {
    const fs = require('fs')
    const alvo = require('path').join(require('os').homedir(), 'dita-input.log')
    win.webContents.on('input-event', (_e, ev) => {
      if (ev.type.startsWith('mouse')) {
        try { fs.appendFileSync(alvo, `${new Date().toISOString()} ${ev.type} ${ev.x},${ev.y}\n`) } catch {}
      }
    })
  }
  if (process.env.DITA_DEBUG) {
    win.webContents.on('console-message', (_e, _l, m) => console.log('RENDERER:', m))
    win.webContents.on('render-process-gone', (_e, d) => console.log('RENDERER GONE:', JSON.stringify(d)))
  }

  let tween = null
  let guard = null

  function place(w, h) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setBounds({
      x: Math.round(workArea.x + workArea.width / 2 - w / 2),
      y: Math.round(workArea.y + workArea.height - h - MARGIN_BOTTOM),
      width: w, height: h
    })
  }

  function tweenTo(w, h) {
    if (tween) { clearInterval(tween); tween = null }
    const b = win.getBounds()
    if (b.width === w && b.height === h) return
    const sw = b.width, sh = b.height
    const t0 = Date.now(), dur = 150
    tween = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      place(Math.round(sw + (w - sw) * e), Math.round(sh + (h - sh) * e))
      if (p >= 1) { clearInterval(tween); tween = null }
    }, 10)
  }

  function startGuard() {
    if (guard) clearInterval(guard)
    guard = setInterval(() => {
      if (win.isDestroyed()) return
      win.setAlwaysOnTop(true, 'screen-saver')
      keepOnAllWorkspaces(win)
      if (!win.isVisible()) win.showInactive()
      win.moveTop()
    }, 500)
  }
  function stopGuard() { if (guard) { clearInterval(guard); guard = null } }

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  return {
    win,
    show() {
      if (tween) { clearInterval(tween); tween = null }
      place(SIZE.rec.w, SIZE.rec.h)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.showInactive()
      startGuard()
    },
    expandResult() { tweenTo(SIZE.result.w, SIZE.result.h) },
    toast() { tweenTo(SIZE.toast.w, SIZE.toast.h) },
    hide() { stopGuard(); win.hide() },
    hideAnimated() {
      if (!win.isVisible()) { stopGuard(); return }
      win.webContents.send('rec:closing')
      setTimeout(() => { if (!win.isDestroyed()) { stopGuard(); win.hide() } }, 130)
    },
    send(channel, ...args) { win.webContents.send(channel, ...args) }
  }
}
