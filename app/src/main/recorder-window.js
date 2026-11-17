import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

const isMac = process.platform === 'darwin'

// no macOS mantém o popup acima de apps em tela cheia e fora da troca de
// espaços; no Windows o alwaysOnTop 'screen-saver' já basta
function keepOnAllWorkspaces(win) {
  if (!isMac) return
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
}

// A janela da pílula tem tamanho FIXO e fica sempre na tela, igual ao Wispr
// Flow: parada ela mostra a pílula pequena (40x8), e quem muda de tamanho é a
// pílula, por CSS, dentro desta área transparente. A área sobra em cima para
// a dica que aparece com o mouse e para a tarja de cancelado. O resto da
// janela deixa o clique passar (setIgnoreMouseEvents com forward), e só a
// pílula liga o mouse quando o ponteiro entra nela.
// Uma área só, fixa, onde cabe tudo: a pílula, a dica, a tarja de cancelado
// e o cartão de "sem campo" (até 440 px, como o do Wispr). O cartão nasce da
// própria pílula esticando por CSS, então a janela não muda de tamanho nunca.
const SIZE = {
  rec: { w: 470, h: 250 }
}
const MARGIN_BOTTOM = 2

export function createRecorderWindow({ mostrarParada = () => true } = {}) {
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

  let guard = null
  let telaAtual = null
  let repousando = false

  // Por padrão a janela inteira é "vidro": o clique passa para o app de baixo.
  // forward:true continua entregando o movimento do mouse ao renderer, que é
  // como ele percebe o ponteiro entrando na pílula e pede o mouse de volta.
  function vidro(on) {
    if (win.isDestroyed()) return
    win.setIgnoreMouseEvents(on, on ? { forward: true } : undefined)
  }
  vidro(true)

  function place(w, h) {
    const tela = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    telaAtual = tela.id
    const { workArea } = tela
    win.setBounds({
      x: Math.round(workArea.x + workArea.width / 2 - w / 2),
      y: Math.round(workArea.y + workArea.height - h - MARGIN_BOTTOM),
      width: w, height: h
    })
  }



  // Mantém a pílula por cima de tudo e, parada, acompanha a tela onde está o
  // mouse (no Wispr ela aparece no monitor em que você está trabalhando).
  function startGuard(ms = 500) {
    if (guard) clearInterval(guard)
    guard = setInterval(() => {
      if (win.isDestroyed()) return
      win.setAlwaysOnTop(true, 'screen-saver')
      keepOnAllWorkspaces(win)
      if (!win.isVisible()) win.showInactive()
      win.moveTop()
      if (repousando) {
        const tela = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        if (tela.id !== telaAtual) place(SIZE.rec.w, SIZE.rec.h)
      }
    }, ms)
  }

  // Volta para a pílula parada, sem esconder a janela.
  function descansar() {
    if (win.isDestroyed()) return
    repousando = true
    place(SIZE.rec.w, SIZE.rec.h)
    vidro(true)
    win.webContents.send('rec:repouso')
    // "Mostrar a pílula o tempo todo" desligado (o "Show Flow Bar at all
    // times" do Wispr): parada ela some, e volta só no próximo ditado.
    if (!mostrarParada()) {
      if (guard) { clearInterval(guard); guard = null }
      win.hide()
      return
    }
    win.setAlwaysOnTop(true, 'screen-saver')
    win.showInactive()
    startGuard(1000)
  }

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  // A pílula parada aparece assim que o app abre, como no Wispr.
  win.webContents.once('did-finish-load', () => descansar())

  return {
    win,
    show() {
      repousando = false
      place(SIZE.rec.w, SIZE.rec.h)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.showInactive()
      startGuard(500)
    },
    // O cartão "sem campo" cabe na mesma área; o clique liga quando o mouse
    // entra nele (mouseDentro), como na pílula.
    expandResult() { repousando = false },
    // A tarja de cancelado cabe na área da pílula; só precisa do clique (Anular).
    toast() { repousando = false },
    // O renderer avisa quando o ponteiro entra ou sai da pílula.
    mouseDentro(dentro) { vidro(!dentro) },
    hide() { descansar() },
    // O ajuste mudou: aplica já se ela estiver parada.
    aplicarParada() { if (repousando) descansar() },
    hideAnimated() {
      win.webContents.send('rec:closing')
      setTimeout(() => descansar(), 130)
    },
    send(channel, ...args) { win.webContents.send(channel, ...args) }
  }
}
