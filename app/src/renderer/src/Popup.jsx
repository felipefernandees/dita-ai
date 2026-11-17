import { useEffect, useRef, useState } from 'react'
import { TAXA_ALVO, amostrasPorChunk, blocoParaPcm16, taxaUtilizavel } from './pcm'
import { rotuloPttCurto } from './atalhos'
// `?url` faz o Vite tratar o worklet como ASSET, não como módulo do bundle: ele
// sai como arquivo próprio em out/renderer/assets e esta variável vira o
// caminho dele. É o único jeito que funciona nos dois mundos — em dev o Vite
// serve pelo dev server, no empacotado o addModule resolve o file:// ao lado do
// index.html. Importar o worklet normalmente o enfiaria dentro do bundle do
// React, e o AudioWorkletGlobalScope não tem `document` nem `window` para rodar
// isso; um `addModule` apontando para o próprio bundle explode em runtime.
import urlWorklet from './pcm-worklet.js?url'

// Pílula no padrão do Wispr Flow, medida no CSS do app dele (2026-11-17):
// preto puro, borda vast-900, raio 22,5, transição de 100 ms na curva
// cubic-bezier(0.05, 0.6, 0.4, 0.95). Os tamanhos de cada estado estão em
// TAMANHO, logo abaixo. A pílula é preta nos dois temas do sistema.
const PRETO = '#000000'
const BORDA = '#30302f'      // vast-900
const TEXTO = '#fcfcfb'      // sand-50
const APOIO = '#9d9c98'      // vast-400
const LUMEN = '#ffffeb'      // botão principal sobre o preto
const ALERTA = '#ff5757'     // red-450
const FONTE = "'Figtree Variable', Figtree, ui-sans-serif, system-ui, sans-serif"
const CURVA = 'cubic-bezier(0.05, 0.6, 0.4, 0.95)'

// Largura x altura de cada estado, com a barra embaixo da tela.
const TAMANHO = {
  parada: [40, 8],       // sempre na tela, quase invisível
  pronta: [50, 30],      // mouse em cima: mostra o microfone
  segurando: [73, 30],   // Fn segurada
  travada: [106, 30],    // mãos livres: cancelar, onda, parar
  processando: [98, 30],
  erro: [91, 30]
}

// A onda: 10 barras de 2 px. Em repouso cada barra tem 2 px de altura e
// cresce com o volume (até 9x); as do meio crescem mais (fator 1 - d²/48,
// o "bulge" do Wispr) e cada uma oscila com um atraso próprio.
const N_BARRAS = 10
const BARRAS = Array.from({ length: N_BARRAS }, (_, i) => {
  const d = Math.abs((N_BARRAS - 1) / 2 - i)
  return { escala: Math.max(0, 1 - (d * d) / 48), atraso: 0.1 * (i < N_BARRAS / 2 ? i : i - N_BARRAS) }
})

