import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Potomac Signal | CRDBX Composite Model',
  description: 'Live risk-on/risk-off signal dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#07101c', fontFamily: "'Inter', system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  )
}
