import React, { useMemo, useState, useEffect } from 'react';
import { Booking, Car } from '../types';
import { format, parseISO, startOfDay, isToday, isPast, isFuture, getMonth, getYear, isValid, differenceInDays, addDays } from 'date-fns';
import { Calendar, Clock, User, Car as CarIcon, MapPin, Search, Filter, Eye, Edit2, Trash2, X, AlertCircle, AlertTriangle, CheckCircle2, Mail, Phone, FileText, DollarSign, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { LocationPicker } from './LocationPicker';
import { DatePickerCustom } from './ui/DatePickerCustom';
import { db, handleFirestoreError, OperationType, logSystemActivity } from '../firebase';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { sendTemplatedEmail } from '../lib/emailUtils';

interface BookingsProps {
  bookings: Booking[];
  cars: Car[];
  onRefresh?: () => void;
}

export const Bookings: React.FC<BookingsProps> = ({ bookings = [], cars = [], onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  
  // Modal State
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [originalBooking, setOriginalBooking] = useState<Booking | null>(null);
  const [showExtensionPrompt, setShowExtensionPrompt] = useState<{ booking: Booking, carName: string } | null>(null);
  const [deletingBooking, setDeletingBooking] = useState<Booking | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickUpTime, setPickUpTime] = useState('09:30');
  const [dropOffTime, setDropOffTime] = useState('09:30');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: new Date(),
    to: addDays(new Date(), 1)
  });
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (showDatePicker) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showDatePicker]);

  const filteredBookings = useMemo(() => {
    return bookings.filter(booking => {
      // Only show bookings with an assigned car in this view
      if (!booking.carId || booking.carId === '' || booking.carId === 'unassigned') return false;

      const car = cars.find(c => c.id === booking.carId);
      const searchLower = (searchTerm || '').toLowerCase();
      const matchesSearch = 
        (booking.customerName?.toLowerCase() || '').includes(searchLower) ||
        (car?.name?.toLowerCase() || '').includes(searchLower) ||
        (car?.plateNumber?.toLowerCase() || '').includes(searchLower);

      const bookingDate = parseISO(booking.startDate);
      if (!isValid(bookingDate)) return false;

      const matchesMonth = selectedMonth === 'all' || 
        `${getYear(bookingDate)}-${String(getMonth(bookingDate) + 1).padStart(2, '0')}` === selectedMonth;

      return matchesSearch && matchesMonth;
    });
  }, [bookings, cars, searchTerm, selectedMonth]);

  const sortedBookings = useMemo(() => {
    return [...filteredBookings].sort((a, b) => {
      const dateA = parseISO(a.startDate);
      const dateB = parseISO(b.startDate);
      if (!isValid(dateA) || !isValid(dateB)) return 0;
      return dateB.getTime() - dateA.getTime();
    });
  }, [filteredBookings]);

  // Group bookings by date
  const groupedBookings = useMemo(() => {
    const groups: { [date: string]: Booking[] } = {};
    sortedBookings.forEach(booking => {
      const date = parseISO(booking.startDate);
      if (!isValid(date)) return;
      const dateKey = startOfDay(date).toISOString();
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(booking);
    });
    return groups;
  }, [sortedBookings]);

  const dateKeys = useMemo(() => Object.keys(groupedBookings).sort((a, b) => b.localeCompare(a)), [groupedBookings]);

  // Generate month options from bookings
  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    bookings.forEach(b => {
      const date = parseISO(b.startDate);
      if (isValid(date)) {
        months.add(`${getYear(date)}-${String(getMonth(date) + 1).padStart(2, '0')}`);
      }
    });
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [bookings]);

  const handleUpdateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBooking) return;

    setIsSubmitting(true);
    try {
      const bookingRef = doc(db, 'bookings', editingBooking.id);
      const { id, ...updateData } = editingBooking;
      await updateDoc(bookingRef, updateData);
      
      // Log activity
      const car = cars.find(c => c.id === editingBooking.carId);
      await logSystemActivity(
        'Update Booking',
        `Updated booking for ${editingBooking.customerName} (${car?.name || 'Unknown Car'})`,
        'Bookings',
        { bookingId: editingBooking.id, customerName: editingBooking.customerName }
      );

      // Check if this was an extension
      const originalEndDate = originalBooking ? parseISO(originalBooking.endDate) : null;
      const newEndDate = parseISO(editingBooking.endDate);
      
      const isExtension = originalEndDate && isValid(originalEndDate) && isValid(newEndDate) && newEndDate > originalEndDate;

      toast.success('Booking updated successfully');
      
      const updatedBooking = { ...editingBooking };
      const carName = car?.name || 'Vehicle';
      
      setEditingBooking(null);
      setOriginalBooking(null);
      
      if (isExtension) {
        setShowExtensionPrompt({ 
          booking: updatedBooking, 
          carName: carName 
        });
      }
      
      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      console.error('Error updating booking:', error);
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${editingBooking.id}`);
      toast.error('Failed to update booking');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const handleSendExtensionEmail = async () => {
    if (!showExtensionPrompt) return;
    
    const { booking, carName } = showExtensionPrompt;
    if (!booking.email) {
      toast.error('Customer email not found');
      setShowExtensionPrompt(null);
      return;
    }

    setIsSendingEmail(true);
    try {
      const returnDate = format(parseISO(booking.endDate), 'PPP');
      const totalPrice = booking.amount?.toLocaleString() || '0';
      
      await sendTemplatedEmail('extension_acknowledged', booking.email, {
        '{{customer_name}}': booking.customerName,
        '{{vehicle_model}}': carName,
        '{{return_date}}': returnDate,
        '{{total_price}}': totalPrice
      });
      
      toast.success('Extension confirmation email sent');
    } catch (error) {
      console.error('Error sending extension email:', error);
      toast.error('Email failed to send, but booking was updated');
    } finally {
      setIsSendingEmail(false);
      setShowExtensionPrompt(null);
    }
  };

  const handleDeleteBooking = async () => {
    if (!deletingBooking) return;

    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'bookings', deletingBooking.id));
      
      // Log activity
      const car = cars.find(c => c.id === deletingBooking.carId);
      await logSystemActivity(
        'Delete Booking',
        `Deleted booking for ${deletingBooking.customerName} (${car?.name || 'Unknown Car'})`,
        'Bookings',
        { bookingId: deletingBooking.id, customerName: deletingBooking.customerName }
      );

      toast.success('Booking deleted successfully');
      setDeletingBooking(null);
      
      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      console.error('Error deleting booking:', error);
      handleFirestoreError(error, OperationType.DELETE, `bookings/${deletingBooking.id}`);
      toast.error('Failed to delete booking');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-warm-bg overflow-hidden">
      <div className="p-8 border-b border-white/20 bg-white/40 backdrop-blur-xl flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif italic text-4xl text-[#1A1A1A]">Bookings</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] mt-1 font-medium">Schedule View of All Reservations</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30" size={16} />
            <input
              type="text"
              placeholder="Search by customer, car, or plate..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-12 pl-12 pr-4 bg-white/60 border border-white/40 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all"
            />
          </div>

          <div className="relative min-w-[180px]">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30" size={16} />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full h-12 pl-12 pr-10 bg-white/60 border border-white/40 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all appearance-none cursor-pointer"
            >
              <option value="all">All Months</option>
              {monthOptions.map(month => {
                const date = parseISO(`${month}-01`);
                if (!isValid(date)) return null;
                return (
                  <option key={month} value={month}>
                    {format(date, 'MMMM yyyy')}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        <div className="max-w-5xl mx-auto space-y-12">
          {dateKeys.map(dateKey => {
            const date = parseISO(dateKey);
            if (!isValid(date)) return null;
            const dayBookings = groupedBookings[dateKey];
            const isDayToday = isToday(date);

            return (
              <div key={dateKey} className="flex gap-8 relative">
                {/* Date Column */}
                <div className="w-24 shrink-0 pt-1">
                  <div className="sticky top-8">
                    <div className="flex flex-col items-center">
                      <span className={cn(
                        "text-3xl font-bold transition-colors",
                        isDayToday ? "text-brand-orange" : "text-[#1A1A1A]"
                      )}>
                        {format(date, 'd')}
                      </span>
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest transition-colors",
                        isDayToday ? "text-brand-orange" : "text-[#1A1A1A]/40"
                      )}>
                        {format(date, 'MMM, EEE')}
                      </span>
                      {isDayToday && (
                        <div className="mt-2 w-1.5 h-1.5 rounded-full bg-brand-orange shadow-lg shadow-brand-orange/40" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Bookings List for this Date */}
                <div className="flex-1 space-y-1 pb-8 border-l border-[#1A1A1A]/5 pl-8">
                  {dayBookings.map(booking => {
                    const car = cars.find(c => c.id === booking.carId);
                    const startDate = parseISO(booking.startDate);
                    const endDate = parseISO(booking.endDate);
                    
                    if (!isValid(startDate) || !isValid(endDate)) return null;

                    const startTime = format(startDate, 'HH:mm');
                    const endTime = format(endDate, 'HH:mm');
                    const isAllDay = startTime === '00:00' && endTime === '00:00';

                    return (
                      <motion.div
                        key={booking.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-white/60 transition-all cursor-default border border-transparent hover:border-white/60 hover:shadow-sm"
                      >
                        {/* Status Dot */}
                        <div className={cn(
                          "w-3 h-3 rounded-full shrink-0 shadow-sm",
                          booking.status === 'Paid' 
                            ? "bg-green-500" 
                            : (parseISO(booking.startDate) < new Date()
                                ? "bg-yellow-500"
                                : (isFuture(parseISO(booking.startDate)) 
                                    ? "bg-red-500" 
                                    : ((!booking.carId || booking.carId === 'unassigned') ? "bg-yellow-500" : "bg-orange-500")))
                        )} />

                        {/* Time */}
                        <div className="w-28 shrink-0 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60 flex items-center gap-2">
                          <Clock size={12} className="opacity-40" />
                          {isAllDay ? 'All day' : `${startTime} - ${endTime}`}
                        </div>

                        {/* Description */}
                        <div className="flex-1 flex items-center gap-4 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <CarIcon size={14} className="text-brand-orange/60 shrink-0" />
                            <span className="font-bold text-sm text-[#1A1A1A] truncate flex items-center gap-2">
                              {car ? (
                                <>
                                  <span>{car.make && car.model ? `${car.make} ${car.model}` : car.name}</span>
                                  <span className="bg-white border border-[#1A1A1A]/20 px-1.5 py-0.5 rounded text-[8px] font-bold font-mono shadow-sm leading-none">
                                    {car.plateNumber}
                                  </span>
                                </>
                              ) : (
                                <span className="text-brand-orange italic">Unassigned Vehicle</span>
                              )}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2 min-w-0">
                            <User size={14} className="text-[#1A1A1A]/20 shrink-0" />
                            <span className="text-[#1A1A1A]/60 text-xs truncate font-medium">
                              {booking.customerName}
                            </span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all",
                            booking.status === 'Paid' 
                              ? "bg-green-100/80 text-green-600 border border-green-200/50" 
                              : (parseISO(booking.startDate) < new Date()
                                  ? "bg-yellow-100/80 text-yellow-600 border border-yellow-200/50"
                                  : (isFuture(parseISO(booking.startDate)) 
                                      ? "bg-red-100/80 text-red-600 border border-red-200/50" 
                                      : ((!booking.carId || booking.carId === 'unassigned') 
                                          ? "bg-yellow-100/80 text-yellow-600 border border-yellow-200/50" 
                                          : "bg-orange-100/80 text-orange-600 border border-orange-200/50")))
                          )}>
                            {booking.status}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setViewingBooking(booking)}
                              className="p-2 hover:bg-white rounded-xl text-[#1A1A1A]/40 hover:text-brand-orange transition-all"
                              title="View Details"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => {
                                setOriginalBooking(booking);
                                setEditingBooking(booking);
                                const start = parseISO(booking.startDate);
                                const end = parseISO(booking.endDate);
                                setPickUpTime(format(start, 'HH:mm'));
                                setDropOffTime(format(end, 'HH:mm'));
                                setDateRange({ from: start, to: end });
                              }}
                              className="p-2 hover:bg-white rounded-xl text-[#1A1A1A]/40 hover:text-brand-orange transition-all"
                              title="Edit Booking"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => setDeletingBooking(booking)}
                              className="p-2 hover:bg-white rounded-xl text-[#1A1A1A]/40 hover:text-red-500 transition-all"
                              title="Delete Booking"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {dateKeys.length === 0 && (
            <div className="h-[60vh] flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 bg-white/40 backdrop-blur-xl border border-white/60 rounded-full flex items-center justify-center mb-6 shadow-xl">
                <Calendar className="text-[#1A1A1A]/10" size={40} />
              </div>
              <h2 className="font-serif italic text-2xl mb-2 text-[#1A1A1A]">No Bookings Found</h2>
              <p className="text-[#1A1A1A]/40 uppercase tracking-widest text-[10px] font-bold">
                {searchTerm || selectedMonth !== 'all' ? 'Try adjusting your filters' : 'Your schedule is currently empty'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* View Modal */}
      <AnimatePresence>
        {viewingBooking && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewingBooking(null)}
              className="absolute inset-0 bg-[#1A1A1A]/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white/90 backdrop-blur-2xl border border-white/60 w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[#1A1A1A]/5 flex items-center justify-between">
                <div>
                  <h2 className="font-serif italic text-3xl text-[#1A1A1A]">Booking Details</h2>
                  <p className="text-[#1A1A1A]/40 uppercase tracking-widest text-[10px] font-bold mt-1">Reservation Info</p>
                </div>
                <button
                  onClick={() => setViewingBooking(null)}
                  className="w-10 h-10 rounded-full bg-[#1A1A1A]/5 flex items-center justify-center text-[#1A1A1A]/40 hover:bg-brand-orange hover:text-white transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 space-y-8">
                {/* Customer Info */}
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Customer</p>
                    <div className="flex items-center gap-2 text-[#1A1A1A]">
                      <User size={14} className="text-brand-orange" />
                      <span className="font-bold">{viewingBooking.customerName}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Status</p>
                    <div className={cn(
                      "inline-flex px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider",
                      viewingBooking.status === 'Paid' 
                        ? "bg-green-100 text-green-600" 
                        : (parseISO(viewingBooking.startDate) < new Date()
                            ? "bg-yellow-100 text-yellow-600"
                            : (isFuture(parseISO(viewingBooking.startDate)) 
                                ? "bg-red-100 text-red-600" 
                                : ((!viewingBooking.carId || viewingBooking.carId === 'unassigned') ? "bg-yellow-100 text-yellow-600" : "bg-orange-100 text-orange-600")))
                    )}>
                      {viewingBooking.status}
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Email</p>
                    <div className="flex items-center gap-2 text-[#1A1A1A]/60 text-sm">
                      <Mail size={14} />
                      <span>{viewingBooking.email || 'N/A'}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Mobile</p>
                    <div className="flex items-center gap-2 text-[#1A1A1A]/60 text-sm">
                      <Phone size={14} />
                      <span>{viewingBooking.mobileNumber || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {/* Vehicle & Dates */}
                <div className="bg-[#1A1A1A]/5 rounded-3xl p-6 space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                      <CarIcon size={24} className="text-brand-orange" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Vehicle</p>
                      <p className="font-bold text-[#1A1A1A] flex items-center gap-2">
                        {(() => {
                          const car = cars.find(c => c.id === viewingBooking.carId);
                          if (!car) return <span className="text-brand-orange italic">Unassigned Vehicle</span>;
                          return (
                            <>
                              <span>{car.make && car.model ? `${car.make} ${car.model}` : car.name}</span>
                              <span className="bg-white border border-[#1A1A1A]/20 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono shadow-sm">
                                {car.plateNumber}
                              </span>
                            </>
                          );
                        })()}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[#1A1A1A]/5">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Pick-up</p>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Calendar size={14} className="text-[#1A1A1A]/20" />
                        {format(parseISO(viewingBooking.startDate), 'MMM d, yyyy')}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#1A1A1A]/40 mt-1">
                        <Clock size={12} />
                        {format(parseISO(viewingBooking.startDate), 'HH:mm')}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Return</p>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Calendar size={14} className="text-[#1A1A1A]/20" />
                        {format(parseISO(viewingBooking.endDate), 'MMM d, yyyy')}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#1A1A1A]/40 mt-1">
                        <Clock size={12} />
                        {format(parseISO(viewingBooking.endDate), 'HH:mm')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Financials & Notes */}
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Total Amount</p>
                    <div className="flex items-center gap-1 text-xl font-bold text-brand-orange">
                      <span className="text-sm font-medium">฿</span>
                      {viewingBooking.amount?.toLocaleString() || '0'}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Deposit Held</p>
                    <div className="flex items-center gap-1 text-xl font-bold text-emerald-600">
                      <span className="text-sm font-medium">฿</span>
                      {viewingBooking.deposit?.toLocaleString() || '0'}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Duration</p>
                    <div className="text-sm font-medium text-[#1A1A1A]/60">
                      {differenceInDays(parseISO(viewingBooking.endDate), parseISO(viewingBooking.startDate))} Days
                    </div>
                  </div>
                </div>

                {viewingBooking.notes && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Notes</p>
                    <div className="bg-white border border-[#1A1A1A]/5 rounded-2xl p-4 text-sm text-[#1A1A1A]/60 leading-relaxed italic">
                      "{viewingBooking.notes}"
                    </div>
                  </div>
                )}
                {viewingBooking.returnNote && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Return Note</p>
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-[#1A1A1A]/60 leading-relaxed font-medium">
                      {viewingBooking.returnNote}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-8 bg-[#1A1A1A]/5 flex gap-4">
                <button
                  onClick={() => {
                    setOriginalBooking(viewingBooking);
                    setEditingBooking(viewingBooking);
                    setViewingBooking(null);
                  }}
                  className="flex-1 bg-white border border-[#1A1A1A]/10 text-[#1A1A1A] py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange hover:text-white hover:border-brand-orange transition-all flex items-center justify-center gap-2"
                >
                  <Edit2 size={14} /> Edit Booking
                </button>
                <button
                  onClick={() => setViewingBooking(null)}
                  className="flex-1 bg-[#1A1A1A] text-white py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-[#1A1A1A]/90 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingBooking && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSubmitting && setEditingBooking(null)}
              className="absolute inset-0 bg-[#1A1A1A]/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white/90 backdrop-blur-2xl border border-white/60 w-full max-w-xl rounded-[40px] shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleUpdateBooking}>
                <div className="p-8 border-b border-[#1A1A1A]/5 flex items-center justify-between">
                  <div>
                    <h2 className="font-serif italic text-3xl text-[#1A1A1A]">Edit Booking</h2>
                    <p className="text-[#1A1A1A]/40 uppercase tracking-widest text-[10px] font-bold mt-1">Update Reservation Details</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingBooking(null)}
                    disabled={isSubmitting}
                    className="w-10 h-10 rounded-full bg-[#1A1A1A]/5 flex items-center justify-center text-[#1A1A1A]/40 hover:bg-brand-orange hover:text-white transition-all disabled:opacity-50"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-8">
                  {/* Customer Section */}
                  <div className="space-y-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange">Customer Information</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Full Name</label>
                        <input
                          type="text"
                          required
                          value={editingBooking.customerName}
                          onChange={(e) => setEditingBooking({ ...editingBooking, customerName: e.target.value })}
                          className="w-full h-12 px-4 bg-white border border-[#1A1A1A]/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Mobile Number</label>
                        <input
                          type="tel"
                          value={editingBooking.mobileNumber || ''}
                          onChange={(e) => setEditingBooking({ ...editingBooking, mobileNumber: e.target.value })}
                          className="w-full h-12 px-4 bg-white border border-[#1A1A1A]/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Email Address</label>
                      <input
                        type="email"
                        value={editingBooking.email || ''}
                        onChange={(e) => setEditingBooking({ ...editingBooking, email: e.target.value })}
                        className="w-full h-12 px-4 bg-white border border-[#1A1A1A]/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                      />
                    </div>
                  </div>

                  {/* Booking Section */}
                  <div className="space-y-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange">Rental Details</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Vehicle</label>
                        <select
                          value={editingBooking.carId || ''}
                          onChange={(e) => setEditingBooking({ ...editingBooking, carId: e.target.value })}
                          className="w-full h-12 px-4 bg-white border border-[#1A1A1A]/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                        >
                          <option value="">Unassigned</option>
                          {cars.map(car => (
                            <option key={car.id} value={car.id}>{car.name} ({car.plateNumber})</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Status</label>
                        <select
                          required
                          value={editingBooking.status}
                          onChange={(e) => setEditingBooking({ ...editingBooking, status: e.target.value as 'Paid' | 'Pending' })}
                          className="w-full h-12 px-4 bg-white border border-[#1A1A1A]/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                        >
                          <option value="Pending">Pending</option>
                          <option value="Paid">Paid</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Date & Time Range</label>
                        <button
                          type="button"
                          onClick={() => setShowDatePicker(true)}
                          className="w-full bg-white border border-[#1A1A1A]/10 p-4 rounded-2xl text-left hover:bg-[#1A1A1A]/5 transition-all outline-none"
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-1">Pick-up</p>
                              <p className="text-sm font-bold text-[#1A1A1A]">
                                {format(dateRange.from, 'PPP')} at {pickUpTime}
                              </p>
                            </div>
                            <div className="h-8 w-px bg-black/10 mx-4" />
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-1">Drop-off</p>
                              <p className="text-sm font-bold text-[#1A1A1A]">
                                {format(dateRange.to, 'PPP')} at {dropOffTime}
                              </p>
                            </div>
                          </div>
                        </button>

                        <AnimatePresence>
                          {showDatePicker && (
                            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                              <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setShowDatePicker(false)}
                                className="absolute inset-0 bg-black/20 backdrop-blur-sm"
                              />
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="relative z-10 w-full max-w-[700px] bg-white dark:bg-[#1A1A1A] rounded-[2.5rem] overflow-hidden shadow-2xl max-h-[90vh] flex flex-col"
                              >
                                <DatePickerCustom
                                  selectedRange={dateRange}
                                  onRangeChange={(range) => {
                                    setDateRange(range);
                                    const start = new Date(range.from);
                                    const [sh, sm] = pickUpTime.split(':').map(Number);
                                    start.setHours(sh, sm, 0, 0);

                                    const end = new Date(range.to);
                                    const [eh, em] = dropOffTime.split(':').map(Number);
                                    end.setHours(eh, em, 0, 0);

                                    setEditingBooking({ 
                                      ...editingBooking, 
                                      startDate: start.toISOString(),
                                      endDate: end.toISOString()
                                    });
                                  }}
                                  pickUpTime={pickUpTime}
                                  onPickUpTimeChange={(time) => {
                                    setPickUpTime(time);
                                    const start = new Date(dateRange.from);
                                    const [sh, sm] = time.split(':').map(Number);
                                    start.setHours(sh, sm, 0, 0);
                                    setEditingBooking({ ...editingBooking, startDate: start.toISOString() });
                                  }}
                                  dropOffTime={dropOffTime}
                                  onDropOffTimeChange={(time) => {
                                    setDropOffTime(time);
                                    const end = new Date(dateRange.to);
                                    const [eh, em] = time.split(':').map(Number);
                                    end.setHours(eh, em, 0, 0);
                                    setEditingBooking({ ...editingBooking, endDate: end.toISOString() });
                                  }}
                                  onClose={() => setShowDatePicker(false)}
                                  onApply={() => setShowDatePicker(false)}
                                  isBikeMode={false}
                                />
                              </motion.div>
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-2xl flex gap-3">
                      <AlertCircle className="text-blue-500 shrink-0" size={16} />
                      <p className="text-[10px] text-blue-600 font-medium leading-relaxed italic">
                        Financial details and rental notes are now managed in the floating action bar at the bottom.
                      </p>
                    </div>

                    {/* Delivery Section */}
                    <div className="space-y-4 pt-4 border-t border-[#1A1A1A]/5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange">Delivery Information</p>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Delivery Address</label>
                        <input
                          type="text"
                          value={editingBooking.deliveryAddress || ''}
                          onChange={(e) => setEditingBooking({ ...editingBooking, deliveryAddress: e.target.value })}
                          className="w-full h-12 px-4 bg-white border border-[#1A1A1A]/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                          placeholder="Enter delivery address..."
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Pin Location</label>
                        <LocationPicker 
                          location={editingBooking.deliveryLocation} 
                          onChange={(loc) => setEditingBooking({ ...editingBooking, deliveryLocation: loc })}
                          height="250px"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Floating Action Bar (Bookings Edit) */}
                <div className="sticky bottom-0 bg-white/80 backdrop-blur-2xl border-t border-black/5 p-6 space-y-6 shadow-[0_-20px_50px_rgba(0,0,0,0.1)] z-40 rounded-b-[40px]">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                       <label className="text-[8px] font-bold uppercase tracking-widest text-brand-orange ml-1">Delivery & Return Notes</label>
                       <div className="grid grid-cols-1 gap-2">
                         <textarea
                           rows={1}
                           value={editingBooking.deliveryNotes || ''}
                           onChange={(e) => setEditingBooking({ ...editingBooking, deliveryNotes: e.target.value })}
                           className="w-full p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl text-xs focus:ring-1 focus:ring-emerald-500 outline-none resize-none min-h-[40px] transition-all"
                           placeholder="Start/Delivery note..."
                         />
                         <textarea
                           rows={1}
                           value={editingBooking.returnNote || ''}
                           onChange={(e) => setEditingBooking({ ...editingBooking, returnNote: e.target.value })}
                           className="w-full p-3 bg-amber-500/5 border border-amber-200 rounded-xl text-xs focus:ring-1 focus:ring-amber-500 outline-none resize-none min-h-[40px] transition-all"
                           placeholder="End/Return note..."
                         />
                       </div>
                     </div>
                     <div className="space-y-2">
                       <label className="text-[8px] font-bold uppercase text-gray-400 ml-1">Summary</label>
                       <div className="grid grid-cols-2 gap-2">
                         <div className="bg-black/5 p-3 rounded-2xl">
                           <label className="text-[8px] font-bold uppercase text-brand-orange block mb-1">Amount</label>
                           <input
                             type="number"
                             className="w-full bg-transparent border-0 p-0 text-sm font-bold focus:ring-0 outline-none"
                             value={editingBooking.amount || 0}
                             onChange={(e) => setEditingBooking({ ...editingBooking, amount: Number(e.target.value) })}
                           />
                         </div>
                         <div className="bg-black/5 p-3 rounded-2xl">
                           <label className="text-[8px] font-bold uppercase text-gray-400 block mb-1">Deposit</label>
                           <input
                             type="number"
                             className="w-full bg-transparent border-0 p-0 text-sm font-bold focus:ring-0 outline-none font-mono"
                             value={editingBooking.deposit || 0}
                             onChange={(e) => setEditingBooking({ ...editingBooking, deposit: Number(e.target.value) })}
                           />
                         </div>
                       </div>
                     </div>
                   </div>

                   <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setEditingBooking(null)}
                      disabled={isSubmitting}
                      className="px-8 bg-black/5 border border-black/10 text-gray-600 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-black/10 transition-all disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 bg-[#1A1A1A] text-white py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange transition-all shadow-lg active:translate-y-[2px] active:shadow-none flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <Clock className="animate-spin" size={14} />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      Save Changes
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {deletingBooking && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSubmitting && setDeletingBooking(null)}
              className="absolute inset-0 bg-[#1A1A1A]/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white/90 backdrop-blur-2xl border border-white/60 w-full max-w-sm rounded-[40px] shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto mb-6">
                <AlertCircle size={32} />
              </div>
              <h3 className="font-serif italic text-2xl text-[#1A1A1A] mb-2">Delete Booking?</h3>
              <p className="text-[#1A1A1A]/60 text-sm mb-8 leading-relaxed">
                Are you sure you want to delete the booking for <span className="font-bold text-[#1A1A1A]">{deletingBooking.customerName}</span>? This action cannot be undone.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setDeletingBooking(null)}
                  disabled={isSubmitting}
                  className="bg-white border border-[#1A1A1A]/10 text-[#1A1A1A] py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-[#1A1A1A]/5 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteBooking}
                  disabled={isSubmitting}
                  className="bg-red-500 text-white py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Clock className="animate-spin" size={14} />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {/* Extension Confirmation Prompt */}
        <AnimatePresence>
          {showExtensionPrompt && (
            <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => !isSendingEmail && setShowExtensionPrompt(null)}
                className="absolute inset-0 bg-[#1A1A1A]/20 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white/90 backdrop-blur-2xl border border-white/60 w-full max-w-sm rounded-[40px] shadow-2xl p-8 text-center"
              >
                <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-500 mx-auto mb-6">
                  <Mail size={32} />
                </div>
                <h3 className="font-serif italic text-2xl text-[#1A1A1A] mb-2">Booking Extended</h3>
                <p className="text-[#1A1A1A]/60 text-sm mb-8 leading-relaxed">
                  Would you like to send a confirmation email for this extension to <span className="font-bold text-[#1A1A1A]">{showExtensionPrompt.booking.customerName}</span>?
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setShowExtensionPrompt(null)}
                    disabled={isSendingEmail}
                    className="bg-white border border-[#1A1A1A]/10 text-[#1A1A1A] py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-[#1A1A1A]/5 transition-all disabled:opacity-50"
                  >
                    Skip
                  </button>
                  <button
                    onClick={handleSendExtensionEmail}
                    disabled={isSendingEmail}
                    className="bg-blue-500 text-white py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSendingEmail ? (
                      <Clock className="animate-spin" size={14} />
                    ) : (
                      <Mail size={14} />
                    )}
                    Send Email
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </AnimatePresence>
    </div>
  );
};
