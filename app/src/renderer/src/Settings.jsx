import { useEffect, useMemo, useRef, useState } from 'react'
import { ATALHOS, specDeEvento, rotuloToggle, rotuloPttCurto } from './atalhos'

// Paleta do Wispr Flow (tokens sand/vast), declarada em tema.css como variáveis
// de CSS: assim o tema claro/escuro segue o do sistema sem nenhum código aqui.
const C = {
  bg: 'var(--fundo)',            // fundo do app e barra lateral
  panel: 'var(--painel)',        // área de conteúdo
  card: 'var(--cartao)',         // cards
  hover: 'var(--campo)',         // hover / campos
  border: 'var(--borda)',        // borda
  text: 'var(--texto)',          // texto primário
  muted: 'var(--texto-apoio)',   // texto de apoio
  accent: 'var(--primaria)',     // destaque: o quase preto (claro) ou o creme (escuro)
  ink: 'var(--primaria-texto)',  // texto sobre o destaque
  // Única cor da paleta. Recusar um atalho precisa LER como recusa, e num
  // esquema todo neutro a mensagem some no meio dos textos de apoio.
  alerta: 'var(--alerta)'
}
const FONT = 'var(--fonte)'
const FONT_TITULO = 'var(--fonte-titulo)'
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
  h1: { fontFamily: FONT_TITULO, fontSize: 34, fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 1.1, margin: '0 0 22px' },
  kicker: { fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted, margin: '0 0 10px 2px' },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '2px 18px', marginBottom: 16 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', gap: 16 },
  divider: { borderTop: `1px solid ${C.border}` },
  label: { fontSize: 14, fontWeight: 600 },
  sub: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 1.5 },
  select: { padding: '7px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.hover, color: C.text, fontSize: 13, maxWidth: 230, fontFamily: FONT },
  kbd: { background: C.hover, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 7px', fontSize: 12, color: C.text, fontFamily: MONO },
  // coluna da direita das linhas de atalho: o controle em cima, a explicação
  // embaixo, mensagens de recusa são frases inteiras e não cabem numa linha
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
        <rect key={i} x={b.x} y={b.y} width="66" height={b.h} rx="33" style={{ fill: color }} />
      ))}
    </svg>
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
// contador do Google vai bater no limite real sem aviso, e o jeito de evitar
// isso não é caprichar na contagem (impossível daqui), é não prometer.
function BarraUso({ motor }) {
  const pct = Math.max(0, Math.min(100, Number(motor.percentual) || 0))
  const alto = pct >= 90
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--w-bg2)', overflow: 'hidden' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${Math.max(pct, 1)}%`, height: '100%', borderRadius: 999, background: alto ? 'var(--alerta)' : 'var(--w-fg)' }} />
      </div>
      <span>
        {motor.usoDiario} de {motor.limite} pedidos hoje ({pct}%). É uma estimativa contada neste computador:
        quem decide o limite de verdade é o Google.
      </span>
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

  const linhasChave = []
  if (!motor.temChave && motor.chaveCifrada) {
    linhasChave.push(<div key="c1" className="aj-desc" style={{ color: 'var(--alerta)' }}>Havia uma chave salva, mas ela foi cifrada em outro usuário ou em outro computador e não pode ser lida aqui. Cole a chave de novo.</div>)
  }
  if (motor.temChave && !motor.chaveCifrada) {
    linhasChave.push(<div key="c2" className="aj-desc" style={{ color: 'var(--alerta)' }}>Este computador não ofereceu cofre de senhas, então a chave ficou gravada sem cifra no config.json do app. Quem tiver acesso ao seu usuário consegue lê-la.</div>)
  }
  if (pedindoChave) {
    linhasChave.push(
      <div key="form" className="aj-texto" style={{ gap: 14 }}>
        <div className="aj-rot">Chave do Google Gemini</div>
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }} className="aj-desc">
          {PASSOS_CHAVE.map((passo) => <li key={passo}>{passo}</li>)}
        </ol>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* type=password por padrão: a chave é credencial e esta tela é a que
              se abre numa chamada compartilhando a tela. */}
          <input
            type={revelar ? 'text' : 'password'} value={chave}
            onChange={(e) => { setChave(e.target.value); setRecado(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && chave.trim() && !salvando) salvar() }}
            placeholder="Cole aqui o código gerado" autoComplete="off" spellCheck={false}
            aria-label="Chave da API do Google" className="aj-input"
          />
          <button type="button" className="aj-btn sec" onClick={() => setRevelar(!revelar)}>{revelar ? 'Ocultar' : 'Mostrar'}</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="aj-btn pri" onClick={salvar} disabled={salvando || !chave.trim()} style={{ opacity: chave.trim() ? 1 : 0.5 }}>{salvando ? 'Salvando…' : 'Salvar e ativar'}</button>
          {trocando && <button type="button" className="aj-btn sec" onClick={() => { setTrocando(false); setChave(''); setRecado(null) }}>Cancelar</button>}
        </div>
      </div>
    )
  } else {
    // Chave salva. O campo NUNCA é preenchido de volta: o motorEstado de
    // propósito não devolve a chave.
    linhasChave.push(<Linha key="k" rotulo="Chave do Google Gemini" descricao={motor.chaveCifrada ? 'Salva e cifrada pelo cofre do sistema.' : 'Salva.'}><button type="button" className="aj-btn sec" onClick={() => { setTrocando(true); setRecado(null) }}>Trocar</button></Linha>)
    linhasChave.push(<Linha key="r" rotulo="Remover chave" descricao="Apaga a chave deste computador. O ditado volta a funcionar só no modo do computador."><button type="button" className="aj-btn sec" onClick={remover}>Remover</button></Linha>)
  }
  if (recado) linhasChave.push(<div key="rec" className="aj-desc" style={recado.erro ? { color: 'var(--alerta)' } : undefined}>{recado.texto}</div>)
  if (motor.temChave) linhasChave.push(<div key="uso" className="aj-texto"><div className="aj-rot">Uso de hoje</div><div className="aj-desc"><BarraUso motor={motor} /></div></div>)

  return (
    <>
      <Cartao linhas={[
        <Linha key="m" rotulo="Motor de transcrição" descricao={gemini
          ? 'Tempo real, com a IA do Google Gemini: o texto sai na hora. Seu áudio vai para os servidores do Google enquanto você fala.'
          : 'No computador, sem configurar nada. Mais lento: o texto leva de 7 a 10 segundos.'}>
          <Seletor itens={[['gemini', 'Tempo real'], ['local', 'No computador']]} valor={motor.engine} onEscolher={escolher} />
        </Linha>
      ]} />
      {gemini && <Cartao titulo="Gemini" linhas={linhasChave} />}
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
// ---------------------------------------------------------------------------
// Janela principal no layout do Wispr Flow (medidas do CSS do app deles,
// 2026-11-17): barra lateral de 216 px com itens de 14 px peso 550, painel de
// conteúdo claro com borda e raio 12, e os Ajustes num painel por cima
// (960x640, barra lateral própria com as seções, linhas com rótulo à esquerda
// e controle de 220 px à direita).
// ---------------------------------------------------------------------------
const CSS_HUB = `
.hub { display: flex; height: 100vh; background: var(--fundo); color: var(--texto); font-family: var(--fonte); overflow: hidden; -webkit-font-smoothing: antialiased; }
.hub button { font-family: inherit; }
.lateral { width: 216px; padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; -webkit-app-region: drag; user-select: none; }
.marca { display: flex; align-items: center; gap: 8px; padding: 4px 5px; margin: 34px 0 16px; }
.nav { display: flex; flex-direction: column; gap: 4px; }
.item { -webkit-app-region: no-drag; border: 0; background: transparent; color: var(--texto); border-radius: 6px; display: flex; align-items: center; gap: 8px; padding: 8px; width: 100%; font-size: 14px; line-height: 20px; font-weight: 550; cursor: pointer; text-align: left; transition: background-color .15s; }
.item:hover, .item.ativo { background: var(--campo); }
.item svg { width: 20px; height: 20px; flex-shrink: 0; }
.rodape-lateral { margin-top: auto; padding-top: 8px; border-top: 1px solid var(--borda); }
.painel { flex: 1; min-width: 0; margin: 8px 8px 8px 0; background: var(--painel); border: 1px solid var(--borda); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
.rolagem { flex: 1; overflow-y: auto; }
.rolagem::-webkit-scrollbar { width: 8px; }
.rolagem::-webkit-scrollbar-thumb { background: var(--campo); border-radius: 4px; }
.miolo { max-width: 800px; margin: 0 auto; padding: 40px 32px 80px; box-sizing: border-box; }
.titulo { font-family: var(--fonte-titulo); font-weight: 400; font-size: 36px; line-height: 1.1; letter-spacing: -0.04em; margin: 0; }
.topo { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.numeros { display: flex; gap: 6px; flex-wrap: wrap; }
.numero { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--borda); background: var(--cartao); font-size: 13px; line-height: 20px; font-weight: 550; }
.numero svg { width: 14px; height: 14px; opacity: .7; }
.dica { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; border-radius: 16px; background: var(--primaria); color: var(--primaria-texto); margin-bottom: 32px; }
.dica h3 { font-family: var(--fonte-titulo); font-weight: 400; font-size: 24px; letter-spacing: -0.03em; margin: 0 0 4px; }
.dica p { margin: 0; font-size: 14px; line-height: 20px; opacity: .7; }
.tecla { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1px solid currentColor; opacity: .9; margin: 0 2px; }
.cabeca-lista { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 10px; }
.rotulo-dia { font-size: 12px; line-height: 20px; letter-spacing: .075em; text-transform: uppercase; font-weight: 600; color: var(--texto-apoio); margin: 22px 0 8px; }
.cartao { background: var(--cartao); border: 1px solid var(--borda); border-radius: 12px; overflow: hidden; }
.linha { display: flex; gap: 16px; padding: 14px 16px; align-items: flex-start; position: relative; }
.linha + .linha { border-top: 1px solid var(--borda); }
.linha:hover { background: color-mix(in srgb, var(--campo) 45%, transparent); }
.hora { width: 72px; flex-shrink: 0; font-size: 14px; line-height: 20px; color: var(--texto-apoio); }
.texto { flex: 1; min-width: 0; font-size: 14px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
.acoes { display: flex; gap: 4px; opacity: 0; transition: opacity .12s; }
.linha:hover .acoes { opacity: 1; }
.btn-icone { border: 0; background: transparent; color: var(--texto-apoio); width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.btn-icone:hover { background: var(--campo); color: var(--texto); }
.btn-icone svg { width: 16px; height: 16px; }
.btn { border: 0; border-radius: 8px; padding: 6px 12px; font-size: 14px; line-height: 20px; font-weight: 600; cursor: pointer; background: var(--primaria); color: var(--primaria-texto); }
.btn.sec { background: var(--campo); color: var(--texto); }
.btn:disabled { opacity: .45; cursor: default; }
.busca { height: 32px; width: 220px; box-sizing: border-box; border: 1px solid var(--borda); border-radius: 8px; padding: 0 10px; background: var(--cartao); color: var(--texto); font-size: 14px; font-family: inherit; outline: none; }
.busca:focus { border-color: var(--texto-apoio); }
.vazio { padding: 48px 16px; text-align: center; color: var(--texto-apoio); font-size: 14px; }
/* Painel de Ajustes do Wispr Flow (medidas, cores e textos tirados do app
   deles em 2026-11-17: modal 960x640 sobre um véu escuro, barra lateral de
   192 px, título em serifa 28 px, cartões com linhas divididas e o botão
   "Mudar" de 164 px). */
.aj-veu { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; background: var(--w-veu); animation: aparece .15s ease-out; -webkit-app-region: no-drag; }
.aj-modal { display: flex; width: min(960px, 100vw - 48px); height: min(640px, 100vh - 88px); background: var(--w-branco); color: var(--w-fg); border-radius: 12px; box-shadow: var(--w-sombra-xl); overflow: hidden; animation: escala .15s var(--w-mola); }
.aj-lado { display: flex; flex-direction: column; justify-content: space-between; padding: 8px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--w-borda); border-radius: 12px 0 0 12px; background: var(--w-bg3); user-select: none; }
.aj-topo { width: 192px; display: flex; flex-direction: column; gap: 6px; }
.aj-titulo-lado { display: flex; padding: 8px; font-size: 12px; line-height: 20px; text-transform: uppercase; letter-spacing: .075em; font-weight: 600; color: var(--w-n500); }
.aj-itens { display: flex; flex-direction: column; }
.aj-item { display: flex; min-height: 36px; padding: 8px; gap: 8px; align-items: center; border-radius: 8px; border: 0; background: transparent; color: var(--w-fg); font-family: inherit; font-size: 14px; line-height: 20px; font-weight: 550; cursor: pointer; text-align: left; width: 100%; }
.aj-item:hover, .aj-item.ativo { background: var(--w-borda); }
.aj-item svg { width: 18px; height: 18px; flex-shrink: 0; }
.aj-divisor-lado { height: 1px; background: var(--w-borda); margin: 6px 0; }
.aj-versao { display: flex; padding: 6px 8px; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 20px; color: var(--w-n500); }
.aj-versao svg { width: 18px; height: 18px; }
.aj-pagina { flex: 1 0 0; min-width: 0; display: flex; flex-direction: column; gap: 36px; padding: 48px; position: relative; }
.aj-pagina > h3 { font-family: var(--fonte-titulo); font-weight: 400; letter-spacing: -0.04em; font-size: 28px; line-height: 28px; margin: 0; -webkit-font-smoothing: antialiased; }
.aj-conteudo { display: flex; flex-direction: column; gap: 24px; flex: 1 0 0; min-height: 0; overflow-y: auto; }
.aj-conteudo::-webkit-scrollbar { display: none; }
.aj-secao { display: flex; flex-direction: column; gap: 16px; }
.aj-secao > .t { font-size: 14px; line-height: 20px; font-weight: 600; }
.aj-cartao { display: flex; flex-direction: column; gap: 20px; padding: 20px; border-radius: 12px; background: var(--w-bg3); }
.aj-linha { display: flex; justify-content: space-between; align-items: center; margin: -8px -12px; padding: 8px 12px; border-radius: 8px; }
.aj-texto { display: flex; flex-direction: column; gap: 6px; flex: 1 1 0; min-width: 0; }
.aj-rot { font-size: 14px; line-height: 20px; font-weight: 550; }
.aj-desc { font-size: 14px; line-height: 20px; color: var(--w-n600); overflow-wrap: break-word; }
.aj-ctrl { width: 164px; flex-shrink: 0; margin-left: 12px; display: flex; justify-content: flex-end; align-items: center; position: relative; }
.aj-ctrl > .aj-btn { width: 100%; }
.aj-div { height: 1px; background: var(--w-borda); }
.aj-tecla-inline { display: inline-flex; margin: 0 4px; font-weight: 600; color: var(--w-fg); }
.aj-btn { display: flex; justify-content: center; align-items: center; gap: 8px; padding: 8px 16px; border: 0; border-radius: 8px; font-family: inherit; font-size: 14px; line-height: 20px; font-weight: 550; cursor: pointer; user-select: none; transition: background-color .4s var(--w-mola); }
.aj-btn.sec { color: var(--w-fg); background: var(--w-bg2); font-weight: 600; }
.aj-btn.sec:hover { background: color-mix(in srgb, var(--w-bg2), var(--w-fg) 6%); }
.aj-btn.pri { color: var(--w-primaria-texto); background: var(--w-primaria); }
.aj-btn.pri:hover { background: color-mix(in srgb, var(--w-primaria), var(--w-bg) 10%); }
.aj-btn.perigo { color: #fff; background: #e5484d; }
.aj-btn.perigo:hover { background: #ec5d61; }
.aj-sw { position: relative; display: inline-block; width: 42px; height: 25px; flex-shrink: 0; border-radius: 9999px; background: var(--w-switch); transition: background-color .1s; cursor: pointer; }
.aj-sw.on { background: var(--w-primaria); }
.aj-sw input { position: absolute; opacity: 0; width: 0; height: 0; }
.aj-sw:has(input:focus-visible) { outline: 2px solid var(--vast-300); }
.aj-sw i { position: absolute; inset: 0; margin: 2px; }
.aj-sw i::before { content: ""; display: block; width: 21px; height: 21px; border-radius: 50%; background: #fff; transition: transform .15s var(--w-mola); }
.aj-sw.on i::before { transform: translateX(17px); }
@media (prefers-color-scheme: dark) { .aj-sw.on i::before { background: var(--w-bg); } }
.aj-sel { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 8px 12px; border: 0; border-radius: 6px; background: var(--w-branco); color: var(--w-fg); font-family: inherit; font-size: 14px; line-height: 20px; outline: 1px solid var(--w-borda); cursor: pointer; }
.aj-sel:hover, .aj-sel.aberto { outline: 2px solid var(--w-n500); }
.aj-sel .v { display: flex; align-items: center; gap: 8px; min-width: 0; }
.aj-sel svg { flex-shrink: 0; }
.aj-sel .seta { transition: transform .2s cubic-bezier(0.05, 0.6, 0.4, 0.95); }
.aj-sel.aberto .seta { transform: rotate(-180deg); }
.aj-menu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 100%; box-sizing: border-box; z-index: 40; padding: 4px; border: 1px solid var(--w-borda); border-radius: 8px; background: var(--w-bg); box-shadow: var(--w-sombra-xl); animation: aparece .1s ease-out; }
.aj-op { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--w-fg); font-family: inherit; font-size: 14px; line-height: 20px; cursor: pointer; text-align: left; white-space: nowrap; }
.aj-op:hover { background: var(--w-bg3); }
.aj-op .v { display: flex; align-items: center; gap: 8px; }
/* diálogos que abrem por cima do painel (Atalhos, Microfone, Idiomas) */
.aj-dveu { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; background: var(--w-veu); animation: aparece .15s ease-out; }
.aj-dialogo { min-width: 200px; max-width: calc(100vw - 48px); max-height: calc(100vh - 58px); overflow: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 32px; padding: 24px; border: 1px solid var(--w-borda); border-radius: 12px; background: var(--w-bg); color: var(--w-fg); box-shadow: var(--w-sombra-xl); animation: escala .15s var(--w-mola); }
.aj-dialogo::-webkit-scrollbar { width: 8px; }
.aj-dialogo::-webkit-scrollbar-thumb { background: var(--w-borda); border-radius: 4px; }
.aj-dcab { display: flex; justify-content: space-between; gap: 24px; }
.aj-dcab > div { display: flex; flex-direction: column; gap: 8px; max-width: 416px; }
.aj-dtit { font-size: 18px; line-height: 28px; font-weight: 600; }
.aj-dsub { font-size: 14px; line-height: 20px; color: var(--w-n500); }
.aj-fechar { border: 0; background: transparent; padding: 0; height: 20px; cursor: pointer; color: var(--w-n500); }
.aj-fechar:hover { color: var(--w-n600); }
.aj-fechar svg { width: 20px; height: 20px; }
.aj-atalhos { display: flex; flex-direction: column; gap: 16px; max-width: 650px; }
.aj-at-itens { display: flex; flex-direction: column; gap: 24px; padding: 16px; max-height: 400px; overflow-y: auto; }
.aj-at-item { display: flex; gap: 24px; align-items: flex-start; padding: 16px 24px; border-radius: 8px; background: var(--w-bg3); }
.aj-at-rot { flex: 1 0 0; display: flex; flex-direction: column; gap: 4px; }
.aj-at-rot .t { font-size: 14px; line-height: 20px; font-weight: 600; }
.aj-at-rot .d { font-size: 12px; line-height: 20px; color: var(--w-fg2); max-width: 240px; }
.aj-at-sel { width: 264px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; position: relative; }
.aj-campo { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; width: 216px; min-height: 44px; box-sizing: border-box; padding: 0 6px 0 12px; border: 1px solid var(--w-borda); border-radius: 8px; background: var(--w-branco); color: var(--w-fg3); font-family: inherit; font-size: 12px; line-height: 20px; text-align: left; }
button.aj-campo { cursor: pointer; }
button.aj-campo:hover, .aj-campo.capturando { outline: 2px solid var(--w-n500); outline-offset: -1px; }
.aj-tecla { display: inline-flex; padding: 2px 4px; justify-content: center; align-items: center; border-radius: 4px; border: 1px solid var(--w-borda); background: var(--w-bg3); color: var(--w-fg); font-size: 14px; line-height: 20px; }
.aj-presets { display: flex; flex-wrap: wrap; gap: 6px; width: 216px; }
.aj-preset { border: 1px dashed var(--w-fg3); border-radius: 8px; background: transparent; color: var(--w-fg3); padding: 2px 8px; font-family: inherit; font-size: 12px; line-height: 20px; cursor: pointer; }
.aj-preset:hover { border-style: solid; color: var(--w-fg); }
.aj-input { flex: 1; min-width: 0; min-height: 36px; box-sizing: border-box; padding: 8px 12px; border: 0; border-radius: 6px; background: var(--w-branco); color: var(--w-fg); outline: 1px solid var(--w-borda); font-family: inherit; font-size: 14px; line-height: 20px; }
.aj-input:focus { outline: 2px solid var(--w-n500); }
.aj-nota { width: 216px; font-size: 12px; line-height: 18px; color: var(--w-fg3); }
.aj-nota.erro { color: var(--alerta); }
.aj-at-rodape { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 0 24px 0 16px; }
.aj-lista { display: flex; flex-direction: column; gap: 8px; width: 440px; }
.aj-opcao { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border: 1px solid transparent; border-radius: 8px; background: var(--w-bg3); color: var(--w-fg); font-family: inherit; font-size: 14px; line-height: 20px; font-weight: 550; cursor: pointer; text-align: left; }
.aj-opcao:hover { border-color: var(--w-borda); }
.aj-opcao.sel { border-color: var(--w-fg); }
.aj-aviso { display: flex; gap: 12px; padding: 16px; border: 1px solid #e8a33d; border-radius: 12px; background: color-mix(in srgb, #e8a33d 10%, var(--w-bg)); font-size: 14px; line-height: 20px; font-weight: 550; width: 440px; box-sizing: border-box; }
.aj-rodape-dialogo { display: flex; justify-content: flex-end; gap: 8px; }
@keyframes escala { from { opacity: 0; transform: scale(.9) } to { opacity: 1; transform: none } }
@keyframes aparece { from { opacity: 0 } to { opacity: 1 } }
@keyframes sobe { from { opacity: 0; transform: translateY(8px) scale(.985) } to { opacity: 1; transform: none } }
`

// Ícones de traço simples desenhados aqui (nada copiado do Wispr).
const I = {
  inicio: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-6h4v6" /></svg>,
  dicionario: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></svg>,
  ajustes: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  sistema: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>,
  onda: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" /></svg>,
  fogo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-2 1-3 1-3s.5 2 2 2c0-3-1-5 1-8z" /></svg>,
  texto: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>,
  raio: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>,
  copiar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  ok: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>,
  lixo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
}

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR')

function dayLabel(dateStr) {
  const today = new Date()
  const d = new Date(dateStr + 'T00:00:00')
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - d) / 86400000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}

