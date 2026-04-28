import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, logSystemActivity, auth } from '../firebase';
import { PricingGrid } from '../types';
import { Save, X, Plus, Trash2, Calendar, Clock, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays, startOfDay, parseISO, isSameDay } from 'date-fns';
import { cn } from '../lib/utils';

interface PricingGridEditorProps {
  carType: string;
  onClose: () => void;
  initialData?: PricingGrid;
}

export const PricingGridEditor: React.FC<PricingGridEditorProps> = ({ carType, onClose, initialData }) => {
  const [grid, setGrid] = useState<PricingGrid>(initialData || {
    id: carType.toLowerCase(),
    carType: carType,
    headers: Array.from({ length: 179 }, (_, i) => 1 + i * 0.5),
    rates: {},
    updatedAt: new Date().toISOString()
  });
  const [loading, setLoading] = useState(!initialData);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [numDaysToShow, setNumDaysToShow] = useState(180);
  const [selectionStart, setSelectionStart] = useState<{ date: string, hIdx: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ date: string, hIdx: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const generateDates = () => {
    const dates = [];
    let current = parseISO(startDate);
    for (let i = 0; i < numDaysToShow; i++) {
      dates.push(format(current, 'yyyy-MM-dd'));
      current = addDays(current, 1);
    }
    return dates;
  };

  const visibleDates = generateDates();

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsSelecting(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey)) {
        if (e.key === 'c') {
          handleCopy();
        } else if (e.key === 'v') {
          // If no input is focused, paste into the selection start
          if (document.activeElement?.tagName !== 'INPUT' && selectionStart) {
            handlePaste(null, selectionStart.date, selectionStart.hIdx);
          }
        }
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectionStart, selectionEnd, grid.rates, visibleDates]);

  useEffect(() => {
    if (!initialData) {
      const fetchGrid = async () => {
        if (!auth.currentUser) {
          setLoading(false);
          return;
        }
        try {
          const docRef = doc(db, 'pricing_grid', carType.toLowerCase());
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setGrid({ id: docSnap.id, ...docSnap.data() } as PricingGrid);
          }
          setLoading(false);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `pricing_grid/${carType}`);
          setLoading(false);
        }
      };
      fetchGrid();
    }
  }, [carType, initialData]);

  const handleRateChange = (date: string, headerIndex: number, value: string) => {
    const numValue = parseInt(value) || 0;
    setGrid(prev => {
      const newRates = { ...prev.rates };
      if (!newRates[date]) {
        // Initialize with zeros if date doesn't exist
        newRates[date] = new Array(prev.headers.length).fill(0);
      }
      const dateRates = [...newRates[date]];
      dateRates[headerIndex] = numValue;
      newRates[date] = dateRates;
      return { ...prev, rates: newRates };
    });
  };

  const addDate = () => {
    const lastDate = Object.keys(grid.rates).sort().pop() || format(new Date(), 'yyyy-MM-dd');
    const nextDate = format(addDays(parseISO(lastDate), 1), 'yyyy-MM-dd');
    
    setGrid(prev => ({
      ...prev,
      rates: {
        ...prev.rates,
        [nextDate]: new Array(prev.headers.length).fill(0)
      }
    }));
  };

  const addHeader = () => {
    const lastHeader = grid.headers[grid.headers.length - 1] || 0;
    const nextHeader = lastHeader + 0.5;
    
    setGrid(prev => {
      const newHeaders = [...prev.headers, nextHeader];
      const newRates = { ...prev.rates };
      Object.keys(newRates).forEach(date => {
        newRates[date] = [...newRates[date], 0];
      });
      return { ...prev, headers: newHeaders, rates: newRates };
    });
  };

  const removeHeader = (index: number) => {
    toast('Remove this duration tier?', {
      description: "This will remove the column and all associated rates.",
      action: {
        label: "Remove",
        onClick: () => {
          setGrid(prev => {
            const newHeaders = prev.headers.filter((_, i) => i !== index);
            const newRates = { ...prev.rates };
            Object.keys(newRates).forEach(date => {
              newRates[date] = newRates[date].filter((_, i) => i !== index);
            });
            return { ...prev, headers: newHeaders, rates: newRates };
          });
        }
      }
    });
  };

  const handleCopy = () => {
    if (!selectionStart || !selectionEnd) return;

    const startDIdx = visibleDates.indexOf(selectionStart.date);
    const endDIdx = visibleDates.indexOf(selectionEnd.date);
    const minDIdx = Math.min(startDIdx, endDIdx);
    const maxDIdx = Math.max(startDIdx, endDIdx);

    const minHIdx = Math.min(selectionStart.hIdx, selectionEnd.hIdx);
    const maxHIdx = Math.max(selectionStart.hIdx, selectionEnd.hIdx);

    const selectedDates = visibleDates.slice(minDIdx, maxDIdx + 1);
    const rows: string[] = [];

    selectedDates.forEach(date => {
      const row: string[] = [];
      for (let i = minHIdx; i <= maxHIdx; i++) {
        row.push((grid.rates[date]?.[i] || 0).toString());
      }
      rows.push(row.join('\t'));
    });

    const text = rows.join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Copied selection to clipboard');
  };

  const handlePaste = (e: React.ClipboardEvent | null, startDate: string, startHIdx: number) => {
    if (e) e.preventDefault();
    
    const pasteData = async () => {
      const clipboardData = e ? e.clipboardData.getData('text') : await navigator.clipboard.readText();
      if (!clipboardData) return;

      const rows = clipboardData.split(/\r?\n/).filter(row => row.trim() !== '');
      const parsedData = rows.map(row => row.split('\t'));

      setGrid(prev => {
        const newRates = { ...prev.rates };
        const startDateIdx = visibleDates.indexOf(startDate);

        parsedData.forEach((row, rIdx) => {
          const targetDateIdx = startDateIdx + rIdx;
          if (targetDateIdx < visibleDates.length) {
            const targetDate = visibleDates[targetDateIdx];
            if (!newRates[targetDate]) {
              newRates[targetDate] = new Array(prev.headers.length).fill(0);
            }
            const dateRates = [...newRates[targetDate]];
            
            row.forEach((cellValue, cIdx) => {
              const targetHIdx = startHIdx + cIdx;
              if (targetHIdx < prev.headers.length) {
                const numValue = parseInt(cellValue.replace(/[^0-9]/g, '')) || 0;
                dateRates[targetHIdx] = numValue;
              }
            });
            newRates[targetDate] = dateRates;
          }
        });

        return { ...prev, rates: newRates };
      });
      
      toast.success('Data pasted');
    };

    pasteData();
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedGrid = {
        ...grid,
        updatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'pricing_grid', grid.id), updatedGrid);
      
      await logSystemActivity(
        'Update Pricing Grid',
        `Manually updated pricing grid for ${carType}`,
        'Pricing',
        { carType, gridId: grid.id }
      );

      toast.success(`Pricing grid for ${carType} saved successfully`);
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `pricing_grid/${grid.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-3xl flex flex-col items-center gap-4">
          <Clock className="animate-spin text-brand-orange" size={32} />
          <p className="font-bold uppercase tracking-widest text-[10px] text-[#1A1A1A]/40">Loading Grid Editor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4 md:p-8">
      <div className="bg-warm-bg w-full max-w-7xl h-full max-h-[90vh] rounded-[40px] shadow-2xl flex flex-col overflow-hidden border border-white/20">
        {/* Header */}
        <div className="p-8 border-b border-[#1A1A1A]/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white/40">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="font-serif italic text-4xl text-[#1A1A1A]">Edit Pricing: {carType}</h2>
              <span className="bg-brand-orange/10 text-brand-orange text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-brand-orange/20">Manual Editor</span>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Spreadsheet-style manual rate management</p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="bg-white/60 border border-[#1A1A1A]/5 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white transition-all active:translate-y-[2px]"
            >
              <X size={14} /> Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-brand-orange text-white px-8 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20 active:translate-y-[2px] disabled:opacity-50"
            >
              {isSaving ? <Clock className="animate-spin" size={14} /> : <Save size={14} />}
              Save Changes
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="px-8 py-4 bg-white/20 border-b border-[#1A1A1A]/5 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">View From:</span>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/40" size={14} />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-white/60 border border-[#1A1A1A]/5 rounded-xl pl-9 pr-4 py-2 text-xs font-bold focus:outline-none focus:border-brand-orange transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Days to show:</span>
            <select
              value={numDaysToShow}
              onChange={(e) => setNumDaysToShow(parseInt(e.target.value))}
              className="bg-white/60 border border-[#1A1A1A]/5 rounded-xl px-4 py-2 text-xs font-bold focus:outline-none focus:border-brand-orange transition-all"
            >
              <option value={7}>7 Days</option>
              <option value={14}>14 Days</option>
              <option value={30}>30 Days</option>
              <option value={60}>60 Days</option>
              <option value={90}>90 Days</option>
              <option value={120}>120 Days</option>
              <option value={150}>150 Days</option>
              <option value={180}>180 Days</option>
            </select>
          </div>

          <div className="flex-1" />
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto custom-scrollbar bg-white/20">
          <table className="border-collapse min-w-max table-fixed">
            <thead className="sticky top-0 z-20">
              <tr className="bg-white shadow-sm">
                <th className="p-1 text-left border-r border-[#1A1A1A]/5 sticky left-0 z-30 bg-white w-[110px] min-w-[110px]">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Date</span>
                    <span className="text-[8px] text-brand-orange uppercase font-bold">YYYY-MM-DD</span>
                  </div>
                </th>
                {grid.headers.map((header, idx) => (
                  <th key={idx} className="p-1 border-r border-[#1A1A1A]/5 w-[70px] min-w-[70px]">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-sm text-[#1A1A1A]">{header}</span>
                        <span className="text-[8px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Days</span>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleDates.map((date) => (
                <tr key={date} className="border-b border-[#1A1A1A]/5 hover:bg-white/40 transition-colors">
                  <td className="p-1 border-r border-[#1A1A1A]/5 sticky left-0 z-10 bg-white/80 backdrop-blur-sm font-mono text-[10px] font-bold text-[#1A1A1A]">
                    <div className="flex flex-col">
                      <span>{date}</span>
                      <span className="text-[8px] text-[#1A1A1A]/40 uppercase">{format(parseISO(date), 'EEEE')}</span>
                    </div>
                  </td>
                  {grid.headers.map((_, hIdx) => {
                    const startDIdx = selectionStart ? visibleDates.indexOf(selectionStart.date) : -1;
                    const endDIdx = selectionEnd ? visibleDates.indexOf(selectionEnd.date) : -1;
                    const currentDIdx = visibleDates.indexOf(date);
                    
                    const isSelected = selectionStart && selectionEnd && 
                      currentDIdx >= Math.min(startDIdx, endDIdx) &&
                      currentDIdx <= Math.max(startDIdx, endDIdx) &&
                      hIdx >= Math.min(selectionStart.hIdx, selectionEnd.hIdx) &&
                      hIdx <= Math.max(selectionStart.hIdx, selectionEnd.hIdx);

                    return (
                      <td 
                        key={hIdx} 
                        className={cn(
                          "p-1 border-r border-[#1A1A1A]/5 relative group/cell transition-colors w-[70px] min-w-[70px]",
                          isSelected && "bg-brand-orange/10 ring-1 ring-inset ring-brand-orange/30"
                        )}
                        onMouseDown={() => {
                          setSelectionStart({ date, hIdx });
                          setSelectionEnd({ date, hIdx });
                          setIsSelecting(true);
                        }}
                        onMouseEnter={() => {
                          if (isSelecting) {
                            setSelectionEnd({ date, hIdx });
                          }
                        }}
                      >
                        <input
                          type="number"
                          value={grid.rates[date]?.[hIdx] || 0}
                          onChange={(e) => handleRateChange(date, hIdx, e.target.value)}
                          onPaste={(e) => handlePaste(e, date, hIdx)}
                          onFocus={() => {
                            if (!isSelecting) {
                              setSelectionStart({ date, hIdx });
                              setSelectionEnd({ date, hIdx });
                            }
                          }}
                          className={cn(
                            "w-full bg-white/40 border border-transparent rounded-md py-1 px-0.5 text-center font-bold text-xs focus:outline-none focus:border-brand-orange focus:bg-white transition-all",
                            !grid.rates[date]?.[hIdx] && "text-[#1A1A1A]/20"
                          )}
                          placeholder="0"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Info */}
        <div className="p-6 bg-white/40 border-t border-[#1A1A1A]/5 flex justify-between items-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 italic">
            * Changes are only saved when you click "Save Changes"
          </p>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brand-orange" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60">Toyota Vios Template</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
