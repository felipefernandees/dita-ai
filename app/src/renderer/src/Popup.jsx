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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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
    const ctx2d = canvasRef.current.getContext('2d')
    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const loop = () => {
      analyser.getByteFrequencyData(data)
      ctx2d.clearRect(0, 0, 180, 40)
      ctx2d.fillStyle = '#f5f5f4'
      for (let i = 0; i < 24; i++) {
        const h = Math.max(3, (data[i] / 255) * 34)
        ctx2d.fillRect(i * 7.5, 20 - h / 2, 4, h)
      }
      mediaRef.current.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  const pill = {
    height: 56, margin: 8, borderRadius: 28, background: '#141414',
    display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10,
    color: '#eee', fontFamily: 'system-ui', fontSize: 13,
    boxShadow: '0 6px 24px rgba(0,0,0,.45)'
  }

  if (phase === 'done') {
    return (
      <div style={{ ...pill, justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result}</span>
        <button
          onClick={() => { window.dita.copyText(result); window.dita.closePopup() }}
          style={{ background: '#3a3a3a', color: '#fff', border: 0, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
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
        style={{ background: '#2a2a2a', color: '#bbb', border: 0, borderRadius: '50%', width: 26, height: 26, cursor: 'pointer' }}
      >✕</button>
      {phase === 'processing'
        ? <span style={{ flex: 1, textAlign: 'center', color: '#aaa' }}>Transcrevendo…</span>
        : <canvas ref={canvasRef} width={180} height={40} style={{ flex: 1 }} />}
    </div>
  )
}