// Sons de início e fim do ditado. São gerados aqui (duas notas curtas), não
// copiados de app nenhum.
let ctxSom = null
function tocarSom(tipo) {
  try {
    ctxSom = ctxSom || new AudioContext()
    const t0 = ctxSom.currentTime + 0.01
    const notas = tipo === 'inicio' ? [660, 990] : [990, 660]
    notas.forEach((f, i) => {
      const o = ctxSom.createOscillator()
      const g = ctxSom.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const t = t0 + i * 0.07
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.06, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      o.connect(g).connect(ctxSom.destination)
      o.start(t)
      o.stop(t + 0.1)
    })
  } catch { /* sem áudio de saída: o ditado segue */ }
}

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
// Cartão "sem campo" do Wispr (CSS do app deles, 2026-11-17): dica em cima
// ("Selecione um campo de texto primeiro, depois dite"), o texto em até 3
// linhas, e o botão embaixo. Aqui o texto já foi pro clipboard, então o botão
// nasce como "Copiado!". O X tem um anel que esvazia em 8 s e fecha sozinho;
// mouse em cima pausa a contagem, igual ao Wispr.
const PRAZO_CARTAO_MS = 8000
function CartaoSemCampo({ texto }) {
  const [pausado, setPausado] = useState(false)
  const restanteRef = useRef(PRAZO_CARTAO_MS)
  const inicioRef = useRef(0)
  useEffect(() => {
    if (pausado) return
    inicioRef.current = performance.now()
    const t = setTimeout(() => window.dita.closePopup(), restanteRef.current)
    return () => {
      clearTimeout(t)
      restanteRef.current = Math.max(0, restanteRef.current - (performance.now() - inicioRef.current))
    }
  }, [pausado])
  const R = 10.5
  const perimetro = 2 * Math.PI * R
  const progresso = 1 - restanteRef.current / PRAZO_CARTAO_MS
  return (
    <div onMouseEnter={() => setPausado(true)} onMouseLeave={() => setPausado(false)} style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', textAlign: 'left',
      animation: 'conteudoCartao .2s ease-out .12s both'
    }}>
      <button onMouseUp={() => window.dita.closePopup()} title="Fechar" style={{
        position: 'absolute', top: 12, right: 12, width: 24, height: 24, padding: 0, border: 0, borderRadius: '50%',
        background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
          <circle cx="12" cy="12" r={R} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1.5" />
          <circle cx="12" cy="12" r={R} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.5"
            strokeDasharray={perimetro} strokeDashoffset={perimetro * progresso}
            style={{ '--perimetro': `${perimetro}px`, '--de': `${perimetro * progresso}px`, animation: `anel ${restanteRef.current}ms linear forwards`, animationPlayState: pausado ? 'paused' : 'running' }} />
        </svg>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fcfcfb" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 50px 20px 16px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fcfcfb" strokeOpacity=".4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 4h4M7 4v16M5 20h4M13 7h6M13 12h6M13 17h4" />
        </svg>
        <span style={{ fontSize: 12, lineHeight: '20px', color: '#fcfcfb', opacity: 0.4 }}>Selecione um campo de texto primeiro, depois dite</span>
      </div>
      <div style={{ padding: '0 16px 20px' }}>
        <p style={{
          margin: 0, fontSize: 14, lineHeight: '20px', color: '#b3b2ad', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden'
        }}>{texto}</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '0 16px 20px', marginTop: 'auto' }}>
        <span style={{ fontSize: 12, lineHeight: '20px', color: '#fcfcfb', opacity: 0.4 }}>Clique num campo e use ⌘V</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
          background: '#71716e', color: '#eeebe3', fontSize: 14, lineHeight: '20px', fontWeight: 600
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
          Copiado!
        </span>
      </div>
    </div>
  )
}

