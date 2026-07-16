import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, auth, safeGetDocs } from '../firebase';
import { CalendarEvent } from '../types';
import {
  format, isToday, isSameMonth,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, User, PartyPopper, Bell, X, Plus, Pencil, Trash2 } from 'lucide-react';
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

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formDate, setFormDate] = useState('');
  const [formType, setFormType] = useState<CalendarEvent['type']>('event');
  const [formTitle, setFormTitle] = useState('');
  const [formStaffName, setFormStaffName] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const openAddModal = (prefillDate?: Date) => {
    setEditingEvent(null);
    setFormDate(format(prefillDate || new Date(), 'yyyy-MM-dd'));
    setFormType('event');
    setFormTitle('');
    setFormStaffName('');
    setFormNotes('');
    setFormOpen(true);
  };

  const openEditModal = (ev: CalendarEvent) => {
    setEditingEvent(ev);
    setFormDate(ev.date);
    setFormType(ev.type);
    setFormTitle(ev.title || '');
    setFormStaffName(ev.staffName || '');
    setFormNotes(ev.notes || '');
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingEvent(null);
  };

  const handleSave = async () => {
    if (!formDate || !formTitle.trim()) {
      toast.error('Date and title are required');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        date: formDate,
        type: formType,
        title: formTitle.trim(),
        staffName: formType === 'shift' && formStaffName.trim() ? formStaffName.trim() : null,
        notes: formNotes.trim() ? formNotes.trim() : null,
      };

      if (editingEvent) {
        await updateDoc(doc(db, 'calendar_events', editingEvent.id), payload);
        toast.success('Entry updated');
      } else {
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'calendar_events'), payload);
        toast.success('Entry added');
      }
      closeForm();
      await fetchEvents();
    } catch (error) {
      console.error('Error saving calendar event:', error);
      toast.error('Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'calendar_events', id));
      toast.success('Entry deleted');
      setConfirmDeleteId(null);
      setSelectedDay(null);
      await fetchEvents();
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      toast.error('Failed to delete entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-warm-bg overflow-hidden">
      <div className="p-8 border-b border-white/20 bg-white/40 backdrop-blur-xl flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-serif italic text-4xl text-[#1A1A1A]">Team Calendar</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] mt-1 font-medium">Staff Shifts, Events &amp; Holidays</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => openAddModal()}
              className="flex items-center gap-2 px-4 py-2 bg-brand-orange hover:bg-brand-orange/90 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
            >
              <Plus size={14} />
              New Entry
            </button>
            <button
              onClick={fetchEvents}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-white/60 hover:bg-white border border-white/40 rounded-xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-brand-orange transition-all disabled:opacity-50"
            >
              <RefreshCw size={14} className={cn(loading && "animate-spin")} />
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
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
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      "min-h-[110px] rounded-2xl border p-3 text-left flex flex-col gap-1.5 transition-all cursor-pointer",
                      inMonth ? "bg-white/60 border-white/40 hover:bg-white" : "bg-white/20 border-white/20 hover:bg-white/40",
                      today && "ring-2 ring-brand-orange ring-offset-2 ring-offset-warm-bg"
                    )}
                    whileHover={{ scale: 1.02 }}
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
              <p className="text-xs mt-1">Click <strong>New Entry</strong> above, or click any day, to add a staff shift, event, or holiday.</p>
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
            onClick={() => { setSelectedDay(null); setConfirmDeleteId(null); }}
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
                <button onClick={() => { setSelectedDay(null); setConfirmDeleteId(null); }} className="text-[#1A1A1A]/40 hover:text-[#1A1A1A]">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-3">
                {selectedDayEvents.length === 0 && (
                  <p className="text-sm text-[#1A1A1A]/40 text-center py-4">No entries for this day yet.</p>
                )}
                {selectedDayEvents.map(ev => (
                  <div key={ev.id} className={cn("p-4 rounded-2xl border", TYPE_META[ev.type]?.pill || TYPE_META.event.pill)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 mb-1">
                        {ev.type === 'shift' ? <User size={14} /> : ev.type === 'holiday' ? <PartyPopper size={14} /> : <Bell size={14} />}
                        <span className="text-[9px] font-bold uppercase tracking-widest">{TYPE_META[ev.type]?.label || 'Event'}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => { setSelectedDay(null); setConfirmDeleteId(null); openEditModal(ev); }}
                          className="opacity-50 hover:opacity-100 transition-opacity"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        {confirmDeleteId === ev.id ? (
                          <button
                            onClick={() => handleDelete(ev.id)}
                            disabled={saving}
                            className="text-[9px] font-bold uppercase tracking-widest text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            Confirm?
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(ev.id)}
                            className="opacity-50 hover:opacity-100 transition-opacity"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="font-bold text-sm">{ev.type === 'shift' && ev.staffName ? `${ev.staffName} - ${ev.title}` : ev.title}</p>
                    {ev.notes && <p className="text-xs opacity-70 mt-1">{ev.notes}</p>}
                  </div>
                ))}
              </div>
              <button
                onClick={() => { const d = selectedDay; setSelectedDay(null); setConfirmDeleteId(null); openAddModal(d || undefined); }}
                className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/60 hover:bg-white border border-[#1A1A1A]/10 rounded-xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-brand-orange transition-all"
              >
                <Plus size={14} />
                Add Entry for This Day
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
            onClick={closeForm}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-serif italic text-2xl text-[#1A1A1A]">{editingEvent ? 'Edit Entry' : 'New Entry'}</h3>
                <button onClick={closeForm} className="text-[#1A1A1A]/40 hover:text-[#1A1A1A]">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/50">Date</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="mt-1 w-full px-4 py-2.5 bg-white/60 border border-[#1A1A1A]/10 rounded-xl text-sm text-[#1A1A1A] focus:outline-none focus:border-brand-orange"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/50">Type</label>
                  <div className="mt-1 flex gap-2">
                    {(Object.keys(TYPE_META) as Array<CalendarEvent['type']>).map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFormType(type)}
                        className={cn(
                          "flex-1 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all",
                          formType === type ? TYPE_META[type].pill : "bg-white/60 border-[#1A1A1A]/10 text-[#1A1A1A]/40"
                        )}
                      >
                        {TYPE_META[type].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/50">Title</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder={formType === 'shift' ? 'e.g. Morning Shift' : formType === 'holiday' ? 'e.g. Songkran' : 'e.g. Fleet Maintenance'}
                    className="mt-1 w-full px-4 py-2.5 bg-white/60 border border-[#1A1A1A]/10 rounded-xl text-sm text-[#1A1A1A] focus:outline-none focus:border-brand-orange"
                  />
                </div>

                {formType === 'shift' && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/50">Staff Name</label>
                    <input
                      type="text"
                      value={formStaffName}
                      onChange={(e) => setFormStaffName(e.target.value)}
                      placeholder="e.g. Rak"
                      className="mt-1 w-full px-4 py-2.5 bg-white/60 border border-[#1A1A1A]/10 rounded-xl text-sm text-[#1A1A1A] focus:outline-none focus:border-brand-orange"
                    />
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/50">Notes (optional)</label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    rows={3}
                    className="mt-1 w-full px-4 py-2.5 bg-white/60 border border-[#1A1A1A]/10 rounded-xl text-sm text-[#1A1A1A] focus:outline-none focus:border-brand-orange resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={closeForm}
                  className="flex-1 px-4 py-2.5 bg-white/60 hover:bg-white border border-[#1A1A1A]/10 rounded-xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-brand-orange hover:bg-brand-orange/90 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingEvent ? 'Save Changes' : 'Add Entry'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
