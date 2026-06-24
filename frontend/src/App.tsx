import { useState, useEffect, type CSSProperties } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''

// ── Types ──────────────────────────────────────────────────────────────────────
interface EventRecord {
  event_type: string
  play_pattern: string
  x: number | null
  y: number | null
  end_x: number | null
  end_y: number | null
  duration: number | null
  under_pressure: number
  minute: number | null
  second: number | null
}

// ── Event colors ───────────────────────────────────────────────────────────────
const EVENT_COLOR: Record<string, string> = {
  'Pass': '#38bdf8',
  'Carry': '#2dd4bf',
  'Dribble': '#fbbf24',
  'Pressure': '#f472b6',
  'Ball Receipt*': '#a78bfa',
  'Ball Recovery': '#22d3ee',
  'Duel': '#fb923c',
  'Interception': '#34d399',
  'Clearance': '#94a3b8',
  'Block': '#cbd5e1',
  'Miscontrol': '#f87171',
  'Foul Won': '#c084fc',
}
const colorFor = (t: string) => EVENT_COLOR[t] || '#94a3b8'
const shortName = (t: string) => (t === 'Ball Receipt*' ? 'Receipt*' : t)

// ── Preset scenarios (Spanish) ──────────────────────────────────────────────────
const SAMPLES: Record<string, { icon: string; desc: string; events: EventRecord[] }> = {
  'Ataque Peligroso': {
    icon: '⚡',
    desc: 'Progresión profunda al área bajo presión',
    events: [
      { event_type: 'Ball Receipt*', play_pattern: 'Regular Play', x: 75, y: 40, end_x: null, end_y: null, duration: 0.1, under_pressure: 0, minute: 62, second: 5 },
      { event_type: 'Carry', play_pattern: 'Regular Play', x: 75, y: 40, end_x: 88, end_y: 35, duration: 1.5, under_pressure: 0, minute: 62, second: 6 },
      { event_type: 'Pass', play_pattern: 'Regular Play', x: 88, y: 35, end_x: 95, end_y: 28, duration: 0.8, under_pressure: 0, minute: 62, second: 8 },
      { event_type: 'Ball Receipt*', play_pattern: 'Regular Play', x: 95, y: 28, end_x: null, end_y: null, duration: 0.1, under_pressure: 1, minute: 62, second: 9 },
      { event_type: 'Dribble', play_pattern: 'Regular Play', x: 95, y: 28, end_x: 100, end_y: 30, duration: 1.2, under_pressure: 1, minute: 62, second: 10 },
      { event_type: 'Carry', play_pattern: 'Regular Play', x: 100, y: 30, end_x: 108, end_y: 36, duration: 1.0, under_pressure: 0, minute: 62, second: 12 },
    ],
  },
  'Build-up Seguro': {
    icon: '🛡️',
    desc: 'Pases cortos en campo propio, sin riesgo',
    events: [
      { event_type: 'Pass', play_pattern: 'From Goal Kick', x: 12, y: 40, end_x: 30, end_y: 35, duration: 1.2, under_pressure: 0, minute: 33, second: 0 },
      { event_type: 'Ball Receipt*', play_pattern: 'From Goal Kick', x: 30, y: 35, end_x: null, end_y: null, duration: 0.1, under_pressure: 0, minute: 33, second: 2 },
      { event_type: 'Pass', play_pattern: 'Regular Play', x: 30, y: 35, end_x: 25, end_y: 20, duration: 0.9, under_pressure: 0, minute: 33, second: 3 },
      { event_type: 'Ball Receipt*', play_pattern: 'Regular Play', x: 25, y: 20, end_x: null, end_y: null, duration: 0.1, under_pressure: 0, minute: 33, second: 5 },
      { event_type: 'Carry', play_pattern: 'Regular Play', x: 25, y: 20, end_x: 40, end_y: 25, duration: 2.0, under_pressure: 0, minute: 33, second: 6 },
      { event_type: 'Pass', play_pattern: 'Regular Play', x: 40, y: 25, end_x: 45, end_y: 60, duration: 0.7, under_pressure: 0, minute: 33, second: 9 },
    ],
  },
  'Contraataque': {
    icon: '🚀',
    desc: 'Transición rápida tras recuperación',
    events: [
      { event_type: 'Ball Recovery', play_pattern: 'From Counter', x: 35, y: 42, end_x: null, end_y: null, duration: 0.3, under_pressure: 0, minute: 78, second: 22 },
      { event_type: 'Carry', play_pattern: 'From Counter', x: 35, y: 42, end_x: 65, end_y: 38, duration: 2.5, under_pressure: 0, minute: 78, second: 23 },
      { event_type: 'Pass', play_pattern: 'From Counter', x: 65, y: 38, end_x: 90, end_y: 35, duration: 1.1, under_pressure: 0, minute: 78, second: 26 },
      { event_type: 'Ball Receipt*', play_pattern: 'From Counter', x: 90, y: 35, end_x: null, end_y: null, duration: 0.1, under_pressure: 1, minute: 78, second: 28 },
      { event_type: 'Carry', play_pattern: 'From Counter', x: 90, y: 35, end_x: 105, end_y: 38, duration: 1.4, under_pressure: 1, minute: 78, second: 29 },
    ],
  },
}

