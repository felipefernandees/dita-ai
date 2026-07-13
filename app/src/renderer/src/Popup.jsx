import { useEffect, useRef, useState } from 'react'

export default function Popup() {
  const [phase, setPhase] = useState('idle') // idle|recording|processing|done|error
  const [result, setResult] = useState('')
  const canvasRef = useRef(null)
  const mediaRef = useRef({})

  useEffect(() => {
    window.dita.onCommand(async (ch, payload) => {
      if (ch === 'rec:start') await startRecording()
      if (ch === 'rec:stop') stopRecording(true)
      if (ch === 'rec:cancel') stopRecording(false)
      if (ch === 'rec:phase') setPhase(payload)
      if (ch === 'rec:result') { setResult(payload.text); setPhase('done') }
    })
  }, [])

  async function startRecording() {
    const settings = await window.dita.getSettings()
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
      stream.getTracks().forEach((t) => t.stop())
      if (mediaRef.current.keep) {
        const buf = await new Blob(chunks).arrayBuffer()
        window.dita.sendAudio(buf)
      }
    }
    recorder.start(250)
    mediaRef.current = { recorder, stream, keep: false }
    setPhase('recording')
    drawWave(stream)
  }

  function stopRecording(keep) {
    const m = mediaRef.current
    if (m.recorder && m.recorder.state !== 'inactive') {
      m.keep = keep
      m.recorder.stop()
    }
    if (m.raf) cancelAnimationFrame(m.raf)
    setPhase(keep ? 'processing' : 'idle')
  }

  function drawWave(stream) {
    const canvas = canvasRef.current
    const W = canvas.width
    const H = canvas.height
    const ctx2d = canvas.getContext('2d')
    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)

    // Barras simétricas: nascem no MEIO e propagam pras duas pontas.
    const BAR_W = 3
    const GAP = 3
    const HALF = Math.floor(W / 2 / (BAR_W + GAP))
    const loop = () => {
      analyser.getByteFrequencyData(data)
      ctx2d.clearRect(0, 0, W, H)
      ctx2d.fillStyle = '#f5f5f4'
      const cx = W / 2
      for (let i = 0; i < HALF; i++) {
        const v = data[i] / 255
        const h = Math.max(2.5, v * H * 0.9)
        const y = (H - h) / 2
        // centro pra direita e centro pra esquerda com a mesma altura
        ctx2d.fillRect(cx + i * (BAR_W + GAP), y, BAR_W, h)
        if (i > 0) ctx2d.fillRect(cx - i * (BAR_W + GAP) - BAR_W, y, BAR_W, h)
      }
      mediaRef.current.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  const pill = {
    height: '100%', borderRadius: 22, background: '#141414',
    display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8,
    color: '#eee', fontFamily: 'system-ui', fontSize: 12,
    boxShadow: '0 4px 18px rgba(0,0,0,.5)', boxSizing: 'border-box'
  }

  if (phase === 'done') {
    return (
      <div style={{ ...pill, justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result}</span>
        <button
          onClick={() => { window.dita.copyText(result); window.dita.closePopup() }}
          style={{ background: '#3a3a3a', color: '#fff', border: 0, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12 }}
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
        style={{ background: '#2a2a2a', color: '#bbb', border: 0, borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >✕</button>
      {phase === 'processing'
        ? <span style={{ flex: 1, textAlign: 'center', color: '#aaa' }}>Transcrevendo…</span>
        : <canvas ref={canvasRef} width={150} height={30} style={{ flex: 1 }} />}
    </div>
  )
}
