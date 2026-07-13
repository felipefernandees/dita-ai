import { useEffect, useRef, useState } from 'react'

export default function Popup() {
  const [phase, setPhase] = useState('idle') // idle|recording|processing|done|error
  const [result, setResult] = useState('')
  const [waveColor, setWaveColor] = useState('#F4F2EC')
  const [bgColor, setBgColor] = useState('#221C33')
  const [radius, setRadius] = useState(999)
  const canvasRef = useRef(null)
  const mediaRef = useRef({})
  const colorRef = useRef('#F4F2EC')

  useEffect(() => {
    window.dita.onCommand(async (ch, payload) => {
      if (ch === 'rec:start') await startRecording()
      if (ch === 'rec:stop') stopRecording(true)
      if (ch === 'rec:cancel') stopRecording(false)
      if (ch === 'rec:phase') setPhase(payload)
      if (ch === 'rec:result') { setResult(payload.text); setPhase('done') }
    })
  }, [])

  // O desenho do waveform só começa quando o canvas EXISTE no DOM
  // (antes havia uma corrida: drawWave rodava antes do React montar o canvas
  // e o popup ficava preto sem barras)
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

    // Barras simétricas nascendo EXATAMENTE no centro: o primeiro par fica
    // colado no meio (GAP/2 pra cada lado), sem pixel morto central
    const BAR_W = 3 * devicePixelRatio
    const GAP = 3 * devicePixelRatio
    const half = Math.floor((W / 2 - GAP / 2) / (BAR_W + GAP))
    const cx = W / 2

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
    releaseMic() // garante que nenhum stream anterior ficou aberto
    const settings = await window.dita.getSettings()
    colorRef.current = settings.waveColor || '#F4F2EC'
    setWaveColor(colorRef.current)
    setBgColor(settings.popupBg || '#221C33')
    setRadius(settings.popupRadius != null ? Number(settings.popupRadius) : 999)
    const audio = settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : true
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio })
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }) // mic salvo sumiu, cai no padrão
    }
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    const chunks = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.onstop = async () => {
      if (mediaRef.current.keep) {
        const buf = await new Blob(chunks).arrayBuffer()
        window.dita.sendAudio(buf)
      }
      releaseMic() // solta o microfone SEMPRE (fim do laranja no macOS)
    }
    recorder.start(250)

    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    audioCtx.createMediaStreamSource(stream).connect(analyser)

    // watchdog: gravação nunca fica pendurada segurando o mic por mais de 3 min
    const watchdog = setTimeout(() => stopRecording(true), 180000)
    mediaRef.current = { recorder, stream, analyser, audioCtx, watchdog, keep: false }
    setPhase('recording')
  }

  function stopRecording(keep) {
    const m = mediaRef.current
    if (m.recorder && m.recorder.state !== 'inactive') {
      m.keep = keep
      m.recorder.stop()
    } else {
      releaseMic() // não havia recorder ativo, ainda assim solta qualquer stream órfão
    }
    setPhase(keep ? 'processing' : 'idle')
  }

  const pill = {
    height: '100vh', width: '100vw', borderRadius: radius, background: bgColor,
    display: 'flex', alignItems: 'center', padding: '0 8px', gap: 7,
    color: '#F4F2EC', fontFamily: "'General Sans', ui-sans-serif, system-ui, sans-serif",
    fontSize: 12, boxSizing: 'border-box', border: '1px solid rgba(255,255,255,0.08)'
  }

  if (phase === 'done') {
    return (
      <div style={{ ...pill, justifyContent: 'space-between', padding: '0 6px 0 12px' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result}</span>
        <button
          onClick={() => { window.dita.copyText(result); window.dita.closePopup() }}
          style={{ background: '#ECFF77', color: '#0E0E0E', border: 0, borderRadius: 999, padding: '5px 11px', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600, fontFamily: "'General Sans', system-ui" }}
        >Copiar Ditado</button>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={{ ...pill, justifyContent: 'center', color: '#f0a0a0' }}>
        Falha na transcrição. Áudio preservado.
      </div>
    )
  }

  return (
    <div style={pill}>
      <button
        onClick={() => window.dita.closePopup()}
        style={{ background: '#2C2542', color: '#A8A4B5', border: 0, borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
      >✕</button>
      {phase === 'processing'
        ? <span style={{ flex: 1, textAlign: 'center', color: '#aaa' }}>Transcrevendo…</span>
        : <canvas ref={canvasRef} style={{ flex: 1, height: '70%' }} />}
    </div>
  )
}
