import React, { useState, useEffect, useMemo } from 'react';
import { collection } from 'firebase/firestore';
import { db, auth, safeGetDocs } from '../firebase';
import { CalendarEvent } from '../types';
import {
  format, isToday, isSameMonth,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, User, PartyPopper, Bell, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

const TYPE_META: Record<CalendarEvent['type'], { label: string; dot: string; pill: string }> = {
  shift: { label: 'Staff Shift', dot: 'bg-blue-500', pill: 'bg-blue-50 text-blue-600 border-blue-100' },
  event: { label: 'Event / Reminder', dot: 'bg-purple-500', pill: 'bg-purple-50 text-purple-600 border-purple-100' },
  holiday: { label: 'Holiday', dot: 'bg-red-500', pill: 'bg-red-50 text-red-600 border-red-100' },
};

export const TeamCalendar: React.FC = () => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const fetchEvents = async () => {
    if (!auth.currentUser) { setLoading(false); return; }
    setLoading(true);
    try {
      const snapshot = await safeGetDocs(collection(db, 'calendar_events'));
      const data = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as CalendarEvent));
      setEvents(data);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      toast.error('Failed to load calendar events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach(ev => {
      if (!ev.date) return;
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    });
    return map;
  }, [events]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const selectedDayEvents = selectedDay ? (eventsByDate[format(selectedDay, 'yyyy-MM-dd')] || []) : [];

  return (
    <div className="flex-1 flex flex-col h-full bg-warm-bg overflow-hidden">
      <div className="p-8 border-b border-white/20 bg-white/40 backdrop-blur-xl flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-serif italic text-4xl text-[#1A1A1A]">Team Calendar</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] mt-1 font-medium">Staff Shifts, Events &amp; Holidays</p>
          </div>
          <button
            onClick={fetchEvents}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white/60 hover:bg-white border border-white/40 rounded-xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-brand-orange transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}
              className="w-10 h-10 rounded-xl bg-white/60 hover:bg-white border border-white/40 flex items-center justify-center transition-all text-[#1A1A1A]/60 hover:text-brand-orange"
            >
              <ChevronLeft size={16} />
            </button>
            <h2 className="text-lg font-bold text-[#1A1A1A] min-w-[160px] text-center">{format(currentMonth, 'MMMM yyyy')}</h2>
            <button
              onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}
              className="w-10 h-10 rounded-xl bg-white/60 hover:bg-white border border-white/40 flex items-center justify-center transition-all text-[#1A1A1A]/60 hover:text-brand-orange"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setCurrentMonth(startOfMonth(new Date()))}
              className="ml-2 px-4 py-2 bg-white/60 hover:bg-white border border-white/40 rounded-xl text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-brand-orange transition-all"
            >
              Today
            </button>
          </div>

          <div className="flex items-center gap-4">
            {(Object.keys(TYPE_META) as Array<CalendarEvent['type']>).map(type => (
              <div key={type} className="flex items-center gap-2">
                <span className={cn("w-2.5 h-2.5 rounded-full", TYPE_META[type].dot)} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60">{TYPE_META[type].label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-7 gap-2 mb-2">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 py-2">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24 text-[#1A1A1A]/40">
              <RefreshCw size={20} className="animate-spin mr-3" />
              Loading calendar...
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {days.map(day => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const dayEvents = eventsByDate[dateKey] || [];
                const inMonth = isSameMonth(day, currentMonth);
                const today = isToday(day);

                return (
                  <motion.button
                    key={dateKey}
                    onClick={() => dayEvents.length > 0 && setSelectedDay(day)}
                    className={cn(
                      "min-h-[110px] rounded-2xl border p-3 text-left flex flex-col gap-1.5 transition-all",
                      inMonth ? "bg-white/60 border-white/40" : "bg-white/20 border-white/20",
                      today && "ring-2 ring-brand-orange ring-offset-2 ring-offset-warm-bg",
                      dayEvents.length > 0 ? "hover:bg-white cursor-pointer" : "cursor-default"
                    )}
                    whileHover={dayEvents.length > 0 ? { scale: 1.02 } : {}}
                  >
                    <span className={cn(
                      "text-xs font-bold",
                      inMonth ? "text-[#1A1A1A]" : "text-[#1A1A1A]/30",
                      today && "text-brand-orange"
                    )}>
                      {format(day, 'd')}
                    </span>
                    <div className="flex flex-col gap-1">
                      {dayEvents.slice(0, 3).map(ev => (
                        <span
                          key={ev.id}
                          className={cn(
                            "px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest border truncate",
                            TYPE_META[ev.type]?.pill || TYPE_META.event.pill
                          )}
                        >
                          {ev.type === 'shift' && ev.staffName ? ev.staffName : ev.title}
                        </span>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[9px] font-bold text-[#1A1A1A]/40 pl-1">+{dayEvents.length - 3} more</span>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}

          {!loading && events.length === 0 && (
            <div className="text-center py-16 text-[#1A1A1A]/40">
              <CalendarDays size={32} className="mx-auto mb-4 opacity-40" />
              <p className="text-sm font-medium">No calendar entries yet</p>
              <p className="text-xs mt-1">Add staff shifts, events, or holidays to the <code className="px-1.5 py-0.5 bg-white/60 rounded">calendar_events</code> collection in Firestore.</p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedDay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
            onClick={() => setSelectedDay(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-serif italic text-2xl text-[#1A1A1A]">{selectedDay ? format(selectedDay, 'EEEE, MMMM d') : ''}</h3>
                <button onClick={() => setSelectedDay(null)} className="text-[#1A1A1A]/40 hover:text-[#1A1A1A]">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-3">
                {selectedDayEvents.map(ev => (
                  <div key={ev.id} className={cn("p-4 rounded-2xl border", TYPE_META[ev.type]?.pill || TYPE_META.event.pill)}>
                    <div className="flex items-center gap-2 mb-1">
                      {ev.type === 'shift' ? <User size={14} /> : ev.type === 'holiday' ? <PartyPopper size={14} /> : <Bell size={14} />}
                      <span className="text-[9px] font-bold uppercase tracking-widest">{TYPE_META[ev.type]?.label || 'Event'}</span>
                    </div>
                    <p className="font-bold text-sm">{ev.type === 'shift' && ev.staffName ? `${ev.staffName} \u2014 ${ev.title}` : ev.title}</p>
                    {ev.notes && <p className="text-xs opacity-70 mt-1">{ev.notes}</p>}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
