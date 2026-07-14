import { useEffect, useRef, useState } from 'react'

// Paleta clonada do Wispr Flow (near-black / branco / cinza)
const BG = '#1a1a1c'
const WHITE = '#f5f5f7'
const GRAY = '#8e8e93'
const BTN = '#48484a'
const XBG = 'rgba(255,255,255,0.14)'

export default function Popup() {
  const [phase, setPhase] = useState('idle') // idle|recording|processing|done|error|cancelled
  const [result, setResult] = useState('')
  const [pasted, setPasted] = useState(false)
  const [shown, setShown] = useState(false)
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

    canvas.width = canvas.clientWidth * devicePixelRatio
    canvas.height = canvas.clientHeight * devicePixelRatio
    analyser.smoothingTimeConstant = 0.85
    const ctx = canvas.getContext('2d')
    const data = new Uint8Array(analyser.frequencyBinCount)
    const W = canvas.width, H = canvas.height, dpr = devicePixelRatio
    const BAR = 3 * dpr, GAP = 3.5 * dpr
    const cx = W / 2
    const half = Math.max(1, Math.floor((W / 2 - GAP / 2) / (BAR + GAP)))
    const smooth = new Float32Array(half)

    let raf
    const loop = () => {
      analyser.getByteFrequencyData(data)
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
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [phase])

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
    const watchdog = setTimeout(() => stopRecording(true), 180000)
    mediaRef.current = { recorder, stream, analyser, audioCtx, watchdog, keep: false }
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
  const circleX = {
    background: XBG, color: '#d0d0d2', border: 0, borderRadius: '50%', width: 24, height: 24,
    cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0
  }
  const circleCheck = {
    background: WHITE, color: '#1a1a1c', border: 0, borderRadius: '50%', width: 24, height: 24,
    cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0
  }
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
          <button onClick={() => window.dita.closePopup()} style={circleX}>✕</button>
        </div>
        <div style={{ flex: 1, width: '100%', fontSize: 17, lineHeight: 1.35, overflow: 'hidden' }}>{result}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={() => { window.dita.copyText(result); window.dita.closePopup() }} style={{ ...grayBtn, padding: '9px 18px', fontSize: 13.5 }}>Copiar Ditado</button>
        </div>
      </div>
    )
  } else if (phase === 'done' && pasted) {
    body = (
      <div style={{ ...container(false), padding: '0 14px', justifyContent: 'center', gap: 8 }}>
        <span style={{ color: GRAY, fontSize: 13 }}>✓</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Colado</span>
      </div>
    )
  } else if (phase === 'cancelled') {
    body = (
      <div style={{ ...container(false), padding: '0 8px 0 16px', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: GRAY, fontSize: 13 }}>Transcrição cancelada</span>
        <button onClick={() => window.dita.undo()} style={grayBtn}>Anular</button>
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
        <button onClick={() => window.dita.cancelHard()} style={circleX}>✕</button>
        <span style={{ flex: 1, textAlign: 'center', color: GRAY, fontSize: 13 }}>Transcrevendo…</span>
        <div style={{ width: 24, flexShrink: 0 }} />
      </div>
    )
  } else {
    body = (
      <div style={{ ...container(false), padding: '0 10px', gap: 8 }}>
        <button onClick={() => window.dita.cancelHard()} style={circleX}>✕</button>
        <canvas ref={canvasRef} style={{ flex: 1, height: '100%' }} />
        <button onClick={() => window.dita.finish()} style={circleCheck}>✓</button>
      </div>
    )
  }

  return <div style={wrap}>{body}</div>
}
