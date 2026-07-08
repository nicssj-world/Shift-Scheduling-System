import type { Metadata, Viewport } from 'next'
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/500.css'
import '@fontsource/noto-sans-thai/600.css'
import '@fontsource/noto-sans-thai/700.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'ระบบจัดตารางเวร · กลุ่มงานเทคนิคการแพทย์ รพ.ชลบุรี',
  description: 'ระบบจัดตารางเวรออนไลน์ กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
