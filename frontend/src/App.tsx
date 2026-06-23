import { useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

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

interface PredictionResult {
  shot_probability: number
  model_used: string
  n_events: number
  timestamp: string
}

// ── Preset sample possessions ─────────────────────────────────────────────────
const SAMPLES: Record<string, EventRecord[]> = {
  'Dangerous Attack (High xShot)': [
    { event_type: 'Ball Receipt*', play_pattern: 'Regular Play', x: 75, y: 40, end_x: null, end_y: null, duration: 0.1, under_pressure: 0, minute: 62, second: 5 },
    { event_type: 'Carry', play_pattern: 'Regular Play', x: 75, y: 40, end_x: 88, end_y: 35, duration: 1.5, under_pressure: 0, minute: 62, second: 6 },
    { event_type: 'Pass', play_pattern: 'Regular Play', x: 88, y: 35, end_x: 95, end_y: 28, duration: 0.8, under_pressure: 0, minute: 62, second: 8 },
    { event_type: 'Ball Receipt*', play_pattern: 'Regular Play', x: 95, y: 28, end_x: null, end_y: null, duration: 0.1, under_pressure: 1, minute: 62, second: 9 },
    { event_type: 'Dribble', play_pattern: 'Regular Play', x: 95, y: 28, end_x: 100, end_y: 30, duration: 1.2, under_pressure: 1, minute: 62, second: 10 },
    { event_type: 'Carry', play_pattern: 'Regular Play', x: 100, y: 30, end_x: 108, end_y: 36, duration: 1.0, under_pressure: 0, minute: 62, second: 12 },
  ],
  'Safe Build-up (Low xShot)': [
    { event_type: 'Pass', play_pattern: 'From Goal Kick', x: 12, y: 40, end_x: 30, end_y: 35, duration: 1.2, under_pressure: 0, minute: 33, second: 0 },
    { event_type: 'Ball Receipt*', play_pattern: 'From Goal Kick', x: 30, y: 35, end_x: null, end_y: null, duration: 0.1, under_pressure: 0, minute: 33, second: 2 },
    { event_type: 'Pass', play_pattern: 'Regular Play', x: 30, y: 35, end_x: 25, end_y: 20, duration: 0.9, under_pressure: 0, minute: 33, second: 3 },
    { event_type: 'Ball Receipt*', play_pattern: 'Regular Play', x: 25, y: 20, end_x: null, end_y: null, duration: 0.1, under_pressure: 0, minute: 33, second: 5 },
    { event_type: 'Carry', play_pattern: 'Regular Play', x: 25, y: 20, end_x: 40, end_y: 25, duration: 2.0, under_pressure: 0, minute: 33, second: 6 },
    { event_type: 'Pass', play_pattern: 'Regular Play', x: 40, y: 25, end_x: 45, end_y: 60, duration: 0.7, under_pressure: 0, minute: 33, second: 9 },
  ],
  'Counter Attack': [
    { event_type: 'Ball Recovery', play_pattern: 'From Counter', x: 35, y: 42, end_x: null, end_y: null, duration: 0.3, under_pressure: 0, minute: 78, second: 22 },
    { event_type: 'Carry', play_pattern: 'From Counter', x: 35, y: 42, end_x: 65, end_y: 38, duration: 2.5, under_pressure: 0, minute: 78, second: 23 },
    { event_type: 'Pass', play_pattern: 'From Counter', x: 65, y: 38, end_x: 90, end_y: 35, duration: 1.1, under_pressure: 0, minute: 78, second: 26 },
    { event_type: 'Ball Receipt*', play_pattern: 'From Counter', x: 90, y: 35, end_x: null, end_y: null, duration: 0.1, under_pressure: 1, minute: 78, second: 28 },
    { event_type: 'Carry', play_pattern: 'From Counter', x: 90, y: 35, end_x: 105, end_y: 38, duration: 1.4, under_pressure: 1, minute: 78, second: 29 },
  ],
}

// ── Pitch SVG component ───────────────────────────────────────────────────────
function PitchViz({ events }: { events: EventRecord[] }) {
  // StatsBomb field: 120x80. We'll scale to SVG 600x400
  const scaleX = 5
  const scaleY = 5

  const pathPoints = events
    .filter(e => e.x !== null && e.y !== null)
    .map(e => ({ x: (e.x || 0) * scaleX, y: (e.y || 0) * scaleY, type: e.event_type }))

  const pathD = pathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  const colorForType = (t: string) => {
    if (t === 'Shot') return '#ef4444'
    if (t === 'Pass') return '#3b82f6'
    if (t === 'Carry') return '#10b981'
    if (t === 'Dribble') return '#f59e0b'
    return '#6b7280'
  }

  return (
    <svg viewBox="0 0 600 400" style={{ width: '100%', background: '#2d5016', borderRadius: 8 }}>
      {/* Pitch markings */}
      <rect x="0" y="0" width="600" height="400" fill="#3a6b1a" stroke="#fff" strokeWidth="2" />
      <rect x="0" y="0" width="300" height="400" fill="none" stroke="#fff" strokeWidth="1" strokeDasharray="4,4" opacity="0.4" />
      <circle cx="300" cy="200" r="50" fill="none" stroke="#fff" strokeWidth="1" opacity="0.5" />
      <line x1="300" y1="0" x2="300" y2="400" stroke="#fff" strokeWidth="1" opacity="0.4" />
      {/* Goals */}
      <rect x="0" y="155" width="18" height="90" fill="none" stroke="#fff" strokeWidth="2" />
      <rect x="582" y="155" width="18" height="90" fill="none" stroke="#fff" strokeWidth="2" />
      {/* Penalty areas */}
      <rect x="0" y="100" width="90" height="200" fill="none" stroke="#fff" strokeWidth="1" opacity="0.6" />
      <rect x="510" y="100" width="90" height="200" fill="none" stroke="#fff" strokeWidth="1" opacity="0.6" />
      {/* Thirds lines */}
      <line x1="200" y1="0" x2="200" y2="400" stroke="#fff" strokeWidth="1" opacity="0.2" strokeDasharray="2,6" />
      <line x1="400" y1="0" x2="400" y2="400" stroke="#fff" strokeWidth="1" opacity="0.2" strokeDasharray="2,6" />

      {/* Path */}
      {pathPoints.length > 1 && (
        <path d={pathD} fill="none" stroke="#fde047" strokeWidth="2.5" strokeLinejoin="round" opacity="0.85" />
      )}
      {/* Event dots */}
      {pathPoints.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.type === 'Shot' ? 8 : 5}
          fill={colorForType(p.type)}
          stroke="#fff"
          strokeWidth="1.5"
          opacity="0.9"
        >
          <title>{p.type}</title>
        </circle>
      ))}
      {/* Direction arrow on first point */}
      {pathPoints.length > 0 && (
        <text x={pathPoints[0].x + 6} y={pathPoints[0].y - 6} fill="#fde047" fontSize="10" fontWeight="bold">Start</text>
      )}

      {/* Legend */}
      {[['Pass', '#3b82f6'], ['Carry', '#10b981'], ['Dribble', '#f59e0b'], ['Shot', '#ef4444'], ['Other', '#6b7280']].map(([t, c], i) => (
        <g key={t} transform={`translate(${10 + i * 110}, 385)`}>
          <circle cx="6" cy="0" r="5" fill={c} />
          <text x="14" y="4" fill="#fff" fontSize="9">{t}</text>
        </g>
      ))}
    </svg>
  )
}

