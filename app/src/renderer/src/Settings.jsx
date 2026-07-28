import { useEffect, useMemo, useRef, useState } from 'react'
import { ATALHOS, specDeEvento, rotuloToggle, avisoToggle } from './atalhos'

// Paleta neutra clonada do Wispr Flow: near-black e branco, zero cor saturada
const C = {
  bg: '#131315',        // fundo app
  panel: '#1a1a1c',     // painel/conteúdo
  card: '#202022',      // cards
  hover: '#2b2b2e',     // hover / campos
  border: '#323235',    // borda
  text: '#f5f5f7',      // texto primário
  muted: '#8e8e93',     // texto muted
  accent: '#f5f5f7',    // destaque = o próprio branco
  ink: '#131315',       // texto sobre o branco
  // Única cor da paleta. Recusar um atalho precisa LER como recusa, e num
  // esquema todo cinza a mensagem some no meio dos textos de apoio; o vermelho
  // é dessaturado ao máximo que ainda dá para reconhecer.
  alerta: '#e0a3a3'
}
const FONT = "'General Sans', ui-sans-serif, system-ui, sans-serif"
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"

const S = {
  shell: { display: 'flex', height: '100vh', background: C.bg, color: C.text, fontFamily: FONT, overflow: 'hidden' },
  // a sidebar inteira arrasta a janela (a barra de título nativa foi removida);
  // itens clicáveis reativam o clique com WebkitAppRegion 'no-drag'
  sidebar: { width: 196, padding: '52px 14px 16px', boxSizing: 'border-box', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3, WebkitAppRegion: 'drag' },
  brand: { display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px 22px' },
  navItem: (active) => ({
    padding: '10px 13px', borderRadius: 10, fontSize: 13.5, cursor: 'pointer', userSelect: 'none', WebkitAppRegion: 'no-drag',
    color: active ? C.text : C.muted, background: active ? C.hover : 'transparent',
    fontWeight: active ? 600 : 500, display: 'flex', alignItems: 'center', gap: 9, transition: 'background .12s'
  }),
  content: { flex: 1, background: C.panel, padding: '34px 40px', overflowY: 'auto' },
  h1: { fontSize: 25, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 22px' },
  kicker: { fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted, margin: '0 0 10px 2px' },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '2px 18px', marginBottom: 16 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', gap: 16 },
  divider: { borderTop: `1px solid ${C.border}` },
  label: { fontSize: 14, fontWeight: 600 },
  sub: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 1.5 },
  select: { padding: '7px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.hover, color: C.text, fontSize: 13, maxWidth: 230, fontFamily: FONT },
  kbd: { background: C.hover, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 7px', fontSize: 12, color: C.text, fontFamily: MONO },
  // coluna da direita das linhas de atalho: o controle em cima, a explicação
  // embaixo — mensagens de recusa são frases inteiras e não cabem numa linha
  controle: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 },
  captura: (ativo) => ({
    padding: '7px 13px', borderRadius: 10, minWidth: 196, textAlign: 'center', cursor: 'pointer',
    border: `1px solid ${ativo ? C.accent : C.border}`, background: C.hover,
    color: ativo ? C.muted : C.text, fontSize: 13, fontFamily: MONO
  }),
  pill: (ativo) => ({
    padding: '6px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
    border: `1px solid ${ativo ? C.accent : C.border}`,
    background: ativo ? C.accent : C.hover, color: ativo ? C.ink : C.muted
  }),
  nota: (cor) => ({ fontSize: 12, color: cor, marginTop: 7, lineHeight: 1.45, maxWidth: 262, textAlign: 'right' }),

  // --- motor de transcrição ---
  // A área que se abre embaixo da opção escolhida. Mora dentro do mesmo card,
  // separada pelo divisor de sempre, para ler como continuação da opção e não
  // como um bloco novo pregado por cima.
  expandido: { padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 15 },
  passo: {
    width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: C.hover,
    border: `1px solid ${C.border}`, color: C.muted, fontFamily: MONO, fontSize: 11,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  campoChave: {
    flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: 10, border: `1px solid ${C.border}`,
    background: C.hover, color: C.text, fontSize: 13, fontFamily: MONO
  },
  botao: { borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: 'pointer', border: 0, alignSelf: 'flex-start' },
  // Blocos de aviso em largura cheia. Os S.nota são alinhados à direita porque
  // vivem na coluna de controle das linhas de atalho; estes são parágrafos.
  bloco: (cor) => ({ fontSize: 12, color: cor, lineHeight: 1.5 }),
  trilha: { height: 6, borderRadius: 999, background: C.hover, overflow: 'hidden', marginTop: 8 },
  preenchimento: (pct, cor) => ({ width: `${pct}%`, height: '100%', background: cor, borderRadius: 999, transition: 'width .25s ease' })
}

// Equalizador de 5 barras (símbolo da marca). Coordenadas copiadas do ícone
// do app (conteudo/_brandings/dita-ai/assets/src-svg/app-icon.svg), com o
// viewBox travado na caixa das barras: o símbolo aqui é o mesmo do ícone.
const BARRAS = [
  { x: 268.0, y: 361.30, h: 301.4 },
  { x: 373.5, y: 289.00, h: 446.0 },
  { x: 479.0, y: 232.00, h: 560.0 },
  { x: 584.5, y: 332.50, h: 359.0 },
  { x: 690.0, y: 382.55, h: 258.9 }
]
function Equalizer({ size = 20, color = C.accent }) {
  return (
    <svg height={size} width={size * (488 / 560)} viewBox="268 232 488 560" style={{ display: 'block' }}>
      {BARRAS.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width="66" height={b.h} rx="33" fill={color} />
      ))}
    </svg>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <div onClick={() => onChange(!checked)} style={{
      width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0,
      background: checked ? C.accent : C.hover, position: 'relative', transition: 'background .15s'
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', background: checked ? C.ink : '#fff', position: 'absolute', top: 2,
        left: checked ? 20 : 2, transition: 'left .15s'
      }} />
    </div>
  )
}


// Irmão do Toggle, mesma paleta e mesma caixa de 22px do knob dele: os dois
// motores são MUTUAMENTE exclusivos, e dois Toggle lado a lado prometeriam que
// dá para ligar os dois (ou nenhum).
function Radio({ ativo }) {
  return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 2,
      border: `1px solid ${ativo ? C.accent : C.border}`, background: ativo ? C.accent : C.hover,
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s'
    }}>
      {ativo && <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.ink }} />}
    </div>
  )
}

