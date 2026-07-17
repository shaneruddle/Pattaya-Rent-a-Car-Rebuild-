import React, { useState } from 'react';
import { TrendingUp, ExternalLink, Send, Loader2, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { usePricing } from '../contexts/PricingContext';

const CLASSES = ['Economy', 'Budget Economy', 'Compact Sedan', 'MPV', 'Pickup Truck', 'SUV', 'Budget SUV'];

const COMPETITORS = [
  { key: 'rentalcars', name: 'Rentalcars.com', url: 'https://www.rentalcars.com/' },
  { key: 'maks', name: 'MAKS Car Rental', url: 'https://thai-rent-car.com/' },
  { key: 'expat', name: 'Expat Car Rent', url: 'https://expatcarrent.com/' },
];

const fmtThb = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '-' : `${Math.round(n).toLocaleString()} THB`;

export const CompetitorPricing: React.FC = () => {
  const { classPrices, classPricesLoading, fetchClassPrices } = usePricing();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [hasFetched, setHasFetched] = useState(false);
  const [competitorPrices, setCompetitorPrices] = useState<Record<string, Record<string, string>>>({});
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);

  const datesValid = !!fromDate && !!toDate && new Date(toDate) > new Date(fromDate);

  const handleLoadPrices = async () => {
    if (!datesValid) {
      toast.error('Pick a valid pickup and return date first.');
      return;
    }
    await fetchClassPrices(CLASSES, fromDate, toDate);
    setHasFetched(true);
  };

  const setCompetitorPrice = (competitorKey: string, carClass: string, value: string) => {
    setCompetitorPrices(prev => ({
      ...prev,
      [competitorKey]: { ...(prev[competitorKey] || {}), [carClass]: value }
    }));
  };

  const ourPriceFor = (carClass: string): number | null => {
    const q = classPrices[carClass];
    if (!q || !q.quotable) return null;
    return q.totalPrice;
  };

  const buildReportHtml = (): string => {
    const rangeLabel = `${fromDate} to ${toDate}`;
    const rows = CLASSES.map(cls => {
      const ours = ourPriceFor(cls);
      const cells = COMPETITORS.map(c => {
        const raw = (competitorPrices[c.key] || {})[cls];
        const theirs = raw ? parseFloat(raw) : null;
        let diffLabel = '-';
        if (ours != null && theirs != null && Number.isFinite(theirs)) {
          const diff = ours - theirs;
          diffLabel = diff === 0
            ? 'Even'
            : diff > 0
              ? `+${Math.round(diff).toLocaleString()} THB pricier`
              : `${Math.round(Math.abs(diff)).toLocaleString()} THB cheaper`;
        }
        return `<td style="padding:8px;border:1px solid #eee;">${raw ? fmtThb(theirs) : '-'}<br/><span style="font-size:11px;color:#888;">${diffLabel}</span></td>`;
      }).join('');
      return `<tr><td style="padding:8px;border:1px solid #eee;font-weight:bold;">${cls}</td><td style="padding:8px;border:1px solid #eee;">${fmtThb(ours)}</td>${cells}</tr>`;
    }).join('');

    return `
      <p>Competitor pricing comparison for <strong>${rangeLabel}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #eee;text-align:left;">Class</th>
            <th style="padding:8px;border:1px solid #eee;text-align:left;">Our Price</th>
            ${COMPETITORS.map(c => `<th style="padding:8px;border:1px solid #eee;text-align:left;">${c.name}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${notes ? `<p><strong>Notes:</strong><br/>${notes.replace(/\n/g, '<br/>')}</p>` : ''}
    `;
  };

  const handleSendReport = async () => {
    if (!hasFetched) {
      toast.error('Load our prices first.');
      return;
    }
    setSending(true);
    try {
      const html = buildReportHtml();
      const resp = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'shaneruddle@gmail.com',
          subject: `Competitor Pricing Report  ${fromDate} to ${toDate}`,
          html,
          skipFinalToOverride: true,
        }),
      });
      if (!resp.ok) throw new Error('Send failed');
      toast.success('Report sent to shaneruddle@gmail.com');
    } catch (e) {
      console.error('CompetitorPricing: send report failed', e);
      toast.error('Failed to send report. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-brand-orange/10 text-brand-orange flex items-center justify-center">
          <TrendingUp size={22} />
        </div>
        <div>
          <h1 className="font-serif italic text-3xl text-[#1A1A1A]">Competitor Pricing</h1>
          <p className="text-[#1A1A1A]/50 text-sm">Compare our quotes against rentalcars.com and local competitors.</p>
        </div>
      </div>

      <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-6 mb-6 shadow-lg">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-4">Step 1  Select Dates</p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Pickup Date</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="h-11 px-4 rounded-xl border border-black/10 bg-white/80 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Return Date</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="h-11 px-4 rounded-xl border border-black/10 bg-white/80 text-sm" />
          </div>
          <button
            onClick={handleLoadPrices}
            disabled={!datesValid || classPricesLoading}
            className="h-11 px-6 rounded-xl bg-brand-orange text-white font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-[#1A1A1A] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {classPricesLoading ? <Loader2 className="animate-spin" size={16} /> : <Calendar size={16} />}
            Load Our Prices
          </button>
        </div>
      </div>

      {hasFetched && (
        <>
          <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-6 mb-6 shadow-lg">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-4">Step 2  Check Competitor Sites</p>
            <div className="flex flex-wrap gap-3">
              {COMPETITORS.map(c => (
                <a key={c.key} href={c.url} target="_blank" rel="noopener noreferrer"
                  className="h-11 px-5 rounded-xl border border-black/10 bg-white/80 text-sm font-medium flex items-center gap-2 hover:border-brand-orange hover:text-brand-orange transition-all">
                  {c.name} <ExternalLink size={14} />
                </a>
              ))}
            </div>
            <p className="text-[11px] text-[#1A1A1A]/40 mt-3">Opens in a new tab  search {fromDate} to {toDate} for Pattaya pickup on each site, then enter what you find below.</p>
          </div>

          <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-6 mb-6 shadow-lg overflow-x-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-4">Step 3  Enter What You Found</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">
                  <th className="pb-3 pr-4">Class</th>
                  <th className="pb-3 pr-4">Our Price</th>
                  {COMPETITORS.map(c => (
                    <th key={c.key} className="pb-3 pr-4">{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CLASSES.map(cls => {
                  const ours = ourPriceFor(cls);
                  return (
                    <tr key={cls} className="border-t border-black/5">
                      <td className="py-3 pr-4 font-medium">{cls}</td>
                      <td className="py-3 pr-4 font-bold text-brand-orange">{fmtThb(ours)}</td>
                      {COMPETITORS.map(c => (
                        <td key={c.key} className="py-3 pr-4">
                          <input
                            type="number"
                            placeholder="THB"
                            value={(competitorPrices[c.key] || {})[cls] || ''}
                            onChange={e => setCompetitorPrice(c.key, cls, e.target.value)}
                            className="w-28 h-9 px-3 rounded-lg border border-black/10 bg-white/80 text-sm"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-6 shadow-lg">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-4">Step 4  Notes &amp; Send</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes for the report..."
              rows={3}
              className="w-full p-4 rounded-xl border border-black/10 bg-white/80 text-sm mb-4"
            />
            <button
              onClick={handleSendReport}
              disabled={sending}
              className="h-12 px-8 rounded-2xl bg-brand-orange text-white font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-[#1A1A1A] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-brand-orange/20"
            >
              {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              {sending ? 'Sending...' : 'Send Report'}
            </button>
            <p className="text-[11px] text-[#1A1A1A]/40 mt-3">Sends a comparison report to shaneruddle@gmail.com. Nothing is saved in the system.</p>
          </div>
        </>
      )}
    </div>
  );
};