// Valid model vocabulary (Shot excluded by design — causal prediction)
const AVAILABLE_EVENTS = [
  'Pass', 'Carry', 'Ball Receipt*', 'Dribble', 'Ball Recovery', 'Pressure',
  'Duel', 'Interception', 'Clearance', 'Block', 'Miscontrol', 'Foul Won',
]

// Append a new event, progressing toward the rival goal (x → 120)
function makeEvent(prev: EventRecord[], t: string): EventRecord {
  const last = prev[prev.length - 1]
  const baseX = last ? (last.end_x ?? last.x ?? 30) : 30
  const x = Math.min(116, Math.round(baseX + 12))
  const y = Math.round(40 + (prev.length % 2 === 0 ? -8 : 8))
  const moves = t === 'Pass' || t === 'Carry' || t === 'Dribble'
  return {
    event_type: t, play_pattern: 'Regular Play',
    x, y,
    end_x: moves ? Math.min(119, x + 12) : null,
    end_y: moves ? y - 4 : null,
    duration: 1.0, under_pressure: x > 80 ? 1 : 0,
    minute: 50, second: prev.length * 2,
  }
}

export default function App() {
  const [scenario, setScenario] = useState<string>('Ataque Peligroso')
  const [events, setEvents] = useState<EventRecord[]>(SAMPLES['Ataque Peligroso'].events)
  const [result, setResult] = useState<{ gru: number; baseline: number; n: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiStatus, setApiStatus] = useState<'unknown' | 'ok' | 'error'>('unknown')
  const [showPalette, setShowPalette] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_URL}/health`)
      setApiStatus(res.ok ? 'ok' : 'error')
    } catch { setApiStatus('error') }
  }
  useEffect(() => {
    checkHealth()
    const id = setInterval(checkHealth, 30000)
    return () => clearInterval(id)
  }, [])

  const loadPreset = (name: string) => {
    setScenario(name)
    setEvents(SAMPLES[name].events)
    setResult(null)
  }
  const addEvent = (t: string) => { setEvents(p => [...p, makeEvent(p, t)]); setResult(null) }
  const removeAt = (i: number) => { setEvents(p => p.filter((_, j) => j !== i)); setResult(null) }
  const moveItem = (from: number, to: number) => setEvents(p => {
    if (from === to || from < 0) return p
    const c = [...p]; const [m] = c.splice(from, 1); c.splice(to, 0, m); return c
  })

  const analyze = async () => {
    setLoading(true); setError(null)
    try {
      const call = async (model: string) => {
        const res = await fetch(`${API_URL}/v1/predict-possession`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events, model }),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail || `HTTP ${res.status}`) }
        return res.json()
      }
      const [g, b] = await Promise.all([call('gru'), call('baseline')])
      setResult({ gru: g.shot_probability, baseline: b.shot_probability, n: g.n_events })
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  // ── styles ──
  const panel: CSSProperties = { background: '#0f1729', border: '1px solid #1e2a44', borderRadius: 14 }
  const label: CSSProperties = { fontSize: 11, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }
  const statusDot = apiStatus === 'ok' ? '#22c55e' : apiStatus === 'error' ? '#ef4444' : '#eab308'
  const statusTxt = apiStatus === 'ok' ? 'Conectado' : apiStatus === 'error' ? 'Sin conexión' : 'Conectando…'

  return (
    <div style={{ minHeight: '100vh', background: '#070b16', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', display: 'grid', gridTemplateColumns: '290px 1fr 290px', gap: 14, padding: 14 }}>

      {/* ════ LEFT SIDEBAR ════ */}
      <div style={{ ...panel, padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#a855f7,#ec4899)' }} />
            <span style={{ fontWeight: 800, fontSize: 18, background: 'linear-gradient(135deg,#c084fc,#f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PitchView</span>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginTop: 10 }}>
            Modelo GRU de Deep Learning entrenado sobre 21 K posesiones reales. Predice la probabilidad de remate a partir de la secuencia de eventos.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot, boxShadow: `0 0 8px ${statusDot}` }} />
            {statusTxt}
          </div>
        </div>

        {/* Scenarios */}
        <div>
          <div style={label}>1 · Elige escenario</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {Object.entries(SAMPLES).map(([name, s]) => {
              const active = scenario === name
              return (
                <button key={name} onClick={() => loadPreset(name)} style={{
                  textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                  border: active ? '1px solid #ec4899' : '1px solid #1e2a44',
                  background: active ? 'linear-gradient(135deg,#a855f71a,#ec48991a)' : '#0b1322',
                }}>
                  <span style={{ fontSize: 18 }}>{s.icon}</span>
                  <span>
                    <div style={{ fontWeight: 700, fontSize: 13, color: active ? '#f472b6' : '#e2e8f0' }}>{name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{s.desc}</div>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Sequence editor */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={label}>2 · Secuencia · {events.length} eventos</div>
            <button onClick={() => setShowPalette(s => !s)} style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg,#a855f7,#ec4899)', color: '#fff', fontSize: 12, fontWeight: 700,
            }}>+ Agregar</button>
          </div>

          {showPalette && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8, padding: 8, background: '#0b1322', borderRadius: 8, border: '1px solid #1e2a44' }}>
              {AVAILABLE_EVENTS.map(t => (
                <div key={t} draggable
                  onDragStart={e => { e.dataTransfer.setData('type', t); e.dataTransfer.setData('src', 'palette') }}
                  onClick={() => addEvent(t)}
                  style={{ cursor: 'grab', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, color: colorFor(t), border: `1px solid ${colorFor(t)}55`, background: `${colorFor(t)}15` }}>
                  {shortName(t)}
                </div>
              ))}
            </div>
          )}

          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.getData('src') === 'palette') addEvent(e.dataTransfer.getData('type')); setDragIndex(null) }}
            style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
            {events.map((ev, i) => {
              const c = colorFor(ev.event_type)
              return (
                <div key={i} draggable
                  onDragStart={e => { e.dataTransfer.setData('idx', String(i)); e.dataTransfer.setData('src', 'seq'); setDragIndex(i) }}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    if (e.dataTransfer.getData('src') === 'seq') moveItem(Number(e.dataTransfer.getData('idx')), i)
                    setDragIndex(null)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'grab',
                    background: '#0b1322', borderLeft: `3px solid ${c}`, border: '1px solid #1e2a44', borderLeftWidth: 3,
                    opacity: dragIndex === i ? 0.4 : 1,
                  }}>
                  <span style={{ color: '#475569', fontSize: 11, width: 12 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: c }}>{shortName(ev.event_type)}</span>
                  {ev.under_pressure === 1 && <span style={{ fontSize: 10, color: '#f472b6' }}>⚠ presión</span>}
                  <span style={{ fontSize: 10, color: '#475569' }}>{ev.x},{ev.y}</span>
                  <button onClick={() => removeAt(i)} style={{ border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Analyze */}
        <div>
          <div style={label}>3 · Analizar</div>
          <button onClick={analyze} disabled={loading || events.length === 0} style={{
            width: '100%', marginTop: 10, padding: '13px 0', borderRadius: 10, border: 'none',
            cursor: (loading || events.length === 0) ? 'not-allowed' : 'pointer',
            background: (loading || events.length === 0) ? '#334155' : 'linear-gradient(135deg,#a855f7,#ec4899)',
            color: '#fff', fontWeight: 800, fontSize: 15,
          }}>
            {loading ? 'Analizando…' : '⚡ Analizar Posesión'}
          </button>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 6, textAlign: 'center' }}>GRU + Baseline corren en paralelo</div>
          {error && <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>{error}</div>}
        </div>
      </div>

      {/* ════ CENTER ════ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ ...panel, padding: 14 }}>
          <div style={label}>Secuencia de eventos</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {events.map((ev, i) => {
              const c = colorFor(ev.event_type)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 10, background: '#0b1322', border: `1px solid ${c}44` }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{shortName(ev.event_type)}</span>
                  {ev.under_pressure === 1 && <span style={{ fontSize: 10, color: '#f472b6' }}>⚠ presión</span>}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ ...panel, padding: 14, flex: 1 }}>
          <div style={label}>Trayectoria en campo · StatsBomb 120×80</div>
          <Pitch events={events} />
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 10 }}>
            {[['Pass', '#38bdf8'], ['Carry', '#2dd4bf'], ['Dribble', '#fbbf24'], ['Pressure', '#f472b6']].map(([t, c]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />{t}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════ RIGHT SIDEBAR ════ */}
      <div style={{ ...panel, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Análisis de Riesgo</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Probabilidad de remate por modelo</div>
        </div>

        {/* Result / placeholder */}
        <div style={{ textAlign: 'center', padding: '14px 0' }}>
          {result ? <Gauge prob={result.gru} /> : (
            <>
              <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: 'linear-gradient(135deg,#a855f733,#ec489933)', border: '1px solid #ec489955' }}>⚡</div>
              <div style={{ fontWeight: 700, marginTop: 12 }}>Listo para analizar</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Elige un escenario y presiona<br /><span style={{ color: '#c084fc' }}>Analizar Posesión</span></div>
            </>
          )}
        </div>

        {/* Metric bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MetricBar icon="🟣" name={result ? 'GRU P(remate)' : 'GRU PR-AUC'} value={result ? result.gru : 0.870} grad="linear-gradient(90deg,#a855f7,#ec4899)" />
          <MetricBar icon="🔵" name={result ? 'Baseline P(remate)' : 'Baseline PR-AUC'} value={result ? result.baseline : 0.564} grad="linear-gradient(90deg,#38bdf8,#0ea5e9)" />
          {!result && <MetricBar icon="✅" name="Mejora GRU vs Baseline" value={0.307} grad="linear-gradient(90deg,#34d399,#10b981)" suffix="+30.7 pp" />}
        </div>

        {/* Dataset */}
        <div style={{ background: '#0b1322', border: '1px solid #1e2a44', borderRadius: 10, padding: 14 }}>
          <div style={{ ...label, marginBottom: 8 }}>Dataset</div>
          {[['Partidos', '127'], ['Posesiones', '21,080'], ['Tasa de remate', '14.3%'], ['Ligas', '4']].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
              <span style={{ color: '#64748b' }}>{k}</span>
              <span style={{ fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Pitch SVG ───────────────────────────────────────────────────────────────────
function Pitch({ events }: { events: EventRecord[] }) {
  const W = 1000, H = 640
  const sx = (x: number) => (x / 120) * W
  const sy = (y: number) => (y / 80) * H
  const pts = events.filter(e => e.x !== null && e.y !== null).map((e, i) => ({ x: sx(e.x || 0), y: sy(e.y || 0), t: e.event_type, n: i + 1 }))
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', borderRadius: 12, marginTop: 10, display: 'block' }}>
      <defs>
        <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d5e36" /><stop offset="100%" stopColor="#0e3a20" />
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect x="0" y="0" width={W} height={H} rx="14" fill="url(#turf)" />
      {/* stripes */}
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x={(i * W) / 8} y="0" width={W / 8} height={H} fill={i % 2 ? '#ffffff' : '#000000'} opacity="0.03" />
      ))}
      <g stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2" fill="none">
        <rect x="14" y="14" width={W - 28} height={H - 28} rx="6" />
        <line x1={W / 2} y1="14" x2={W / 2} y2={H - 14} />
        <circle cx={W / 2} cy={H / 2} r="80" />
        <rect x="14" y={H / 2 - 110} width="130" height="220" />
        <rect x={W - 144} y={H / 2 - 110} width="130" height="220" />
        <rect x="14" y={H / 2 - 50} width="50" height="100" />
        <rect x={W - 64} y={H / 2 - 50} width="50" height="100" />
      </g>
      {/* trajectory */}
      {pts.length > 1 && <path d={lineD} fill="none" stroke="#fde047" strokeWidth="3" strokeDasharray="2 10" strokeLinecap="round" opacity="0.7" />}
      {pts.map((p, i) => {
        const c = colorFor(p.t)
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="20" fill={c} opacity="0.25" filter="url(#glow)" />
            <circle cx={p.x} cy={p.y} r="14" fill={c} stroke="#fff" strokeWidth="2" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13" fontWeight="800" fill="#0b1322">{p.n}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Gauge ────────────────────────────────────────────────────────────────────────
function Gauge({ prob }: { prob: number }) {
  const pct = prob * 100
  const color = prob > 0.6 ? '#ef4444' : prob > 0.35 ? '#fbbf24' : '#22c55e'
  const risk = prob > 0.6 ? '🔴 Alto' : prob > 0.35 ? '🟡 Medio' : '🟢 Bajo'
  return (
    <div>
      <svg viewBox="0 0 200 116" style={{ width: 200 }}>
        <path d="M 30 100 A 70 70 0 0 1 170 100" fill="none" stroke="#1e2a44" strokeWidth="16" strokeLinecap="round" />
        <path d="M 30 100 A 70 70 0 0 1 170 100" fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${pct * 2.2} 220`} />
        <text x="100" y="92" textAnchor="middle" fontSize="30" fontWeight="800" fill={color}>{pct.toFixed(1)}%</text>
      </svg>
      <div style={{ fontWeight: 700, marginTop: 4 }}>Riesgo: {risk}</div>
    </div>
  )
}

// ── Metric bar ─────────────────────────────────────────────────────────────────
function MetricBar({ icon, name, value, grad, suffix }: { icon: string; name: string; value: number; grad: string; suffix?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
        <span style={{ color: '#94a3b8' }}>{icon} {name}</span>
        <span style={{ fontWeight: 800, color: '#f472b6' }}>{suffix || value.toFixed(3)}</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: '#1e2a44', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, value * 100)}%`, background: grad, borderRadius: 4 }} />
      </div>
    </div>
  )
}