function OpcaoMotor({ ativo, titulo, descricao, aviso, divisor, onSelect }) {
  return (
    <div
      role="radio" aria-checked={ativo} onClick={onSelect}
      style={{ ...S.row, ...(divisor ? S.divider : {}), alignItems: 'flex-start', cursor: 'pointer' }}
    >
      <div>
        <div style={S.label}>{titulo}</div>
        <div style={S.sub}>{descricao}</div>
        {/* O aviso de privacidade fica na descrição da PRÓPRIA opção e aparece
            mesmo com ela desmarcada: quem está decidindo precisa saber o que
            está escolhendo ANTES de escolher. Escondê-lo atrás da seleção o
            transformaria em letra miúda pós-consentimento. */}
        {aviso && <div style={{ ...S.sub, color: C.alerta }}>{aviso}</div>}
      </div>
      <Radio ativo={ativo} />
    </div>
  )
}

const PASSOS_CHAVE = [
  'Acesse aistudio.google.com e faça login.',
  'Clique em "Get API key".',
  'Clique em "Create API key".',
  'Copie o código gerado.'
]

// Barra de cota. É uma ESTIMATIVA e o texto diz isso sem rodeio: quem conta é o
// nosso config.json, nesta máquina. Alguém que confie nela como se fosse o
// contador do Google vai bater no limite real sem aviso — e o jeito de evitar
// isso não é caprichar na contagem (impossível daqui), é não prometer.
function BarraUso({ motor }) {
  const pct = Math.max(0, Math.min(100, Number(motor.percentual) || 0))
  const cor = pct >= 90 ? C.alerta : C.accent
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Uso diário estimado</span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: pct >= 90 ? C.alerta : C.muted }}>
          {motor.usoDiario} / {motor.limite} · {pct}%
        </span>
      </div>
      <div style={S.trilha} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={S.preenchimento(pct, cor)} />
      </div>
      <div style={{ ...S.sub, marginTop: 8 }}>
        Estimativa: a contagem é local a esta máquina, então a mesma chave usada em outro
        computador não aparece aqui. Quem decide o limite de verdade é o Google.
      </div>
    </div>
  )
}

