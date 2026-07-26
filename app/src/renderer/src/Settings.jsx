import { useEffect, useMemo, useState } from 'react'

// Fn não chega a nenhum hook no Windows, e o Right Alt é o AltGr do teclado
// ABNT2 — por isso as listas divergem em vez de serem traduzidas.
const ATALHOS = {
  darwin: {
    toggle: [
      ['fn+space', 'Fn + Espaço'],
      ['opt+space', '⌥ Option + Espaço'],
      ['ctrl+space', '⌃ Control + Espaço'],
      ['f5', 'F5']
    ],
    ptt: [
      ['rcmd', '⌘ Command direito'],
      ['ropt', '⌥ Option direito']
    ],
    padraoToggle: 'fn+space',
    padraoPtt: 'rcmd',
    colarUltimo: '⌃⌘V'
  },
  win32: {
    toggle: [
      ['ctrl+shift+space', 'Ctrl + Shift + Espaço'],
      ['ctrl+space', 'Ctrl + Espaço'],
      ['alt+space', 'Alt + Espaço'],
      ['f5', 'F5']
    ],
    // NÃO reintroduzir 'rwin': um toque solto abre o menu Iniciar, e teclas
    // de PTT nunca são suprimidas.
    ptt: [
      ['rctrl', 'Ctrl direito'],
      ['rshift', 'Shift direito'],
      ['ralt', 'Alt direito (AltGr — evite em teclado ABNT2)']
    ],
    padraoToggle: 'ctrl+shift+space',
    padraoPtt: 'rctrl',
    colarUltimo: 'Ctrl+Alt+V'
  }
}

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
  ink: '#131315'        // texto sobre o branco
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
  kbd: { background: C.hover, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 7px', fontSize: 12, color: C.text, fontFamily: MONO }
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


function Config({ settings, mics, update }) {
  const atalhos = ATALHOS[settings.platform] || ATALHOS.darwin
  return (
    <>
      <h1 style={S.h1}>Configurações</h1>

      <div style={S.kicker}>Atalhos</div>
      <div style={S.card}>
        <div style={S.row}>
          <div>
            <div style={S.label}>Atalho principal (liga e desliga)</div>
            <div style={S.sub}>Aperta uma vez pra gravar, de novo pra transcrever</div>
          </div>
          <select style={S.select} value={settings.toggleShortcut || atalhos.padraoToggle} onChange={(e) => update('toggleShortcut', e.target.value)}>
            {atalhos.toggle.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </select>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div>
            <div style={S.label}>Push-to-talk (segurar pra falar)</div>
            <div style={S.sub}>Grava enquanto a tecla está pressionada</div>
          </div>
          <select style={S.select} value={settings.pttShortcut || atalhos.padraoPtt} onChange={(e) => update('pttShortcut', e.target.value)}>
            {atalhos.ptt.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </select>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div style={S.sub}>
            <span style={S.kbd}>Esc</span> cancela a gravação · <span style={S.kbd}>{atalhos.colarUltimo}</span> cola o último ditado
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
            <div style={S.sub}>O Dita Aí abre sozinho quando você liga o Mac</div>
          </div>
          <Toggle checked={settings.openAtLogin !== 'false'} onChange={(v) => update('openAtLogin', String(v))} />
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.muted, fontFamily: MONO, letterSpacing: '.04em' }}>
        DITA AÍ v0.3 · 100% LOCAL · O ÁUDIO NUNCA SAI DO SEU MAC
      </div>
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
