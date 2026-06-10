'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { computeSignals, runBacktest, type SignalRow, type BacktestResult, type Datasets } from '@/lib/signals'

// ── Design ────────────────────────────────────────────────────
const C = {
  bg:'#07101c', surface:'#0d1a28', card:'#101e2e',
  border:'#162438', accent:'#00dba8', accentDim:'#00dba812',
  danger:'#ff3f5e', dangerDim:'#ff3f5e12', gold:'#f6a21e',
  bull:'#00dba8', bear:'#ff3f5e',
  text:'#dae6f2', muted:'#4d7a9e',
}

const PILLARS = {
  Trend:     { color:'#7c83f7', keys:['maCross','priceAbove200'] },
  Breadth:   { color:'#00dba8', keys:['breadthB1','breadthB2','breadthB3'] },
  Momentum:  { color:'#f6a21e', keys:['rsiMomentum','stochastic'] },
  Sentiment: { color:'#f472b6', keys:['sentiment'] },
}

const SPY_IND: Record<string,{label:string;pillar:string;desc:string}> = {
  maCross:        { label:'50/200 MA Cross',               pillar:'Trend',    desc:'Golden Cross: 50d SMA above 200d SMA' },
  priceAbove200:  { label:'Price > 200-day MA',            pillar:'Trend',    desc:'SPY above its long-term trend line' },
  breadthB1:      { label:'Equal-Weight Breadth (RSP/SPY)',pillar:'Breadth',  desc:'RSP outperforming SPY = broad participation' },
  breadthB2:      { label:'Small-Cap Breadth (IWM/SPY)',   pillar:'Breadth',  desc:'Small caps leading = genuine risk appetite' },
  breadthB3:      { label:'Growth Leadership (QQQ/SPY)',   pillar:'Breadth',  desc:'Growth stocks leading = expansionary regime' },
  rsiMomentum:    { label:'RSI(14) > 50',                  pillar:'Momentum', desc:'Positive price momentum' },
  stochastic:     { label:'Stochastic %K > %D',            pillar:'Momentum', desc:'Stochastic crossover above 25' },
  sentiment:      { label:'VIX < 20',                      pillar:'Sentiment',desc:'Fear gauge below 20 = calm environment' },
}

const QQQ_IND: Record<string,{label:string;pillar:string;desc:string}> = {
  maCross:        { label:'50/200 MA Cross (QQQ)',         pillar:'Trend',    desc:'Golden Cross: QQQ 50d SMA above 200d SMA' },
  priceAbove200:  { label:'QQQ Price > 200-day MA',        pillar:'Trend',    desc:'QQQ above its long-term trend line' },
  breadthB1:      { label:'Broad Market (SPY/QQQ)',        pillar:'Breadth',  desc:'SPY holding up relative to QQQ = healthy backdrop' },
  breadthB2:      { label:'Small-Cap Breadth (IWM/QQQ)',   pillar:'Breadth',  desc:'Small caps participating = broad risk-on' },
  breadthB3:      { label:'Bonds vs Tech (TLT/QQQ)',       pillar:'Breadth',  desc:'TLT falling vs QQQ = growth regime, rates healthy' },
  rsiMomentum:    { label:'RSI(14) > 50 (QQQ)',            pillar:'Momentum', desc:'Positive momentum on NASDAQ 100' },
  stochastic:     { label:'Stochastic %K > %D (QQQ)',      pillar:'Momentum', desc:'QQQ stochastic crossover above 25' },
  sentiment:      { label:'VIX < 20',                      pillar:'Sentiment',desc:'Fear gauge below 20 = calm environment' },
}

// ── Backtest date range presets ───────────────────────────────
const PRESETS = [
  { label:'1Y',  months:12  },
  { label:'2Y',  months:24  },
  { label:'3Y',  months:36  },
  { label:'5Y',  months:60  },
  { label:'Max', months:999 },
]

function getFromDate(months: number): string | undefined {
  if (months >= 999) return undefined
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0,10)
}

