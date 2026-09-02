'use client'

import { useState } from 'react'
import { ArrowLeftRight, Coins } from 'lucide-react'
import { SalesView } from '@/components/swaps/sales-view'
import { SwapsView } from '@/components/swaps/swaps-view'

export default function SwapsPage() {
  const [tab, setTab] = useState<'swap' | 'sale'>('swap')

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="รายการแลกและขายเวร" className="flex w-full max-w-sm gap-1 rounded-2xl border border-line bg-white p-1 shadow-sm">
        <button
          type="button"
          role="tab"
          id="swap-tab"
          aria-controls="swap-panel"
          aria-selected={tab === 'swap'}
          onClick={() => setTab('swap')}
          className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${tab === 'swap' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-brand-50'}`}
        >
          <ArrowLeftRight size={16} aria-hidden="true" />
          <span>แลกเวร</span>
        </button>
        <button
          type="button"
          role="tab"
          id="sale-tab"
          aria-controls="sale-panel"
          aria-selected={tab === 'sale'}
          onClick={() => setTab('sale')}
          className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${tab === 'sale' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-brand-50'}`}
        >
          <Coins size={16} aria-hidden="true" />
          <span>ขายเวร</span>
        </button>
      </div>
      <div id={tab === 'swap' ? 'swap-panel' : 'sale-panel'} role="tabpanel" aria-labelledby={tab === 'swap' ? 'swap-tab' : 'sale-tab'}>
        {tab === 'swap' ? <SwapsView /> : <SalesView />}
      </div>
    </div>
  )
}
