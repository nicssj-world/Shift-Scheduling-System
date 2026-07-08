'use client'

import { useState } from 'react'
import { SalesView } from '@/components/swaps/sales-view'
import { SwapsView } from '@/components/swaps/swaps-view'

export default function SwapsPage() {
  const [tab, setTab] = useState<'swap' | 'sale'>('swap')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit gap-1 rounded-xl border border-line bg-white p-1">
        <button
          onClick={() => setTab('swap')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${tab === 'swap' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-brand-50'}`}
        >
          แลกเวร
        </button>
        <button
          onClick={() => setTab('sale')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${tab === 'sale' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-brand-50'}`}
        >
          ขายเวร
        </button>
      </div>
      {tab === 'swap' ? <SwapsView /> : <SalesView />}
    </div>
  )
}