// ── Probability gauge ─────────────────────────────────────────────────────────
function ProbGauge({ prob }: { prob: number }) {
  const pct = prob * 100
  const color = prob > 0.6 ? '#ef4444' : prob > 0.35 ? '#f59e0b' : '#22c55e'
  const arcX = 100
  const arcY = 90
  const r = 70
  const angle = (pct / 100) * 180
  const rad = (angle - 180) * (Math.PI / 180)
  const needleX = arcX + r * Math.cos(rad)
  const needleY = arcY + r * Math.sin(rad)

  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 200 110" style={{ width: 200 }}>
        <path d={`M ${arcX - r} ${arcY} A ${r} ${r} 0 0 1 ${arcX + r} ${arcY}`}
          fill="none" stroke="#e5e7eb" strokeWidth="16" strokeLinecap="round" />
        <path d={`M ${arcX - r} ${arcY} A ${r} ${r} 0 0 1 ${arcX + r} ${arcY}`}
          fill="none" stroke={color} strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${pct * 2.2} 220`} opacity="0.85" />
        <line x1={arcX} y1={arcY} x2={needleX} y2={needleY}
          stroke="#1f2937" strokeWidth="3" strokeLinecap="round" />
        <circle cx={arcX} cy={arcY} r="6" fill="#1f2937" />
        <text x={arcX} y={arcY + 18} textAnchor="middle" fontSize="22" fontWeight="bold" fill={color}>
          {pct.toFixed(1)}%
        </text>
        <text x="20" y={arcY + 4} fontSize="9" fill="#6b7280">Low</text>
        <text x="160" y={arcY + 4} fontSize="9" fill="#6b7280">High</text>
      </svg>
    </div>
  )
}

// ── Event timeline ─────────────────────────────────────────────────────────────
function EventTimeline({ events }: { events: EventRecord[] }) {
  const typeColor: Record<string, string> = {
    'Pass': '#3b82f6', 'Carry': '#10b981', 'Dribble': '#f59e0b',
    'Shot': '#ef4444', 'Ball Receipt*': '#8b5cf6', 'Pressure': '#ec4899',
    'Ball Recovery': '#06b6d4', 'Duel': '#f97316',
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {events.map((e, i) => {
        const color = typeColor[e.event_type] || '#6b7280'
        return (
          <div key={i} title={`${e.event_type} @ (${e.x?.toFixed(0)}, ${e.y?.toFixed(0)})`}
            style={{
              background: color + '22', border: `1.5px solid ${color}`,
              borderRadius: 6, padding: '2px 8px', fontSize: 11, color,
              fontWeight: 600, cursor: 'default',
            }}>
            {i + 1}. {e.event_type}
          </div>
        )
      })}
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [selectedSample, setSelectedSample] = useState<string>('Dangerous Attack (High xShot)')
  const [events, setEvents] = useState<EventRecord[]>(SAMPLES['Dangerous Attack (High xShot)'])
  const [model, setModel] = useState<'gru' | 'baseline'>('gru')
  const [result, setResult] = useState<PredictionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiStatus, setApiStatus] = useState<'unknown' | 'ok' | 'error'>('unknown')

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_URL}/health`)
      if (res.ok) setApiStatus('ok')
      else setApiStatus('error')
    } catch {
      setApiStatus('error')
    }
  }

  const runPrediction = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/v1/predict-possession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events, model }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setResult(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSampleChange = (name: string) => {
    setSelectedSample(name)
    setEvents(SAMPLES[name])
    setResult(null)
  }

  const statusColors = { unknown: '#6b7280', ok: '#22c55e', error: '#ef4444' }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#0f172a', color: '#f1f5f9', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 28 }}>⚽</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>Football Possession Intelligence</div>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>Deep Learning · P(shot | possession)</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={checkHealth}
            style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}>
            Check API
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColors[apiStatus] }} />
            <span style={{ color: '#94a3b8' }}>{apiStatus === 'ok' ? 'API Online' : apiStatus === 'error' ? 'API Offline' : 'Unknown'}</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Left column: controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Sample selector */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px #00000018' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: '#1e293b' }}>
              Select Possession Scenario
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.keys(SAMPLES).map(name => (
                <button key={name} onClick={() => handleSampleChange(name)}
                  style={{
                    textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                    border: selectedSample === name ? '2px solid #3b82f6' : '1.5px solid #e2e8f0',
                    background: selectedSample === name ? '#eff6ff' : '#f8fafc',
                    color: '#1e293b', fontWeight: selectedSample === name ? 600 : 400,
                    cursor: 'pointer', fontSize: 13,
                  }}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Model selector */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px #00000018' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: '#1e293b' }}>Model</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {(['gru', 'baseline'] as const).map(m => (
                <button key={m} onClick={() => setModel(m)}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    border: model === m ? '2px solid #3b82f6' : '1.5px solid #e2e8f0',
                    background: model === m ? '#eff6ff' : '#f8fafc',
                    color: model === m ? '#1d4ed8' : '#64748b',
                  }}>
                  {m === 'gru' ? '🧠 GRU (Deep)' : '📊 Baseline (LR)'}
                </button>
              ))}
            </div>
          </div>

          {/* Event timeline */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px #00000018' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: '#1e293b' }}>
              Possession Events ({events.length})
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
              Sequence fed to the model
            </div>
            <EventTimeline events={events} />
          </div>

          {/* Predict button */}
          <button onClick={runPrediction} disabled={loading}
            style={{
              padding: '14px 0', borderRadius: 10, border: 'none',
              background: loading ? '#94a3b8' : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              color: '#fff', fontWeight: 700, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 8px #3b82f640',
            }}>
            {loading ? 'Predicting...' : '⚡ Predict Shot Probability'}
          </button>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, color: '#dc2626', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        {/* Right column: results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Pitch viz */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px #00000018' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: '#1e293b' }}>
              Pitch Trajectory
            </div>
            <PitchViz events={events} />
          </div>

          {/* Prediction output */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px #00000018' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: '#1e293b' }}>
              Shot Probability
            </div>
            {result ? (
              <>
                <ProbGauge prob={result.shot_probability} />
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                  {[
                    ['Model', result.model_used.toUpperCase()],
                    ['Events', result.n_events.toString()],
                    ['P(shot)', (result.shot_probability * 100).toFixed(2) + '%'],
                    ['Risk', result.shot_probability > 0.6 ? '🔴 High' : result.shot_probability > 0.35 ? '🟡 Medium' : '🟢 Low'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ color: '#64748b', fontSize: 11 }}>{k}</div>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0', fontSize: 14 }}>
                Select a scenario and click Predict
              </div>
            )}
          </div>

          {/* Info card */}
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 16, fontSize: 13, color: '#166534' }}>
            <strong>About this model</strong><br />
            Trained on StatsBomb open data (Bundesliga 2023/24, La Liga 2020/21, Ligue 1 2021/22 + 2022/23).
            The GRU model processes the full event sequence; the baseline uses aggregate features only.
            Primary metric: PR-AUC.
          </div>
        </div>
      </div>
    </div>
  )
}
