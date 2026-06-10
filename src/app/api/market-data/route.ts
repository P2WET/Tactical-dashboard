import { NextResponse } from 'next/server'

const TD_KEY = process.env.TWELVE_DATA_API_KEY!

// Twelve Data free tier max is ~5 years (outputsize 5000 = all available)
// For QQQ-based model we also fetch QQQ as primary
const SPY_TICKERS  = ['SPY', 'RSP', 'IWM', 'QQQ', 'TLT']
const QQQ_TICKERS  = ['QQQ', 'RSP', 'IWM', 'TLT']  // QQQ is primary for tech model
const VIX_TICKER   = 'VIX'

type Bar = { date: string; open: number; high: number; low: number; close: number }

async function fetchTicker(symbol: string): Promise<Bar[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=5000&apikey=${TD_KEY}&format=JSON`
  const res = await fetch(url, { next: { revalidate: 3600 } })
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`)
  const json = await res.json()
  if (json.status === 'error' || !json.values?.length) {
    throw new Error(`${symbol}: ${json.message || 'no data'}`)
  }
  return (json.values as any[])
    .map((v: any) => ({
      date:  v.datetime.slice(0, 10),
      open:  parseFloat(v.open),
      high:  parseFloat(v.high),
      low:   parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .filter(d => !isNaN(d.close))
    .reverse()
}

export async function GET() {
  try {
    const allTickers = [...SPY_TICKERS, ...QQQ_TICKERS, VIX_TICKER]
    const needed = allTickers.filter((t, i) => allTickers.indexOf(t) === i)
    const results = await Promise.allSettled(
      needed.map(t => fetchTicker(t).then(data => ({ ticker: t, data })))
    )

    const datasets: Record<string, Bar[]> = {}
    const errors: string[] = []

    for (const r of results) {
      if (r.status === 'fulfilled') {
        datasets[r.value.ticker] = r.value.data
      } else {
        errors.push(r.reason?.message || 'unknown')
      }
    }

    if (!datasets.SPY?.length) {
      return NextResponse.json({ error: 'SPY data unavailable', errors }, { status: 502 })
    }

    const rows = Object.fromEntries(Object.entries(datasets).map(([k,v]) => [k, v.length]))
    const oldest = Object.fromEntries(Object.entries(datasets).map(([k,v]) => [k, v[0]?.date ?? null]))

    return NextResponse.json({ datasets, errors, fetchedAt: new Date().toISOString(), rows, oldest })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