// ── Charts ────────────────────────────────────────────────────
function EquityCurve({ equity }: { equity: BacktestResult['equity'] }) {
  if (!equity?.length) return null
  const W=900,H=220,PL=58,PR=14,PT=10,PB=30,iW=W-PL-PR,iH=H-PT-PB
  const allV=equity.flatMap(e=>[e.portfolio,e.benchmark])
  const minV=Math.min(...allV)*0.96, maxV=Math.max(...allV)*1.02
  const xS=(i:number)=>(i/(equity.length-1))*iW
  const yS=(v:number)=>iH-((v-minV)/(maxV-minV))*iH
  const pp=equity.map((e,i)=>`${i===0?'M':'L'}${xS(i).toFixed(1)},${yS(e.portfolio).toFixed(1)}`).join(' ')
  const bp=equity.map((e,i)=>`${i===0?'M':'L'}${xS(i).toFixed(1)},${yS(e.benchmark).toFixed(1)}`).join(' ')
  const bands:number[][]=[];let bs:number|null=null
  equity.forEach((e,i)=>{ if(!e.riskOn&&bs===null)bs=i; if(e.riskOn&&bs!==null){bands.push([bs,i]);bs=null;} })
  if(bs!==null)bands.push([bs,equity.length-1])
  const ticks=[0,.2,.4,.6,.8,1].map(t=>minV+t*(maxV-minV))
  const years:Array<{i:number,y:string}>=[]
  equity.forEach((e,i)=>{ if(i>0&&e.date.slice(0,4)!==equity[i-1].date.slice(0,4)) years.push({i,y:e.date.slice(0,4)}) })
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      <g transform={`translate(${PL},${PT})`}>
        {ticks.map(v=>{ const y=yS(v); return <g key={v}><line x1={0} y1={y} x2={iW} y2={y} stroke={C.border} strokeWidth={1}/><text x={-6} y={y+4} textAnchor="end" fontSize={10} fill={C.muted}>${(v/1000).toFixed(0)}k</text></g> })}
        {bands.map(([s,e],i)=><rect key={i} x={xS(s)} y={0} width={Math.max(2,xS(e)-xS(s))} height={iH} fill="#ff3f5e" opacity={0.09}/>)}
        {years.map(({i,y})=><text key={y} x={xS(i)} y={iH+22} textAnchor="middle" fontSize={10} fill={C.muted}>{y}</text>)}
        <path d={bp} fill="none" stroke={C.muted} strokeWidth={1.5} strokeDasharray="5,3"/>
        <path d={pp} fill="none" stroke={C.accent} strokeWidth={2.5}/>
        <text x={iW-4} y={yS(equity[equity.length-1].portfolio)-8} textAnchor="end" fontSize={10} fill={C.accent} fontWeight="600">Model</text>
        <text x={iW-4} y={yS(equity[equity.length-1].benchmark)+14} textAnchor="end" fontSize={10} fill={C.muted}>Buy & Hold</text>
      </g>
    </svg>
  )
}

function ScoreMeter({ score }: { score:number }) {
  return (
    <div style={{display:'flex',gap:5}}>
      {Array.from({length:8},(_,i)=>(
        <div key={i} style={{flex:1,height:10,borderRadius:3,background:i<score?(i<3?C.danger:i<5?C.gold:C.accent):C.border}}/>
      ))}
    </div>
  )
}

function Sparkline({ values, color }: { values:(number|null)[]; color:string }) {
  const v=values.filter(x=>x!=null) as number[]
  if (!v.length) return <div style={{height:36,background:C.surface,borderRadius:4}}/>
  const mn=Math.min(...v),mx=Math.max(...v),W=160,H=36
  const xS=(i:number)=>(i/(values.length-1||1))*W
  const yS=(val:number)=>H-((val-mn)/(mx-mn||1))*H
  const path=values.map((val,i)=>val==null?null:`${i===0||values[i-1]==null?'M':'L'}${xS(i).toFixed(1)},${yS(val).toFixed(1)}`).filter(Boolean).join(' ')
  return <svg width={W} height={H}><path d={path} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85}/></svg>
}

// ── Main ──────────────────────────────────────────────────────
type Mode = 'spy' | 'qqq'
type View = 'dashboard' | 'backtest' | 'indicators' | 'sources'

