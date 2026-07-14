import { spawn } from 'child_process'

const MIN_PTT_MS = 300

export function createHotkeyMachine({ onStart, onStop, onCancel, now = () => Date.now() }) {
  let state = 'idle' // idle | recording
  let source = null  // toggle | ptt
  let startedAt = 0

  function start(src) {
    state = 'recording'
    source = src
    startedAt = now()
    onStart()
  }

  function finish() {
    state = 'idle'
    source = null
    onStop()
  }

  function cancel(reason) {
    state = 'idle'
    source = null
    onCancel(reason)
  }

  return {
    state: () => state,
    // acionados pelos botões do popup (check = finalizar, X = cancelar)
    stopExternally() { if (state === 'recording') finish() },
    cancelExternally() { if (state === 'recording') cancel('button') },
    handle(event) {
      if (event === 'toggle') {
        if (state === 'idle') start('toggle')
        else finish()
      } else if (event === 'ptt_down') {
        if (state === 'idle') start('ptt')
      } else if (event === 'ptt_up') {
        if (state === 'recording' && source === 'ptt') {
          if (now() - startedAt < MIN_PTT_MS) cancel('short')
          else finish()
        }
      } else if (event === 'ptt_abort') {
        if (state === 'recording' && source === 'ptt') cancel('abort')
      } else if (event === 'esc') {
        if (state === 'recording') cancel('esc')
      }
    }
  }
}

export function startHotkeys({ helperPath, args = [], machine, onNoPermission = () => {} }) {
  const proc = spawn(helperPath, args, { stdio: ['pipe', 'pipe', 'inherit'] })
  let buffer = ''
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      try {
        const { event } = JSON.parse(line)
        if (event === 'no_permission') onNoPermission()
        else if (event !== 'ready' && event !== 'combo') machine.handle(event)
      } catch { /* linha inválida, ignora */ }
    }
  })
  return {
    setRecordingState(on) { try { proc.stdin.write(`state ${on ? 'on' : 'off'}\n`) } catch { /* helper morto */ } },
    kill() { proc.kill() }
  }
}
