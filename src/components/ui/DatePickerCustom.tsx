import React, { useState } from 'react';
import { format, addDays, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, addMonths, subMonths, differenceInHours } from 'date-fns';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../LanguageContext';

export const timeOptions = Array.from({ length: 24 }).flatMap((_, i) => {
  const hour = i.toString().padStart(2, '0');
  return [`${hour}:00`, `${hour}:30`];
});

// For the backend, we might want all times, but the BookingEngine filters them.
// Let's provide a prop to filter or not.
export const filteredTimeOptions = timeOptions.filter(time => {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m;
  return totalMinutes >= 9 * 60 + 30 && totalMinutes <= 16 * 60;
});

interface DatePickerCustomProps {
  selectedRange: { from: Date; to: Date };
  onRangeChange: (range: { from: Date; to: Date }) => void;
  pickUpTime: string;
  onPickUpTimeChange: (time: string) => void;
  dropOffTime: string;
  onDropOffTimeChange: (time: string) => void;
  isBikeMode?: boolean;
  onClose?: () => void;
  onApply?: () => void;
  useFilteredTimes?: boolean;
}

export const DatePickerCustom: React.FC<DatePickerCustomProps> = ({ 
  selectedRange, 
  onRangeChange, 
  pickUpTime,
  onPickUpTimeChange,
  dropOffTime,
  onDropOffTimeChange,
  isBikeMode = false,
  onClose,
  onApply,
  useFilteredTimes = false
}) => {
  const { t } = useLanguage();
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedRange.from));
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [tempRange, setTempRange] = useState<{ from: Date | null; to: Date | null }>({
    from: selectedRange.from,
    to: selectedRange.to
  });
  
  const nextMonth = addMonths(currentMonth, 1);
  const times = useFilteredTimes ? filteredTimeOptions : timeOptions;

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
        <div className="flex justify-between items-center mb-6 px-2 text-white">
          <h3 className="font-bold text-lg tracking-tight">
            {format(month, 'MMMM yyyy')}
          </h3>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-[10px] font-bold text-white/40 py-1 uppercase tracking-widest">{d}</div>
          ))}
          {blanks.map((_, i) => <div key={`blank-${i}`} />)}
          {days.map(day => {
            const isStart = tempRange.from && isSameDay(day, tempRange.from);
            const isEnd = tempRange.to && isSameDay(day, tempRange.to);
            const inRange = isInRange(day);
            const isToday = isSameDay(day, new Date());
            const isPast = day < new Date() && !isToday;

            return (
              <button
                key={day.toString()}
                type="button"
                disabled={isPast}
                onMouseEnter={() => setHoverDate(day)}
                onMouseLeave={() => setHoverDate(null)}
                onClick={() => handleDayClick(day)}
                className={cn(
                  "h-10 w-10 flex items-center justify-center text-xs font-bold transition-all relative",
                  isStart && !tempRange.to ? "text-white rounded-full z-10 shadow-lg" :
                  isStart ? "text-white rounded-l-full z-10" : 
                  isEnd ? "text-white rounded-r-full z-10" : 
                  inRange ? "text-white" : 
                  isPast ? "text-white/10 cursor-not-allowed" : "text-white hover:bg-white/10 rounded-full"
                )}
                style={{
                  backgroundColor: isStart || isEnd ? (isBikeMode ? '#0084ff' : '#FF6321') : inRange ? (isBikeMode ? 'rgba(0, 132, 255, 0.2)' : 'rgba(255, 99, 33, 0.2)') : undefined
                }}
              >
                {format(day, 'd')}
                {isStart && tempRange.to && (
                  <div 
                    className="absolute -top-10 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-xl whitespace-nowrap z-50"
                    style={{ backgroundColor: isBikeMode ? '#0084ff' : '#FF6321' }}
                  >
                    {calculateDays()} days
                    <div 
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45" 
                      style={{ backgroundColor: isBikeMode ? '#0084ff' : '#FF6321' }}
                    />
                  </div>
                )}
                {isToday && !(isStart || isEnd) && <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full" />}
              </button>
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
    <div 
      className={cn(
        "rounded-[40px] overflow-hidden z-[100] shadow-2xl transition-all",
        "w-full max-w-[700px] mx-auto",
      )}
      style={{ 
        backgroundColor: isBikeMode ? '#0084ff' : '#FF6321', 
      }}
    >
      <div className="flex flex-col md:flex-row relative border-b border-white/10 overflow-hidden">
        <button 
          type="button"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="absolute left-6 top-8 p-2 text-white hover:bg-white/10 rounded-full z-20 transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        {renderMonth(currentMonth)}
        <div className="w-px bg-white/10 hidden md:block" />
        {renderMonth(nextMonth)}
        <button 
          type="button"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="absolute right-6 top-8 p-2 text-white hover:bg-white/10 rounded-full z-20 transition-colors"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Time Selection Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 border-b border-white/10">
        <div className="p-6 md:p-8 border-b md:border-b-0 md:border-r border-white/10">
          <div className="flex items-start gap-4">
            <span className="text-4xl md:text-6xl font-bold text-white/40 leading-none">
              {tempRange.from ? format(tempRange.from, 'd') : '--'}
            </span>
            <div>
              <p className="text-white font-bold text-base md:text-lg leading-tight text-left">
                {tempRange.from ? format(tempRange.from, 'MMMM yyyy') : 'Select Date'}
              </p>
              <p className="text-white/60 text-xs md:text-sm font-medium text-left">
                {tempRange.from ? format(tempRange.from, 'EEEE') : ''}
              </p>
            </div>
          </div>
          <div className="mt-6 md:mt-8 relative">
            <select 
              value={pickUpTime}
              onChange={(e) => onPickUpTimeChange(e.target.value)}
              className="w-full bg-transparent text-white text-3xl md:text-5xl font-bold outline-none appearance-none cursor-pointer"
            >
              {times.map(time => (
                <option key={time} value={time} className="text-white text-base" style={{ backgroundColor: isBikeMode ? '#0084ff' : '#FF6321' }}>{time}</option>
              ))}
            </select>
            <ChevronDown size={24} className="absolute right-0 top-1/2 -translate-y-1/2 text-white pointer-events-none md:hidden" />
            <ChevronDown size={32} className="absolute right-0 top-1/2 -translate-y-1/2 text-white pointer-events-none hidden md:block" />
          </div>
        </div>

        <div className="p-6 md:p-8">
          <div className="flex items-start gap-4">
            <span className="text-4xl md:text-6xl font-bold text-white/40 leading-none">
              {tempRange.to ? format(tempRange.to, 'd') : '--'}
            </span>
            <div>
              <p className="text-white font-bold text-base md:text-lg leading-tight text-left">
                {tempRange.to ? format(tempRange.to, 'MMMM yyyy') : 'Select Date'}
              </p>
              <p className="text-white/60 text-xs md:text-sm font-medium text-left">
                {tempRange.to ? format(tempRange.to, 'EEEE') : ''}
              </p>
            </div>
          </div>
          <div className="mt-6 md:mt-8 relative">
            <select 
              value={dropOffTime}
              onChange={(e) => onDropOffTimeChange(e.target.value)}
              className="w-full bg-transparent text-white text-3xl md:text-5xl font-bold outline-none appearance-none cursor-pointer"
            >
              {times.map(time => (
                <option key={time} value={time} className="text-white text-base" style={{ backgroundColor: isBikeMode ? '#0084ff' : '#FF6321' }}>{time}</option>
              ))}
            </select>
            <ChevronDown size={24} className="absolute right-0 top-1/2 -translate-y-1/2 text-white pointer-events-none md:hidden" />
            <ChevronDown size={32} className="absolute right-0 top-1/2 -translate-y-1/2 text-white pointer-events-none hidden md:block" />
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="bg-black/20 py-4 text-center">
        <span className="text-white font-bold text-lg uppercase tracking-widest">
          {calculateDays()} days
        </span>
      </div>

      <div className="p-6 md:p-8 flex items-center justify-end gap-4 bg-black/10">
        <button 
          type="button"
          onClick={onClose}
          className="flex-1 md:flex-none px-6 md:px-10 py-4 bg-[#ff3b30] text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] md:text-sm hover:opacity-90 transition-all shadow-lg"
        >
          Cancel
        </button>
        <button 
          type="button"
          onClick={handleApply}
          className="flex-1 md:flex-none px-6 md:px-10 py-4 bg-[#4cd964] text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] md:text-sm hover:opacity-90 transition-all shadow-lg"
        >
          Apply
        </button>
      </div>
    </div>
  );
};