export default function Home() {
  const [rawData,    setRawData]    = useState<Datasets>({})
  const [dataInfo,   setDataInfo]   = useState<Record<string,number>>({})
  const [oldestDate, setOldestDate] = useState<Record<string,string>>({})
  const [fetchedAt,  setFetchedAt]  = useState<string|null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string|null>(null)

  const [mode,       setMode]       = useState<Mode>('spy')
  const [view,       setView]       = useState<View>('dashboard')
  const [btPreset,   setBtPreset]   = useState<number>(60)  // months

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/market-data')
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
      setRawData(json.datasets)
      setDataInfo(json.rows || {})
      setOldestDate(json.oldest || {})
      setFetchedAt(new Date(json.fetchedAt).toLocaleTimeString())
    } catch (e:any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Compute signals for current mode
  const signals = useMemo(() => computeSignals(rawData, mode), [rawData, mode])

  // Compute backtest for selected preset
  const backtest = useMemo(() => {
    if (!signals?.length) return null
    return runBacktest(signals, getFromDate(btPreset))
  }, [signals, btPreset])

  const latest = signals?.[signals.length-1]
  const IND    = mode === 'qqq' ? QQQ_IND : SPY_IND

  const box = (extra: React.CSSProperties={}): React.CSSProperties => ({
    background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:18, ...extra
  })

  // ── Loading ──
  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,color:C.text}}>
      <div style={{fontSize:15,color:C.accent,fontWeight:700,letterSpacing:'0.06em'}}>BULL / BEAR SIGNAL DASHBOARD</div>
      <div style={{fontSize:13,color:C.muted}}>Fetching live market data…</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center',maxWidth:420}}>
        {['SPY','QQQ','RSP','IWM','VIX','TLT'].map(tk=>(
          <div key={tk} style={{padding:'6px 16px',borderRadius:6,background:C.card,border:`1px solid ${C.border}`,fontSize:13,color:C.muted}}>{tk}</div>
        ))}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}.sp{animation:spin 1.5s linear infinite;display:inline-block;font-size:22px;color:#00dba8;margin-top:4px}`}</style>
      <div className="sp">◌</div>
    </div>
  )

  // ── Error ──
  if (error || !latest) return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,color:C.text,padding:24}}>
      <div style={{fontSize:24,color:C.danger}}>⚠</div>
      <div style={{fontSize:14,color:C.danger,maxWidth:480,textAlign:'center'}}>{error||'No signal data available'}</div>
      <div style={{fontSize:12,color:C.muted,maxWidth:420,textAlign:'center'}}>Ensure TWELVE_DATA_API_KEY is set in Vercel environment variables.</div>
      <button onClick={load} style={{padding:'10px 28px',borderRadius:8,background:C.accent,color:'#000',border:'none',cursor:'pointer',fontWeight:700,fontSize:14}}>Retry</button>
    </div>
  )

  const isBull   = latest.riskOn
  const sigColor = isBull ? C.bull : C.bear

  return (
    <div style={{minHeight:'100vh',color:C.text}}>

      {/* ── Header ── */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:'0 24px',position:'sticky',top:0,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',height:56}}>
          <div style={{display:'flex',alignItems:'center',gap:20}}>
            <div>
              <div style={{fontSize:11,color:C.muted,letterSpacing:'0.1em',textTransform:'uppercase'}}>Composite Signal Model</div>
              <div style={{fontSize:18,fontWeight:800,letterSpacing:'-0.02em'}}>Bull / Bear Dashboard</div>
            </div>
            {/* Mode toggle */}
            <div style={{display:'flex',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:3,gap:2}}>
              {(['spy','qqq'] as Mode[]).map(m=>(
                <button key={m} onClick={()=>setMode(m)} style={{
                  padding:'5px 16px',borderRadius:6,fontSize:13,cursor:'pointer',border:'none',
                  background:mode===m?C.accent:'transparent',
                  color:mode===m?'#000':C.muted,fontWeight:mode===m?700:400,transition:'all 0.15s'
                }}>
                  {m==='spy'?'SPY Model':'QQQ / TQQQ'}
                </button>
              ))}
            </div>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            {(['dashboard','backtest','indicators','sources'] as View[]).map(v=>(
              <button key={v} onClick={()=>setView(v)} style={{
                padding:'6px 14px',borderRadius:6,fontSize:12,cursor:'pointer',
                border:`1px solid ${view===v?C.accent:C.border}`,
                background:view===v?C.accentDim:'transparent',
                color:view===v?C.accent:C.muted,fontWeight:view===v?600:400,
              }}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>
            ))}
            <button onClick={load} style={{padding:'6px 12px',borderRadius:6,fontSize:12,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,cursor:'pointer'}}>
              ↺
            </button>
          </div>
        </div>
      </div>

      {/* ── Signal Banner ── */}
      <div style={{margin:'16px 24px 0',padding:'18px 24px',borderRadius:12,border:`2px solid ${sigColor}40`,background:`${sigColor}08`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',gap:18,alignItems:'center'}}>
          <div style={{width:56,height:56,borderRadius:12,background:`${sigColor}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,flexShrink:0}}>
            {isBull?'🐂':'🐻'}
          </div>
          <div>
            <div style={{fontSize:26,fontWeight:900,color:sigColor,letterSpacing:'-0.03em',lineHeight:1}}>
              {isBull?'BULL — FULLY INVESTED':'BEAR — MOVE TO CASH'}
            </div>
            <div style={{fontSize:12,color:C.muted,marginTop:5}}>
              {latest.compositeScore}/8 signals bullish ·{' '}
              {mode==='spy'?`SPY $${latest.close?.toFixed(2)}`:`QQQ $${latest.close?.toFixed(2)}`}{' '}
              · VIX {latest.vix?.toFixed(2)??' N/A'} · {latest.date}
            </div>
            {mode==='qqq'&&(
              <div style={{fontSize:11,color:C.gold,marginTop:4}}>
                {isBull?'⚡ Signal: Hold / Buy TQQQ (3× leveraged long)':'⚡ Signal: Hold / Buy SQQQ (3× leveraged short)'}
              </div>
            )}
          </div>
        </div>
        <div style={{textAlign:'right',fontSize:11,color:C.muted}}>
          <div style={{fontWeight:600,color:C.text}}>{mode==='spy'?'SPY Composite':'QQQ Composite'}</div>
          <div style={{marginTop:3}}>Twelve Data · {fetchedAt}</div>
          <div style={{marginTop:2}}>{signals?.length} sessions loaded</div>
        </div>
      </div>

      {/* ── DASHBOARD ── */}
      {view==='dashboard'&&(
        <div style={{padding:'16px 24px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>

          <div style={box()}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Composite Score</div>
            <div style={{fontSize:56,fontWeight:900,color:isBull?C.bull:C.bear,lineHeight:1,marginBottom:14}}>
              {latest.compositeScore}<span style={{fontSize:24,color:C.muted,fontWeight:400}}>/8</span>
            </div>
            <ScoreMeter score={latest.compositeScore}/>
            <div style={{marginTop:14,display:'flex',gap:8}}>
              <div style={{flex:1,padding:'10px 12px',borderRadius:8,background:isBull?`${C.bull}15`:`${C.bear}15`,border:`1px solid ${isBull?C.bull+'30':C.bear+'30'}`,textAlign:'center'}}>
                <div style={{fontSize:16,fontWeight:800,color:isBull?C.bull:C.bear}}>{isBull?'BULL':'BEAR'}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>Current Signal</div>
              </div>
              {mode==='qqq'&&(
                <div style={{flex:1,padding:'10px 12px',borderRadius:8,background:`${C.gold}10`,border:`1px solid ${C.gold}30`,textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:800,color:C.gold}}>{isBull?'TQQQ':'SQQQ'}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:2}}>Action</div>
                </div>
              )}
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:12}}>
              {latest.compositeScore>=7?'Strong bull — all pillars aligned':latest.compositeScore===6?'Solid bull signal':latest.compositeScore===5?'Marginal bull — monitor closely':latest.compositeScore>=3?'Mixed signals — caution':'Strong bear — capital preservation'}
            </div>
          </div>

          <div style={box()}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Signal Pillars</div>
            {Object.entries(PILLARS).map(([name,{color,keys}])=>{
              const score=keys.filter(k=>latest.scores[k]).length
              return (
                <div key={name} style={{marginBottom:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                    <span style={{fontSize:13,color,fontWeight:600}}>{name}</span>
                    <span style={{fontSize:13,fontWeight:700,color:score===keys.length?C.bull:score===0?C.bear:C.gold}}>{score}/{keys.length}</span>
                  </div>
                  <div style={{height:6,background:C.border,borderRadius:3}}>
                    <div style={{height:'100%',borderRadius:3,background:color,width:`${(score/keys.length)*100}%`,transition:'width 0.4s'}}/>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{...box(),gridColumn:'1/-1'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>All 8 Indicators</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {Object.entries(IND).map(([key,meta])=>{
                const on=latest.scores[key]===1
                const pc=(PILLARS as any)[meta.pillar]?.color??C.accent
                return (
                  <div key={key} style={{padding:'12px 14px',borderRadius:8,background:on?`${pc}0e`:'#ffffff04',border:`1px solid ${on?pc+'35':C.border}`,display:'flex',gap:12}}>
                    <div style={{width:26,height:26,borderRadius:'50%',flexShrink:0,background:on?pc:C.border,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:on?'#000':C.muted,fontWeight:700,marginTop:1}}>
                      {on?'✓':'✗'}
                    </div>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:on?C.text:C.muted}}>{meta.label}</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:3,lineHeight:1.5}}>{latest.details?.[key]}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{...box(),gridColumn:'1/-1'}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Key Readings</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10}}>
              {[
                {l:mode==='qqq'?'QQQ':'SPY', v:`$${latest.close?.toFixed(2)}`,        s:`MA200 $${latest.ma200?.toFixed(0)}`,              g:latest.close>latest.ma200!},
                {l:'MA50',                   v:`$${latest.ma50?.toFixed(1)}`,          s:latest.ma50!>latest.ma200!?'Golden Cross ✓':'Death Cross ✗', g:latest.ma50!>latest.ma200!},
                {l:'RSI 14',                 v:latest.rsiVal?.toFixed(1)??'--',        s:latest.rsiVal!>70?'Overbought':latest.rsiVal!>50?'Bullish':'Bearish', g:latest.rsiVal!>50},
                {l:'VIX',                    v:latest.vix?.toFixed(2)??'--',           s:latest.vix!<15?'Complacent':latest.vix!<20?'Calm ✓':latest.vix!<30?'Elevated':'Fear', g:latest.vix!<20},
                {l:'Stoch %K',               v:latest.stochK?.toFixed(1)??'--',        s:`%D ${latest.stochD?.toFixed(1)??'--'}`,           g:latest.stochK!>latest.stochD!},
                {l:'BB %B',                  v:latest.bbPct?.toFixed(2)??'--',         s:latest.bbPct!>0.8?'Upper band':latest.bbPct!<0.2?'Lower band':'Mid-band', g:latest.bbPct!>0.2&&latest.bbPct!<0.9},
              ].map(m=>(
                <div key={m.l} style={{padding:'12px 14px',borderRadius:8,background:C.surface,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>{m.l}</div>
                  <div style={{fontSize:21,fontWeight:700,marginTop:5,color:m.g?C.bull:C.bear}}>{m.v}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:3}}>{m.s}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── BACKTEST ── */}
      {view==='backtest'&&(
        <div style={{padding:'16px 24px'}}>

          {/* Date range selector */}
          <div style={{...box(),marginBottom:14,display:'flex',alignItems:'center',gap:16}}>
            <div style={{fontSize:12,color:C.muted,fontWeight:600,flexShrink:0}}>Backtest Window:</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {PRESETS.map(p=>(
                <button key={p.label} onClick={()=>setBtPreset(p.months)} style={{
                  padding:'6px 16px',borderRadius:6,fontSize:13,cursor:'pointer',
                  border:`1px solid ${btPreset===p.months?C.accent:C.border}`,
                  background:btPreset===p.months?C.accentDim:'transparent',
                  color:btPreset===p.months?C.accent:C.muted,fontWeight:btPreset===p.months?700:400,
                }}>
                  {p.label}
                </button>
              ))}
            </div>
            {backtest&&(
              <div style={{fontSize:11,color:C.muted,marginLeft:'auto'}}>
                {backtest.startDate} → {backtest.endDate} ({backtest.years}yr)
                {backtest.years < 2 && <span style={{color:C.gold}}> · Limited data available</span>}
              </div>
            )}
            <div style={{fontSize:11,color:C.muted,borderLeft:`1px solid ${C.border}`,paddingLeft:16}}>
              Max available: ~5yr (Twelve Data free tier)
            </div>
          </div>

          {backtest ? (
            <>
              <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:14}}>
                {[
                  {l:'Model Return',  v:`${parseFloat(backtest.portRet)>0?'+':''}${backtest.portRet}%`, c:parseFloat(backtest.portRet)>0?C.bull:C.bear},
                  {l:`${mode==='qqq'?'QQQ':'SPY'} B&H`, v:`${parseFloat(backtest.benchRet)>0?'+':''}${backtest.benchRet}%`, c:C.muted},
                  {l:'Alpha vs B&H',  v:`${parseFloat(backtest.alpha)>0?'+':''}${backtest.alpha}%`,    c:parseFloat(backtest.alpha)>0?C.bull:C.bear},
                  {l:'Max Drawdown',  v:`-${backtest.maxDD}%`,                                         c:C.gold},
                  {l:'Time Invested', v:`${backtest.riskOnPct}%`,                                      c:C.accent},
                ].map(s=>(
                  <div key={s.l} style={box({padding:'14px 16px'})}>
                    <div style={{fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{s.l}</div>
                    <div style={{fontSize:24,fontWeight:700,color:s.c}}>{s.v}</div>
                  </div>
                ))}
              </div>

              <div style={box({marginBottom:14})}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4}}>
                  <div style={{fontSize:12,fontWeight:600}}>Equity Curve — $10,000 Starting Capital</div>
                  <div style={{fontSize:11,color:C.muted}}>{backtest.transitions} regime switches · red = Bear (cash)</div>
                </div>
                <div style={{marginBottom:14}}/>
                <EquityCurve equity={backtest.equity}/>
              </div>

              <div style={box()}>
                <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Daily Composite Score — white line = 5/8 Bull threshold</div>
                <svg width="100%" viewBox="0 0 900 60">
                  {backtest.equity.map((e,i)=>{
                    const x=(i/backtest.equity.length)*900,w=Math.max(1,900/backtest.equity.length)
                    const col=e.score>=6?C.accent:e.score>=5?'#6ee7b7':e.score>=3?C.gold:C.danger
                    return <rect key={i} x={x} y={60-(e.score/8)*60} width={w} height={(e.score/8)*60} fill={col} opacity={0.9}/>
                  })}
                  <line x1={0} y1={60*(1-5/8)} x2={900} y2={60*(1-5/8)} stroke="#fff" strokeWidth={1} strokeDasharray="4,3" opacity={0.4}/>
                </svg>
              </div>
            </>
          ) : (
            <div style={{...box(),textAlign:'center',color:C.muted,padding:40}}>Not enough data for this time range</div>
          )}
        </div>
      )}

      {/* ── INDICATORS ── */}
      {view==='indicators'&&(
        <div style={{padding:'16px 24px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          {Object.entries(IND).map(([key,meta])=>{
            const on=latest.scores[key]===1
            const pc=(PILLARS as any)[meta.pillar]?.color??C.accent
            const h60=signals!.slice(-60).map(s=>s.scores[key])
            const hitRate=(h60.filter(Boolean).length/h60.length*100).toFixed(0)
            const sv=signals!.slice(-90).map(s=>{
              if(key==='maCross')       return s.ma50&&s.ma200?(s.ma50/s.ma200-1)*100:null
              if(key==='priceAbove200') return s.close&&s.ma200?(s.close/s.ma200-1)*100:null
              if(key==='rsiMomentum')   return s.rsiVal
              if(key==='stochastic')    return s.stochK
              if(key==='sentiment')     return s.vix?40-s.vix:null
              if(key==='breadthB1')     return s.rspRatio?s.rspRatio*1000:null
              if(key==='breadthB2')     return s.iwmRatio?s.iwmRatio*1000:null
              if(key==='breadthB3')     return s.qqqRatio?s.qqqRatio*100:null
              return null
            })
            return (
              <div key={key} style={box()}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                  <div>
                    <div style={{fontSize:9,color:pc,textTransform:'uppercase',letterSpacing:'0.1em'}}>{meta.pillar}</div>
                    <div style={{fontSize:13,fontWeight:600,marginTop:2,color:on?C.text:C.muted}}>{meta.label}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:13,fontWeight:800,padding:'3px 12px',borderRadius:6,background:on?`${C.bull}18`:`${C.bear}18`,color:on?C.bull:C.bear}}>
                      {on?'BULL':'BEAR'}
                    </div>
                    <div style={{fontSize:10,color:C.muted,marginTop:4}}>{hitRate}% bullish · 60d</div>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.muted,marginBottom:8,lineHeight:1.6}}>{meta.desc}</div>
                <div style={{fontSize:11,color:C.muted,marginBottom:10,fontFamily:'monospace'}}>{latest.details?.[key]}</div>
                <Sparkline values={sv} color={on?pc:C.danger}/>
                <div style={{display:'flex',gap:2,marginTop:8,flexWrap:'wrap'}}>
                  {h60.slice(-30).map((s,i)=><div key={i} style={{width:10,height:10,borderRadius:2,background:s?pc:C.border}}/>)}
                </div>
                <div style={{fontSize:9,color:C.muted,marginTop:5}}>Last 30 sessions · filled = bullish</div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── SOURCES ── */}
      {view==='sources'&&(
        <div style={{padding:'16px 24px'}}>
          <div style={box({marginBottom:14})}>
            <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Live Data — Twelve Data API</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
              {['SPY','QQQ','RSP','IWM','VIX','TLT'].map(tk=>{
                const n=dataInfo[tk]??0
                const d=rawData[tk]
                return (
                  <div key={tk} style={{padding:'12px 14px',borderRadius:8,background:C.surface,border:`1px solid ${C.border}`}}>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <span style={{fontSize:14,fontWeight:700}}>{tk}</span>
                      <span style={{fontSize:11,color:n>100?C.bull:C.bear}}>{n>100?`✓ ${n} days`:'✗ no data'}</span>
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginTop:4}}>
                      {d?.length>0?`$${d[d.length-1]?.close?.toFixed(2)} · from ${oldestDate[tk]??'?'}`:' —'}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:12,padding:'10px 14px',background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
              ⓘ Twelve Data free tier provides up to ~5 years of history. For 10–30 year backtests, a paid Twelve Data or Tiingo subscription would be needed. Data refreshes every hour automatically.
            </div>
          </div>

          <div style={box({marginBottom:14})}>
            <div style={{fontSize:14,fontWeight:600,marginBottom:10}}>QQQ / TQQQ-SQQQ Model</div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.9}}>
              <p>The QQQ model applies the same 8-indicator composite to the Nasdaq 100 (QQQ). When Bull signal fires, the implied trade is <strong style={{color:C.gold}}>TQQQ</strong> (3× leveraged long QQQ). When Bear fires, the implied trade is <strong style={{color:C.gold}}>SQQQ</strong> (3× leveraged inverse QQQ).</p>
              <p><strong style={{color:C.text}}>Important:</strong> Leveraged ETFs like TQQQ/SQQQ decay over time due to daily rebalancing. They are designed for short-term tactical use, not buy-and-hold. The composite model's trend-following nature is well-suited to reducing exposure during drawdowns, which is where leveraged ETFs get destroyed.</p>
            </div>
          </div>

          <div style={box()}>
            <div style={{fontSize:14,fontWeight:600,marginBottom:10}}>SPY Model — Breadth Proxies</div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.9}}>
              <p><strong style={{color:C.text}}>RSP/SPY</strong> — Equal-weight vs cap-weight divergence. When RSP leads, participation is broad. Correlates ~0.85 with actual % of stocks above their 50-day MA.</p>
              <p><strong style={{color:C.text}}>IWM/SPY</strong> — Small-cap vs large-cap ratio. Small-cap leadership signals genuine risk appetite across the market cap spectrum.</p>
              <p><strong style={{color:C.text}}>QQQ/SPY</strong> — Growth vs blend leadership. Growth stocks leading indicates an expansionary, low-fear regime.</p>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
