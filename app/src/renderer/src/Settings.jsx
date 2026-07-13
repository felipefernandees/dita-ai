import { useEffect, useState } from 'react'

const S = {
  page: { minHeight: '100vh', background: '#f7f5f0', color: '#1e1d1a', fontFamily: 'system-ui', padding: '28px 32px', boxSizing: 'border-box' },
  h1: { fontSize: 22, fontWeight: 600, margin: '0 0 20px' },
  card: { background: '#fffdf9', border: '1px solid #e8e4da', borderRadius: 14, padding: '4px 18px', marginBottom: 16 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', gap: 16 },
  divider: { borderTop: '1px solid #eee9df' },
  label: { fontSize: 14, fontWeight: 600 },
  sub: { fontSize: 12, color: '#8a857a', marginTop: 2 },
  select: { padding: '7px 10px', borderRadius: 8, border: '1px solid #ddd7ca', background: '#fff', fontSize: 13, maxWidth: 230 },
  kbd: { background: '#efece4', border: '1px solid #ddd7ca', borderRadius: 6, padding: '2px 7px', fontSize: 12, fontFamily: 'inherit' }
}

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 25, borderRadius: 13, cursor: 'pointer', flexShrink: 0,
        background: checked ? '#1e1d1a' : '#d8d3c7', position: 'relative', transition: 'background .15s'
      }}
    >
      <div style={{
        width: 21, height: 21, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
        left: checked ? 19 : 2, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)'
      }} />
    </div>
  )
}

export default function Settings() {
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
    <div style={S.page}>
      <h1 style={S.h1}>Configurações</h1>

      <div style={S.card}>
        <div style={S.row}>
          <div>
            <div style={S.label}>Atalhos</div>
            <div style={S.sub}>
              <span style={S.kbd}>Fn</span> + <span style={S.kbd}>Espaço</span> liga e desliga · segurar <span style={S.kbd}>⌘ direito</span> fala e solta · <span style={S.kbd}>Esc</span> cancela · <span style={S.kbd}>⌃⌘V</span> cola o último
            </div>
          </div>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div>
            <div style={S.label}>Microfone</div>
            <div style={S.sub}>Qual entrada de áudio o ditado usa</div>
          </div>
          <select
            style={S.select}
            value={settings.micDeviceId || ''}
            onChange={(e) => update('micDeviceId', e.target.value)}
          >
            <option value="">Detecção automática</option>
            {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microfone'}</option>)}
          </select>
        </div>
        <div style={{ ...S.row, ...S.divider }}>
          <div>
            <div style={S.label}>Idioma do ditado</div>
            <div style={S.sub}>Reinicia o motor de transcrição ao trocar</div>
          </div>
          <select
            style={S.select}
            value={settings.language || 'pt'}
            onChange={(e) => update('language', e.target.value)}
          >
            <option value="pt">Português</option>
            <option value="en">English</option>
            <option value="auto">Automático</option>
          </select>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.row}>
          <div>
            <div style={S.label}>Iniciar aplicativo no login</div>
            <div style={S.sub}>O Dita Aí abre sozinho quando você liga o Mac</div>
          </div>
          <Toggle checked={settings.openAtLogin !== 'false'} onChange={(v) => update('openAtLogin', String(v))} />
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#a09a8d' }}>
        Dita Aí v0.1 · 100% local: o áudio nunca sai do seu Mac. Dicionário, Snippets, Estilo e Insights chegam na Fase 2.
      </div>
    </div>
  )
}
