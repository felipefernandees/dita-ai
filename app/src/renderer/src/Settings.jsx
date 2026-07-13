import { useEffect, useMemo, useState } from 'react'

const C = {
  bg: '#f3f1ea', panel: '#faf8f2', card: '#fffdf9', border: '#e6e1d5',
  text: '#1e1d1a', sub: '#8a857a', accent: '#1e1d1a'
}

const S = {
  shell: { display: 'flex', height: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui', overflow: 'hidden' },
  sidebar: { width: 180, padding: '48px 12px 16px', boxSizing: 'border-box', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  navItem: (active) => ({
    padding: '9px 12px', borderRadius: 9, fontSize: 13.5, cursor: 'pointer', userSelect: 'none',
    background: active ? '#e9e5da' : 'transparent', fontWeight: active ? 600 : 400,
    display: 'flex', alignItems: 'center', gap: 8
  }),
  content: { flex: 1, background: C.panel, borderRadius: '14px 0 0 0', border: `1px solid ${C.border}`, borderRight: 0, borderBottom: 0, padding: '30px 34px', overflowY: 'auto' },
  h1: { fontSize: 24, fontWeight: 600, margin: '0 0 20px', fontFamily: 'Georgia, serif' },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '2px 18px', marginBottom: 16 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', gap: 16 },
  divider: { borderTop: `1px solid #efeadf` },
  label: { fontSize: 14, fontWeight: 600 },
  sub: { fontSize: 12, color: C.sub, marginTop: 2 },
  select: { padding: '7px 10px', borderRadius: 8, border: `1px solid #ddd7ca`, background: '#fff', fontSize: 13, maxWidth: 230 },
  kbd: { background: '#efece4', border: '1px solid #ddd7ca', borderRadius: 6, padding: '2px 7px', fontSize: 12 }
}

function Toggle({ checked, onChange }) {
  return (
    <div onClick={() => onChange(!checked)} style={{
      width: 42, height: 25, borderRadius: 13, cursor: 'pointer', flexShrink: 0,
      background: checked ? C.accent : '#d8d3c7', position: 'relative', transition: 'background .15s'
    }}>
      <div style={{
        width: 21, height: 21, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
        left: checked ? 19 : 2, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)'
      }} />
    </div>
  )
}

const WAVE_COLORS = ['#f5f5f4', '#2dd4bf', '#E8540F', '#60a5fa', '#4ade80', '#f472b6', '#facc15']

function Config({ settings, mics, update }) {
  return (
    <>
      <h1 style={S.h1}>Configurações</h1>

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

      <div style={S.card}>
        <div style={S.row}>
          <div>
            <div style={S.label}>Tamanho do popup</div>
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {WAVE_COLORS.map((c) => (
              <div key={c} onClick={() => update('waveColor', c)} style={{
                width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                border: settings.waveColor === c ? `2px solid ${C.text}` : '1px solid #ccc7ba',
                boxSizing: 'border-box'
              }} />
            ))}
            <input type="color" value={settings.waveColor || '#f5f5f4'} onChange={(e) => update('waveColor', e.target.value)}
              style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }} title="Cor personalizada" />
          </div>
        </div>
      </div>

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

      <div style={{ fontSize: 12, color: C.sub }}>
        Dita Aí v0.2 · 100% local: o áudio nunca sai do seu Mac. Dicionário, Snippets, Estilo e Insights chegam na Fase 2; limpeza inteligente de fala (correções e tópicos) na Fase 3.
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ ...S.h1, margin: 0 }}>Histórico</h1>
        <input
          placeholder="Buscar ditados…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ ...S.select, width: 200, maxWidth: 200 }}
        />
      </div>
      {groups.length === 0 && <div style={{ color: C.sub, fontSize: 14 }}>Nenhum ditado ainda. Aperta o atalho e fala.</div>}
      {groups.map(([day, items]) => (
        <div key={day} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, color: C.sub, textTransform: 'uppercase', margin: '0 0 8px 2px' }}>{dayLabel(day)}</div>
          <div style={S.card}>
            {items.map((r, i) => (
              <div key={r.id} style={{ ...S.row, ...(i > 0 ? S.divider : {}), alignItems: 'flex-start' }}>
                <div style={{ minWidth: 54, color: C.sub, fontSize: 12, paddingTop: 2 }}>
                  {(r.created_at || '').slice(11, 16)}
                </div>
                <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{r.text}</div>
                <button onClick={() => copy(r)} style={{
                  background: copiedId === r.id ? '#1e1d1a' : '#efece4', color: copiedId === r.id ? '#fff' : '#555',
                  border: '1px solid #ddd7ca', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0
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
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 600, padding: '0 12px 14px' }}>Dita Aí</div>
        <div style={S.navItem(section === 'historico')} onClick={() => setSection('historico')}>🕘 Histórico</div>
        <div style={S.navItem(section === 'config')} onClick={() => setSection('config')}>⚙️ Configurações</div>
      </div>
      <div style={S.content}>
        {section === 'historico' ? <Historico /> : <Config settings={settings} mics={mics} update={update} />}
      </div>
    </div>
  )
}
