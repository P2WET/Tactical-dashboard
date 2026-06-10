export type Bar = { date: string; open: number; high: number; low: number; close: number }
export type Datasets = Record<string, Bar[]>

export type SignalRow = {
  date: string
  close: number
  compositeScore: number
  riskOn: boolean
  scores: Record<string, number>
  details: Record<string, string>
  ma50: number | null
  ma200: number | null
  rsiVal: number | null
  stochK: number | null
  stochD: number | null
  bbPct: number | null
  vix: number | null
  rspRatio: number | null
  iwmRatio: number | null
  qqqRatio: number | null
}

export type BacktestResult = {
  equity: { date: string; portfolio: number; benchmark: number; riskOn: boolean; score: number }[]
  portRet: string
  benchRet: string
  alpha: string
  maxDD: string
  riskOnPct: string
  transitions: number
  startDate: string
  endDate: string
  years: number
}

// ── Math ──────────────────────────────────────────────────────
export const sma = (arr: (number | null)[], n: number): (number | null)[] => {
  const out: (number | null)[] = new Array(arr.length).fill(null)
  for (let i = n - 1; i < arr.length; i++) {
    const sl = arr.slice(i - n + 1, i + 1)
    if (sl.every(v => v != null)) out[i] = (sl as number[]).reduce((a, b) => a + b, 0) / n
  }
  return out
}

const rsiCalc = (cl: number[], p = 14): (number | null)[] => {
  const out: (number | null)[] = new Array(cl.length).fill(null)
  for (let i = p; i < cl.length; i++) {
    let g = 0, l = 0
    for (let j = i - p + 1; j <= i; j++) { const d = cl[j]-cl[j-1]; if (d>0) g+=d; else l-=d }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + (g/p) / (l/p))
  }
  return out
}

const stochCalc = (hi: number[], lo: number[], cl: number[], k=14, d=3) => {
  const kLine: (number|null)[] = cl.map((_,i) => {
    if (i < k-1) return null
    const H = Math.max(...hi.slice(i-k+1,i+1))
    const L = Math.min(...lo.slice(i-k+1,i+1))
    return H === L ? 50 : ((cl[i]-L)/(H-L))*100
  })
  return { k: kLine, d: sma(kLine.map(v => v ?? 0), d) }
}

const bbCalc = (cl: number[], p=20) => {
  const mid = sma(cl, p)
  return cl.map((c,i) => {
    if (!mid[i]) return null
    const sl = cl.slice(i-p+1,i+1)
    const sd = Math.sqrt(sl.reduce((a,v) => a+(v-mid[i]!)**2,0)/p)
    const u=mid[i]!+2*sd, l=mid[i]!-2*sd
    return { pct: (c-l)/((u-l)||1) }
  })
}

