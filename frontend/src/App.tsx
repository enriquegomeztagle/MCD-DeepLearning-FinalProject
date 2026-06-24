import { useState, useEffect, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''

/* ── Palette ─────────────────────────────────────────────────────────── */
const C = {
  bg:     '#0c0d1e',
  side:   '#0f1023',
  card:   '#141528',
  card2:  '#1a1b30',
  border: '#1e2040',
  muted:  '#3d3f6b',
  dim:    '#6e71a0',
  text:   '#dde1f5',
  pink:   '#f72585',
  cyan:   '#4cc9f0',
  purple: '#7c3aed',
  violet: '#4361ee',
  teal:   '#06d6a0',
  amber:  '#ffd166',
}

/* ── Global CSS injected once ────────────────────────────────────────── */
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; overflow: hidden; }
  body { background:${C.bg}; color:${C.text}; font-family:'Inter',system-ui,sans-serif; }
  input,select { outline:none; }
  button { outline:none; font-family:inherit; }
  * { scrollbar-width:thin; scrollbar-color:${C.border} transparent; }
  *::-webkit-scrollbar { width:3px; height:3px; }
  *::-webkit-scrollbar-thumb { background:${C.border}; border-radius:3px; }

  @keyframes fadeUp  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  @keyframes popIn   { from{opacity:0;transform:scale(.85)} to{opacity:1;transform:scale(1)} }
  @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:.25} }
  @keyframes spin    { to{transform:rotate(360deg)} }
  @keyframes glow    { 0%,100%{box-shadow:0 0 16px ${C.pink}50} 50%{box-shadow:0 0 36px ${C.pink},0 0 60px ${C.purple}50} }
  @keyframes barIn   { from{width:0} }

  .fade-up { animation:fadeUp .4s ease both; }
  .pop-in  { animation:popIn .35s cubic-bezier(.34,1.56,.64,1) both; }

  .scenario-btn {
    width:100%; background:transparent; border:1px solid ${C.border};
    border-radius:10px; padding:9px 12px; cursor:pointer; text-align:left;
    display:flex; align-items:center; gap:10px; transition:all .18s;
    color:${C.text};
  }
  .scenario-btn:hover { border-color:${C.violet}60; background:${C.violet}10; transform:translateX(2px); }
  .scenario-btn.active { background:${C.violet}18; }

  .analyze-btn {
    width:100%; padding:13px; font-size:14px; font-weight:800; letter-spacing:.02em;
    background:linear-gradient(135deg,${C.violet} 0%,${C.purple} 50%,${C.pink} 100%);
    color:#fff; border:none; border-radius:12px; cursor:pointer;
    box-shadow:0 4px 20px ${C.purple}50; transition:transform .15s,box-shadow .15s;
    animation:glow 2.8s ease-in-out infinite;
  }
  .analyze-btn:hover:not(:disabled) { transform:translateY(-2px) scale(1.02); box-shadow:0 8px 32px ${C.pink}50; }
  .analyze-btn:active:not(:disabled){ transform:scale(.97); }
  .analyze-btn:disabled { background:${C.card2}; color:${C.muted}; box-shadow:none; animation:none; cursor:not-allowed; opacity:.55; pointer-events:none; }

  .evt-row { transition:background .12s; }
  .evt-row:hover { background:${C.card2} !important; }

  .add-btn {
    background:${C.violet}20; border:1px solid ${C.violet}40; color:${C.cyan};
    border-radius:8px; padding:5px 12px; cursor:pointer; font-size:11px; font-weight:700;
    transition:all .15s;
  }
  .add-btn:hover { background:${C.violet}35; border-color:${C.cyan}60; }

  .chip-node { transition:transform .12s; cursor:default; }
  .chip-node:hover { transform:scale(1.06); }

  .bar-track { height:8px; background:${C.border}; border-radius:8px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:8px; animation:barIn 1.2s cubic-bezier(.22,1,.36,1) both; }
