import React, { useState, useMemo, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Car, Booking, VehicleFinance, Transaction } from '../types';
import { format, parseISO, isValid, differenceInDays, eachDayOfInterval } from 'date-fns';
import {
  Car as CarIcon,
  Calendar,
  DollarSign,
  TrendingUp,
  FileText,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  User,
  Wrench,
  ChevronDown,
  Loader2,
  BarChart2,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface VehicleReportProps {
  cars: Car[];
  bookings: Booking[];
}

export const VehicleReport: React.FC<VehicleReportProps> = ({ cars, bookings }) => {
  const [selectedCarId, setSelectedCarId] = useState<string>('');
  const [carPickerOpen, setCarPickerOpen] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [vehicleFinances, setVehicleFinances] = useState<VehicleFinance[]>([]);
  const [loading, setLoading] = useState(false);

  const activeCars = useMemo(() => cars.filter(c => c.isActive !== false), [cars]);
  const selectedCar = useMemo(() => activeCars.find(c => c.id === selectedCarId) || null, [activeCars, selectedCarId]);

  useEffect(() => {
    if (!selectedCarId) return;
    setLoading(true);
    const fetchData = async () => {
      try {
        const [txSnap, vfSnap] = await Promise.all([
          getDocs(query(collection(db, 'transactions'), where('carId', '==', selectedCarId))),
          getDocs(query(collection(db, 'vehicleFinance'), where('vehicleId', '==', selectedCarId))),
        ]);
        setTransactions(txSnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)));
        setVehicleFinances(vfSnap.docs.map(d => ({ id: d.id, ...d.data() } as VehicleFinance)));
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, 'transactions/vehicleFinance');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedCarId]);

  const filterByDateRange = (dateStr: string) => {
    if (!fromDate && !toDate) return true;
    const d = parseISO(dateStr);
    if (!isValid(d)) return false;
    const start = fromDate ? new Date(fromDate + 'T00:00:00') : new Date(0);
    const end = toDate ? new Date(toDate + 'T23:59:59') : new Date(8640000000000000);
    return d >= start && d <= end;
  };

  const carBookings = useMemo(() => {
    if (!selectedCarId) return [];
    return bookings
      .filter(b => b.carId === selectedCarId)
      .filter(b => {
        if (!fromDate && !toDate) return true;
        const s = parseISO(b.startDate);
        const e = parseISO(b.endDate);
        if (!isValid(s) || !isValid(e)) return false;
        const rangeStart = fromDate ? new Date(fromDate + 'T00:00:00') : new Date(0);
        const rangeEnd = toDate ? new Date(toDate + 'T23:59:59') : new Date(8640000000000000);
        return s <= rangeEnd && e >= rangeStart;
      })
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [selectedCarId, bookings, fromDate, toDate]);

  const carTransactions = useMemo(() =>
    transactions.filter(tx => filterByDateRange(tx.date))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions, fromDate, toDate]
  );

  const summary = useMemo(() => {
    const rentals = carBookings.filter(b => !b.isMaintenance && b.status !== 'DNR' && b.status !== 'Deleted');
    const totalIncome = rentals.reduce((s, b) => s + (b.amount || 0), 0);
    const bookingCount = rentals.length;
    const avgPerBooking = bookingCount > 0 ? totalIncome / bookingCount : 0;

    const allDates = rentals.flatMap(b => {
      try {
        const s = parseISO(b.startDate), e = parseISO(b.endDate);
        return isValid(s) && isValid(e) ? eachDayOfInterval({ start: s, end: e }) : [];
      } catch { return []; }
    });
    const bookedDays = new Set(allDates.map(d => format(d, 'yyyy-MM-dd'))).size;

    const firstBooking = rentals.length > 0 ? parseISO(rentals[rentals.length - 1].startDate) : new Date();
    const rangeStart = fromDate ? new Date(fromDate + 'T00:00:00') : firstBooking;
    const rangeEnd = toDate ? new Date(toDate + 'T23:59:59') : new Date();
    const totalDays = Math.max(1, differenceInDays(rangeEnd, rangeStart) + 1);
    const utilisation = Math.min(100, Math.round((bookedDays / totalDays) * 100));

    const txIncome = carTransactions.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
    const txExpense = carTransactions.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);

    return { totalIncome, bookingCount, avgPerBooking, utilisation, txIncome, txExpense };
  }, [carBookings, carTransactions, fromDate, toDate]);

  const loan = vehicleFinances[0] || null;
  const loanPaid = loan?.paidInstallments || 0;
  const loanRemaining = loan ? loan.totalInstallments - loanPaid : 0;
  const loanOutstanding = loan ? loanRemaining * loan.monthlyInstallment : 0;
  const loanEndDate = loan ? (() => {
    const d = new Date(loan.startDate);
    d.setMonth(d.getMonth() + loan.totalInstallments);
    return d;
  })() : null;

  const safeFormat = (dateStr: string, fmt: string) => {
    try { const d = parseISO(dateStr); return isValid(d) ? format(d, fmt) : '—'; } catch { return '—'; }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-warm-bg overflow-hidden">
      <header className="h-auto py-6 sm:py-0 sm:h-24 bg-white/40 backdrop-blur-xl border-b border-white/60 flex flex-col sm:flex-row sm:items-center justify-between px-6 sm:px-12 shrink-0 z-10 gap-4">
        <div>
          <h1 className="font-serif italic text-2xl sm:text-3xl text-[#1A1A1A]">Vehicle Report</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-1">
            {selectedCar ? `${selectedCar.make} ${selectedCar.model} · ${selectedCar.plateNumber}` : 'Select a vehicle to view its full report'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-white/40 border border-white/60 rounded-2xl px-4 py-2.5">
            <Calendar size={14} className="text-[#1A1A1A]/40 shrink-0" />
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="bg-transparent text-xs font-medium text-[#1A1A1A]/60 outline-none w-32" />
            <span className="text-[#1A1A1A]/30 text-xs">→</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="bg-transparent text-xs font-medium text-[#1A1A1A]/60 outline-none w-32" />
            {(fromDate || toDate) && (
              <button onClick={() => { setFromDate(''); setToDate(''); }} className="text-[#1A1A1A]/30 hover:text-brand-orange transition-colors ml-1">
                <X size={12} />
              </button>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => setCarPickerOpen(v => !v)}
              className="flex items-center gap-3 bg-white/40 border border-white/60 rounded-2xl px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:bg-white/60 transition-all min-w-[200px]"
            >
              <CarIcon size={14} className="text-brand-orange" />
              {selectedCar ? `${selectedCar.make} ${selectedCar.model}` : 'Select Vehicle'}
              <ChevronDown size={12} className={cn("ml-auto transition-transform", carPickerOpen && "rotate-180")} />
            </button>
            <AnimatePresence>
              {carPickerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute right-0 top-full mt-2 w-72 bg-white/95 backdrop-blur-xl border border-white/60 rounded-2xl shadow-xl z-50 overflow-hidden max-h-80 overflow-y-auto"
                >
                  {activeCars.map(car => (
                    <button
                      key={car.id}
                      onClick={() => { setSelectedCarId(car.id); setCarPickerOpen(false); }}
                      className={cn("w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-brand-orange/5 transition-all", car.id === selectedCarId && "bg-brand-orange/10")}
                    >
                      <div className="w-8 h-8 rounded-xl overflow-hidden bg-black/5 shrink-0">
                        {car.imageUrl
                          ? <img src={car.imageUrl} alt={car.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          : <div className="w-full h-full flex items-center justify-center"><CarIcon size={14} className="text-[#1A1A1A]/20" /></div>}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-[#1A1A1A]">{car.make} {car.model}</p>
                        <p className="text-[10px] text-[#1A1A1A]/40 font-mono">{car.plateNumber}</p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-12 custom-scrollbar">
        {!selectedCar ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-32 h-32 bg-white/40 backdrop-blur-xl border border-white/60 rounded-[40px] flex items-center justify-center mb-8 shadow-xl">
              <BarChart2 size={56} className="text-brand-orange/20" />
            </div>
            <h2 className="font-serif italic text-3xl text-[#1A1A1A] mb-3">Select a Vehicle</h2>
            <p className="text-[#1A1A1A]/40 text-xs font-bold uppercase tracking-widest">Choose a vehicle above to view its full report</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-brand-orange" size={40} />
          </div>
        ) : (
          <div className="space-y-8 max-w-5xl mx-auto">

            {/* Identity */}
            <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-8 flex flex-col sm:flex-row items-center gap-8 shadow-sm">
              <div className="w-28 h-28 rounded-[24px] overflow-hidden bg-white/60 border border-white/80 shrink-0 shadow-inner">
                {selectedCar.imageUrl
                  ? <img src={selectedCar.imageUrl} alt={selectedCar.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  : <div className="w-full h-full flex items-center justify-center"><CarIcon size={40} className="text-[#1A1A1A]/10" /></div>}
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h2 className="font-serif italic text-4xl text-[#1A1A1A]">{selectedCar.make} {selectedCar.model}</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-2">
                  {selectedCar.year} · {selectedCar.color} · <span className="font-mono">{selectedCar.plateNumber}</span>
                </p>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30 shrink-0">
                {fromDate || toDate
                  ? `${fromDate ? safeFormat(fromDate, 'dd MMM yyyy') : 'All time'} → ${toDate ? safeFormat(toDate, 'dd MMM yyyy') : 'Today'}`
                  : 'Full History'}
              </p>
            </div>

            {/* Revenue Summary */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-4 px-1">Revenue Summary</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Rental Income', value: `฿${summary.totalIncome.toLocaleString()}`, icon: DollarSign, color: 'text-emerald-500' },
                  { label: 'Bookings', value: `${summary.bookingCount}`, icon: Calendar, color: 'text-brand-orange' },
                  { label: 'Avg per Booking', value: `฿${Math.round(summary.avgPerBooking).toLocaleString()}`, icon: TrendingUp, color: 'text-blue-500' },
                  { label: 'Utilisation', value: `${summary.utilisation}%`, icon: BarChart2, color: 'text-purple-500' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[24px] p-6 shadow-sm">
                    <div className={cn("mb-3", color)}><Icon size={20} /></div>
                    <p className="font-serif italic text-3xl text-[#1A1A1A]">{value}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-1">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Loan */}
            {loan && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-4 px-1">Finance / Loan</p>
                <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-8 shadow-sm">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center"><CreditCard size={18} className="text-blue-500" /></div>
                    <div>
                      <p className="font-bold text-lg text-[#1A1A1A]">{loan.lender}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Vehicle Finance</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6 mb-6">
                    {[
                      { label: 'Principal', value: `฿${loan.totalLoanAmount.toLocaleString()}` },
                      { label: 'Monthly', value: `฿${loan.monthlyInstallment.toLocaleString()}` },
                      { label: 'Paid', value: `${loanPaid} / ${loan.totalInstallments}` },
                      { label: 'Outstanding', value: `฿${loanOutstanding.toLocaleString()}`, highlight: true },
                      { label: 'End Date', value: loanEndDate ? format(loanEndDate, 'MMM yyyy') : '—' },
                    ].map(({ label, value, highlight }) => (
                      <div key={label}>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">{label}</p>
                        <p className={cn("font-bold text-lg", highlight ? "text-red-500" : "text-[#1A1A1A]")}>{value}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-2">
                      <span>Loan Progress</span>
                      <span>{Math.round((loanPaid / loan.totalInstallments) * 100)}% paid</span>
                    </div>
                    <div className="w-full h-2 bg-black/5 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-orange rounded-full" style={{ width: `${Math.min(100, (loanPaid / loan.totalInstallments) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Booking History */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-4 px-1">Booking History ({carBookings.length})</p>
              {carBookings.length === 0 ? (
                <div className="bg-white/20 border-2 border-dashed border-white/40 rounded-[32px] py-16 text-center">
                  <Calendar className="text-[#1A1A1A]/10 mx-auto mb-4" size={40} />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30">No bookings in this range</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {carBookings.map(booking => {
                    const isMaint = booking.isMaintenance;
                    return (
                      <div key={booking.id} className={cn(
                        "backdrop-blur-xl border rounded-[20px] p-5 flex flex-col sm:flex-row sm:items-center gap-4",
                        isMaint ? "bg-gray-50/60 border-gray-200/60" : "bg-white/40 border-white/60"
                      )}>
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                            isMaint ? "bg-gray-100" : "bg-brand-orange/10"
                          )}>
                            {isMaint ? <Wrench size={14} className="text-gray-400" /> : <User size={14} className="text-brand-orange" />}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-[#1A1A1A] truncate">{isMaint ? 'Maintenance' : (booking.customerName || '—')}</p>
                            {!isMaint && booking.email && <p className="text-[10px] text-[#1A1A1A]/40 truncate">{booking.email}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 shrink-0">
                          <Clock size={10} />
                          {safeFormat(booking.startDate, 'dd MMM yyyy')} → {safeFormat(booking.endDate, 'dd MMM yyyy')}
                          {(() => {
                            try {
                              const days = differenceInDays(parseISO(booking.endDate), parseISO(booking.startDate));
                              return <span className="text-[#1A1A1A]/20">({Math.max(0, days)}d)</span>;
                            } catch { return null; }
                          })()}
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider",
                            isMaint ? "bg-gray-100 text-gray-500" :
                            booking.status === 'Paid' ? "bg-green-100 text-green-600" :
                            booking.status === 'Completed' ? "bg-blue-100 text-blue-600" :
                            "bg-orange-100 text-orange-600"
                          )}>
                            {isMaint ? 'Maintenance' : booking.status}
                          </span>
                          {!isMaint && (
                            <p className="font-bold text-sm text-[#1A1A1A] w-24 text-right">
                              {booking.amount ? `฿${booking.amount.toLocaleString()}` : <span className="text-[#1A1A1A]/20 font-normal text-xs">no amount</span>}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Transactions */}
            <div className="pb-8">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-4 px-1 flex items-center justify-between">
                <span>Transaction History ({carTransactions.length})</span>
                {carTransactions.length > 0 && (
                  <span className={cn("font-bold", (summary.txIncome - summary.txExpense) >= 0 ? "text-emerald-500" : "text-red-500")}>
                    Net {(summary.txIncome - summary.txExpense) >= 0 ? '+' : ''}฿{(summary.txIncome - summary.txExpense).toLocaleString()}
                  </span>
                )}
              </p>
              {carTransactions.length === 0 ? (
                <div className="bg-white/20 border-2 border-dashed border-white/40 rounded-[32px] py-16 text-center">
                  <FileText className="text-[#1A1A1A]/10 mx-auto mb-4" size={40} />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30">No transactions found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {carTransactions.map(tx => (
                    <div key={tx.id} className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[20px] p-4 flex items-center gap-4">
                      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                        tx.type === 'Income' ? "bg-emerald-50" : tx.type === 'Expense' ? "bg-red-50" : "bg-blue-50"
                      )}>
                        {tx.type === 'Income' ? <ArrowUpRight size={14} className="text-emerald-500" /> :
                         tx.type === 'Expense' ? <ArrowDownRight size={14} className="text-red-500" /> :
                         <DollarSign size={14} className="text-blue-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#1A1A1A] truncate">{tx.description || tx.category || '—'}</p>
                        {tx.category && tx.description && <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-widest font-bold">{tx.category}</p>}
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 shrink-0 hidden sm:block">{safeFormat(tx.date, 'dd MMM yyyy')}</p>
                      <p className={cn("font-bold text-sm w-28 text-right shrink-0",
                        tx.type === 'Income' ? "text-emerald-600" : tx.type === 'Expense' ? "text-red-500" : "text-[#1A1A1A]"
                      )}>
                        {tx.type === 'Expense' ? '-' : '+'}฿{tx.amount.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
};
