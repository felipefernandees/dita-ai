import { useEffect, useRef, useState } from 'react'

export default function Popup() {
  const [phase, setPhase] = useState('idle') // idle|recording|processing|done|error|cancelled
  const [result, setResult] = useState('')
  const [pasted, setPasted] = useState(false)
  const [shown, setShown] = useState(false)
  const [bgColor, setBgColor] = useState('#221C33')
  const [radius, setRadius] = useState(999)
  const canvasRef = useRef(null)
  const mediaRef = useRef({})
  const colorRef = useRef('#F4F2EC')
  const radiusRef = useRef(999)

  useEffect(() => {
    window.dita.onCommand(async (ch, payload) => {
      if (ch === 'rec:start') await startRecording()
      if (ch === 'rec:stop') stopRecording(true)
      if (ch === 'rec:cancel') { stopRecording(false); animateOut() }
      if (ch === 'rec:phase') setPhase(payload)
      if (ch === 'rec:result') { setResult(payload.text); setPasted(!!payload.pasted); setPhase('done') }
      if (ch === 'rec:cancelled') setPhase('cancelled') // o áudio já foi capturado via rec:stop
      if (ch === 'rec:closing') animateOut()
    })
  }, [])

  function animateOut() { setShown(false) }

  useEffect(() => {
    if (phase !== 'recording') return
    const canvas = canvasRef.current
    const analyser = mediaRef.current.analyser
    if (!canvas || !analyser) return

    canvas.width = canvas.clientWidth * devicePixelRatio
    canvas.height = canvas.clientHeight * devicePixelRatio
    analyser.smoothingTimeConstant = 0.88 // resposta mais suave, menos "pulo"
    const ctx2d = canvas.getContext('2d')
    const data = new Uint8Array(analyser.frequencyBinCount)
    const W = canvas.width
    const H = canvas.height
    const dpr = devicePixelRatio
    const BAR_W = 3 * dpr
    const GAP = 3.5 * dpr
    // área útil = da direita do X até a margem da quina direita (preenche o resto)
    const xClear = 32 * dpr
    const cornerClear = Math.min(radiusRef.current * dpr, H / 2) + 5 * dpr
    const left = xClear
    const right = W - cornerClear
    const center = (left + right) / 2
    const halfW = (right - left) / 2
    const half = Math.max(1, Math.floor((halfW - GAP / 2) / (BAR_W + GAP)))
    // alturas suavizadas entre frames pra ficar mais fluido
    const smooth = new Float32Array(half)

    let raf
    const loop = () => {
      analyser.getByteFrequencyData(data)
      ctx2d.clearRect(0, 0, W, H)
      ctx2d.fillStyle = colorRef.current
      for (let i = 0; i < half; i++) {
        // amostra espalhada pelo espectro; gamma 1.6 deixa menos sensível
        const idx = Math.min(data.length - 1, Math.floor((i / half) * 22) + 1)
        const v = Math.pow(data[idx] / 255, 1.6)
        const target = Math.max(2 * dpr, v * H * 0.62)
        smooth[i] += (target - smooth[i]) * 0.35
        const h = smooth[i]
        const y = (H - h) / 2
        ctx2d.fillRect(center + GAP / 2 + i * (BAR_W + GAP), y, BAR_W, h)
        ctx2d.fillRect(center - GAP / 2 - BAR_W - i * (BAR_W + GAP), y, BAR_W, h)
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
    colorRef.current = settings.waveColor || '#F4F2EC'
    setBgColor(settings.popupBg || '#221C33')
    const r = settings.popupRadius != null ? Number(settings.popupRadius) : 999
    setRadius(r); radiusRef.current = r
    const audioInput = settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : true
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioInput })
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    }
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
    if (m.recorder && m.recorder.state !== 'inactive') {
      m.keep = keep
      m.recorder.stop()
    } else {
      releaseMic()
    }
    if (!keep && phase === 'recording') setPhase('idle')
    else if (keep) setPhase('processing')
  }

  const wrap = {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: shown ? 1 : 0,
    transform: shown ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.92)',
    transition: 'opacity .13s ease, transform .18s cubic-bezier(.22,.95,.3,1)'
  }
  const pill = {
    height: '100%', width: '100%', boxSizing: 'border-box',
    borderRadius: radius, background: bgColor, position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px', overflow: 'hidden',
    color: '#F4F2EC', fontFamily: "'General Sans', ui-sans-serif, system-ui, sans-serif", fontSize: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,.55)',
    transition: 'background .2s ease, border-radius .15s ease'
  }
  const xBtn = {
    background: 'rgba(255,255,255,0.10)', color: '#C9C6D4', border: 0, borderRadius: '50%', width: 20, height: 20,
    cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', zIndex: 2
  }
  const copyBtn = {
    background: '#ECFF77', color: '#0E0E0E', border: 0, borderRadius: 9, padding: '6px 14px',
    cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0
  }
  const undoBtn = { ...copyBtn, background: 'rgba(255,255,255,0.12)', color: '#F4F2EC' }

  return (
    <div style={wrap}>
      <div style={pill}>
        {phase === 'done' && !pasted ? (
          <>
            <button onClick={() => window.dita.closePopup()} style={xBtn}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', paddingLeft: 26 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.92 }}>{result}</span>
              <button onClick={() => { window.dita.copyText(result); window.dita.closePopup() }} style={copyBtn}>Copiar Ditado</button>
            </div>
          </>
        ) : phase === 'done' && pasted ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#F4F2EC', fontWeight: 600 }}>
            <span style={{ fontSize: 13, color: '#A8A4B5' }}>✓</span> Colado
          </span>
        ) : phase === 'cancelled' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 4 }}>
            <span style={{ color: '#A8A4B5' }}>Transcrição cancelada</span>
            <button onClick={() => window.dita.undo()} style={undoBtn}>Anular</button>
          </div>
        ) : phase === 'error' ? (
          <span style={{ color: '#f0a0a0' }}>Falha. Áudio preservado.</span>
        ) : phase === 'processing' ? (
          <>
            <button onClick={() => window.dita.closePopup()} style={xBtn}>✕</button>
            <span style={{ color: '#A8A4B5', paddingLeft: 20 }}>Transcrevendo…</span>
          </>
        ) : (
          <>
            <button onClick={() => window.dita.closePopup()} style={xBtn}>✕</button>
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          </>
        )}
      </div>
    </div>
  )
}
