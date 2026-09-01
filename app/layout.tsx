import type { Metadata, Viewport } from 'next'
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/500.css'
import '@fontsource/noto-sans-thai/600.css'
import '@fontsource/noto-sans-thai/700.css'
import './globals.css'

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Shift Scheduler' },
  title: 'ระบบจัดตารางเวร · กลุ่มงานเทคนิคการแพทย์ รพ.ชลบุรี',
  description: 'ระบบจัดตารางเวรออนไลน์ กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
