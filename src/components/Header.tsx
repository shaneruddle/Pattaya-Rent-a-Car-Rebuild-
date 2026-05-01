import React from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Search, Filter, X, Plus } from 'lucide-react';
import { format, addMonths, subMonths } from 'date-fns';
import { cn } from '../lib/utils';

interface HeaderProps {
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  availability: { free: number; total: number };
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onNewBooking?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  currentDate, 
  setCurrentDate, 
  availability,
  searchQuery,
  setSearchQuery,
  onNewBooking
}) => {
  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const handleToday = () => setCurrentDate(new Date());

  const clearFilters = () => {
    setSearchQuery('');
  };

  const hasActiveFilters = searchQuery;

  return (
    <header className="bg-white/40 backdrop-blur-xl border-b border-black/10 sticky top-0 z-20">
      <div className="h-12 px-8 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4">
            <h1 className="font-serif italic text-xl text-[#1A1A1A] min-w-[150px]">
              {format(currentDate, 'MMMM yyyy')}
            </h1>
            <div className="flex items-center gap-1 bg-white/40 border border-black/20 p-1 rounded-full backdrop-blur-md">
              <button
                onClick={handlePrevMonth}
                className="p-1.5 hover:bg-brand-orange hover:text-white rounded-full transition-all text-[#1A1A1A]"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={handleToday}
                className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange hover:text-white rounded-full transition-all text-[#1A1A1A]"
              >
                Today
              </button>
              <button
                onClick={handleNextMonth}
                className="p-1.5 hover:bg-brand-orange hover:text-white rounded-full transition-all text-[#1A1A1A]"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Search Bar */}
          <div className="relative group">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/40 group-focus-within:text-brand-orange transition-colors" />
            <input
              type="text"
              placeholder="Search..."
              className="bg-white/40 border border-black/20 focus:border-brand-orange focus:bg-white outline-none rounded-full h-10 pl-10 pr-4 text-xs w-48 transition-all font-medium backdrop-blur-md"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <button
            onClick={onNewBooking}
            className="bg-brand-orange text-white h-10 px-6 rounded-full flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:bg-[#1A1A1A] transition-all shadow-lg shadow-brand-orange/20"
          >
            <Plus size={16} />
            New Booking
          </button>
        </div>
      </div>

      {/* Active Filters Bar */}
      {hasActiveFilters && (
        <div className="px-8 py-2 bg-brand-orange/10 border-t border-white/40 flex items-center gap-3 backdrop-blur-md">
          <span className="text-[10px] font-bold uppercase tracking-widest text-brand-orange/60">Active Filters:</span>
          <div className="flex flex-wrap gap-2">
            {searchQuery && (
              <span className="bg-white/60 border border-white/80 text-[#1A1A1A] px-2 py-1 rounded-full text-[10px] flex items-center gap-1">
                Search: {searchQuery}
                <button onClick={() => setSearchQuery('')} className="hover:text-brand-orange"><X size={10} /></button>
              </span>
            )}
            <button 
              onClick={clearFilters}
              className="text-[10px] font-bold uppercase tracking-widest text-brand-orange hover:underline ml-2"
            >
              Clear All
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