`

/* ── Data ───────────────────────────────────────────────────────────── */
const EVENT_TYPES = [
  'Pass','Carry','Ball Receipt*','Pressure','Dribble','Ball Recovery',
  'Clearance','Interception','Duel','Foul Committed','Foul Won','Block',
  'Miscontrol','Dispossessed','Dribbled Past','50/50','Goal Keeper',
  'Offside','Shield','Error','Own Goal For','Own Goal Against',
]
const PLAY_PATTERNS = [
  'Regular Play','From Corner','From Free Kick','From Throw In',
  'From Goal Kick','From Keeper','From Kick Off',
]

const EC: Record<string,string> = {
  'Pass':C.cyan,'Carry':C.teal,'Dribble':C.amber,'Ball Receipt*':'#a78bfa',
  'Pressure':C.pink,'Duel':'#f472b6','Clearance':'#2dd4bf','Interception':'#fb923c',
  'Ball Recovery':C.teal,'Block':C.purple,'Miscontrol':'#e879f9',
}
const ec = (t:string) => EC[t] || C.dim

interface Evt {
  event_type:string; play_pattern:string
  x:number|null; y:number|null; end_x:number|null; end_y:number|null
  duration:number|null; under_pressure:number; minute:number|null; second:number|null
}
interface Pred { shot_probability:number; model_used:string; n_events:number }

const blank = ():Evt => ({
  event_type:'Pass', play_pattern:'Regular Play',
  x:60, y:40, end_x:null, end_y:null,
  duration:1, under_pressure:0, minute:45, second:0,
})

const PRESETS:{[k:string]:{icon:string;color:string;desc:string;events:Evt[]}} = {
  'Ataque Peligroso': { icon:'⚡', color:C.pink, desc:'Progresión profunda al área bajo presión', events:[
    {event_type:'Ball Receipt*',play_pattern:'Regular Play',x:75,y:40,end_x:null,end_y:null,duration:.1,under_pressure:0,minute:62,second:5},
    {event_type:'Carry',play_pattern:'Regular Play',x:75,y:40,end_x:88,end_y:35,duration:1.5,under_pressure:0,minute:62,second:6},
    {event_type:'Pass',play_pattern:'Regular Play',x:88,y:35,end_x:95,end_y:28,duration:.8,under_pressure:0,minute:62,second:8},
    {event_type:'Ball Receipt*',play_pattern:'Regular Play',x:95,y:28,end_x:null,end_y:null,duration:.1,under_pressure:1,minute:62,second:9},
    {event_type:'Dribble',play_pattern:'Regular Play',x:95,y:28,end_x:100,end_y:30,duration:1.2,under_pressure:1,minute:62,second:10},
    {event_type:'Carry',play_pattern:'Regular Play',x:100,y:30,end_x:108,end_y:36,duration:1,under_pressure:0,minute:62,second:12},
  ]},
  'Build-up Seguro': { icon:'🛡️', color:C.cyan, desc:'Pases cortos en campo propio, sin intención de gol', events:[
    {event_type:'Pass',play_pattern:'From Goal Kick',x:12,y:40,end_x:30,end_y:35,duration:1.2,under_pressure:0,minute:33,second:0},
    {event_type:'Ball Receipt*',play_pattern:'From Goal Kick',x:30,y:35,end_x:null,end_y:null,duration:.1,under_pressure:0,minute:33,second:2},
    {event_type:'Pass',play_pattern:'Regular Play',x:30,y:35,end_x:25,end_y:20,duration:.9,under_pressure:0,minute:33,second:3},
    {event_type:'Ball Receipt*',play_pattern:'Regular Play',x:25,y:20,end_x:null,end_y:null,duration:.1,under_pressure:0,minute:33,second:5},
    {event_type:'Carry',play_pattern:'Regular Play',x:25,y:20,end_x:40,end_y:25,duration:2,under_pressure:0,minute:33,second:6},
    {event_type:'Pass',play_pattern:'Regular Play',x:40,y:25,end_x:45,end_y:60,duration:.7,under_pressure:0,minute:33,second:9},
  ]},
  'Contraataque': { icon:'🚀', color:C.amber, desc:'Transición rápida tras recuperación — carrera larga', events:[
    {event_type:'Ball Recovery',play_pattern:'From Counter',x:35,y:42,end_x:null,end_y:null,duration:.3,under_pressure:0,minute:78,second:22},
    {event_type:'Carry',play_pattern:'From Counter',x:35,y:42,end_x:65,end_y:38,duration:2.5,under_pressure:0,minute:78,second:23},
    {event_type:'Pass',play_pattern:'From Counter',x:65,y:38,end_x:90,end_y:35,duration:1.1,under_pressure:0,minute:78,second:26},
    {event_type:'Ball Receipt*',play_pattern:'From Counter',x:90,y:35,end_x:null,end_y:null,duration:.1,under_pressure:1,minute:78,second:28},
    {event_type:'Carry',play_pattern:'From Counter',x:90,y:35,end_x:105,end_y:38,duration:1.4,under_pressure:1,minute:78,second:29},
  ]},
}

/* ── CountUp hook ────────────────────────────────────────────────────── */
function useCountUp(target:number, dur=900) {
  const [v,setV] = useState(0)
  const tid = useRef<ReturnType<typeof setInterval>|null>(null)
  useEffect(()=>{
    if(tid.current) clearInterval(tid.current)
    const t0 = Date.now()
    tid.current = setInterval(()=>{
      const p = Math.min((Date.now()-t0)/dur, 1)
      const e = 1 - Math.pow(1-p, 3)
      setV(target * e)
      if(p >= 1){ clearInterval(tid.current!); setV(target) }
    }, 16)
    return () => { if(tid.current) clearInterval(tid.current) }
  },[target])
  return v
}

/* ── AnimBar ─────────────────────────────────────────────────────────── */
function AnimBar({value, grad, delay=0}:{value:number; grad:string; delay?:number}) {
  const [w,setW] = useState('0%')
  const n = useCountUp(value, 1000)
  useEffect(()=>{ const t=setTimeout(()=>setW(`${(value*100).toFixed(1)}%`),delay+80); return()=>clearTimeout(t) },[value,delay])
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:7}}>
        <span style={{fontSize:11,color:C.dim,fontWeight:600}}>Probabilidad de remate</span>
        <span style={{fontSize:26,fontWeight:900,color:'#fff',letterSpacing:'-.02em',fontVariantNumeric:'tabular-nums'}}>
          {(n*100).toFixed(1)}%
        </span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{width:w, background:grad, boxShadow:`0 0 10px ${grad.split(',')[0].replace('linear-gradient(90deg,','').trim()}80`, animationDelay:`${delay}ms`}}/>
      </div>
    </div>
  )
}

/* ── Pitch ───────────────────────────────────────────────────────────── */
function Pitch({events,onPitchClick,clickMode}:{events:Evt[];onPitchClick?:(x:number,y:number)=>void;clickMode?:boolean}) {
  const W=600, H=400, sx=W/120, sy=H/80
  const pts = events.filter(e=>e.x!=null&&e.y!=null).map(e=>({x:e.x!*sx,y:e.y!*sy,t:e.event_type,ex:e.end_x,ey:e.end_y}))

  const handleClick = (ev:React.MouseEvent<SVGSVGElement>) => {
    if(!onPitchClick) return
    const r = ev.currentTarget.getBoundingClientRect()
    onPitchClick(
      +((ev.clientX-r.left)*(W/r.width)/sx).toFixed(1),
      +((ev.clientY-r.top)*(H/r.height)/sy).toFixed(1)
    )
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet"
      onClick={handleClick}
      style={{display:'block',borderRadius:14,cursor:clickMode?'crosshair':'default',
        boxShadow:`0 16px 48px #00000080, 0 0 0 1px ${C.border}`}}>
      <defs>
        <linearGradient id="pf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0f5c2e"/><stop offset="100%" stopColor="#09391e"/>
        </linearGradient>
        <filter id="ng"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="tg"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      {/* Field bg */}
      <rect width={W} height={H} fill="url(#pf)" rx="14"/>
      {[0,1,2,3,4,5].map(i=><rect key={i} x={i*100} width={100} height={H} fill={i%2?'#00000009':'transparent'}/>)}
      {/* Lines */}
      <line x1={W/2} y1={0} x2={W/2} y2={H} stroke="#ffffff1a" strokeWidth="1.5"/>
      <circle cx={W/2} cy={H/2} r={73} fill="none" stroke="#ffffff1a" strokeWidth="1.5"/>
      <circle cx={W/2} cy={H/2} r={4} fill="#ffffff30"/>
      <rect x={0} y={100} width={132} height={200} fill="none" stroke="#ffffff22" strokeWidth="1.5"/>
      <rect x={W-132} y={100} width={132} height={200} fill="none" stroke="#ffffff22" strokeWidth="1.5"/>
      <rect x={0} y={148} width={44} height={104} fill="none" stroke="#ffffff15" strokeWidth="1"/>
      <rect x={W-44} y={148} width={44} height={104} fill="none" stroke="#ffffff15" strokeWidth="1"/>
      <circle cx={88} cy={H/2} r={3} fill="#ffffff22"/>
      <circle cx={W-88} cy={H/2} r={3} fill="#ffffff22"/>
      <rect x={-6} y={160} width={10} height={80} fill="#ffffff0d" stroke="#ffffff60" strokeWidth="1.5" rx="2"/>
      <rect x={W-4} y={160} width={10} height={80} fill="#ffffff0d" stroke="#ffffff60" strokeWidth="1.5" rx="2"/>
      {/* Trajectory line */}
      {pts.length>1&&(
        <polyline points={pts.map(p=>`${p.x},${p.y}`).join(' ')} fill="none"
          stroke={`${C.amber}50`} strokeWidth="2.5" strokeLinejoin="round" strokeDasharray="8 5"
          filter="url(#tg)"/>
      )}
      {/* End-position lines */}
      {pts.map((p,i)=>p.ex!=null&&p.ey!=null&&(
        <line key={`e${i}`} x1={p.x} y1={p.y} x2={p.ex*sx} y2={p.ey*sy}
          stroke={ec(p.t)} strokeWidth="1.5" strokeDasharray="4 3" opacity=".45"/>
      ))}
      {/* Event nodes */}
      {pts.map((p,i)=>(
        <g key={i} filter="url(#ng)">
          <circle cx={p.x} cy={p.y} r={15} fill={ec(p.t)} opacity={.15}/>
          <circle cx={p.x} cy={p.y} r={9} fill={ec(p.t)} stroke="#fff" strokeWidth="1.5"/>
          <text x={p.x} y={p.y+4} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="900">{i+1}</text>
        </g>
      ))}
      {/* Legend */}
      {(['Pass','Carry','Dribble','Pressure'] as const).map((t,i)=>(
        <g key={t} transform={`translate(${10+i*88},${H-17})`}>
          <circle cx={4} cy={4} r={4} fill={ec(t)} opacity={.9}/>
          <text x={12} y={8} fill="#ffffff80" fontSize="9">{t}</text>
        </g>
      ))}
      {/* Click-mode overlay */}
      {clickMode&&(
        <g>
          <rect y={H-28} width={W} height={28} fill="#000000aa"/>
          <text x={W/2} y={H-10} textAnchor="middle" fill={C.amber} fontSize="12" fontWeight="700">
            📍 Haz click en el campo para colocar el evento
          </text>
        </g>
      )}
    </svg>
  )
}

