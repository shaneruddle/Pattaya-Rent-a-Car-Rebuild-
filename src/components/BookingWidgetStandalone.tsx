import React, { useState, useEffect, useRef } from 'react';
import { format, addDays, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, addMonths, subMonths, differenceInHours } from 'date-fns';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  ChevronDown, 
  ChevronRight, 
  ChevronLeft,
  X
} from 'lucide-react';

/**
 * UTILS
 */
function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ');
}

const timeOptions = Array.from({ length: 24 }).flatMap((_, i) => {
  const hour = i.toString().padStart(2, '0');
  return [`${hour}:00`, `${hour}:30`];
});

const filteredTimeOptions = timeOptions.filter(time => {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m;
  return totalMinutes >= 9 * 60 + 30 && totalMinutes <= 16 * 60 + 30;
});

/**
 * STANDALONE DATE PICKER COMPONENT
 */
interface DatePickerCustomProps {
  selectedRange: { from: Date; to: Date };
  onRangeChange: (range: { from: Date; to: Date }) => void;
  pickUpTime: string;
  onPickUpTimeChange: (time: string) => void;
  dropOffTime: string;
  onDropOffTimeChange: (time: string) => void;
  onClose?: () => void;
  onApply?: () => void;
}

const DatePickerCustom: React.FC<DatePickerCustomProps> = ({ 
  selectedRange, 
  onRangeChange, 
  pickUpTime,
  onPickUpTimeChange,
  dropOffTime,
  onDropOffTimeChange,
  onClose,
  onApply
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedRange.from));
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [tempRange, setTempRange] = useState<{ from: Date | null; to: Date | null }>({
    from: selectedRange.from,
    to: selectedRange.to
  });
  
  const nextMonth = addMonths(currentMonth, 1);
  const times = filteredTimeOptions;

  const calculateDays = () => {
    if (!tempRange.from || !tempRange.to) return 0;
    const from = new Date(tempRange.from);
    const [fromH, fromM] = pickUpTime.split(':').map(Number);
    from.setHours(fromH, fromM, 0, 0);

    const to = new Date(tempRange.to);
    const [toH, toM] = dropOffTime.split(':').map(Number);
    to.setHours(toH, toM, 0, 0);

    const totalHours = differenceInHours(to, from);
    return Math.max(1, Math.ceil(totalHours / 12) / 2);
  };

  const handleDayClick = (day: Date) => {
    if (!tempRange.from || (tempRange.from && tempRange.to)) {
      setTempRange({ from: day, to: null });
    } else {
      if (isSameDay(day, tempRange.from)) return;
      if (day < tempRange.from) {
        setTempRange({ from: day, to: tempRange.from });
      } else {
        setTempRange({ from: tempRange.from, to: day });
      }
    }
  };

  const isInRange = (day: Date) => {
    if (tempRange.from && tempRange.to) {
      return isWithinInterval(day, { start: tempRange.from, end: tempRange.to });
    }
    if (tempRange.from && hoverDate) {
      const start = tempRange.from < hoverDate ? tempRange.from : hoverDate;
      const end = tempRange.from < hoverDate ? hoverDate : tempRange.from;
      return isWithinInterval(day, { start, end });
    }
    return false;
  };

  const renderMonth = (month: Date) => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    const days = eachDayOfInterval({ start, end });
    const startDay = start.getDay();
    const blanks = Array(startDay).fill(null);

    return (
      <div className="flex-1 p-6">
        <div className="flex justify-between items-center mb-6 px-2">
          <h3 className="font-bold text-lg tracking-tight text-[#1A1A1A]">
            {format(month, 'MMMM yyyy')}
          </h3>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-[10px] font-bold text-[#1A1A1A]/40 py-1 uppercase tracking-widest">{d}</div>
          ))}
          {blanks.map((_, i) => <div key={`blank-${i}`} />)}
          {days.map(day => {
            const isStart = tempRange.from && isSameDay(day, tempRange.from);
            const isEnd = tempRange.to && isSameDay(day, tempRange.to);
            const inRange = isInRange(day);
            const isToday = isSameDay(day, new Date());
            const isPast = day < new Date() && !isToday;

            return (
              <div key={day.toString()} className="relative flex justify-center">
                <button
                  type="button"
                  disabled={isPast}
                  onMouseEnter={() => setHoverDate(day)}
                  onMouseLeave={() => setHoverDate(null)}
                  onClick={() => handleDayClick(day)}
                  className={cn(
                    "h-10 w-10 flex items-center justify-center text-xs font-bold transition-all relative z-10",
                    isStart && !isEnd ? "bg-[#FF6321] text-white rounded-l-full" : "",
                    isEnd && !isStart ? "bg-[#FF6321] text-white rounded-r-full" : "",
                    isStart && isEnd ? "bg-[#FF6321] text-white rounded-full" : "",
                    inRange && !isStart && !isEnd ? "bg-[#FF6321]/10 text-[#FF6321]" : "",
                    !inRange && isPast ? "text-[#1A1A1A]/20 cursor-not-allowed" : "",
                    !inRange && !isPast ? "text-[#1A1A1A] hover:bg-black/5 rounded-full" : ""
                  )}
                >
                  {format(day, 'd')}
                  {isToday && !(isStart || isEnd) && <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-[#1A1A1A] rounded-full" />}
                </button>
                {isEnd && tempRange.from && (
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#28a745] text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-xl whitespace-nowrap z-[110]">
                    {Math.max(1, Math.ceil(calculateDays()))} Days
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-[#28a745] z-[110]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const handleApply = () => {
    if (tempRange.from && tempRange.to) {
      onRangeChange({ from: tempRange.from, to: tempRange.to });
      if (onApply) onApply();
    } else if (tempRange.from) {
      const to = addDays(tempRange.from, 1);
      onRangeChange({ from: tempRange.from, to });
      if (onApply) onApply();
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-white">
      <div className="flex-1 overflow-y-auto custom-scrollbar overflow-x-hidden min-h-0 [overscroll-behavior:contain] pb-32 md:pb-0">
        <div className="flex flex-col md:flex-row relative border-b border-black/10 rounded-t-[40px] pb-6 md:pb-0">
          <button 
            type="button"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="absolute left-6 top-8 p-2 text-[#1A1A1A] hover:bg-black/5 rounded-full z-20 transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          {renderMonth(currentMonth)}
          <div className="w-px bg-black/10 hidden md:block" />
          {renderMonth(nextMonth)}
          <button 
            type="button"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="absolute right-6 top-8 p-2 text-[#1A1A1A] hover:bg-black/5 rounded-full z-20 transition-colors"
          >
            <ChevronRight size={24} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-black/10">
          <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-black/10">
            <div className="flex items-start gap-4">
              <span className="text-4xl md:text-6xl font-bold text-[#1A1A1A]/20 leading-none">
                {tempRange.from ? format(tempRange.from, 'd') : '--'}
              </span>
              <div>
                <p className="text-[#1A1A1A] font-bold text-base md:text-lg leading-tight text-left">
                  {tempRange.from ? format(tempRange.from, 'MMMM yyyy') : 'Select Date'}
                </p>
                <p className="text-[#1A1A1A]/60 text-xs md:text-sm font-medium text-left">
                  {tempRange.from ? format(tempRange.from, 'EEEE') : ''}
                </p>
              </div>
            </div>
            <div className="mt-4 md:mt-8 relative">
              <select 
                value={pickUpTime}
                onChange={(e) => onPickUpTimeChange(e.target.value)}
                className="w-full bg-transparent text-[#1A1A1A] text-3xl md:text-5xl font-bold outline-none appearance-none cursor-pointer"
              >
                {times.map(time => (
                  <option key={time} value={time} className="text-[#1A1A1A] bg-white text-base">{time}</option>
                ))}
              </select>
              <ChevronDown size={24} className="absolute right-0 top-1/2 -translate-y-1/2 text-[#1A1A1A] pointer-events-none" />
            </div>
          </div>

          <div className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <span className="text-4xl md:text-6xl font-bold text-[#1A1A1A]/20 leading-none">
                {tempRange.to ? format(tempRange.to, 'd') : '--'}
              </span>
              <div>
                <p className="text-[#1A1A1A] font-bold text-base md:text-lg leading-tight text-left">
                  {tempRange.to ? format(tempRange.to, 'MMMM yyyy') : 'Select Date'}
                </p>
                <p className="text-[#1A1A1A]/60 text-xs md:text-sm font-medium text-left">
                  {tempRange.to ? format(tempRange.to, 'EEEE') : ''}
                </p>
              </div>
            </div>
            <div className="mt-4 md:mt-8 relative">
              <select 
                value={dropOffTime}
                onChange={(e) => onDropOffTimeChange(e.target.value)}
                className="w-full bg-transparent text-[#1A1A1A] text-3xl md:text-5xl font-bold outline-none appearance-none cursor-pointer"
              >
                {times.map(time => (
                  <option key={time} value={time} className="text-[#1A1A1A] bg-white text-base">{time}</option>
                ))}
              </select>
              <ChevronDown size={24} className="absolute right-0 top-1/2 -translate-y-1/2 text-[#1A1A1A] pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 mt-auto p-4 md:p-8 flex flex-col md:flex-row items-center justify-between gap-4 bg-[#f8f8f8] border-t border-black/10 z-30">
        <div className="flex items-center gap-3">
          <span className="text-[#1A1A1A]/60 font-medium text-sm">Duration:</span>
          <span className="bg-[#28a745] text-white font-bold text-lg px-4 py-1.5 rounded-full shadow-sm">
            {calculateDays()} days
          </span>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button 
            type="button"
            onClick={onClose}
            className="flex-1 md:flex-none px-6 py-3 border-2 border-black/10 text-[#1A1A1A] rounded-xl font-bold uppercase tracking-widest text-sm hover:bg-black/5 transition-all"
          >
            Cancel
          </button>
          <button 
            type="button"
            onClick={handleApply}
            className="flex-1 md:flex-none px-6 py-3 text-white rounded-xl font-bold uppercase tracking-widest text-sm hover:opacity-90 transition-all shadow-md bg-[#FF6321]"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * MAIN STANDALONE WIDGET
 */
export const BookingWidgetStandalone: React.FC = () => {
  const [selectedRange, setSelectedRange] = useState<{ from: Date; to: Date }>({
    from: addDays(new Date(), 1),
    to: addDays(new Date(), 6)
  });
  const [pickUpTime, setPickUpTime] = useState('09:30');
  const [dropOffTime, setDropOffTime] = useState('09:30');
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setShowCalendar(false);
      }
    };
    if (showCalendar) {
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [showCalendar]);

  const handleSearch = () => {
    const fromStr = format(selectedRange.from, 'yyyy-MM-dd');
    const toStr = format(selectedRange.to, 'yyyy-MM-dd');
    window.location.href = `https://pattayarentacar.com/?from=${fromStr}&to=${toStr}&pickupTime=${pickUpTime}&dropoffTime=${dropOffTime}`;
  };

  return (
    <div className="w-full max-w-5xl mx-auto font-sans text-[#1A1A1A]">
      <style>{`
        .glass-card {
          background: rgba(255, 255, 255, 0.6);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 9px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
          border-radius: 10px;
        }
      `}</style>

      <div className="flex flex-col md:flex-row items-stretch glass-card rounded-[2.5rem] overflow-hidden shadow-2xl">
        <button 
          onClick={() => setShowCalendar(true)}
          className="flex-[1.5] p-6 lg:p-8 text-left hover:bg-white/20 transition-colors flex items-center gap-4 lg:gap-6 border-b md:border-b-0 md:border-r border-black/5"
        >
          <CalendarIcon className="text-[#FF6321]" size={28} />
          <div>
            <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">Pick-up Date</p>
            <p className="text-black font-mono text-lg lg:text-xl tracking-tight">{format(selectedRange.from, 'EEE dd MMM')}</p>
          </div>
        </button>

        <div className="p-6 lg:p-8 text-left flex items-center gap-4 lg:gap-6 border-b md:border-b-0 md:border-r border-black/5 min-w-[140px] lg:min-w-[180px]">
          <Clock className="text-[#FF6321]" size={28} />
          <div className="flex-1">
            <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">Time</p>
            <div className="relative">
              <select 
                value={pickUpTime}
                onChange={(e) => setPickUpTime(e.target.value)}
                className="bg-transparent text-black font-mono text-lg lg:text-xl outline-none w-full appearance-none cursor-pointer pr-6"
              >
                {filteredTimeOptions.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-black/20 pointer-events-none" />
            </div>
          </div>
        </div>

        <button 
          onClick={() => setShowCalendar(true)}
          className="flex-[1.5] p-6 lg:p-8 text-left hover:bg-white/20 transition-colors flex items-center gap-4 lg:gap-6 border-b md:border-b-0 md:border-r border-black/5"
        >
          <CalendarIcon className="text-[#FF6321]" size={28} />
          <div>
            <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">Drop-off Date</p>
            <p className="text-black font-mono text-lg lg:text-xl tracking-tight">{format(selectedRange.to, 'EEE dd MMM')}</p>
          </div>
        </button>

        <div className="p-6 lg:p-8 text-left flex items-center gap-4 lg:gap-6 border-b md:border-b-0 md:border-r border-black/5 min-w-[140px] lg:min-w-[180px]">
          <Clock className="text-[#FF6321]" size={28} />
          <div className="flex-1">
            <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">Time</p>
            <div className="relative">
              <select 
                value={dropOffTime}
                onChange={(e) => setDropOffTime(e.target.value)}
                className="bg-transparent text-black font-mono text-lg lg:text-xl outline-none w-full appearance-none cursor-pointer pr-6"
              >
                {filteredTimeOptions.map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-black/20 pointer-events-none" />
            </div>
          </div>
        </div>

        <button 
          onClick={handleSearch}
          className="text-white px-8 lg:px-12 py-6 md:py-0 font-bold uppercase tracking-widest text-sm hover:opacity-90 transition-all flex items-center justify-center gap-3 active:scale-95 bg-[#FF6321] shadow-xl shadow-[#FF6321]/20"
        >
          Search <ChevronRight size={20} />
        </button>
      </div>

      {showCalendar && (
        <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center p-0 md:p-4">
          <div 
            onClick={() => setShowCalendar(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div 
            ref={calendarRef}
            className="relative z-10 w-full md:w-[700px] max-w-full md:max-w-[95vw] bg-white shadow-2xl rounded-t-[2.5rem] md:rounded-[2.5rem] flex flex-col h-[85vh] md:h-auto md:max-h-[85vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="absolute top-6 right-6 z-30 md:hidden">
              <button 
                onClick={() => setShowCalendar(false)}
                className="p-2 bg-black/5 rounded-full"
              >
                <X size={20} />
              </button>
            </div>
            <DatePickerCustom 
              selectedRange={selectedRange}
              onRangeChange={setSelectedRange}
              pickUpTime={pickUpTime}
              onPickUpTimeChange={setPickUpTime}
              dropOffTime={dropOffTime}
              onDropOffTimeChange={setDropOffTime}
              onClose={() => setShowCalendar(false)}
              onApply={() => setShowCalendar(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingWidgetStandalone;