function MotorTranscricao({ motor, recarregar }) {
  const [chave, setChave] = useState('')
  const [revelar, setRevelar] = useState(false)
  const [trocando, setTrocando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [recado, setRecado] = useState(null)   // { erro: bool, texto }

  const gemini = motor.engine === 'gemini'
  // Pede a chave quando não há nenhuma utilizável, ou quando o usuário pediu
  // para trocar. `temChave` vem do main já resolvido: uma chave cifrada que
  // ESTA máquina não consegue abrir chega aqui como "não tem".
  const pedindoChave = !motor.temChave || trocando

  async function escolher(engine) {
    if (engine === motor.engine) return
    setRecado(null)
    await window.dita.motorSetEngine(engine)
    await recarregar()
  }

  async function salvar() {
    setSalvando(true)
    try {
      const r = await window.dita.motorSetChave(chave)
      if (!r?.ok) { setRecado({ erro: true, texto: r?.erro || 'Não consegui salvar a chave.' }); return }
      // "Salvar e Ativar": o botão promete as duas coisas, então liga o motor
      // aqui também em vez de contar com o rádio já ter sido marcado antes.
      await window.dita.motorSetEngine('gemini')
      // Some com a chave da memória da tela no instante em que ela é aceita.
      setChave('')
      setRevelar(false)
      setTrocando(false)
      setRecado({ erro: false, texto: 'Chave salva. O modo tempo real está ativo.' })
      await recarregar()
    } catch (err) {
      setRecado({ erro: true, texto: 'Não consegui falar com o aplicativo para salvar a chave.' })
      console.error('motorSetChave:', err)
    } finally {
      setSalvando(false)
    }
  }

  async function remover() {
    await window.dita.motorLimparChave()
    setChave('')
    setTrocando(false)
    setRecado({ erro: false, texto: 'Chave removida desta máquina.' })
    await recarregar()
  }

  return (
    <>
      <div style={S.kicker}>Motor de transcrição</div>
      <div style={S.card}>
        <OpcaoMotor
          ativo={!gemini}
          titulo="Modo Padrão (Sem configuração)"
          descricao="Utiliza o processador nativo. Velocidade lenta (Delay de 7 a 10s). Pronto para usar."
          onSelect={() => escolher('local')}
        />
        <OpcaoMotor
          divisor
          ativo={gemini}
          titulo="Modo Tempo Real (Recomendado)"
          descricao="Utiliza a IA do Google Gemini. Velocidade instantânea. Requer chave gratuita."
          aviso="Neste modo o seu áudio é enviado para os servidores do Google enquanto você fala — ele não fica só na sua máquina."
          onSelect={() => escolher('gemini')}
        />

        {gemini && (
          <div style={{ ...S.divider, ...S.expandido }}>
            {/* Bytes cifrados que este perfil do Windows não abre. Acontece ao
                copiar o AppData para outro usuário/máquina: o main já reporta
                temChave=false, então sem esta linha o usuário só veria o
                formulário de novo, sem entender por que a chave "sumiu". */}
            {!motor.temChave && motor.chaveCifrada && (
              <div style={S.bloco(C.alerta)}>
                Havia uma chave salva, mas ela foi cifrada em outro usuário ou em outra máquina e não
                pode ser lida aqui. Cole a chave de novo.
              </div>
            )}

            {motor.temChave && !motor.chaveCifrada && (
              <div style={S.bloco(C.alerta)}>
                Esta máquina não ofereceu cofre de credenciais, então a chave <strong>não pôde ser
                cifrada</strong> e está gravada em texto puro no config.json do aplicativo. Quem tiver
                acesso ao seu perfil consegue lê-la.
              </div>
            )}

            {pedindoChave ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {PASSOS_CHAVE.map((passo, i) => (
                    <div key={passo} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={S.passo}>{i + 1}</span>
                      <span style={{ fontSize: 13 }}>{passo}</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* type=password por padrão: a chave é credencial, e a tela de
                      configurações é justamente o que se abre numa chamada de
                      vídeo compartilhando a tela. O revelar é opt-in, para
                      conferir uma colagem que deu errado. */}
                  <input
                    type={revelar ? 'text' : 'password'}
                    value={chave}
                    onChange={(e) => { setChave(e.target.value); setRecado(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && chave.trim() && !salvando) salvar() }}
                    placeholder="Cole aqui o código gerado"
                    autoComplete="off" spellCheck={false} aria-label="Chave da API do Google"
                    style={S.campoChave}
                  />
                  <button type="button" onClick={() => setRevelar(!revelar)} style={S.pill(false)}>
                    {revelar ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button" onClick={salvar} disabled={salvando || !chave.trim()}
                    style={{
                      ...S.botao,
                      background: chave.trim() ? C.accent : C.hover,
                      color: chave.trim() ? C.ink : C.muted,
                      cursor: chave.trim() && !salvando ? 'pointer' : 'default'
                    }}
                  >
                    {salvando ? 'Salvando…' : 'Salvar e Ativar'}
                  </button>
                  {trocando && (
                    <button type="button" onClick={() => { setTrocando(false); setChave(''); setRecado(null) }} style={S.pill(false)}>
                      Cancelar
                    </button>
                  )}
                </div>
              </>
            ) : (
              // Chave salva. O campo NUNCA é preenchido de volta — o motorEstado
              // de propósito não devolve a chave, e reimprimir um segredo na
              // tela só para dizer "está aqui" não vale o risco.
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13 }}>
                  Chave salva{motor.chaveCifrada ? ' e cifrada pelo cofre do sistema' : ''}.
                </span>
                <button type="button" onClick={() => { setTrocando(true); setRecado(null) }} style={S.pill(false)}>Trocar chave</button>
                <button type="button" onClick={remover} style={S.pill(false)}>Remover</button>
              </div>
            )}

            {recado && <div style={S.bloco(recado.erro ? C.alerta : C.muted)}>{recado.texto}</div>}

            {motor.temChave && <BarraUso motor={motor} />}
          </div>
        )}
      </div>
    </>
  )
}

// Captura de atalho: o botão mostra a combinação atual e, clicado, escuta o
// próximo keydown. Grava quando chega uma tecla não-modificadora; Esc puro
// cancela.
//
// O listener é global e em fase de CAPTURA (o `true` no addEventListener), com
// preventDefault: enquanto o modo está ligado, nada mais na janela pode reagir
// ao teclado. Sem isso, gravar "Ctrl+A" selecionaria o texto da tela junto, e
// gravar "Tab" moveria o foco para fora do próprio botão.
function CapturaAtalho({ valor, plataforma, presets, onSave }) {
  const [capturando, setCapturando] = useState(false)
  const [erro, setErro] = useState(null)
  const botao = useRef(null)

  useEffect(() => {
    if (!capturando) return

    function onKeyDown(e) {
      e.preventDefault()
      e.stopPropagation()

      // Esc SOZINHO cancela. Com modificador (ctrl+esc) é combinação legítima,
      // então não pode ser sequestrado pelo cancelamento.
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setCapturando(false)
        setErro(null)
        return
      }

      const r = specDeEvento(e, plataforma)
      // Só modificadores segurados: o usuário está no meio da combinação.
      if (r.pendente) { setErro(null); return }
      // Recusa NÃO sai do modo de captura: o usuário acabou de descobrir a
      // regra e a próxima coisa que ele quer fazer é tentar outra tecla.
      if (!r.ok) { setErro(r.mensagem); return }

      setCapturando(false)
      setErro(null)
      onSave(r.spec)
    }

    // Sair do modo por qualquer caminho que não seja o teclado. Enquanto ele
    // está ligado a janela inteira fica surda — sem estas duas saídas, um
    // clique fora ou um alt-tab deixariam o usuário sem conseguir digitar nem
    // na busca do histórico, e sem pista do porquê.
    function sair() { setCapturando(false); setErro(null) }
    function onMouseDown(e) { if (!botao.current?.contains(e.target)) sair() }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('blur', sair)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('blur', sair)
    }
  }, [capturando, onSave, plataforma])

  const aviso = capturando || erro ? null : avisoToggle(valor, plataforma)

  return (
    <div style={S.controle}>
      <button
        ref={botao}
        type="button"
        onClick={() => { setErro(null); setCapturando(!capturando) }}
        style={S.captura(capturando)}
      >
        {capturando ? 'Pressione a combinação…' : rotuloToggle(valor, plataforma)}
      </button>
      {/* As combinações com a tecla Fn são impossíveis de capturar: o Chromium
          não entrega essa tecla em KeyboardEvent nenhum no macOS. Sem estes
          botões, quem trocasse o atalho não teria como voltar ao fn+Espaço. */}
      {presets?.length > 0 && !capturando && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: 262 }}>
          {presets.map(([spec, rotulo]) => (
            <button key={spec} type="button" aria-pressed={spec === valor} onClick={() => onSave(spec)} style={S.pill(spec === valor)}>
              {rotulo}
            </button>
          ))}
        </div>
      )}
      {capturando && !erro && <div style={S.nota(C.muted)}>Esc cancela</div>}
      {erro && <div style={S.nota(C.alerta)}>{erro}</div>}
      {aviso && <div style={S.nota(C.muted)}>{aviso}</div>}
    </div>
  )
}

