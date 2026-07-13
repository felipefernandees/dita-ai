import { useEffect, useMemo, useState } from 'react'

// Paleta de PRODUTO (dark roxo) da ficha de branding conteudo/_brandings/dita-ai
const C = {
  bg: '#16121F',        // fundo app
  panel: '#1B1626',     // painel/conteúdo
  card: '#221C33',      // fundo app +1 (cards, popup)
  hover: '#2C2542',     // fundo app +2 / hover
  border: '#322B47',    // borda app
  text: '#F4F2EC',      // texto primário
  muted: '#A8A4B5',     // texto muted
  accent: '#ECFF77',    // amarelo-limão (única cor saturada)
  ink: '#0E0E0E'        // texto sobre o amarelo (sempre preto)
}
const FONT = "'General Sans', ui-sans-serif, system-ui, sans-serif"
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"

const S = {
  shell: { display: 'flex', height: '100vh', background: C.bg, color: C.text, fontFamily: FONT, overflow: 'hidden' },
  sidebar: { width: 190, padding: '46px 12px 16px', boxSizing: 'border-box', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  brand: { display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px 18px' },
  navItem: (active) => ({
    padding: '9px 12px', borderRadius: 10, fontSize: 13.5, cursor: 'pointer', userSelect: 'none',
    color: active ? C.text : C.muted, background: active ? C.hover : 'transparent',
    fontWeight: active ? 600 : 500, display: 'flex', alignItems: 'center', gap: 9, transition: 'background .12s'
  }),
  content: { flex: 1, background: C.panel, borderLeft: `1px solid ${C.border}`, padding: '30px 34px', overflowY: 'auto' },
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

// Equalizador de 5 barras (símbolo da marca), proporção travada da ficha
function Equalizer({ size = 20, color = C.accent }) {
  const heights = [4.575, 6.77, 8.5, 5.45, 3.93]
  const max = 8.5
  const bw = size / 7
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ display: 'block' }}>
      {heights.map((h, i) => {
        const barH = (h / max) * 16
        return <rect key={i} x={2 + i * (bw + bw * 0.6) / 1} width={bw} rx={bw / 2}
          y={(20 - barH) / 2} height={barH} fill={color} />
      })}
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

const WAVE_COLORS = ['#F4F2EC', '#ECFF77', '#E9D8FD', '#C6F6D5', '#BDE2F8', '#f472b6', '#2dd4bf']

function Config({ settings, mics, update }) {
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
          <select style={S.select} value={settings.toggleShortcut || 'fn+space'} onChange={(e) => update('toggleShortcut', e.target.value)}>
            <option value="fn+space">Fn + Espaço</option>
            <option value="opt+space">⌥ Option + Espaço</option>
            <option value="ctrl+space">⌃ Control + Espaço</option>
            <option value="f5">F5</option>
          </select>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div>
            <div style={S.label}>Push-to-talk (segurar pra falar)</div>
            <div style={S.sub}>Grava enquanto a tecla está pressionada</div>
          </div>
          <select style={S.select} value={settings.pttShortcut || 'rcmd'} onChange={(e) => update('pttShortcut', e.target.value)}>
            <option value="rcmd">⌘ Command direito</option>
            <option value="ropt">⌥ Option direito</option>
          </select>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div style={S.sub}>
            <span style={S.kbd}>Esc</span> cancela a gravação · <span style={S.kbd}>⌃⌘V</span> cola o último ditado
          </div>
        </div>
      </div>

      <div style={S.kicker}>Aparência do popup</div>
      <div style={S.card}>
        <div style={S.row}>
          <div>
            <div style={S.label}>Tamanho</div>
            <div style={S.sub}>A pílula de gravação na parte de baixo da tela</div>
          </div>
          <select style={S.select} value={settings.popupScale || 'm'} onChange={(e) => update('popupScale', e.target.value)}>
            <option value="p">Pequeno</option>
            <option value="m">Médio</option>
            <option value="g">Grande</option>
          </select>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div>
            <div style={S.label}>Cor do waveform</div>
            <div style={S.sub}>As barrinhas que dançam com a sua voz</div>
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            {WAVE_COLORS.map((c) => (
              <div key={c} onClick={() => update('waveColor', c)} style={{
                width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                border: settings.waveColor === c ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                boxSizing: 'border-box'
              }} />
            ))}
            <input type="color" value={settings.waveColor || '#F4F2EC'} onChange={(e) => update('waveColor', e.target.value)}
              style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }} title="Cor personalizada" />
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
