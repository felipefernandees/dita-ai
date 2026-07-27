import { useEffect, useRef, useState } from 'react'

// Paleta clonada do Wispr Flow (near-black / branco / cinza)
const BG = '#1a1a1c'
const WHITE = '#f5f5f7'
const GRAY = '#8e8e93'
const BTN = '#48484a'
const XBG = 'rgba(255,255,255,0.14)'

// POR QUE OS BOTÕES DAQUI USAM onMouseUp E NÃO onClick
//
// A janela do popup é criada com `focusable: false` — ela NÃO PODE roubar o
// foco, senão o app onde você está ditando perde o cursor no meio da frase.
// No Windows isso vira WS_EX_NOACTIVATE, e clicar numa janela não-ativável faz
// o sistema mandar WM_MOUSEACTIVATE; para essas janelas o Chromium responde
// MA_NOACTIVATEANDEAT, e o "EAT" é literal: a mensagem de mouse-down é
// DESCARTADA. Só o mouse-up chega à página.
//
// Um `click` no DOM exige down E up no mesmo elemento. Sem o down, o evento
// nunca se forma e o onClick nunca dispara — os botões ficam inertes.
//
// Medido no app real (webContents 'input-event', ~27 cliques do usuário):
// 1 mouseDown contra 27 mouseUp. O up é confiável; o down não é.
//
// No macOS o onClick funcionava porque o AppKit não come o clique de ativação
// desse jeito — por isso o bug só apareceu no port.
export default function Popup() {
  const [phase, setPhase] = useState('idle') // idle|recording|processing|done|error|cancelled
  const [result, setResult] = useState('')
  const [pasted, setPasted] = useState(false)
  const [shown, setShown] = useState(false)
  const [session, setSession] = useState(0) // re-arma o equalizador a cada gravação
  const canvasRef = useRef(null)
  const mediaRef = useRef({})

  useEffect(() => {
    window.dita.onCommand(async (ch, payload) => {
      if (ch === 'rec:start') await startRecording()
      if (ch === 'rec:stop') stopRecording(true)
      if (ch === 'rec:cancel') { stopRecording(false); setShown(false) }
      if (ch === 'rec:phase') setPhase(payload)
      if (ch === 'rec:result') { setResult(payload.text); setPasted(!!payload.pasted); setPhase('done') }
      if (ch === 'rec:cancelled') setPhase('cancelled')
      if (ch === 'rec:closing') setShown(false)
    })
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const canvas = canvasRef.current
    const analyser = mediaRef.current.analyser
    if (!canvas || !analyser) return

    analyser.smoothingTimeConstant = 0.85
    const ctx = canvas.getContext('2d')
    const data = new Uint8Array(analyser.frequencyBinCount)
    const dpr = devicePixelRatio
    const BAR = 3 * dpr, GAP = 3.5 * dpr
    let W = 0, H = 0, half = 0, smooth = new Float32Array(0)

    // o canvas pode ainda não ter layout no primeiro frame: mede a cada volta
    // e só desenha quando tiver largura, em vez de travar em zero pra sempre
    const measure = () => {
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
      if (w === W && h === H) return half > 0
      W = w; H = h
      canvas.width = W; canvas.height = H
      half = Math.max(0, Math.floor((W / 2 - GAP / 2) / (BAR + GAP)))
      smooth = new Float32Array(half)
      return half > 0
    }

    let raf
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!measure()) return
      analyser.getByteFrequencyData(data)
      const cx = W / 2
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = WHITE
      for (let i = 0; i < half; i++) {
        const idx = Math.min(data.length - 1, Math.floor((i / half) * 24) + 1)
        const v = Math.pow(data[idx] / 255, 1.4)
        const target = Math.max(2 * dpr, v * H * 0.72)
        smooth[i] += (target - smooth[i]) * 0.4
        const h = smooth[i]
        const y = (H - h) / 2
        ctx.fillRect(cx + GAP / 2 + i * (BAR + GAP), y, BAR, h)
        ctx.fillRect(cx - GAP / 2 - BAR - i * (BAR + GAP), y, BAR, h)
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [phase, session])

  function releaseMic() {
    const m = mediaRef.current
    try { m.stream?.getTracks().forEach((t) => t.stop()) } catch { /* já parado */ }
    try { m.audioCtx?.close() } catch { /* já fechado */ }
    if (m.watchdog) clearTimeout(m.watchdog)
  }

  async function startRecording() {
    releaseMic()
    const settings = await window.dita.getSettings()
    const audioInput = settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : true
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: audioInput }) }
    catch { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    const chunks = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.onstop = async () => {
      if (mediaRef.current.keep) {
        const buf = await new Blob(chunks).arrayBuffer()
        window.dita.sendAudio(buf)
      }
      releaseMic()
    }
    recorder.start(250)
    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    // Rede de segurança contra microfone preso, NÃO limite de fala: 30 min.
    // Chama o mesmo caminho do botão check (pelo main), pra máquina de estado
    // não ficar dessincronizada e o áudio ser transcrito e salvo, nunca jogado
    // fora. O Felipe fala 3+ minutos direto: o limite não pode cortar ele.
    const watchdog = setTimeout(() => window.dita.finish(), 30 * 60000)
    mediaRef.current = { recorder, stream, analyser, audioCtx, watchdog, keep: false }
    setSession((n) => n + 1)
    setPhase('recording')
    requestAnimationFrame(() => setShown(true))
  }

  function stopRecording(keep) {
    const m = mediaRef.current
    if (m.recorder && m.recorder.state !== 'inactive') { m.keep = keep; m.recorder.stop() }
    else releaseMic()
    if (keep) setPhase('processing')
    else if (phase === 'recording') setPhase('idle')
  }

  const wrap = {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: shown ? 1 : 0, transform: shown ? 'scale(1)' : 'scale(0.96)',
    transition: 'opacity .12s ease, transform .14s ease'
  }
  const container = (tall) => ({
    width: '100%', height: '100%', boxSizing: 'border-box', background: BG,
    borderRadius: tall ? 22 : 999, display: 'flex', flexDirection: tall ? 'column' : 'row',
    alignItems: 'center', color: WHITE, fontFamily: "'General Sans', ui-sans-serif, system-ui, sans-serif",
    boxShadow: '0 10px 30px rgba(0,0,0,.5)', overflow: 'hidden'
  })
  const circleBase = {
    border: 0, borderRadius: '50%', width: 24, height: 24, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0
  }
  const circleX = { ...circleBase, background: XBG }
  const circleCheck = { ...circleBase, background: WHITE }
  const IconX = (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#d0d0d2" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
  const IconCheck = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a1a1c" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  )
  const grayBtn = {
    background: BTN, color: WHITE, border: 0, borderRadius: 9, padding: '7px 15px',
    cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0
  }

  // Barras estáticas do equalizador (ícone do header do card)
  const eqIcon = (
    <svg width="15" height="15" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
      {[7, 11, 16, 9, 5].map((h, i) => (
        <rect key={i} x={2 + i * 3.6} width="2.2" rx="1.1" y={(20 - h) / 2} height={h} fill={GRAY} />
      ))}
    </svg>
  )

  let body
  if (phase === 'done' && !pasted) {
    body = (
      <div style={{ ...container(true), padding: '16px 18px', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          {eqIcon}
          <span style={{ flex: 1, color: GRAY, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Selecione uma caixa de texto e cole com o botão
          </span>
          <button onMouseUp={() => window.dita.closePopup()} style={circleX}>{IconX}</button>
        </div>
        <div style={{ flex: 1, width: '100%', fontSize: 17, lineHeight: 1.35, overflow: 'hidden' }}>{result}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button onMouseUp={() => { window.dita.copyText(result); window.dita.closePopup() }} style={{ ...grayBtn, padding: '9px 18px', fontSize: 13.5 }}>Copiar Ditado</button>
        </div>
      </div>
    )
  } else if (phase === 'done' && pasted) {
    body = (
      <div style={{ ...container(false), padding: '0 14px', justifyContent: 'center', gap: 8 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={GRAY} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Colado</span>
      </div>
    )
  } else if (phase === 'cancelled') {
    body = (
      <div style={{ ...container(false), padding: '0 8px 0 16px', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: GRAY, fontSize: 13 }}>Transcrição cancelada</span>
        <button onMouseUp={() => window.dita.undo()} style={grayBtn}>Anular</button>
      </div>
    )
  } else if (phase === 'error') {
    body = (
      <div style={{ ...container(false), padding: '0 16px', justifyContent: 'center' }}>
        <span style={{ color: '#ff9f9f', fontSize: 13 }}>Falha. Áudio preservado.</span>
      </div>
    )
  } else if (phase === 'processing') {
    body = (
      <div style={{ ...container(false), padding: '0 10px', gap: 10 }}>
        <button onMouseUp={() => window.dita.cancelHard()} style={circleX}>{IconX}</button>
        <span style={{ flex: 1, textAlign: 'center', color: GRAY, fontSize: 13 }}>Transcrevendo…</span>
        <div style={{ width: 24, flexShrink: 0 }} />
      </div>
    )
  } else {
    body = (
      <div style={{ ...container(false), padding: '0 10px', gap: 8 }}>
        <button onMouseUp={() => window.dita.cancelHard()} style={circleX}>{IconX}</button>
        <canvas ref={canvasRef} style={{ flex: 1, height: '100%' }} />
        <button onMouseUp={() => window.dita.finish()} style={circleCheck}>{IconCheck}</button>
      </div>
    )
  }

  return <div style={wrap}>{body}</div>
}