function Inicio({ settings }) {
  const [rows, setRows] = useState([])
  const [resumo, setResumo] = useState(null)
  const [q, setQ] = useState('')
  const [copiado, setCopiado] = useState(null)

  async function carregar() {
    const [h, r] = await Promise.all([window.dita.listHistory(), window.dita.resumo()])
    setRows(h); setResumo(r)
  }
  useEffect(() => { carregar() }, [])

  const grupos = useMemo(() => {
    const f = q ? rows.filter((r) => r.text.toLowerCase().includes(q.toLowerCase())) : rows
    const m = new Map()
    for (const r of f) {
      const dia = (r.created_at || '').slice(0, 10)
      if (!m.has(dia)) m.set(dia, [])
      m.get(dia).push(r)
    }
    return [...m.entries()]
  }, [rows, q])

  function copiar(r) {
    window.dita.copyText(r.text)
    setCopiado(r.id)
    setTimeout(() => setCopiado(null), 1200)
  }
  async function apagar(r) {
    await window.dita.deleteHistory(r.id)
    carregar()
  }

  const nome = resumo?.nome
  const ptt = rotuloPttCurto(settings.pttShortcut || 'fn', settings.platform)
  return (
    <div className="miolo">
      <div className="topo">
        <h1 className="titulo">{nome ? `Bem-vindo de volta, ${nome}` : 'Bem-vindo de volta'}</h1>
        {resumo && (
          <div className="numeros">
            <span className="numero" title="Dias seguidos ditando">{I.fogo}{fmt(resumo.diasSeguidos)} {resumo.diasSeguidos === 1 ? 'dia' : 'dias'}</span>
            <span className="numero" title="Palavras ditadas no total">{I.texto}{fmt(resumo.palavras)} palavras</span>
            <span className="numero" title="Velocidade média">{I.raio}{fmt(resumo.ppm)} ppm</span>
          </div>
        )}
      </div>

      <div className="dica">
        <div>
          <h3>Dite em qualquer app</h3>
          <p>Segure <span className="tecla">{ptt}</span> e fale. Toque duas vezes para mãos livres, e <span className="tecla">esc</span> cancela.</p>
        </div>
      </div>

      <div className="cabeca-lista">
        <div className="secao" style={{ margin: 0 }}>Histórico</div>
        <input className="busca" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {grupos.length === 0 && <div className="cartao"><div className="vazio">{q ? 'Nada encontrado.' : 'Nenhum ditado ainda. Segure a tecla e fale.'}</div></div>}
      {grupos.map(([dia, itens]) => (
        <div key={dia}>
          <div className="rotulo-dia">{dayLabel(dia)}</div>
          <div className="cartao">
            {itens.map((r) => (
              <div key={r.id} className="linha">
                <div className="hora">{new Date((r.created_at || '').replace(' ', 'T')).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                <div className="texto">{r.text}</div>
                <div className="acoes">
                  <button className="btn-icone" title={copiado === r.id ? 'Copiado' : 'Copiar'} onClick={() => copiar(r)}>{copiado === r.id ? I.ok : I.copiar}</button>
                  <button className="btn-icone" title="Apagar" onClick={() => apagar(r)}>{I.lixo}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Dicionario() {
  const [itens, setItens] = useState([])
  const [termo, setTermo] = useState('')
  const [troca, setTroca] = useState('')
  const [abrindo, setAbrindo] = useState(false)
  async function carregar() { setItens(await window.dita.dictList()) }
  useEffect(() => { carregar() }, [])
  async function adicionar() {
    if (!termo.trim()) return
    await window.dita.dictAdd(termo, troca)
    setTermo(''); setTroca(''); setAbrindo(false)
    carregar()
  }
  async function remover(id) { await window.dita.dictRemove(id); carregar() }
  return (
    <div className="miolo">
      <div className="topo">
        <h1 className="titulo">Dicionário</h1>
        <button className="btn" onClick={() => setAbrindo(!abrindo)}>Adicionar nova</button>
      </div>
      <p style={{ margin: '-8px 0 24px', fontSize: 14, lineHeight: '20px', color: 'var(--texto-apoio)' }}>
        Nomes, marcas e termos que o Dita Aí precisa escrever do seu jeito. Se ele costuma errar uma palavra, diga como ela soa e como deve sair.
      </p>
      {abrindo && (
        <div className="cartao" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <input autoFocus className="busca" style={{ flex: 1, minWidth: 180 }} placeholder="Palavra (ex.: Seviva)" value={termo}
            onChange={(e) => setTermo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adicionar()} />
          <input className="busca" style={{ flex: 1, minWidth: 180 }} placeholder="Escrever como (opcional)" value={troca}
            onChange={(e) => setTroca(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adicionar()} />
          <button className="btn" disabled={!termo.trim()} onClick={adicionar}>Salvar</button>
          <button className="btn sec" onClick={() => setAbrindo(false)}>Cancelar</button>
        </div>
      )}
      <div className="cartao">
        {itens.length === 0 && <div className="vazio">Nenhuma palavra ainda.</div>}
        {itens.map((d) => (
          <div key={d.id} className="linha" style={{ alignItems: 'center' }}>
            <div className="texto" style={{ fontWeight: 550 }}>
              {d.term}{d.replacement && d.replacement !== d.term && <span style={{ color: 'var(--texto-apoio)', fontWeight: 400 }}>{'  →  '}{d.replacement}</span>}
            </div>
            <div className="acoes"><button className="btn-icone" title="Remover" onClick={() => remover(d.id)}>{I.lixo}</button></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Painel de Ajustes no padrão do Wispr Flow (estrutura, textos e medidas lidos
// do app deles em 2026-11-17). Cada página é uma lista de seções; cada seção é
// um cartão com linhas "rótulo + descrição à esquerda, controle de 164 px à
// direita", separadas por um fio. Os botões "Mudar" abrem um diálogo por cima.
// Só entra o que o Dita Aí faz de verdade: nada de chave sem efeito.
// ---------------------------------------------------------------------------
const AJ_ICONES = {
  geral: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></svg>,
  sistema: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></svg>,
  transcricao: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" /></svg>,
  dados: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>,
  nuvem: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z" /><path d="m9.5 13.5 2 2 3.5-3.5" /></svg>,
  seta: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="seta"><path d="m6 9 6 6 6-6" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  sol: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  lua: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>,
  tela: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></svg>
}

const TEMAS = [['claro', 'Claro', AJ_ICONES.sol], ['escuro', 'Escuro', AJ_ICONES.lua], ['sistema', 'Sistema', AJ_ICONES.tela]]
const IDIOMAS = [['pt', 'Português'], ['en', 'English'], ['auto', 'Detectar automaticamente']]
const MIC_EMBUTIDO = /macbook|built-?in|embutid|interno|internal/i

function Interruptor({ ligado, onChange, rotulo }) {
  return (
    <label className={'aj-sw' + (ligado ? ' on' : '')}>
      <input type="checkbox" checked={ligado} aria-label={rotulo} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  )
}

// Menu que abre embaixo do controle (o "menuSelect" do Wispr: Tema).
function Seletor({ itens, valor, onEscolher }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e) => { if (!ref.current?.contains(e.target)) setAberto(false) }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  }, [aberto])
  const atual = itens.find(([v]) => v === valor) || itens[0]
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button type="button" className={'aj-sel' + (aberto ? ' aberto' : '')} onClick={() => setAberto(!aberto)}>
        <span className="v">{atual[2]}{atual[1]}</span>{AJ_ICONES.seta}
      </button>
      {aberto && (
        <div className="aj-menu">
          {itens.map(([v, rotulo, icone]) => (
            <button key={v} type="button" className="aj-op" onClick={() => { setAberto(false); onEscolher(v) }}>
              <span className="v">{icone}{rotulo}</span>{v === valor ? AJ_ICONES.check : <span style={{ width: 16 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Teclas({ partes }) {
  return partes.map((p, i) => <span key={i} className="aj-tecla">{p}</span>)
}

// Campo de atalho do diálogo "Atalhos": mostra as teclas em pílulas; clicar
// entra em modo de captura (só para o mãos livres; o segurar-para-falar é uma
// tecla só e abre a lista, porque o Chromium não entrega a Fn ao JavaScript).
function CampoCaptura({ valor, plataforma, presets, onSave }) {
  const [capturando, setCapturando] = useState(false)
  const [erro, setErro] = useState(null)
  const botao = useRef(null)

  useEffect(() => {
    if (!capturando) return
    function onKeyDown(e) {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { setCapturando(false); setErro(null); return }
      const r = specDeEvento(e, plataforma)
      if (r.pendente) { setErro(null); return }
      if (!r.ok) { setErro(r.mensagem); return }
      setCapturando(false); setErro(null); onSave(r.spec)
    }
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

  return (
    <>
      <button ref={botao} type="button" className={'aj-campo' + (capturando ? ' capturando' : '')} onClick={() => { setErro(null); setCapturando(!capturando) }}>
        {capturando ? 'Pressione as teclas…' : <Teclas partes={rotuloToggle(valor, plataforma).split(' + ')} />}
      </button>
      {capturando && !erro && <div className="aj-nota">Esc cancela</div>}
      {erro && <div className="aj-nota erro">{erro}</div>}
      {presets?.length > 0 && !capturando && (
        <div className="aj-presets">
          {presets.filter(([spec]) => spec !== valor).map(([spec, rotulo]) => (
            <button key={spec} type="button" className="aj-preset" onClick={() => onSave(spec)}>Usar {rotulo}</button>
          ))}
        </div>
      )}
    </>
  )
}

function CampoLista({ opcoes, valor, onSave }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e) => { if (!ref.current?.contains(e.target)) setAberto(false) }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  }, [aberto])
  const atual = opcoes.find(([v]) => v === valor)
  return (
    <div ref={ref} style={{ position: 'relative', width: 216 }}>
      <button type="button" className="aj-campo" onClick={() => setAberto(!aberto)}>
        <Teclas partes={[valor === 'fn' ? 'fn' : (atual?.[1] || valor)]} />
      </button>
      {aberto && (
        <div className="aj-menu" style={{ left: 0, right: 'auto', width: 216 }}>
          {opcoes.map(([v, rotulo]) => (
            <button key={v} type="button" className="aj-op" onClick={() => { setAberto(false); onSave(v) }}>
              <span className="v">{rotulo}</span>{v === valor ? AJ_ICONES.check : <span style={{ width: 16 }} />}
            </button>
          ))}
        </div>
      )}
      {atual?.[2] && <div className="aj-nota" style={{ marginTop: 12 }}>{atual[2]}</div>}
    </div>
  )
}

function Dialogo({ titulo, subtitulo, onFechar, children }) {
  return (
    <div className="aj-dveu" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="aj-dialogo" role="dialog" aria-label={titulo}>
        <div className="aj-dcab">
          <div>
            <div className="aj-dtit">{titulo}</div>
            {subtitulo && <div className="aj-dsub">{subtitulo}</div>}
          </div>
          <button type="button" className="aj-fechar" aria-label="Fechar" onClick={onFechar}>{AJ_ICONES.x}</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function DialogoAtalhos({ settings, plataforma, atalhos, update, onFechar }) {
  const ptt = settings.pttShortcut || atalhos.padraoPtt
  const pttCurto = rotuloPttCurto(ptt, plataforma)
  const itens = [
    ['Segurar para falar', 'Segure para dizer algo curto', <CampoLista key="p" opcoes={atalhos.ptt} valor={ptt} onSave={(v) => update('pttShortcut', v)} />],
    ['Mãos livres', 'Dite sem as mãos: aperte este atalho para começar e para parar',
      <>
        <CampoCaptura valor={settings.toggleShortcut || atalhos.padraoToggle} plataforma={plataforma} presets={atalhos.presets} onSave={(spec) => update('toggleShortcut', spec)} />
        <div className="aj-campo" style={{ gap: 8 }}>Toque duas vezes <span style={{ display: 'flex', gap: 6 }}><Teclas partes={[pttCurto]} /></span></div>
      </>],
    ['Cancelar', 'Descarta o ditado e as notificações', <div key="c" className="aj-campo"><Teclas partes={['esc']} /></div>]
  ]
  return (
    <Dialogo titulo="Atalhos" subtitulo="Escolha os atalhos que você prefere para usar o Dita Aí." onFechar={onFechar}>
      <div className="aj-atalhos">
        <div className="aj-at-itens">
          {itens.map(([t, d, controle]) => (
            <div key={t} className="aj-at-item">
              <div className="aj-at-rot"><div className="t">{t}</div><div className="d">{d}</div></div>
              <div className="aj-at-sel">{controle}</div>
            </div>
          ))}
        </div>
        <div className="aj-at-rodape">
          <button type="button" className="aj-btn sec" onClick={() => { update('pttShortcut', atalhos.padraoPtt); update('toggleShortcut', atalhos.padraoToggle) }}>Restaurar padrão</button>
          <button type="button" className="aj-btn pri" onClick={onFechar}>Pronto</button>
        </div>
      </div>
    </Dialogo>
  )
}

function DialogoMicrofone({ settings, mics, update, onFechar }) {
  const escolhido = settings.micDeviceId || ''
  const outros = mics.filter((m) => !MIC_EMBUTIDO.test(m.label || ''))
  const atual = mics.find((m) => m.deviceId === escolhido)
  const opcoes = [['', 'Microfone do Mac (recomendado)'], ...outros.map((m) => [m.deviceId, m.label || 'Microfone'])]
  return (
    <Dialogo titulo="Microfone" subtitulo="Usado no ditado." onFechar={onFechar}>
      <div className="aj-lista">
        {opcoes.map(([id, rotulo]) => (
          <button key={id || 'mac'} type="button" className={'aj-opcao' + (id === escolhido ? ' sel' : '')} onClick={() => update('micDeviceId', id)}>
            <span>{rotulo}</span>{id === escolhido && AJ_ICONES.check}
          </button>
        ))}
      </div>
      {/* Mesmo aviso do Wispr: abrir o microfone do AirPods derruba o fone pro
          modo de chamada (som pior) e custa cerca de 1 s no começo do ditado. */}
      {/airpods/i.test(atual?.label || '') && (
        <div className="aj-aviso"><span>⚠️</span><span>AirPods não são os melhores para ditado: o som do fone cai para o modo de chamada e o microfone demora cerca de 1 segundo para abrir.</span></div>
      )}
      <div className="aj-rodape-dialogo"><button type="button" className="aj-btn pri" onClick={onFechar}>Pronto</button></div>
    </Dialogo>
  )
}

function DialogoIdiomas({ settings, update, onFechar }) {
  const atual = settings.language || 'pt'
  return (
    <Dialogo titulo="Idiomas" subtitulo="Selecione o idioma em que você fala para transcrever melhor." onFechar={onFechar}>
      <div className="aj-lista">
        {IDIOMAS.map(([v, rotulo]) => (
          <button key={v} type="button" className={'aj-opcao' + (v === atual ? ' sel' : '')} onClick={() => update('language', v)}>
            <span>{rotulo}</span>{v === atual && AJ_ICONES.check}
          </button>
        ))}
      </div>
      <div className="aj-rodape-dialogo"><button type="button" className="aj-btn pri" onClick={onFechar}>Pronto</button></div>
    </Dialogo>
  )
}

function DialogoApagar({ onFechar }) {
  const [apagando, setApagando] = useState(false)
  return (
    <Dialogo titulo="Apagar seu histórico?" subtitulo="Isso apaga todos os ditados guardados neste computador. Não dá para desfazer. Seus ajustes e o dicionário continuam." onFechar={onFechar}>
      <div className="aj-rodape-dialogo">
        <button type="button" className="aj-btn sec" onClick={onFechar}>Cancelar</button>
        <button type="button" className="aj-btn perigo" disabled={apagando} onClick={async () => { setApagando(true); await window.dita.clearHistory(); onFechar() }}>Apagar</button>
      </div>
    </Dialogo>
  )
}

// Uma linha do cartão. `controle` vem pronto (botão, interruptor ou seletor).
function Linha({ rotulo, descricao, children }) {
  return (
    <div className="aj-linha">
      <div className="aj-texto">
        <div className="aj-rot">{rotulo}</div>
        {descricao && <div className="aj-desc">{descricao}</div>}
      </div>
      <div className="aj-ctrl">{children}</div>
    </div>
  )
}

function Cartao({ titulo, linhas }) {
  const vivas = linhas.filter(Boolean)
  return (
    <div className="aj-secao">
      {titulo && <div className="t">{titulo}</div>}
      <div className="aj-cartao">
        {vivas.map((l, i) => (
          <div key={i} style={{ display: 'contents' }}>
            {l}
            {i < vivas.length - 1 && <div className="aj-div" />}
          </div>
        ))}
      </div>
    </div>
  )
}

const Mudar = ({ onClick }) => <button type="button" className="aj-btn sec" onClick={onClick}>Mudar</button>

function PainelAjustes({ settings, mics, update, onFechar }) {
  const [pagina, setPagina] = useState('geral')
  const [dialogo, setDialogo] = useState(null)
  const plataforma = ATALHOS[settings.platform] ? settings.platform : 'darwin'
  const atalhos = ATALHOS[plataforma]
  const [motor, setMotor] = useState(null)
  async function recarregarMotor() {
    try { setMotor(await window.dita.motorEstado()) } catch (err) { console.error('motorEstado:', err) }
  }
  useEffect(() => { recarregarMotor() }, [])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') { if (dialogo) setDialogo(null); else onFechar() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar, dialogo])

  const ptt = rotuloPttCurto(settings.pttShortcut || atalhos.padraoPtt, plataforma)
  const micAtual = mics.find((m) => m.deviceId === settings.micDeviceId)
  const descMic = !settings.micDeviceId ? 'Microfone do Mac (recomendado)' : (micAtual?.label || 'Microfone escolhido')
  const descIdioma = (IDIOMAS.find(([v]) => v === (settings.language || 'pt')) || IDIOMAS[0])[1]

  const grupos = [
    ['Ajustes', [['geral', 'Geral', AJ_ICONES.geral], ['sistema', 'Sistema', AJ_ICONES.sistema], ['transcricao', 'Transcrição', AJ_ICONES.transcricao]]],
    ['Conta', [['dados', 'Dados e privacidade', AJ_ICONES.dados]]]
  ]
  const titulos = { geral: 'Geral', sistema: 'Sistema', transcricao: 'Transcrição', dados: 'Dados e privacidade' }

  let secoes = null
  if (pagina === 'geral') {
    secoes = (
      <Cartao linhas={[
        <Linha key="a" rotulo="Atalhos" descricao={<span>Segure<span className="aj-tecla-inline">{ptt}</span>e fale.</span>}><Mudar onClick={() => setDialogo('atalhos')} /></Linha>,
        <Linha key="m" rotulo="Microfone" descricao={descMic}><Mudar onClick={() => setDialogo('microfone')} /></Linha>,
        <Linha key="i" rotulo="Meus idiomas" descricao={descIdioma}><Mudar onClick={() => setDialogo('idiomas')} /></Linha>,
        <Linha key="t" rotulo="Tema"><Seletor itens={TEMAS} valor={settings.tema || 'sistema'} onEscolher={(v) => update('tema', v)} /></Linha>
      ]} />
    )
  } else if (pagina === 'sistema') {
    secoes = (
      <>
        <Cartao titulo="Configurações do app" linhas={[
          <Linha key="l" rotulo="Abrir o app ao iniciar sessão"><Interruptor rotulo="Abrir o app ao iniciar sessão" ligado={settings.openAtLogin !== 'false'} onChange={(v) => update('openAtLogin', String(v))} /></Linha>,
          <Linha key="p" rotulo="Mostrar a pílula o tempo todo" descricao="Desligado, ela só aparece enquanto você dita."><Interruptor rotulo="Mostrar a pílula o tempo todo" ligado={settings.mostrarPilula !== 'false'} onChange={(v) => update('mostrarPilula', String(v))} /></Linha>
        ]} />
        <Cartao titulo="Som" linhas={[
          <Linha key="s" rotulo="Sons de ditado e notificação"><Interruptor rotulo="Sons de ditado e notificação" ligado={settings.sons !== 'false'} onChange={(v) => update('sons', String(v))} /></Linha>
        ]} />
        <Cartao titulo="Extras" linhas={[
          <Linha key="f" rotulo="Formatação inteligente" descricao="Tira hesitações e repetições, aplica autocorreções e acerta a pontuação antes de colar. Usa a chave do Gemini."><Interruptor rotulo="Formatação inteligente" ligado={settings.limpezaIA !== 'false'} onChange={(v) => update('limpezaIA', String(v))} /></Linha>
        ]} />
      </>
    )
  } else if (pagina === 'transcricao') {
    secoes = motor && <MotorTranscricao motor={motor} recarregar={recarregarMotor} />
  } else if (pagina === 'dados') {
    secoes = (
      <Cartao linhas={[
        <Linha key="d" rotulo="Apagar seus dados" descricao="Apaga do Dita Aí o histórico de ditados deste computador. Seus ajustes e o dicionário ficam."><button type="button" className="aj-btn sec" onClick={() => setDialogo('apagar')}>Apagar dados…</button></Linha>
      ]} />
    )
  }

  return (
    <div className="aj-veu" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="aj-modal">
        <div className="aj-lado">
          <div className="aj-topo">
            {grupos.map(([nome, paginas], gi) => (
              <div key={nome} style={{ display: 'contents' }}>
                {gi > 0 && <div className="aj-divisor-lado" />}
                <div className="aj-titulo-lado">{nome}</div>
                <div className="aj-itens">
                  {paginas.map(([id, rotulo, icone]) => (
                    <button key={id} type="button" className={'aj-item' + (pagina === id ? ' ativo' : '')} onClick={() => setPagina(id)}>{icone}<span>{rotulo}</span></button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="aj-versao"><span>Dita Aí v{settings.versao || ''}</span>{AJ_ICONES.nuvem}</div>
        </div>
        <div className="aj-pagina">
          <h3>{titulos[pagina]}</h3>
          <div className="aj-conteudo">{secoes}</div>
        </div>
      </div>
      {dialogo === 'atalhos' && <DialogoAtalhos settings={settings} plataforma={plataforma} atalhos={atalhos} update={update} onFechar={() => setDialogo(null)} />}
      {dialogo === 'microfone' && <DialogoMicrofone settings={settings} mics={mics} update={update} onFechar={() => setDialogo(null)} />}
      {dialogo === 'idiomas' && <DialogoIdiomas settings={settings} update={update} onFechar={() => setDialogo(null)} />}
      {dialogo === 'apagar' && <DialogoApagar onFechar={() => setDialogo(null)} />}
    </div>
  )
}

// A página pedida de fora (menu da barra de cima → "Ajustes…") pode chegar
// antes do React montar; fica guardada aqui até alguém ouvir.
let paginaPendente = null
let ouvintePagina = null
window.dita?.onHub?.((p) => { paginaPendente = p; ouvintePagina?.(p) })

export default function Settings() {
  const [secao, setSecao] = useState('inicio')
  const [ajustesAbertos, setAjustesAbertos] = useState(false)
  const [settings, setSettings] = useState(null)
  const [mics, setMics] = useState([])

  useEffect(() => {
    ouvintePagina = (p) => { if (p === 'ajustes') setAjustesAbertos(true); paginaPendente = null }
    if (paginaPendente) ouvintePagina(paginaPendente)
    const atalho = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); setAjustesAbertos(true) } }
    window.addEventListener('keydown', atalho)
    return () => { ouvintePagina = null; window.removeEventListener('keydown', atalho) }
  }, [])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      // No macOS a janela abre no instante em que o app é aberto (evento
      // 'activate'), mas o main só registra os handlers de IPC depois de
      // carregar o modelo e subir o whisper. Sem insistir aqui, o primeiro
      // pedido falhava com "No handler registered" e a janela ficava vazia.
      let s = null
      while (vivo && !s) {
        try { s = await window.dita.getSettings() } catch { await new Promise((r) => setTimeout(r, 400)) }
      }
      if (!vivo) return
      setSettings(s)
      const devices = await navigator.mediaDevices.enumerateDevices()
      setMics(devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'))
    })()
    return () => { vivo = false }
  }, [])

  async function update(key, value) {
    setSettings((s) => ({ ...s, [key]: value }))
    await window.dita.setSetting(key, value)
  }

  return (
    <div className="hub">
      <style>{CSS_HUB}</style>
      <aside className="lateral">
        <div className="marca">
          <Equalizer size={20} color="var(--texto)" />
          <span style={{ fontFamily: FONT_TITULO, fontSize: 24, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: '25px' }}>dita aí</span>
        </div>
        <nav className="nav">
          <button className={'item' + (secao === 'inicio' ? ' ativo' : '')} onClick={() => setSecao('inicio')}>{I.inicio}<span>Início</span></button>
          <button className={'item' + (secao === 'dicionario' ? ' ativo' : '')} onClick={() => setSecao('dicionario')}>{I.dicionario}<span>Dicionário</span></button>
        </nav>
        <div className="rodape-lateral nav">
          <button className="item" onClick={() => setAjustesAbertos(true)}>{I.ajustes}<span>Ajustes</span></button>
        </div>
      </aside>
      <main className="painel">
        <div className="rolagem">
          {!settings ? null : secao === 'inicio' ? <Inicio settings={settings} /> : <Dicionario />}
        </div>
      </main>
      {settings && ajustesAbertos && <PainelAjustes settings={settings} mics={mics} update={update} onFechar={() => setAjustesAbertos(false)} />}
    </div>
  )
}