// Push-to-talk continua sendo uma lista, não uma captura: é sempre UM
// modificador segurado, e um controle de captura prometeria combinações que o
// helper não sabe (nem deveria) escutar.
function EscolhaPtt({ opcoes, valor, onSave }) {
  const aviso = opcoes.find(([v]) => v === valor)?.[2]
  return (
    <div style={S.controle}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: 262 }}>
        {opcoes.map(([v, rotulo]) => (
          <button key={v} type="button" aria-pressed={v === valor} onClick={() => onSave(v)} style={S.pill(v === valor)}>
            {rotulo}
          </button>
        ))}
      </div>
      {aviso && <div style={S.nota(C.muted)}>{aviso}</div>}
    </div>
  )
}

function Config({ settings, mics, update }) {
  // A plataforma vem do processo main pelo IPC: no renderer não existe
  // `process.platform`. Ela decide a GRAMÁTICA de atalhos, não só os rótulos —
  // por isso é passada adiante em vez de cada componente adivinhar.
  const plataforma = ATALHOS[settings.platform] ? settings.platform : 'darwin'
  const atalhos = ATALHOS[plataforma]
  const [motor, setMotor] = useState(null)

  // O estado do motor mora no processo main (config.json), não no `settings`
  // do SQLite, e o contador de uso muda a cada ditado sem avisar ninguém aqui.
  // Recarregar na montagem cobre "abrir a tela de Configurações", que é quando
  // o componente nasce; o salvar chama isto de novo.
  async function recarregarMotor() {
    try { setMotor(await window.dita.motorEstado()) } catch (err) { console.error('motorEstado:', err) }
  }
  useEffect(() => { recarregarMotor() }, [])

  return (
    <>
      <h1 style={S.h1}>Configurações</h1>

      <div style={S.kicker}>Atalhos</div>
      <div style={S.card}>
        <div style={S.row}>
          <div>
            <div style={S.label}>Atalho principal (liga e desliga)</div>
            <div style={S.sub}>Clique e aperte a combinação que você quiser</div>
          </div>
          <CapturaAtalho
            valor={settings.toggleShortcut || atalhos.padraoToggle}
            plataforma={plataforma}
            presets={atalhos.presets}
            onSave={(spec) => update('toggleShortcut', spec)}
          />
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div>
            <div style={S.label}>Push-to-talk (segurar pra falar)</div>
            <div style={S.sub}>Grava enquanto a tecla está pressionada</div>
          </div>
          <EscolhaPtt
            opcoes={atalhos.ptt}
            valor={settings.pttShortcut || atalhos.padraoPtt}
            onSave={(v) => update('pttShortcut', v)}
          />
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div style={S.sub}>
            <span style={S.kbd}>Esc</span> cancela a gravação
          </div>
        </div>
      </div>

      <div style={S.kicker}>Ditado</div>
      <div style={S.card}>
        <div style={S.row}>
          <div>
            <div style={S.label}>Microfone</div>
            <div style={S.sub}>Qual entrada de áudio o ditado usa</div>
          </div>
          <select style={S.select} value={settings.micDeviceId || ''} onChange={(e) => update('micDeviceId', e.target.value)}>
            <option value="">Detecção automática</option>
            {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microfone'}</option>)}
          </select>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div>
            <div style={S.label}>Idioma do ditado</div>
            <div style={S.sub}>Reinicia o motor de transcrição ao trocar</div>
          </div>
          <select style={S.select} value={settings.language || 'pt'} onChange={(e) => update('language', e.target.value)}>
            <option value="pt">Português</option>
            <option value="en">English</option>
            <option value="auto">Automático</option>
          </select>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div>
            <div style={S.label}>Iniciar aplicativo no login</div>
            <div style={S.sub}>O Dita Aí abre sozinho quando você liga o computador</div>
          </div>
          <Toggle checked={settings.openAtLogin !== 'false'} onChange={(v) => update('openAtLogin', String(v))} />
        </div>
      </div>

      {motor && <MotorTranscricao motor={motor} recarregar={recarregarMotor} />}

      {/* A assinatura vira MENTIRA no modo tempo real: ali o áudio sai da
          máquina e vai para o Google. Ela é condicional, e não some — a linha
          continua dizendo o que acontece com o áudio, só que a verdade certa.
          Enquanto o motor não carregou não se afirma nada: um flash de
          "100% LOCAL" para quem está no modo remoto seria a mesma mentira, só
          que rápida. */}
      {motor && (
        <div style={{ fontSize: 12, color: C.muted, fontFamily: MONO, letterSpacing: '.04em' }}>
          {motor.engine === 'gemini'
            ? 'DITA AÍ v0.3 · MODO TEMPO REAL · O ÁUDIO É ENVIADO AO GOOGLE'
            : 'DITA AÍ v0.3 · 100% LOCAL · O ÁUDIO NUNCA SAI DA SUA MÁQUINA'}
        </div>
      )}
    </>
  )
}

function dayLabel(dateStr) {
  const today = new Date()
  const d = new Date(dateStr + 'T00:00:00')
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - d) / 86400000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}