/* ── App ─────────────────────────────────────────────────────────────── */
export default function App() {
  const [events,setEvents]     = useState<Evt[]>(PRESETS['Ataque Peligroso'].events)
  const [gru,setGru]           = useState<Pred|null>(null)
  const [base,setBase]         = useState<Pred|null>(null)
  const [loading,setLoading]   = useState(false)
  const [error,setError]       = useState<string|null>(null)
  const [apiOk,setApiOk]       = useState<boolean|null>(null)
  const [preset,setPreset]     = useState('Ataque Peligroso')
  const [showForm,setShowForm] = useState(false)
  const [editIdx,setEditIdx]   = useState<number|null>(null)
  const [newEvt,setNewEvt]     = useState<Evt>(blank())
  const [clickMode,setClickMode] = useState<'start'|'end'|null>(null)
  const resultKey = useRef(0)

  useEffect(()=>{
    let cancelled = false
    const check = () =>
      fetch(`${API_URL}/health`)
        .then(r => { if(!cancelled) setApiOk(r.ok) })
        .catch(() => { if(!cancelled) setApiOk(false) })
    check()
    const t = setInterval(check, 4000)
    return () => { cancelled = true; clearInterval(t) }
  },[])

  const predict = async () => {
    if(!events.length) return
    setLoading(true); setError(null); setGru(null); setBase(null)
    try {
      const h = {'Content-Type':'application/json'}
      const b = (m:string) => JSON.stringify({events,model:m})
      const [rg,rb] = await Promise.all([
        fetch(`${API_URL}/v1/predict-possession`,{method:'POST',headers:h,body:b('gru')}),
        fetch(`${API_URL}/v1/predict-possession`,{method:'POST',headers:h,body:b('baseline')}),
      ])
      if(!rg.ok||!rb.ok) throw new Error('Error de API — ¿está corriendo el backend en :8000?')
      resultKey.current++
      setGru(await rg.json()); setBase(await rb.json())
    } catch(e:any){ setError(e.message) }
    finally { setLoading(false) }
  }

  const commitEvt = () => {
    if(editIdx!==null){ const u=[...events]; u[editIdx]=newEvt; setEvents(u); setEditIdx(null) }
    else setEvents(e=>[...e,newEvt])
    setNewEvt(blank()); setShowForm(false); setClickMode(null)
  }

  const pitchClick = (x:number,y:number) => {
    if(clickMode==='start') setNewEvt(n=>({...n,x,y}))
    if(clickMode==='end')   setNewEvt(n=>({...n,end_x:x,end_y:y}))
    setClickMode(null)
  }

  const selectPreset = (name:string) => {
    setPreset(name); setEvents(PRESETS[name].events)
    setGru(null); setBase(null); setShowForm(false); setClickMode(null); setError(null)
  }

  /* helpers */
  const inp:React.CSSProperties = {
    background:C.card2, border:`1px solid ${C.border}`, borderRadius:8,
    padding:'7px 10px', color:C.text, fontSize:12, width:'100%',
  }
  const lbl:React.CSSProperties = {
    display:'block', fontSize:9, color:C.dim, fontWeight:700,
    textTransform:'uppercase', letterSpacing:'.09em', marginBottom:4,
  }
  const secHead = (txt:string) => (
    <div style={{fontSize:9,fontWeight:800,color:C.muted,textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>{txt}</div>
  )

  const delta = gru&&base ? gru.shot_probability - base.shot_probability : null

  return (
    <>
      <style>{CSS}</style>

      {/* Root: 3-col, full viewport height */}
      <div style={{display:'grid', gridTemplateColumns:'230px 1fr 272px', gridTemplateRows:'1fr auto', height:'100vh', gap:0}}>

        {/* ════ LEFT SIDEBAR ════════════════════════════════════════════ */}
        <div style={{background:C.side, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden'}}>

          {/* Branding */}
          <div style={{padding:'16px 16px 12px', borderBottom:`1px solid ${C.border}`, flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:5}}>
              <span style={{fontSize:22,lineHeight:1,flexShrink:0}}>⚽</span>
              <span style={{fontSize:15,fontWeight:900,letterSpacing:'-.01em',lineHeight:1,
                background:`linear-gradient(135deg,${C.cyan},${C.purple})`,
                WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
                PitchView
              </span>
            </div>
            <div style={{fontSize:10,color:C.dim,lineHeight:1.5}}>
              Modelo GRU de Deep Learning entrenado sobre 21 K posesiones reales. Predice la probabilidad de remate a partir de la secuencia de eventos.
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8}}>
              <span style={{
                width:7,height:7,borderRadius:'50%',display:'inline-block',
                background:apiOk===null?C.muted:apiOk?C.teal:'#ef4444',
                boxShadow:apiOk?`0 0 8px ${C.teal}`:apiOk===false?'0 0 8px #ef4444':'none',
                animation:apiOk===null?'blink 1.4s infinite':'none',
              }}/>
              <span style={{fontSize:9,color:C.dim}}>
                {apiOk===null?'Conectando…':apiOk?'API Online':'API Offline — inicia el backend'}
              </span>
            </div>
          </div>

          {/* Step 1 — Scenarios */}
          <div style={{padding:'14px 14px 10px', borderBottom:`1px solid ${C.border}`, flexShrink:0}}>
            {secHead('1 · Elige escenario')}
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {Object.entries(PRESETS).map(([name,p])=>(
                <button key={name} onClick={()=>selectPreset(name)}
                  className={`scenario-btn${preset===name?' active':''}`}
                  style={{borderColor:preset===name?`${p.color}70`:C.border,
                    background:preset===name?`${p.color}12`:'transparent',
                    boxShadow:preset===name?`0 0 20px ${p.color}20, inset 0 0 20px ${p.color}06`:'none'}}>
                  <span style={{fontSize:20,flexShrink:0,minWidth:24}}>{p.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:700,color:preset===name?p.color:C.text,lineHeight:1.2}}>{name}</div>
                    <div style={{fontSize:9,color:C.dim,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 — Events */}
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',padding:'12px 14px 0'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexShrink:0}}>
              {secHead(`2 · Secuencia · ${events.length} eventos`)}
              <button className="add-btn" onClick={()=>{setShowForm(s=>!s);setEditIdx(null);setNewEvt(blank())}}>
                + Agregar
              </button>
            </div>

            {/* Event list */}
            <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:3,minHeight:0}}>
              {events.map((ev,i)=>(
                <div key={i} className="evt-row" style={{
                  display:'flex',alignItems:'center',gap:5,
                  background:C.card, borderRadius:8, padding:'5px 7px',
                  borderLeft:`3px solid ${ec(ev.event_type)}`, flexShrink:0,
                }}>
                  <span style={{color:C.muted,fontSize:9,minWidth:12,textAlign:'center',fontWeight:800}}>{i+1}</span>
                  <span style={{fontSize:10,fontWeight:700,color:ec(ev.event_type),flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {ev.event_type.replace('Ball Receipt*','Receipt*')}
                  </span>
                  {ev.x!=null&&<span style={{fontSize:8,color:C.muted,flexShrink:0}}>{ev.x},{ev.y}</span>}
                  {ev.under_pressure===1&&<span style={{fontSize:9,color:C.pink,flexShrink:0}}>⚠</span>}
                  <button onClick={()=>{setNewEvt({...ev});setEditIdx(i);setShowForm(true)}}
                    style={{background:'none',border:'none',color:C.muted,cursor:'pointer',padding:'0 1px',fontSize:11,lineHeight:1}}>✏️</button>
                  <button onClick={()=>setEvents(e=>e.filter((_,j)=>j!==i))}
                    style={{background:'none',border:'none',color:C.muted,cursor:'pointer',padding:'0 1px',fontSize:15,lineHeight:1}}>×</button>
                </div>
              ))}
              {!events.length&&(
                <div style={{color:C.muted,fontSize:11,textAlign:'center',padding:'20px 0',lineHeight:1.6}}>
                  Sin eventos.<br/>Elige un escenario<br/>o agrega eventos.
                </div>
              )}

              {/* Inline form */}
              {showForm&&(
                <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginTop:4,flexShrink:0}} className="fade-up">
                  <div style={{fontSize:11,fontWeight:700,color:C.purple,marginBottom:10}}>
                    {editIdx!==null?`✏️ Editando #${editIdx+1}`:'➕ Nuevo evento'}
                  </div>
                  <div style={{marginBottom:7}}>
                    <label style={lbl}>Tipo de evento</label>
                    <select value={newEvt.event_type} onChange={e=>setNewEvt(n=>({...n,event_type:e.target.value}))} style={inp}>
                      {EVENT_TYPES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:7}}>
                    <label style={lbl}>Patrón de jugada</label>
                    <select value={newEvt.play_pattern} onChange={e=>setNewEvt(n=>({...n,play_pattern:e.target.value}))} style={inp}>
                      {PLAY_PATTERNS.map(p=><option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:7}}>
                    {(['x','y','end_x','end_y'] as const).map((k,ki)=>(
                      <div key={k}>
                        <label style={lbl}>{['Inicio X','Inicio Y','Fin X','Fin Y'][ki]}</label>
                        <div style={{display:'flex',gap:3}}>
                          <input type="number" value={(newEvt as any)[k]??''} min={0} max={ki%2===0?120:80} step={.5}
                            onChange={e=>setNewEvt(n=>({...n,[k]:e.target.value===''?null:+e.target.value}))}
                            style={{...inp,flex:1}}/>
                          {ki===0&&(
                            <button title="Colocar en campo" onClick={()=>setClickMode(c=>c==='start'?null:'start')} style={{
                              background:clickMode==='start'?`${C.violet}50`:C.card,
                              border:`1px solid ${clickMode==='start'?C.violet:C.border}`,
                              borderRadius:6,padding:'0 6px',cursor:'pointer',fontSize:11,
                            }}>📍</button>
                          )}
                          {ki===2&&(
                            <button title="Colocar fin en campo" onClick={()=>setClickMode(c=>c==='end'?null:'end')} style={{
                              background:clickMode==='end'?`${C.violet}50`:C.card,
                              border:`1px solid ${clickMode==='end'?C.violet:C.border}`,
                              borderRadius:6,padding:'0 6px',cursor:'pointer',fontSize:11,
                            }}>📍</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
                    <div>
                      <label style={lbl}>Duración (s)</label>
                      <input type="number" value={newEvt.duration??''} min={0} max={10} step={.1}
                        onChange={e=>setNewEvt(n=>({...n,duration:e.target.value===''?null:+e.target.value}))} style={inp}/>
                    </div>
                    <div>
                      <label style={lbl}>Bajo presión</label>
                      <button onClick={()=>setNewEvt(n=>({...n,under_pressure:n.under_pressure?0:1}))} style={{
                        background:newEvt.under_pressure?`${C.pink}18`:C.card2,
                        border:`1px solid ${newEvt.under_pressure?C.pink+'50':C.border}`,
                        color:newEvt.under_pressure?C.pink:C.dim,
                        borderRadius:8,padding:'7px',width:'100%',cursor:'pointer',fontWeight:700,fontSize:11,
                      }}>{newEvt.under_pressure?'⚠️ Sí':'No'}</button>
                    </div>
                  </div>
                  {clickMode&&(
                    <div style={{background:`${C.amber}10`,border:`1px solid ${C.amber}30`,borderRadius:7,padding:'5px 8px',fontSize:9,color:C.amber,marginBottom:8}}>
                      📍 Haz click en el campo → posición de <b>{clickMode==='start'?'inicio':'fin'}</b>
                    </div>
                  )}
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={commitEvt} style={{flex:1,background:`linear-gradient(135deg,${C.violet},${C.pink})`,border:'none',borderRadius:8,padding:'8px',color:'#fff',fontWeight:800,fontSize:11,cursor:'pointer'}}>
                      {editIdx!==null?'✓ Actualizar':'✓ Agregar'}
                    </button>
                    <button onClick={()=>{setShowForm(false);setEditIdx(null);setClickMode(null)}} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',color:C.dim,fontWeight:700,fontSize:11,cursor:'pointer'}}>
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Step 3 — Analyze */}
          <div style={{padding:'10px 14px 14px',borderTop:`1px solid ${C.border}`,flexShrink:0}}>
            {error&&(
              <div style={{marginBottom:8,color:C.pink,fontSize:10,background:`${C.pink}10`,border:`1px solid ${C.pink}30`,borderRadius:8,padding:'6px 10px',lineHeight:1.4}}>
                ⚠ {error}
              </div>
            )}
            {secHead('3 · Analizar')}
            <button className="analyze-btn" onClick={predict} disabled={loading||!events.length||!apiOk}>
              {loading
                ? <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
                    <span style={{display:'inline-block',width:13,height:13,border:'2px solid #fff4',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
                    Analizando…
                  </span>
                : !apiOk
                  ? '⚠ API Offline'
                  : '⚡ Analizar Posesión'
              }
            </button>
            <div style={{fontSize:9,color:C.muted,textAlign:'center',marginTop:6}}>
              {apiOk ? 'GRU + Baseline corren en paralelo' : 'Inicia el backend para analizar'}
            </div>
          </div>
        </div>

        {/* ════ CENTER — Field ══════════════════════════════════════════ */}
        <div style={{background:C.bg,display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden',padding:'12px 10px'}}>

          {/* Event sequence strip — above pitch */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px',marginBottom:10,flexShrink:0}}>
            <div style={{fontSize:9,fontWeight:800,color:C.muted,textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>
              Secuencia de eventos
            </div>
            <div style={{display:'flex',alignItems:'center',overflowX:'auto',gap:0,paddingBottom:2}}>
              {events.map((ev,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',flexShrink:0}}>
                  <div className="chip-node" style={{
                    background:`${ec(ev.event_type)}12`,
                    border:`1.5px solid ${ec(ev.event_type)}45`,
                    borderRadius:9,padding:'6px 10px',textAlign:'center',minWidth:72,
                  }}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:ec(ev.event_type),margin:'0 auto 4px',boxShadow:`0 0 7px ${ec(ev.event_type)}`}}/>
                    <div style={{fontSize:9,fontWeight:700,color:ec(ev.event_type),lineHeight:1.2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:68}}>
                      {ev.event_type.replace('Ball Receipt*','Receipt*').replace('Ball Recovery','Recovery')}
                    </div>
                    {ev.under_pressure===1&&<div style={{fontSize:8,color:C.pink,marginTop:2}}>⚠ presión</div>}
                  </div>
                  {i<events.length-1&&<span style={{color:C.muted,fontSize:12,margin:'0 2px',flexShrink:0}}>›</span>}
                </div>
              ))}
              {!events.length&&<span style={{color:C.muted,fontSize:11,padding:'4px 0'}}>Sin eventos — elige un escenario</span>}
            </div>
          </div>

          {/* Pitch */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:12,flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexShrink:0}}>
              <span style={{fontSize:9,fontWeight:800,color:C.muted,textTransform:'uppercase',letterSpacing:'.1em'}}>
                Trayectoria en campo · StatsBomb 120×80
              </span>
              {clickMode&&(
                <span style={{fontSize:10,color:C.amber,fontWeight:700,animation:'blink 1s infinite'}}>
                  📍 Modo click activo — selecciona posición
                </span>
              )}
            </div>
            <div style={{flex:1,minHeight:0,maxHeight:'65vh',overflow:'hidden',position:'relative'}}>
              <Pitch events={events} onPitchClick={clickMode?pitchClick:undefined} clickMode={!!clickMode}/>
            </div>
          </div>
        </div>

        {/* ════ RIGHT PANEL — Results ═══════════════════════════════════ */}
        <div style={{background:C.side,borderLeft:`1px solid ${C.border}`,display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>

          {/* Panel header */}
          <div style={{padding:'18px 16px 14px',borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            <div style={{fontSize:13,fontWeight:900,color:C.text}}>Análisis de Riesgo</div>
            <div style={{fontSize:9,color:C.dim,marginTop:3}}>Probabilidad de remate por modelo</div>
          </div>

          <div style={{flex:1,overflowY:'auto',padding:'14px 16px'}}>

            {gru&&base ? (
              <div key={resultKey.current} className="fade-up">

                {/* GRU card */}
                <div style={{background:C.card,border:`1px solid ${C.pink}25`,borderRadius:14,padding:14,marginBottom:12,boxShadow:`0 0 24px ${C.pink}12`}} className="pop-in">
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                    <div style={{width:34,height:34,borderRadius:10,background:`${C.pink}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,border:`1px solid ${C.pink}30`}}>🧠</div>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:C.pink}}>GRU — Deep Learning</div>
                      <div style={{fontSize:9,color:C.dim}}>Procesa la secuencia completa</div>
                    </div>
                  </div>
                  <AnimBar value={gru.shot_probability} grad={`linear-gradient(90deg,${C.purple},${C.pink})`} delay={0}/>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
                    <span style={{fontSize:9,color:C.dim}}>PR-AUC del modelo</span>
                    <span style={{fontSize:11,fontWeight:700,color:C.pink}}>0.870</span>
                  </div>
                </div>

                {/* Baseline card */}
                <div style={{background:C.card,border:`1px solid ${C.cyan}25`,borderRadius:14,padding:14,marginBottom:12,boxShadow:`0 0 24px ${C.cyan}12`}} className="pop-in">
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                    <div style={{width:34,height:34,borderRadius:10,background:`${C.cyan}15`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,border:`1px solid ${C.cyan}30`}}>📊</div>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:C.cyan}}>Logistic Regression</div>
                      <div style={{fontSize:9,color:C.dim}}>Solo características agregadas</div>
                    </div>
                  </div>
                  <AnimBar value={base.shot_probability} grad={`linear-gradient(90deg,${C.violet},${C.cyan})`} delay={120}/>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
                    <span style={{fontSize:9,color:C.dim}}>PR-AUC del modelo</span>
                    <span style={{fontSize:11,fontWeight:700,color:C.cyan}}>0.564</span>
                  </div>
                </div>

                {/* Delta + stats */}
                {delta!==null&&(
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}} className="pop-in">
                      {[
                        {k:'Diferencia',v:`${delta>=0?'+':''}${(delta*100).toFixed(1)} pp`,c:delta>=0?C.pink:C.cyan},
                        {k:'Ventaja',v:delta>=0?'GRU':'Baseline',c:delta>=0?C.pink:C.cyan},
                      ].map(({k,v,c})=>(
                        <div key={k} style={{background:C.card2,borderRadius:10,padding:'10px 8px',textAlign:'center',border:`1px solid ${c}20`}}>
                          <div style={{fontSize:9,color:C.dim,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em'}}>{k}</div>
                          <div style={{fontSize:16,fontWeight:900,color:c,marginTop:4}}>{v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Insight */}
                    <div style={{background:`linear-gradient(135deg,${C.purple}14,${C.pink}08)`,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}} className="fade-up">
                      <div style={{fontSize:9,fontWeight:800,color:C.muted,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:7}}>💡 Interpretación</div>
                      <div style={{fontSize:11,color:'#9b9ec8',lineHeight:1.65}}>
                        {delta>0.05
                          ?`El GRU detecta mayor peligro que el Baseline (+${(delta*100).toFixed(1)} pp). La secuencia revela amenaza que las estadísticas agregadas no capturan.`
                          :delta<-0.05
                          ?`El Baseline sobreestima el peligro vs el GRU (${(delta*100).toFixed(1)} pp). La secuencia completa da más contexto al modelo profundo.`
                          :'Ambos modelos coinciden: esta posesión tiene riesgo similar de remate.'}
                      </div>
                    </div>
                  </>
                )}

              </div>
            ) : (
              /* Empty state — show model stats teaser */
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <div style={{textAlign:'center',padding:'20px 0 14px'}}>
                  <div style={{width:54,height:54,borderRadius:'50%',background:`linear-gradient(135deg,${C.purple}25,${C.pink}18)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,border:`2px solid ${C.purple}35`,margin:'0 auto 10px'}}>
                    ⚡
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>Listo para analizar</div>
                  <div style={{fontSize:10,color:C.dim,marginTop:4,lineHeight:1.5}}>Elige un escenario y presiona<br/><span style={{color:C.cyan}}>Analizar Posesión</span></div>
                </div>

                {/* Model stat cards */}
                {[
                  {icon:'🧠',label:'GRU PR-AUC',val:'0.870',color:C.pink,w:.870,grad:`linear-gradient(90deg,${C.purple},${C.pink})`},
                  {icon:'📊',label:'Baseline PR-AUC',val:'0.564',color:C.cyan,w:.564,grad:`linear-gradient(90deg,${C.violet},${C.cyan})`},
                  {icon:'📈',label:'Mejora GRU vs Baseline',val:'+30.7 pp',color:C.teal,w:.5,grad:`linear-gradient(90deg,${C.teal}80,${C.teal})`},
                ].map(({icon,label,val,color,w,grad})=>(
                  <div key={label} style={{background:C.card,borderRadius:12,padding:'11px 13px',border:`1px solid ${color}18`}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:7}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <span style={{fontSize:14}}>{icon}</span>
                        <span style={{fontSize:10,color:C.dim,fontWeight:600}}>{label}</span>
                      </div>
                      <span style={{fontSize:13,fontWeight:900,color}}>{val}</span>
                    </div>
                    <div className="bar-track">
                      <div style={{height:'100%',width:`${w*100}%`,background:grad,borderRadius:8}}/>
                    </div>
                  </div>
                ))}

                <div style={{marginTop:4,background:`${C.violet}10`,border:`1px solid ${C.violet}25`,borderRadius:10,padding:'10px 12px'}}>
                  <div style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>Dataset</div>
                  {[['Partidos','127'],['Posesiones','21,080'],['Tasa de remate','14.3%'],['Ligas','4']].map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:10,marginTop:4}}>
                      <span style={{color:C.dim}}>{k}</span>
                      <span style={{color:C.text,fontWeight:700}}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Footer */}
      <div style={{gridColumn:'1/-1',textAlign:'center',padding:'8px 0',color:C.dim,fontSize:11,borderTop:`1px solid ${C.border}`,background:C.side}}>
        ⚽ <strong style={{color:C.cyan}}>PitchView — Football Possession Analysis</strong> — Luis Alejandro Guillén Alvarez · Enrique Ulises Báez Gómez Tagle
      </div>
    </>
  )
}