export default function Popup() {
  const [phase, setPhase] = useState('idle') // idle|recording|processing|done|error|cancelled
  const [modo, setModo] = useState('ptt')     // ptt (segurando) | travado (mãos livres)
  const [hover, setHover] = useState(false)
  const [result, setResult] = useState('')
  const [pasted, setPasted] = useState(false)
  const [session, setSession] = useState(0) // re-arma a onda a cada gravação
  const [rtErro, setRtErro] = useState('')   // falha do motor remoto, visível em vez de silenciosa
  const ondaRef = useRef(null)
  const sonsRef = useRef(true)
  // Ajustes guardados aqui para o início do ditado não esperar um IPC; o main
  // avisa quando mudam (settings:mudou). O id do embutido é descoberto uma vez.
  const settingsRef = useRef(null)
  const embutidoRef = useRef(null)
  const mediaRef = useRef({})
  // Mesma ideia da época do main, do lado de cá. `startRecording` atravessa
  // três `await` (configurações, getUserMedia, MediaRecorder) e o ditado pode
  // ser cancelado no meio de qualquer um deles. Sem este número, o
  // getUserMedia resolveria depois do cancelamento e deixaria um microfone
  // ABERTO que ninguém mais referencia — o indicador de gravação do macOS fica
  // aceso e nada no app consegue apagá-lo.
  const epocaRef = useRef(0)

  useEffect(() => {
    // Preferência de som. O main pode ainda não ter subido os handlers quando
    // a pílula nasce (ela abre junto com o app), então insiste um pouco.
    let vivo = true
    ;(async () => {
      for (let i = 0; vivo && i < 60; i++) {
        try { const st = await window.dita.getSettings(); settingsRef.current = st; sonsRef.current = st.sons !== 'false'; return }
        catch { await new Promise((r) => setTimeout(r, 500)) }
      }
    })()
    // Lista de microfones pro menu da barra de cima (o main não enxerga os
    // dispositivos de áudio; quem enxerga é o renderer).
    const informarMics = () => navigator.mediaDevices.enumerateDevices()
      .then((l) => window.dita.informarMicrofones?.(l
        .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d) => ({ deviceId: d.deviceId, label: d.label }))))
      .catch(() => {})
    informarMics()
    navigator.mediaDevices.addEventListener?.('devicechange', () => { embutidoRef.current = null; informarMics() })
    window.dita.onCommand(async (ch, payload) => {
      if (ch === 'rec:start') {
        setModo(payload?.modo === 'travado' ? 'travado' : 'ptt')
        if (sonsRef.current) tocarSom('inicio')
        await startRecording(payload)
      }
      if (ch === 'rec:modo') setModo(payload === 'travado' ? 'travado' : 'ptt')
      if (ch === 'settings:mudou' && payload) { settingsRef.current = payload; sonsRef.current = payload.sons !== 'false' }
      if (ch === 'rec:stop') { if (sonsRef.current) tocarSom('fim'); stopRecording(true) }
      if (ch === 'rec:cancel') { stopRecording(false); setPhase('idle') }
      // Só corta o microfone, sem tocar na visibilidade: o main manda isto
      // junto com a tarja "Transcrição cancelada", que precisa continuar na
      // tela. É a rede de segurança do botão X (ver rec:cancel-hard no main).
      if (ch === 'rec:soltar-mic') soltarMicrofone()
      if (ch === 'rec:phase') setPhase(payload)
      if (ch === 'rec:result') { setResult(payload.text); setPasted(!!payload.pasted); setPhase('done') }
      if (ch === 'rec:cancelled') setPhase('cancelled')
      if (ch === 'rec:closing' || ch === 'rec:repouso') { setPhase('idle'); setRtErro('') }
      if (ch === 'rt:erro') setRtErro(String(payload ?? '').trim())
    })
    return () => { vivo = false }
  }, [])

  // Volume do microfone -> --audio-scale nas barras, direto no DOM (sem
  // re-render do React a cada quadro). Escala do Wispr: max(1, ganho x nível).
  useEffect(() => {
    if (phase !== 'recording') return
    const onda = ondaRef.current
    const analyser = mediaRef.current.analyser
    if (!onda || !analyser) return
    analyser.fftSize = 512
    const dados = new Float32Array(analyser.fftSize)
    let suave = 0
    let raf
    const loop = () => {
      raf = requestAnimationFrame(loop)
      analyser.getFloatTimeDomainData(dados)
      let soma = 0
      for (let i = 0; i < dados.length; i++) soma += dados[i] * dados[i]
      const rms = Math.sqrt(soma / dados.length)
      // -55 dB (silêncio de sala) até -12 dB (fala alta) viram 0..1
      const nivel = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 55) / 43))
      suave += (nivel - suave) * (nivel > suave ? 0.5 : 0.15)
      onda.style.setProperty('--audio-scale', String(Math.max(1, 1 + 8 * suave).toFixed(2)))
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
    // Avança a época ANTES de desmontar: é isto que faz um `startRecording`
    // ainda em voo descobrir, ao voltar do await, que o ditado dele já acabou.
    epocaRef.current++
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

  // Descarta um stream que chegou tarde demais. Sem isto o microfone fica
  // aberto sem dono e o ponto laranja do macOS não apaga mais.
  function descartarStream(stream) {
    try { stream?.getTracks().forEach((t) => t.stop()) } catch { /* já parado */ }
  }

  // Qual microfone abrir. Escolhido nos Ajustes = esse. "Automático" = o
  // microfone EMBUTIDO do Mac, mesmo com fone Bluetooth conectado (decisão do
  // Felipe em 2026-11-17). Motivo medido no Mac dele: com os AirPods como
  // entrada padrão, abrir o microfone obriga o macOS a trocar o fone para o
  // modo de chamada, o que leva cerca de 1 s (a fala desse começo se perde) e
  // derruba a qualidade da música. O Wispr Flow chega a avisar que AirPods não
  // são bons para ditado. Sem embutido (Mac de mesa), fica o padrão do sistema.
  async function escolherMicrofone() {
    const escolhido = settingsRef.current?.micDeviceId
    if (escolhido) return { deviceId: { exact: escolhido } }
    if (embutidoRef.current) return { deviceId: { exact: embutidoRef.current } }
    try {
      const lista = await navigator.mediaDevices.enumerateDevices()
      const embutido = lista.find((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications' &&
        /macbook|built-?in|embutid|interno|internal/i.test(d.label))
      if (embutido) { embutidoRef.current = embutido.deviceId; return { deviceId: { exact: embutido.deviceId } } }
    } catch { /* sem lista: padrão do sistema */ }
    return true
  }

  async function startRecording(payload) {
    releaseMic()
    const minhaEpoca = epocaRef.current
    setRtErro('')

    // A PÍLULA APARECE ANTES DO MICROFONE ABRIR, E ISSO É DE PROPÓSITO.
    //
    // O popup é a única confirmação de que o atalho pegou. Enquanto ele só
    // pintava depois do `await getUserMedia`, o usuário apertava, começava a
    // falar e via a tela vazia — e o relato virava "não aparece o popup de
    // gravação". A janela já estava lá, transparente, esperando o microfone.
    //
    // O equalizador não sofre com a inversão: o loop de desenho desiste sozinho
    // enquanto `analyser` não existir e volta quando `session` muda, logo
    // abaixo. Nos primeiros milissegundos a pílula aparece com as barras
    // paradas, que é a leitura honesta do que está acontecendo.
    setPhase('recording')
    setHover(false)

    let stream
    const t0 = performance.now()
    try {
      const audioInput = await escolherMicrofone()
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: audioInput }) }
      // O microfone escolhido nas configurações pode ter sido desconectado
      // (fone bluetooth que saiu do ar). Cair no dispositivo padrão é melhor do
      // que não gravar — mas se NEM ele existir, a falha precisa aparecer na
      // tela: antes esta segunda tentativa não tinha catch nenhum e a exceção
      // deixava o popup pendurado, sem gravar e sem dizer por quê.
      catch { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    } catch (err) {
      console.error('microfone indisponível:', err)
      if (minhaEpoca !== epocaRef.current) return
      setRtErro('Microfone indisponível. Verifique as permissões.')
      setPhase('error')
      return
    }

    // O ditado foi cancelado enquanto o microfone abria (o toque acidental no
    // Cmd direito cabe folgado aqui). O stream que acabou de chegar não tem
    // mais dono: fechar agora, ou ele vaza.
    if (minhaEpoca !== epocaRef.current) { descartarStream(stream); return }
    const rotulo = stream.getAudioTracks()[0]?.label || '?'
    window.dita.medida?.(`mic aberto em ${Math.round(performance.now() - t0)}ms (${rotulo})`)

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
    analyser.fftSize = 512
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    // Rede de segurança contra microfone preso, NÃO limite de fala: 30 min.
    // Chama o mesmo caminho do botão check (pelo main), pra máquina de estado
    // não ficar dessincronizada e o áudio ser transcrito e salvo, nunca jogado
    // fora. O Felipe fala 3+ minutos direto: o limite não pode cortar ele.
    const watchdog = setTimeout(() => window.dita.finish(), 30 * 60000)
    mediaRef.current = { recorder, stream, analyser, audioCtx, watchdog, keep: false, encerrado: false }
    // A fase já é 'recording' desde o topo; este `session` é o que RE-ARMA o
    // loop do equalizador agora que o `analyser` finalmente existe. Sem ele o
    // efeito de desenho teria desistido lá em cima e as barras ficariam
    // paradas o ditado inteiro.
    setSession((n) => n + 1)
    // O MediaRecorder acima continua rodando no ditado remoto, de propósito: o
    // main guarda esse webm e o joga no whisper local se o Gemini não devolver
    // texto nenhum. É a rede de segurança — o streaming é um extra por cima
    // dela, nunca um substituto, e por isso é disparado DEPOIS de a gravação já
    // estar de pé e sem `await` segurando o popup.
    if (payload?.engine === 'gemini') iniciarStreaming(stream)
  }

  // Fecha o MediaRecorder e devolve o microfone ao sistema. `keep` decide se o
  // áudio gravado ainda vira transcrição (onstop lê essa bandeira) ou é
  // descartado. Separado de stopRecording porque o botão X precisa do corte do
  // microfone SEM as mudanças de fase que vêm junto.
  function soltarMicrofone(keep = false) {
    const m = mediaRef.current
    if (m.recorder && m.recorder.state !== 'inactive') { m.keep = keep; m.recorder.stop() }
    else releaseMic()
  }

  function stopRecording(keep) {
    soltarMicrofone(keep)
    if (keep) setPhase('processing')
    else if (phase === 'recording') setPhase('idle')
  }

  // Mouse: a janela inteira deixa o clique passar; entrar na pílula (ou num
  // card com botões) pede o mouse de volta ao main.
  const entrar = () => { setHover(true); window.dita.mouseNaPilula(true) }
  const sair = () => { setHover(false); window.dita.mouseNaPilula(false) }

  const btnCirculo = {
    border: 0, borderRadius: '50%', width: 20, height: 20, padding: 0, cursor: 'pointer', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', background: BORDA
  }
  const IconX = (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={TEXTO} strokeWidth="3" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
  const IconParar = <span style={{ width: 8, height: 8, borderRadius: 2, background: ALERTA, display: 'block' }} />
  const IconMic = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TEXTO} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
  const botao = (principal) => ({
    border: 0, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
    fontSize: 12.5, fontWeight: 600, fontFamily: FONTE,
    background: principal ? LUMEN : BORDA, color: principal ? PRETO : TEXTO
  })

  const onda = (ativa) => (
    <div ref={ondaRef} style={{ display: 'flex', alignItems: 'center', gap: 2, height: 18, flexShrink: 0 }}>
      {BARRAS.map((b, i) => (
        <span key={i} className={ativa ? 'barra barra-viva' : 'barra barra-processando'}
          style={{ '--bar-height-scale': b.escala, animationDelay: `${ativa ? b.atraso : i * 0.08}s` }} />
      ))}
    </div>
  )

  // Estado visual da pílula
  let estado = 'parada'
  if (phase === 'recording') estado = modo === 'travado' ? 'travada' : 'segurando'
  else if (phase === 'processing') estado = 'processando'
  else if (phase === 'error') estado = 'erro'
  else if (phase === 'idle' && hover) estado = 'pronta'
  else if (phase === 'done' && !pasted) estado = 'cartao'
  // O cartão "sem campo" é a própria pílula esticada (o "morph" do Wispr):
  // 400 px de largura, raio 24, altura pelas linhas do texto (até 3, como lá).
  const linhasCartao = Math.min(3, Math.max(1, Math.ceil(String(result || '').length / 52)))
  const [w, h] = estado === 'cartao' ? [400, 56 + (20 * linhasCartao + 20) + 52] : TAMANHO[estado]
  const parada = estado === 'parada'
  const cartao = estado === 'cartao'

  let miolo = null
  if (estado === 'pronta') miolo = IconMic
  else if (estado === 'segurando') miolo = onda(true)
  else if (estado === 'travada') miolo = (
    <>
      <button onMouseUp={() => window.dita.cancelHard()} style={btnCirculo} title="Cancelar">{IconX}</button>
      {onda(true)}
      <button onMouseUp={() => window.dita.finish()} style={btnCirculo} title="Parar">{IconParar}</button>
    </>
  )
  else if (estado === 'processando') miolo = onda(false)
  else if (estado === 'erro') miolo = <span style={{ color: ALERTA, fontSize: 12, fontWeight: 600 }}>Falhou</span>
  else if (cartao) miolo = <CartaoSemCampo texto={result} />

  // Dica acima da pílula: atalho (parada, com o mouse em cima), cancelado com
  // Anular, ou o motivo de uma falha.
  let dica = null
  if (phase === 'cancelled') dica = (
    <>
      <span style={{ color: APOIO }}>Transcrição cancelada</span>
      <button onMouseUp={() => window.dita.undo()} style={botao(true)}>Desfazer</button>
    </>
  )
  else if (estado === 'pronta') dica = <span>Clique ou segure <b style={{ fontWeight: 700 }}>{rotuloPttCurto(settingsRef.current?.pttShortcut || 'fn', settingsRef.current?.platform)}</b> para ditar</span>
  else if (estado === 'erro') dica = <span style={{ color: APOIO }}>{rtErro || 'Áudio preservado no histórico.'}</span>
  else if (rtErro && phase === 'recording') dica = <span style={{ color: APOIO }}>{rtErro}</span>

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-end', gap: 8, paddingBottom: 10, boxSizing: 'border-box', fontFamily: FONTE
    }}>
      <style>{`
        .barra { width: 2px; height: 2px; border-radius: .5px; background: rgba(255,255,255,.4); transform-origin: center; will-change: transform;
          transform: scaleY(calc(var(--audio-scale, 1) * var(--bar-height-scale, 1))); }
        .barra-viva { background: #fff; animation: onda 1s infinite ease-in-out; }
        .barra-processando { animation: processa 1.1s infinite ease-in-out; }
        @keyframes onda {
          0%, 100% { transform: scaleY(calc(var(--audio-scale, 1) * var(--bar-height-scale, 1) * 1)) }
          20% { transform: scaleY(calc(var(--audio-scale, 1) * var(--bar-height-scale, 1) * 1.2)) }
          40% { transform: scaleY(calc(var(--audio-scale, 1) * var(--bar-height-scale, 1) * 1.5)) }
          80% { transform: scaleY(calc(var(--audio-scale, 1) * var(--bar-height-scale, 1) * 1.1)) }
          90% { transform: scaleY(calc(var(--audio-scale, 1) * var(--bar-height-scale, 1) * 1.3)) }
        }
        @keyframes processa { 0%, 100% { transform: scaleY(1); opacity: .35 } 50% { transform: scaleY(3); opacity: 1 } }
        @keyframes surge { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        @keyframes conteudoCartao { from { opacity: 0; transform: scale(.96) } to { opacity: 1; transform: none } }
        @keyframes anel { from { stroke-dashoffset: var(--de) } to { stroke-dashoffset: var(--perimetro) } }
      `}</style>
      {dica && (
        <div onMouseEnter={phase === 'cancelled' ? entrar : undefined} onMouseLeave={phase === 'cancelled' ? sair : undefined} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: phase === 'cancelled' ? '4px 4px 4px 12px' : '6px 10px',
          background: PRETO, border: `1px solid ${BORDA}`, borderRadius: 999, color: TEXTO, fontSize: 12,
          whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', animation: 'surge .14s ease-out'
        }}>{dica}</div>
      )}
      {/* área de toque um pouco maior que a pílula parada, como o "hotArea" do Wispr */}
      <div onMouseEnter={entrar} onMouseLeave={sair}
        onMouseUp={() => { if (phase === 'idle') window.dita.cliquePilula() }}
        style={{ padding: '6px 10px', display: 'flex', justifyContent: 'center', cursor: phase === 'idle' ? 'pointer' : 'default' }}>
        <div onMouseEnter={cartao ? entrar : undefined} onMouseLeave={cartao ? sair : undefined} style={{
          position: 'relative',
          width: w, height: h, boxSizing: 'border-box', borderRadius: parada ? 6 : cartao ? 24 : 22.5,
          background: parada ? 'rgba(0,0,0,.5)' : PRETO,
          border: `1px solid ${parada ? 'rgba(255,255,255,.5)' : BORDA}`,
          display: 'flex', alignItems: 'center', justifyContent: estado === 'travada' ? 'space-between' : 'center',
          padding: estado === 'travada' ? '0 4px' : 0, overflow: 'hidden', color: TEXTO,
          // O cartão estica mais devagar que as trocas da pílula (que são de
          // 100 ms no Wispr): é uma mudança de forma grande, e rápido demais
          // ela pisca em vez de crescer.
          transition: cartao || phase === 'idle'
            ? `width .28s ${CURVA}, height .28s ${CURVA}, border-radius .28s ${CURVA}, background .2s ease, border-color .2s ease`
            : `width .1s ${CURVA}, height .1s ${CURVA}, border-radius .1s ${CURVA}, background .2s ease, border-color .2s ease`
        }}>
          {miolo}
        </div>
      </div>
    </div>
  )
}
