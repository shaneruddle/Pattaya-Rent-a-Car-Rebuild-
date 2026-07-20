import React, { useState } from 'react';
import { differenceInDays, format } from 'date-fns';
import { cn } from '../lib/utils';
import { Loader2, Tag } from 'lucide-react';

const CAR_CLASSES = [
  { id: 'Economy', label: 'Economy', icon: '' },
  { id: 'Compact Sedan', label: 'Compact Sedan', icon: '' },
  { id: 'Pickup Truck', label: 'Pickup Truck', icon: '' },
  { id: 'MPV', label: 'MPV', icon: '' },
  { id: 'SUV', label: 'SUV', icon: '' },
];

interface QuoteResult {
  quotable: boolean;
  totalPrice?: number;
  perDay?: number;
  reason?: string;
}

export function PriceQuote() {
  const [selectedClass, setSelectedClass] = useState<string>('Economy');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string>('');

  const today = format(new Date(), 'yyyy-MM-dd');

  const days =
    startDate && endDate
      ? differenceInDays(new Date(endDate), new Date(startDate))
      : 0;

  const canQuote = !!selectedClass && !!startDate && !!endDate && days > 0;

  const getQuote = async () => {
    if (!canQuote) return;
    setLoading(true);
    setResult(null);
    setError('');
    try {
      const url = `/api/pricing/quote?class=${encodeURIComponent(selectedClass)}&from=${startDate}&to=${endDate}&durationDays=${days}`;
      const resp = await fetch(url);
      const data: QuoteResult = await resp.json();
      setResult(data);
    } catch (e: any) {
      setError(e?.message || 'Network error  try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-[#F5F4F0] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-black/10 px-4 pt-4 pb-4 flex items-center gap-3">
        <Tag size={18} className="text-brand-orange" />
        <div>
          <h1 className="text-[15px] font-bold tracking-widest uppercase">Price Quote</h1>
          <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-widest">Live rental calculator</p>
        </div>
      </div>

      <div className="px-4 py-5 flex flex-col gap-6">
        {/* Car class */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-3">
            Car Class
          </p>
          <div className="flex flex-col gap-2">
            {CAR_CLASSES.map((cls) => (
              <button
                key={cls.id}
                onClick={() => { setSelectedClass(cls.id); setResult(null); }}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all',
                  selectedClass === cls.id
                    ? 'border-brand-orange bg-brand-orange/5'
                    : 'border-black/8 bg-white'
                )}
              >
                <span className="text-xl">{cls.icon}</span>
                <span
                  className={cn(
                    'font-bold text-[13px] tracking-wide',
                    selectedClass === cls.id ? 'text-brand-orange' : 'text-[#1A1A1A]'
                  )}
                >
                  {cls.label}
                </span>
                {selectedClass === cls.id && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-brand-orange" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Dates */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-3">
            Rental Period
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5">From</p>
              <input
                type="date"
                value={startDate}
                min={today}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setResult(null);
                  if (endDate && e.target.value >= endDate) setEndDate('');
                }}
                className="w-full border border-black/10 rounded-xl px-3 py-3 text-[13px] bg-white focus:outline-none focus:border-brand-orange"
              />
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5">To</p>
              <input
                type="date"
                value={endDate}
                min={startDate || today}
                onChange={(e) => { setEndDate(e.target.value); setResult(null); }}
                className="w-full border border-black/10 rounded-xl px-3 py-3 text-[13px] bg-white focus:outline-none focus:border-brand-orange"
              />
            </div>
          </div>
          {days > 0 && (
            <p className="text-[11px] text-[#1A1A1A]/40 mt-2 text-center">
              {days} day{days !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* CTA */}
        <button
          onClick={getQuote}
          disabled={!canQuote || loading}
          className={cn(
            'w-full py-4 rounded-2xl font-bold text-[13px] uppercase tracking-widest transition-all',
            canQuote && !loading
              ? 'bg-brand-orange text-white shadow-lg shadow-brand-orange/20 active:scale-95'
              : 'bg-black/10 text-black/30 cursor-not-allowed'
          )}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={15} className="animate-spin" />
              Calculating...
            </span>
          ) : (
            'Get Price Quote'
          )}
        </button>

        {/* Result */}
        {result && result.quotable && (
          <div className="bg-white rounded-2xl border border-black/8 overflow-hidden">
            <div className="bg-brand-orange px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                {selectedClass} &middot; {days} day{days !== 1 ? 's' : ''}
              </p>
              <p className="text-[34px] font-bold text-white mt-1">
                &#x0E3F;{result.totalPrice?.toLocaleString()}
              </p>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <span className="text-[11px] text-[#1A1A1A]/50 uppercase tracking-widest">Per day</span>
              <span className="text-[16px] font-bold text-[#1A1A1A]">
                &#x0E3F;{result.perDay?.toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {result && !result.quotable && (
          <div className="bg-white rounded-2xl border border-red-100 px-5 py-4">
            <p className="text-[12px] font-bold text-red-500 uppercase tracking-widest">Not available</p>
            <p className="text-[12px] text-[#1A1A1A]/50 mt-1">{result.reason || 'Cannot quote for these dates.'}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 rounded-xl px-5 py-4">
            <p className="text-[12px] text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
