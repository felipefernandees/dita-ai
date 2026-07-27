import { useEffect, useRef, useState } from 'react'
import { TAXA_ALVO, amostrasPorChunk, blocoParaPcm16, taxaUtilizavel } from './pcm'
// `?url` faz o Vite tratar o worklet como ASSET, não como módulo do bundle: ele
// sai como arquivo próprio em out/renderer/assets e esta variável vira o
// caminho dele. É o único jeito que funciona nos dois mundos — em dev o Vite
// serve pelo dev server, no empacotado o addModule resolve o file:// ao lado do
// index.html. Importar o worklet normalmente o enfiaria dentro do bundle do
// React, e o AudioWorkletGlobalScope não tem `document` nem `window` para rodar
// isso; um `addModule` apontando para o próprio bundle explode em runtime.
import urlWorklet from './pcm-worklet.js?url'

// Paleta clonada do Wispr Flow (near-black / branco / cinza)
const BG = '#1a1a1c'
const WHITE = '#f5f5f7'
const GRAY = '#8e8e93'
const BTN = '#48484a'
const XBG = 'rgba(255,255,255,0.14)'
const ALERTA = '#ff9f9f'

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
  const [aoVivo, setAoVivo] = useState('')   // texto que o Gemini já devolveu neste ditado
  const [rtErro, setRtErro] = useState('')   // falha do motor remoto, visível em vez de silenciosa
  const canvasRef = useRef(null)
  const mediaRef = useRef({})

  useEffect(() => {
    window.dita.onCommand(async (ch, payload) => {
      if (ch === 'rec:start') await startRecording(payload)
      if (ch === 'rec:stop') stopRecording(true)
      if (ch === 'rec:cancel') { stopRecording(false); setShown(false) }
      if (ch === 'rec:phase') setPhase(payload)
      if (ch === 'rec:result') { setResult(payload.text); setPasted(!!payload.pasted); setPhase('done') }
      if (ch === 'rec:cancelled') setPhase('cancelled')
      if (ch === 'rec:closing') setShown(false)
      // O payload é o texto ACUMULADO, não o incremento: substituir é o certo.
      if (ch === 'rt:texto') setAoVivo(String(payload ?? ''))
      if (ch === 'rt:erro') setRtErro(String(payload ?? '').trim())
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

  // close() devolve uma PROMISE, então `try { ctx.close() } catch {}` não pega
  // nada: a rejeição acontece depois do bloco já ter saído. E ela acontece —
  // releaseMic roda mais de uma vez por ditado (no onstop do recorder e de novo
  // no início do ditado seguinte), e a segunda chamada cai em "Cannot close a
  // closed AudioContext". Medido: aparecia como `Uncaught (in promise)
  // InvalidStateError` no console do popup a cada gravação.
  function fecharContexto(ctx) {
    try { ctx?.close()?.catch(() => { /* já estava fechado */ }) } catch { /* nem chegou a abrir */ }
  }

  function releaseMic() {
    const m = mediaRef.current
    // Marca ANTES de desmontar. `iniciarStreaming` é assíncrono (carregar o
    // worklet leva alguns milissegundos) e um ditado curto pode terminar antes
    // dele voltar; sem esta bandeira ele instalaria um contexto de 16 kHz num
    // ditado que já acabou, e esse contexto ficaria aberto para sempre.
    m.encerrado = true
    try { m.stream?.getTracks().forEach((t) => t.stop()) } catch { /* já parado */ }
    // O port precisa fechar explicitamente: enquanto ele estiver aberto o
    // worklet segue como raiz viva pro coletor de lixo, mesmo com o contexto
    // fechado.
    try { m.rtNode?.port.close() } catch { /* já fechado */ }
    try { m.rtNode?.disconnect() } catch { /* já solto */ }
    fecharContexto(m.rtCtx)
    fecharContexto(m.audioCtx)
    if (m.watchdog) clearTimeout(m.watchdog)
    m.rtNode = null
    m.rtCtx = null
  }

  // Segundo grafo de áudio, aberto SÓ quando o ditado é remoto, que fatia o
  // microfone em PCM16 16 kHz mono e despacha enquanto o usuário ainda fala.
  //
  // POR QUE UM SEGUNDO AudioContext, E NÃO O MESMO DO EQUALIZADOR
  //
  // O contexto do equalizador nasce na taxa nativa do dispositivo (48 kHz de
  // praxe) e o desenho depende disso: com fftSize 64 o loop lê os bins 1..24,
  // que a 48 kHz cobrem ~750 Hz a 18 kHz. Forçar aquele contexto a 16 kHz
  // remapearia os mesmos bins para ~250 Hz a 6 kHz e as barras passariam a se
  // mexer de outro jeito — uma regressão visual no MODO LOCAL, que é o padrão
  // do app e não tem nada a ver com esta feature. Um contexto só também teria
  // que existir em todo ditado, inclusive nos locais, e amarraria a aparência
  // do equalizador à taxa que o navegador resolvesse conceder aqui. Dois
  // contextos custam um grafo a mais durante o ditado remoto, os dois fecham no
  // releaseMic, e cada um fica com uma responsabilidade só.
  async function iniciarStreaming(stream) {
    const sessao = mediaRef.current
    let ctx
    try {
      // Pedido, não garantia: pedir 16 kHz faz o Chromium reamostrar o
      // microfone sozinho, mas ele pode devolver a taxa do dispositivo.
      ctx = new AudioContext({ sampleRate: TAXA_ALVO })
      const taxa = ctx.sampleRate
      if (!taxaUtilizavel(taxa)) throw new Error(`taxa de captura inutilizável: ${taxa} Hz`)

      await ctx.audioWorklet.addModule(urlWorklet)
      if (sessao.encerrado) { fecharContexto(ctx); return }

      const no = new AudioWorkletNode(ctx, 'coletor-pcm', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        // É AQUI que o mono é garantido: 'explicit' com channelCount 1 faz o
        // grafo rebaixar um microfone estéreo antes do process() ver o áudio.
        // Ler só inputs[0][0] de um nó estéreo mandaria apenas o canal
        // esquerdo, que não é a mesma coisa — metade do sinal iria embora.
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { amostrasPorBloco: amostrasPorChunk(taxa) }
      })

      no.port.onmessage = (e) => {
        if (sessao.encerrado) return
        const bloco = e.data instanceof Float32Array ? e.data : new Float32Array(e.data)
        // Reamostra (se a taxa não veio 16 kHz) e converte com o MESMO código
        // que os testes exercitam. Roda 4x por segundo — barato o bastante para
        // não valer duplicar a lógica dentro do worklet.
        try { window.dita.sendRealtimeAudio(blocoParaPcm16(bloco, taxa)) } catch { /* IPC caiu: o webm cobre */ }
      }

      ctx.createMediaStreamSource(stream).connect(no)
      // Saída silenciada ligada ao destino de propósito. Um nó de áudio só é
      // processado se alguma coisa puxa por ele: sem um caminho até o
      // destination o grafo pode nunca ser renderizado, e o process() do
      // worklet nunca rodaria — falha total e silenciosa. O ganho zero garante
      // que nada disso volte pelos alto-falantes como eco.
      const mudo = ctx.createGain()
      mudo.gain.value = 0
      no.connect(mudo).connect(ctx.destination)

      if (sessao.encerrado) { fecharContexto(ctx); return }
      sessao.rtCtx = ctx
      sessao.rtNode = no
    } catch (err) {
      // Falhar aqui NÃO é perder o ditado: o MediaRecorder continua gravando o
      // webm e o main cai no whisper local se o Gemini não entregar texto. Por
      // isso a mensagem é informativa e não interrompe a gravação.
      console.error('streaming em tempo real:', err)
      fecharContexto(ctx)
      setRtErro('Tempo real indisponível. Usando a transcrição local.')
    }
  }

  async function startRecording(payload) {
    releaseMic()
    setAoVivo('')
    setRtErro('')
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
    mediaRef.current = { recorder, stream, analyser, audioCtx, watchdog, keep: false, encerrado: false }
    setSession((n) => n + 1)
    setPhase('recording')
    requestAnimationFrame(() => setShown(true))
    // O MediaRecorder acima continua rodando no ditado remoto, de propósito: o
    // main guarda esse webm e o joga no whisper local se o Gemini não devolver
    // texto nenhum. É a rede de segurança — o streaming é um extra por cima
    // dela, nunca um substituto, e por isso é disparado DEPOIS de a gravação já
    // estar de pé e sem `await` segurando o popup.
    if (payload?.engine === 'gemini') iniciarStreaming(stream)
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

  // A PÍLULA TEM 214x40 E NÃO PODE CRESCER (o tamanho é fixado no main, em
  // recorder-window.js). Então o texto ao vivo não ganha linha própria: ele
  // divide a faixa do meio com o equalizador, que encolhe de "todo o espaço
  // livre" para uma tira de 26px assim que a primeira palavra chega.
  //
  // Por que o equalizador não some de vez: ele é o único sinal de "o microfone
  // está te ouvindo". Num trecho de silêncio, ou quando o Gemini demora, um
  // meio vazio ficaria indistinguível de um app travado.
  //
  // Por que alinhado à direita e cortado na esquerda: o transcrito só cresce, e
  // o que interessa é sempre o FIM dele. Com justifyContent 'flex-end' o
  // excesso transborda para a esquerda e o overflow hidden corta ali — sem
  // ellipsis, sem fatiar a string por contagem de caracteres (que erra sempre,
  // porque 'i' e 'm' não têm a mesma largura). A máscara desfia a borda
  // esquerda para o corte parecer um deslize contínuo, e não uma palavra
  // decapitada.
  const temFita = Boolean(rtErro || aoVivo)
  const fita = {
    flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', justifyContent: 'flex-end',
    alignItems: 'center', whiteSpace: 'nowrap', fontSize: 11.5,
    color: rtErro ? ALERTA : WHITE, fontWeight: 500,
    WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 20px)'
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
    // O motivo vindo do motor remoto entra como segunda linha em vez de
    // substituir a primeira: "Áudio preservado" é a informação que decide o que
    // o usuário faz agora, e a mensagem do Google é o porquê. Cortar a segunda
    // linha na largura da pílula é aceitável; cortar a primeira não seria.
    body = (
      <div style={{ ...container(false), flexDirection: 'column', justifyContent: 'center', padding: '0 14px', gap: 1 }}>
        <span style={{ color: ALERTA, fontSize: 13 }}>Falha. Áudio preservado.</span>
        {rtErro && (
          <span style={{ color: GRAY, fontSize: 10.5, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rtErro}
          </span>
        )}
      </div>
    )
  } else if (phase === 'processing') {
    // Depois do stop o Gemini ainda pode mandar as últimas palavras. Manter o
    // texto na tela em vez de trocar por "Transcrevendo…" evita o pisca-pisca
    // de o transcrito sumir bem no fim — e num ditado remoto essa fase dura
    // frações de segundo, então "Transcrevendo…" seria só um flash sem sentido.
    body = (
      <div style={{ ...container(false), padding: '0 10px', gap: 10 }}>
        <button onMouseUp={() => window.dita.cancelHard()} style={circleX}>{IconX}</button>
        {temFita
          ? <div style={fita}><span>{rtErro || aoVivo}</span></div>
          : <span style={{ flex: 1, textAlign: 'center', color: GRAY, fontSize: 13 }}>Transcrevendo…</span>}
        <div style={{ width: 24, flexShrink: 0 }} />
      </div>
    )
  } else {
    body = (
      <div style={{ ...container(false), padding: '0 10px', gap: 8 }}>
        <button onMouseUp={() => window.dita.cancelHard()} style={circleX}>{IconX}</button>
        <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* o loop do equalizador remede clientWidth a cada frame, então ele
              se reajusta sozinho quando esta faixa encolhe para 26px */}
          <canvas ref={canvasRef} style={temFita ? { width: 26, flexShrink: 0, height: '100%' } : { flex: 1, minWidth: 0, height: '100%' }} />
          {temFita && <div style={fita}><span>{rtErro || aoVivo}</span></div>}
        </div>
        <button onMouseUp={() => window.dita.finish()} style={circleCheck}>{IconCheck}</button>
      </div>
    )
  }

  return <div style={wrap}>{body}</div>
}
