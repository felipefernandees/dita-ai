import { useEffect, useRef, useState } from 'react'

export default function Popup() {
  const [phase, setPhase] = useState('idle') // idle|recording|processing|done|error
  const [result, setResult] = useState('')
  const [shown, setShown] = useState(false)
  const [waveColor, setWaveColor] = useState('#F4F2EC')
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
      if (ch === 'rec:result') { setResult(payload.text); setPhase('done') }
      if (ch === 'rec:closing') animateOut()
    })
  }, [])

  function animateOut() {
    setShown(false)
  }

  useEffect(() => {
    if (phase !== 'recording') return
    const canvas = canvasRef.current
    const analyser = mediaRef.current.analyser
    if (!canvas || !analyser) return

    canvas.width = canvas.clientWidth * devicePixelRatio
    canvas.height = canvas.clientHeight * devicePixelRatio
    const ctx2d = canvas.getContext('2d')
    const data = new Uint8Array(analyser.frequencyBinCount)
    const W = canvas.width
    const H = canvas.height
    const BAR_W = 3 * devicePixelRatio
    const GAP = 3 * devicePixelRatio
    const cx = W / 2
    // margem lateral que acompanha o arredondamento, pra as barras nunca
    // entrarem na quina e serem cortadas
    const cornerClear = Math.min(radiusRef.current * devicePixelRatio, H / 2) + 6 * devicePixelRatio
    const usable = W / 2 - cornerClear
    const half = Math.max(1, Math.floor((usable - GAP / 2) / (BAR_W + GAP)))

    let raf
    const loop = () => {
      analyser.getByteFrequencyData(data)
      ctx2d.clearRect(0, 0, W, H)
      ctx2d.fillStyle = colorRef.current
      for (let i = 0; i < half; i++) {
        const v = data[i] / 255
        const h = Math.max(2 * devicePixelRatio, v * H * 0.9)
        const y = (H - h) / 2
        ctx2d.fillRect(cx + GAP / 2 + i * (BAR_W + GAP), y, BAR_W, h)
        ctx2d.fillRect(cx - GAP / 2 - BAR_W - i * (BAR_W + GAP), y, BAR_W, h)
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
    setWaveColor(colorRef.current)
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
    // dispara a animação de entrada no próximo frame
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
    setPhase(keep ? 'processing' : 'idle')
  }

  const wrap = {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: shown ? 1 : 0,
    transform: shown ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.9)',
    transition: 'opacity .2s ease, transform .3s cubic-bezier(.2,.9,.25,1)'
  }

  const pill = {
    height: '92%', width: '100%', boxSizing: 'border-box',
    borderRadius: radius, background: bgColor, border: 'none',
    display: 'flex', alignItems: 'center', padding: '0 7px', gap: 7, overflow: 'hidden',
    color: '#F4F2EC', fontFamily: "'General Sans', ui-sans-serif, system-ui, sans-serif", fontSize: 12,
    boxShadow: '0 6px 22px rgba(0,0,0,.5)',
    transition: 'background .2s ease, border-radius .2s ease'
  }

  const xBtn = {
    background: '#2C2542', color: '#A8A4B5', border: 0, borderRadius: '50%', width: 20, height: 20,
    cursor: 'pointer', fontSize: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2
  }
  const copyBtn = {
    background: '#ECFF77', color: '#0E0E0E', border: 0, borderRadius: Math.min(radius, 999), padding: '0 13px', height: '68%',
    lineHeight: 1, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0, display: 'flex', alignItems: 'center'
  }

  const pillRel = { ...pill, position: 'relative', justifyContent: 'center', padding: '0 8px' }

  return (
    <div style={wrap}>
      <div style={pillRel}>
        <button onClick={() => window.dita.closePopup()} style={xBtn}>✕</button>
        {phase === 'done' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', paddingLeft: 24 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>{result}</span>
            <button onClick={() => { window.dita.copyText(result); window.dita.closePopup() }} style={copyBtn}>Copiar Ditado</button>
          </div>
        ) : phase === 'error' ? (
          <span style={{ color: '#f0a0a0', paddingLeft: 20 }}>Falha. Áudio preservado.</span>
        ) : phase === 'processing' ? (
          <span style={{ color: '#A8A4B5', paddingLeft: 20 }}>Transcrevendo…</span>
        ) : (
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        )}
      </div>
    </div>
  )
}