// ── Signals ───────────────────────────────────────────────────
// mode: 'spy' uses SPY as primary. 'qqq' uses QQQ as primary.
export function computeSignals(ds: Datasets, mode: 'spy'|'qqq' = 'spy'): SignalRow[] | null {
  const primary = mode === 'qqq' ? (ds.QQQ ?? ds.SPY) : ds.SPY
  if (!primary?.length || primary.length < 60) return null

  const cl = primary.map(d => d.close)
  const hi = primary.map(d => d.high)
  const lo = primary.map(d => d.low)
  const n  = primary.length

  const p50  = Math.min(50,  Math.floor(n*0.15))
  const p200 = Math.min(200, Math.floor(n*0.75))
  const p20  = Math.min(20,  Math.floor(n*0.07))
  const start = Math.min(p200+5, Math.floor(n*0.78))

  const ma50  = sma(cl, p50)
  const ma200 = sma(cl, p200)
  const ma20  = sma(cl, p20)
  const rsiA  = rsiCalc(cl, 14)
  const st    = stochCalc(hi, lo, cl, 14, 3)
  const bb    = bbCalc(cl, 20)

  const lk: Record<string, Record<string,number>> = {}
  const others = mode === 'qqq'
    ? ['RSP','IWM','SPY','VIX','TLT']
    : ['RSP','IWM','QQQ','VIX','TLT']
  others.forEach(tk =>
    (ds[tk]||[]).forEach(d => { if(!lk[d.date])lk[d.date]={}; lk[d.date][tk]=d.close })
  )

  // Breadth: for QQQ mode, use IWM/QQQ and SPY/QQQ ratios
  const b1Key = mode === 'qqq' ? 'SPY'  : 'RSP'
  const b2Key = mode === 'qqq' ? 'IWM'  : 'IWM'
  const b3Key = mode === 'qqq' ? 'TLT'  : 'QQQ'

  const b1R  = primary.map(d => lk[d.date]?.[b1Key] ? lk[d.date][b1Key]/d.close : null)
  const b2R  = primary.map(d => lk[d.date]?.[b2Key] ? lk[d.date][b2Key]/d.close : null)
  const b3R  = primary.map(d => lk[d.date]?.[b3Key] ? lk[d.date][b3Key]/d.close : null)
  const b1Ma = sma(b1R, p20)
  const b2Ma = sma(b2R, p20)
  const b3Ma = sma(b3R, p20)

  return primary.map((d,i) => {
    if (i < start) return null
    const row = lk[d.date] || {}
    const sc: Record<string,number> = {}
    const det: Record<string,string> = {}

    sc.maCross       = (ma50[i]&&ma200[i]&&ma50[i]!>ma200[i]!) ? 1 : 0
    det.maCross      = ma50[i]&&ma200[i] ? `MA${p50} $${ma50[i]!.toFixed(1)} ${sc.maCross?'>':'<'} MA${p200} $${ma200[i]!.toFixed(1)}` : 'Calculating'
    sc.priceAbove200 = (ma200[i]&&d.close>ma200[i]!) ? 1 : 0
    det.priceAbove200= ma200[i] ? `${mode==='qqq'?'QQQ':'SPY'} $${d.close.toFixed(2)} ${sc.priceAbove200?'>':'<'} MA${p200} $${ma200[i]!.toFixed(1)}` : 'Calculating'

    const r1=b1R[i]
    sc.breadthB1     = (r1&&b1Ma[i]&&r1>b1Ma[i]!) ? 1 : 0
    det.breadthB1    = r1 ? `${b1Key}/${mode==='qqq'?'QQQ':'SPY'} ${(r1*100).toFixed(3)} ${sc.breadthB1?'>':'<'} 20d avg ${(b1Ma[i]!*100).toFixed(3)}` : `${b1Key} missing`

    const r2=b2R[i]
    sc.breadthB2     = (r2&&b2Ma[i]&&r2>b2Ma[i]!) ? 1 : 0
    det.breadthB2    = r2 ? `${b2Key}/${mode==='qqq'?'QQQ':'SPY'} ${(r2*100).toFixed(3)} ${sc.breadthB2?'>':'<'} 20d avg ${(b2Ma[i]!*100).toFixed(3)}` : `${b2Key} missing`

    const r3=b3R[i]
    sc.breadthB3     = (r3&&b3Ma[i]&&r3>b3Ma[i]!) ? 1 : 0
    det.breadthB3    = r3 ? `${b3Key}/${mode==='qqq'?'QQQ':'SPY'} ${(r3*100).toFixed(3)} ${sc.breadthB3?'>':'<'} 20d avg ${(b3Ma[i]!*100).toFixed(3)}` : `${b3Key} missing`

    const rv=rsiA[i]
    sc.rsiMomentum   = (rv&&rv>50) ? 1 : 0
    det.rsiMomentum  = rv ? `RSI(14) = ${rv.toFixed(1)} — ${rv>70?'Overbought':rv>50?'Bullish':rv>30?'Bearish':'Oversold'}` : 'Calculating'

    const kv=st.k[i], dv=st.d[i]
    sc.stochastic    = (kv&&dv&&kv>dv&&kv>25) ? 1 : 0
    det.stochastic   = kv ? `%K ${kv.toFixed(1)} ${kv>dv!?'>':'<'} %D ${dv?.toFixed(1)}` : 'Calculating'

    const vix=row.VIX
    sc.sentiment     = (vix&&vix<20) ? 1 : 0
    det.sentiment    = vix ? `VIX ${vix.toFixed(2)} — ${vix<15?'Complacent':vix<20?'Calm ✓':vix<30?'Elevated':vix<40?'Fear':'Panic'}` : 'VIX missing'

    const total = Object.values(sc).reduce((a,b)=>a+b,0)
    return {
      date:d.date, close:d.close,
      compositeScore:total, riskOn:total>=5,
      scores:sc, details:det,
      ma50:ma50[i], ma200:ma200[i],
      rsiVal:rv, stochK:kv??null, stochD:dv??null,
      bbPct:bb[i]?.pct??null,
      vix:vix??null,
      rspRatio:b1R[i], iwmRatio:b2R[i], qqqRatio:b3R[i],
    } as SignalRow
  }).filter(Boolean) as SignalRow[]
}

// ── Backtest with date range filter ───────────────────────────
export function runBacktest(
  results: SignalRow[],
  fromDate?: string  // YYYY-MM-DD, if undefined uses all data
): BacktestResult | null {
  if (!results.length) return null
  const filtered = fromDate ? results.filter(r => r.date >= fromDate) : results
  if (filtered.length < 2) return null

  let port=10000, bench=10000, peak=10000, maxDD=0, onD=0, offD=0, trans=0
  let prev: boolean|null = null
  const equity: BacktestResult['equity'] = []

  for (let i=1; i<filtered.length; i++) {
    const ret = (filtered[i].close - filtered[i-1].close) / filtered[i-1].close
    if (prev!==null && filtered[i].riskOn!==prev) trans++
    prev = filtered[i].riskOn
    if (filtered[i].riskOn) { port*=(1+ret); onD++ } else { port*=1.000135; offD++ }
    bench*=(1+ret)
    if (port>peak) peak=port
    const dd=(peak-port)/peak; if(dd>maxDD) maxDD=dd
    equity.push({ date:filtered[i].date, portfolio:+port.toFixed(2), benchmark:+bench.toFixed(2), riskOn:filtered[i].riskOn, score:filtered[i].compositeScore })
  }

  const pr=(port/10000-1)*100, br=(bench/10000-1)*100
  const startDate = filtered[0].date
  const endDate   = filtered[filtered.length-1].date
  const years     = Math.round((new Date(endDate).getTime()-new Date(startDate).getTime())/(1000*60*60*24*365.25)*10)/10

  return {
    equity, portRet:pr.toFixed(1), benchRet:br.toFixed(1),
    alpha:(pr-br).toFixed(1), maxDD:(maxDD*100).toFixed(1),
    riskOnPct:(onD/(onD+offD)*100).toFixed(1), transitions:trans,
    startDate, endDate, years,
  }
}