function Historico() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => { window.dita.listHistory().then(setRows) }, [])

  const groups = useMemo(() => {
    const filtered = q ? rows.filter((r) => r.text.toLowerCase().includes(q.toLowerCase())) : rows
    const map = new Map()
    for (const r of filtered) {
      const day = (r.created_at || '').slice(0, 10)
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(r)
    }
    return [...map.entries()]
  }, [rows, q])

  function copy(row) {
    window.dita.copyText(row.text)
    setCopiedId(row.id)
    setTimeout(() => setCopiedId(null), 1200)
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
        <h1 style={{ ...S.h1, margin: 0 }}>Histórico</h1>
        <input
          placeholder="Buscar ditados…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ ...S.select, width: 210, maxWidth: 210 }}
        />
      </div>
      {groups.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>Nenhum ditado ainda. Aperta o atalho e fala.</div>}
      {groups.map(([day, items]) => (
        <div key={day} style={{ marginBottom: 18 }}>
          <div style={S.kicker}>{dayLabel(day)}</div>
          <div style={S.card}>
            {items.map((r, i) => (
              <div key={r.id} style={{ ...S.row, ...(i > 0 ? S.divider : {}), alignItems: 'flex-start' }}>
                <div style={{ minWidth: 50, color: C.muted, fontSize: 12, paddingTop: 2, fontFamily: MONO }}>
                  {(r.created_at || '').slice(11, 16)}
                </div>
                <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{r.text}</div>
                <button onClick={() => copy(r)} style={{
                  background: copiedId === r.id ? C.accent : C.hover, color: copiedId === r.id ? C.ink : C.muted,
                  border: `1px solid ${C.border}`, borderRadius: 999, padding: '4px 12px', cursor: 'pointer', fontSize: 12, flexShrink: 0, fontFamily: FONT, fontWeight: 600
                }}>{copiedId === r.id ? 'Copiado' : 'Copiar'}</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export default function Settings() {
  const [section, setSection] = useState('historico')
  const [settings, setSettings] = useState(null)
  const [mics, setMics] = useState([])

  useEffect(() => {
    (async () => {
      setSettings(await window.dita.getSettings())
      const devices = await navigator.mediaDevices.enumerateDevices()
      setMics(devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'))
    })()
  }, [])

  if (!settings) return null

  async function update(key, value) {
    setSettings({ ...settings, [key]: value })
    await window.dita.setSetting(key, value)
  }

  return (
    <div style={S.shell}>
      <div style={S.sidebar}>
        <div style={S.brand}>
          <Equalizer size={22} color={C.accent} />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em' }}>dita aí</span>
        </div>
        <div style={S.navItem(section === 'historico')} onClick={() => setSection('historico')}>Histórico</div>
        <div style={S.navItem(section === 'config')} onClick={() => setSection('config')}>Configurações</div>
      </div>
      <div style={S.content}>
        {section === 'historico' ? <Historico /> : <Config settings={settings} mics={mics} update={update} />}
      </div>
    </div>
  )
}
