import React, { useState, useMemo, useRef, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addDays, differenceInDays, parseISO, isWithinInterval, startOfDay, endOfDay, isValid } from 'date-fns';
import { Car, Booking, Customer } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Phone, Mail, DollarSign, FileText, Calendar, Trash2, AlertCircle, Search, User, ChevronRight, Bike, Truck as TruckIcon, Car as CarIconType, ShieldCheck } from 'lucide-react';
import { db, OperationType, handleFirestoreError, logSystemActivity } from '../firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { DayPicker, DateRange } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { LocationPicker } from './LocationPicker';

interface TimelineProps {
  cars: Car[];
  bookings: Booking[];
  currentDate: Date;
  newBookingTrigger?: number;
  onLogIncome?: (booking: Booking) => void;
  title?: string;
}

export const Timeline: React.FC<TimelineProps> = ({ cars, bookings, currentDate, newBookingTrigger, onLogIncome, title = "Car Fleet" }) => {
  const [selectedSlot, setSelectedSlot] = useState<{ carId: string; date: Date; slot: 'AM' | 'PM' } | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'view' | 'edit'>('view');
  const [formData, setFormData] = useState<Partial<Booking>>({
    customerName: '',
    mobileNumber: '',
    status: 'Pending',
    amount: 0,
    deposit: 0,
    notes: '',
    deliveryAddress: '',
    deliveryNotes: '',
    deliveryLocation: undefined
  });

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowCustomerSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
    });
    return () => unsubscribe();
  }, []);

  const filteredCustomers = useMemo(() => {
    const search = formData.customerName?.toLowerCase() || '';
    if (!search || !showCustomerSuggestions) return [];
    return customers.filter(c => 
      c.firstName.toLowerCase().includes(search) ||
      c.lastName?.toLowerCase().includes(search) ||
      c.email.toLowerCase().includes(search)
    ).slice(0, 5);
  }, [customers, formData.customerName, showCustomerSuggestions]);

  const handleSelectCustomer = (customer: Customer) => {
    setFormData({
      ...formData,
      customerName: `${customer.firstName} ${customer.lastName || ''}`.trim(),
      email: customer.email,
      mobileNumber: customer.mobileNumber || '',
      deliveryAddress: customer.location?.address || formData.deliveryAddress,
      deliveryLocation: customer.location ? { lat: customer.location.lat, lng: customer.location.lng } : formData.deliveryLocation
    });
    setShowCustomerSuggestions(false);
  };

  const customerInCRM = useMemo(() => {
    if (!editingBooking?.email) return false;
    return customers.some(c => c.email === editingBooking.email);
  }, [customers, editingBooking?.email]);

  const daysInMonth = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSlotClick = (carId: string, date: Date, slot: 'AM' | 'PM') => {
    setSelectedSlot({ carId, date, slot });
    setEditingBooking(null);
    setModalMode('edit');
    setShowDeleteConfirm(false);
    const start = new Date(date);
    start.setHours(slot === 'AM' ? 8 : 14, 0, 0, 0);
    const end = new Date(date);
    end.setHours(slot === 'AM' ? 14 : 20, 0, 0, 0);
    
    setFormData({
      carId: carId === 'unassigned' ? '' : carId,
      customerName: '',
      email: '',
      mobileNumber: '',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status: 'Pending',
      amount: 0,
      notes: '',
      deliveryAddress: '',
      deliveryNotes: '',
      deliveryLocation: undefined
    });
    setDateRange({ from: start, to: end });
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (newBookingTrigger && newBookingTrigger > 0) {
      handleSlotClick('unassigned', new Date(), 'AM');
    }
  }, [newBookingTrigger]);

  const handleBookingClick = (booking: Booking) => {
    setEditingBooking(booking);
    setFormData({ 
      ...booking,
      deliveryAddress: booking.deliveryAddress || '',
      deliveryNotes: booking.deliveryNotes || '',
      deliveryLocation: booking.deliveryLocation
    });
    setModalMode('view');
    setShowDeleteConfirm(false);
    setDateRange({ 
      from: parseISO(booking.startDate), 
      to: parseISO(booking.endDate) 
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const dataToSave = {
        ...formData,
        startDate: dateRange?.from?.toISOString() || formData.startDate,
        endDate: dateRange?.to?.toISOString() || dateRange?.from?.toISOString() || formData.endDate,
      };

      if (editingBooking) {
        await updateDoc(doc(db, 'bookings', editingBooking.id), dataToSave);
        
        // Update customer location in CRM if email exists
        if (dataToSave.email && dataToSave.deliveryLocation) {
          const customerQuery = query(collection(db, 'customers'), where('email', '==', dataToSave.email));
          const customerSnapshot = await getDocs(customerQuery);
          if (!customerSnapshot.empty) {
            await updateDoc(doc(db, 'customers', customerSnapshot.docs[0].id), {
              location: {
                ...dataToSave.deliveryLocation,
                address: dataToSave.deliveryAddress
              }
            });
          }
        }

        const car = cars.find(c => c.id === dataToSave.carId);
        await logSystemActivity(
          'Update Booking (Timeline)',
          `Updated booking for ${dataToSave.customerName} (${car?.name || 'Unknown Car'})`,
          'Bookings',
          { bookingId: editingBooking.id, customerName: dataToSave.customerName }
        );

        toast.success('Booking updated');
      } else {
        // Check if customer exists in CRM
        if (dataToSave.email) {
          const customerQuery = query(collection(db, 'customers'), where('email', '==', dataToSave.email));
          const customerSnapshot = await getDocs(customerQuery);
          
          if (customerSnapshot.empty) {
            // Log new customer to CRM
            const names = (dataToSave.customerName || '').split(' ');
            const firstName = names[0] || 'New';
            const lastName = names.slice(1).join(' ') || 'Customer';
            
            try {
              await addDoc(collection(db, 'customers'), {
                firstName,
                lastName,
                email: dataToSave.email,
                mobileNumber: dataToSave.mobileNumber || '',
                createdAt: new Date().toISOString(),
                location: dataToSave.deliveryLocation ? {
                  ...dataToSave.deliveryLocation,
                  address: dataToSave.deliveryAddress
                } : undefined
              });
              toast.success('New customer added to CRM');
            } catch (err) {
              console.error("Error adding customer to CRM:", err);
            }
          } else {
            // Update existing customer location if provided
            if (dataToSave.deliveryLocation) {
              const customerDoc = customerSnapshot.docs[0];
              await updateDoc(doc(db, 'customers', customerDoc.id), {
                location: {
                  ...dataToSave.deliveryLocation,
                  address: dataToSave.deliveryAddress
                }
              });
            }
          }
        }

        const docRef = await addDoc(collection(db, 'bookings'), dataToSave);
        
        const car = cars.find(c => c.id === dataToSave.carId);
        await logSystemActivity(
          'New Booking (Timeline)',
          `Created new booking for ${dataToSave.customerName} (${car?.name || 'Unknown Car'})`,
          'Bookings',
          { bookingId: docRef.id, customerName: dataToSave.customerName }
        );

        toast.success('Booking created');
      }
      setIsModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    }
  };

  const handleDeleteBooking = async () => {
    if (!editingBooking) return;
    try {
      await deleteDoc(doc(db, 'bookings', editingBooking.id));
      
      const car = cars.find(c => c.id === editingBooking.carId);
      await logSystemActivity(
        'Delete Booking (Timeline)',
        `Deleted booking for ${editingBooking.customerName} (${car?.name || 'Unknown Car'})`,
        'Bookings',
        { bookingId: editingBooking.id, customerName: editingBooking.customerName }
      );

      setIsModalOpen(false);
      setShowDeleteConfirm(false);
      toast.success('Booking deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `bookings/${editingBooking.id}`);
    }
  };

  // Drag and Drop Logic (Simplified for this dashboard)
  const [draggedBooking, setDraggedBooking] = useState<Booking | null>(null);
  const [dropPreview, setDropPreview] = useState<{ carId: string; date: Date; slot: 'AM' | 'PM' } | null>(null);

  const [hoveredBooking, setHoveredBooking] = useState<{ booking: Booking; x: number; y: number } | null>(null);

  const handleDragStart = (e: React.DragEvent, booking: Booking) => {
    setDraggedBooking(booking);
    e.dataTransfer.setData('bookingId', booking.id);
  };

  const handleDragEnd = () => {
    setDraggedBooking(null);
    setDropPreview(null);
  };

  const handleDrop = async (e: React.DragEvent, carId: string, date: Date, slot: 'AM' | 'PM') => {
    e.preventDefault();
    setDropPreview(null);
    if (!draggedBooking) return;

    const start = parseISO(draggedBooking.startDate);
    const end = parseISO(draggedBooking.endDate);
    const durationMs = end.getTime() - start.getTime();

    const newStart = new Date(date);
    newStart.setHours(slot === 'AM' ? 8 : 14, 0, 0, 0);
    const newEnd = new Date(newStart.getTime() + durationMs);

    try {
      const newCarId = carId === 'unassigned' ? '' : carId;
      await updateDoc(doc(db, 'bookings', draggedBooking.id), {
        carId: newCarId,
        startDate: newStart.toISOString(),
        endDate: newEnd.toISOString()
      });

      const car = cars.find(c => c.id === newCarId);
      const oldCar = cars.find(c => c.id === draggedBooking.carId);
      
      let logMessage = `Rescheduled booking for ${draggedBooking.customerName}`;
      if (draggedBooking.carId !== newCarId) {
        const from = oldCar?.name || 'Unassigned';
        const to = car?.name || 'Unassigned';
        logMessage = `Moved booking for ${draggedBooking.customerName} from ${from} to ${to}`;
      }

      await logSystemActivity(
        'Update Booking (Timeline Drag)',
        logMessage,
        'Bookings',
        { 
          bookingId: draggedBooking.id, 
          customerName: draggedBooking.customerName,
          fromCarId: draggedBooking.carId,
          toCarId: newCarId
        }
      );

      toast.success('Booking rescheduled');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${draggedBooking.id}`);
    }
    setDraggedBooking(null);
  };

  const getCarTypeStyles = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('economy') || t.includes('small')) return { color: 'text-blue-500', bg: 'bg-blue-500', icon: CarIconType };
    if (t.includes('sedan') || t.includes('medium')) return { color: 'text-emerald-500', bg: 'bg-emerald-500', icon: CarIconType };
    if (t.includes('suv') || t.includes('large')) return { color: 'text-purple-500', bg: 'bg-purple-500', icon: CarIconType };
    if (t.includes('truck') || t.includes('van')) return { color: 'text-amber-500', bg: 'bg-amber-500', icon: TruckIcon };
    if (t.includes('luxury')) return { color: 'text-rose-500', bg: 'bg-rose-500', icon: CarIconType };
    if (t.includes('bike') || t.includes('motor')) return { color: 'text-indigo-500', bg: 'bg-indigo-500', icon: Bike };
    return { color: 'text-gray-500', bg: 'bg-gray-500', icon: CarIconType };
  };

  const getBookingStyle = (booking: Booking) => {
    const start = parseISO(booking.startDate);
    const end = parseISO(booking.endDate);
    
    if (!isValid(start) || !isValid(end)) return null;

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);

    // Filter bookings that overlap with current month
    if (end < monthStart || start > monthEnd) return null;

    const visibleStart = start < monthStart ? monthStart : start;
    const visibleEnd = end > monthEnd ? monthEnd : end;

    const startDayIdx = differenceInDays(visibleStart, monthStart);
    const startSlot = visibleStart.getHours() >= 14 ? 1 : 0;
    const totalSlots = differenceInDays(visibleEnd, visibleStart) * 2 + (visibleEnd.getHours() >= 14 ? 1 : 0) - (visibleStart.getHours() >= 14 ? 1 : 0);

    return {
      left: `${(startDayIdx * 2 + startSlot) * 36}px`,
      width: `${Math.max(totalSlots, 1) * 36}px`,
      backgroundColor: (!booking.carId || booking.carId === 'unassigned') ? '#EAB308' : (booking.status === 'Paid' ? '#10B981' : '#FF6321')
    };
  };

  const getDropPreviewStyle = (preview: { carId: string; date: Date; slot: 'AM' | 'PM' }, booking: Booking) => {
    const start = parseISO(booking.startDate);
    const end = parseISO(booking.endDate);
    const durationMs = end.getTime() - start.getTime();
    
    const previewStart = new Date(preview.date);
    previewStart.setHours(preview.slot === 'AM' ? 8 : 14, 0, 0, 0);
    const previewEnd = new Date(previewStart.getTime() + durationMs);

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);

    if (previewEnd < monthStart || previewStart > monthEnd) return null;

    const visibleStart = previewStart < monthStart ? monthStart : previewStart;
    const visibleEnd = previewEnd > monthEnd ? monthEnd : previewEnd;

    const startDayIdx = differenceInDays(visibleStart, monthStart);
    const startSlot = visibleStart.getHours() >= 14 ? 1 : 0;
    const totalSlots = differenceInDays(visibleEnd, visibleStart) * 2 + (visibleEnd.getHours() >= 14 ? 1 : 0) - (visibleStart.getHours() >= 14 ? 1 : 0);

    return {
      left: `${(startDayIdx * 2 + startSlot) * 36}px`,
      width: `${Math.max(totalSlots, 1) * 36}px`,
    };
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-warm-bg">
      <div className="flex-1 overflow-auto custom-scrollbar relative">
        <div className="inline-block min-w-full">
          {/* Timeline Header */}
          <div className="flex sticky top-0 z-30 bg-white/40 backdrop-blur-xl">
            <div className="w-80 flex-shrink-0 border-r border-b border-white/40 bg-white/60 sticky left-0 z-40 p-4 flex items-center justify-between backdrop-blur-md">
              <span className="font-serif italic text-sm text-[#1A1A1A]">{title}</span>
            </div>
            <div className="flex">
              {daysInMonth.map(day => (
                <div key={day.toISOString()} className="w-[72px] flex-shrink-0 border-r border-b border-white/40 bg-white/20">
                  <div className="text-center py-1 text-[9px] font-bold uppercase tracking-wider bg-brand-orange/5 text-brand-orange">
                    {format(day, 'EEE d')}
                  </div>
                  <div className="flex text-[8px] font-bold text-center border-t border-white/20 text-[#1A1A1A]/60">
                    <div className="w-1/2 py-1 border-r border-white/20">AM</div>
                    <div className="w-1/2 py-1">PM</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline Body */}
          <div className="relative">
            {/* Unassigned Row */}
            <div className="flex group h-6 bg-brand-orange/5">
              <div className="w-80 flex-shrink-0 border-r border-b border-white/40 bg-white/60 sticky left-0 z-20 px-3 py-0 flex items-center gap-2 backdrop-blur-md group-hover:bg-brand-orange/10 transition-colors">
                <div className="w-1 h-full absolute left-0 bg-brand-orange" />
                <AlertCircle size={10} className="shrink-0 text-brand-orange" />
                <span className="text-[10px] font-bold text-brand-orange truncate leading-tight uppercase tracking-widest">Unassigned Bookings</span>
              </div>
              <div className="flex relative">
                {daysInMonth.map(day => (
                  <React.Fragment key={day.toISOString()}>
                    <div
                      className="w-[36px] flex-shrink-0 border-r border-b border-white/40 group-hover:bg-brand-orange/10 transition-colors cursor-pointer"
                      onClick={() => handleSlotClick('unassigned', day, 'AM')}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (draggedBooking) setDropPreview({ carId: 'unassigned', date: day, slot: 'AM' });
                      }}
                      onDragLeave={() => setDropPreview(null)}
                      onDrop={(e) => handleDrop(e, 'unassigned', day, 'AM')}
                    />
                    <div
                      className="w-[36px] flex-shrink-0 border-r border-b border-white/40 group-hover:bg-brand-orange/10 transition-colors cursor-pointer"
                      onClick={() => handleSlotClick('unassigned', day, 'PM')}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (draggedBooking) setDropPreview({ carId: 'unassigned', date: day, slot: 'PM' });
                      }}
                      onDragLeave={() => setDropPreview(null)}
                      onDrop={(e) => handleDrop(e, 'unassigned', day, 'PM')}
                    />
                  </React.Fragment>
                ))}

                {/* Unassigned Bookings */}
                {dropPreview && dropPreview.carId === 'unassigned' && draggedBooking && (
                  <div
                    className="absolute h-4 top-1 rounded-md border-2 border-dashed border-brand-orange/50 bg-brand-orange/10 pointer-events-none z-0"
                    style={getDropPreviewStyle(dropPreview, draggedBooking) || {}}
                  />
                )}
                {bookings.filter(b => !b.carId || b.carId === '').map(booking => {
                  const style = getBookingStyle(booking);
                  if (!style) return null;
                  return (
                    <div
                      key={booking.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e as any, booking)}
                      onDragEnd={handleDragEnd}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredBooking({ 
                          booking, 
                          x: rect.left, 
                          y: rect.bottom 
                        });
                      }}
                      onMouseLeave={() => setHoveredBooking(null)}
                      onClick={(e) => { e.stopPropagation(); handleBookingClick(booking); }}
                      className="absolute h-4 top-1 rounded-md shadow-sm cursor-pointer z-10 px-1.5 py-0 flex flex-col justify-center overflow-hidden border border-white/20 backdrop-blur-sm"
                      style={{
                        ...style,
                        color: 'white'
                      }}
                    >
                      <span className="text-[8px] font-bold truncate leading-none">
                        {booking.customerName}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {cars.map(car => {
              const typeStyles = getCarTypeStyles(car.type || car.category || '');
              const Icon = typeStyles.icon;
              
              return (
                <div key={car.id} className="flex group h-6">
                  <div className="w-80 flex-shrink-0 border-r border-b border-white/40 bg-white/60 sticky left-0 z-20 px-3 py-0 flex items-center gap-2 backdrop-blur-md group-hover:bg-brand-orange/5 transition-colors">
                    <div className={cn("w-1 h-full absolute left-0", typeStyles.bg)} />
                    <Icon size={10} className={cn("shrink-0", typeStyles.color)} />
                    <span className="text-[10px] font-bold text-[#1A1A1A] truncate leading-tight">{car.name}</span>
                    <span className="text-[8px] text-[#1A1A1A]/60 font-mono leading-tight">{car.plateNumber}</span>
                  </div>
                  <div className="flex relative">
                    {daysInMonth.map(day => (
                      <React.Fragment key={day.toISOString()}>
                        <div
                          className="w-[36px] flex-shrink-0 border-r border-b border-white/40 group-hover:bg-brand-orange/5 transition-colors cursor-pointer"
                          onClick={() => handleSlotClick(car.id, day, 'AM')}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggedBooking) setDropPreview({ carId: car.id, date: day, slot: 'AM' });
                          }}
                          onDragLeave={() => setDropPreview(null)}
                          onDrop={(e) => handleDrop(e, car.id, day, 'AM')}
                        />
                        <div
                          className="w-[36px] flex-shrink-0 border-r border-b border-white/40 group-hover:bg-brand-orange/5 transition-colors cursor-pointer"
                          onClick={() => handleSlotClick(car.id, day, 'PM')}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggedBooking) setDropPreview({ carId: car.id, date: day, slot: 'PM' });
                          }}
                          onDragLeave={() => setDropPreview(null)}
                          onDrop={(e) => handleDrop(e, car.id, day, 'PM')}
                        />
                      </React.Fragment>
                    ))}

                    {/* Bookings for this car */}
                    {dropPreview && dropPreview.carId === car.id && draggedBooking && (
                      <div
                        className="absolute h-4 top-1 rounded-md border-2 border-dashed border-brand-orange/50 bg-brand-orange/10 pointer-events-none z-0"
                        style={getDropPreviewStyle(dropPreview, draggedBooking) || {}}
                      />
                    )}
                    {bookings.filter(b => b.carId === car.id).map(booking => {
                      const style = getBookingStyle(booking);
                      if (!style) return null;
                      return (
                        <div
                          key={booking.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e as any, booking)}
                          onDragEnd={handleDragEnd}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredBooking({ 
                              booking, 
                              x: rect.left, 
                              y: rect.bottom 
                            });
                          }}
                          onMouseLeave={() => setHoveredBooking(null)}
                          onClick={(e) => { e.stopPropagation(); handleBookingClick(booking); }}
                          className="absolute h-4 top-1 rounded-md shadow-sm cursor-pointer z-10 px-1.5 py-0 flex flex-col justify-center overflow-hidden border border-white/20 backdrop-blur-sm"
                          style={{
                            ...style,
                            color: 'white'
                          }}
                        >
                          <span className="text-[8px] font-bold truncate leading-none">
                            {booking.customerName}
                          </span>
                          <span className="text-[6px] opacity-80 font-medium truncate leading-none mt-0.5">
                            {isValid(parseISO(booking.startDate)) && isValid(parseISO(booking.endDate)) ? (
                              `${format(parseISO(booking.startDate), 'HH:mm')} - ${format(parseISO(booking.endDate), 'HH:mm')}`
                            ) : 'Invalid dates'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {bookings.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-white/40 backdrop-blur-md p-8 border border-white/60 rounded-[32px] flex flex-col items-center gap-4 shadow-xl">
                  <AlertCircle size={48} className="text-brand-orange/20" />
                  <p className="text-sm font-serif italic text-[#1A1A1A]/40">No bookings scheduled for this month.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {hoveredBooking && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="fixed z-[200] pointer-events-none"
            style={{
              left: hoveredBooking.x,
              top: hoveredBooking.y + 10,
              transform: 'translateY(0)'
            }}
          >
            <div className="bg-white/90 backdrop-blur-2xl border border-white/40 shadow-2xl rounded-2xl p-4 min-w-[240px] relative">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="text-sm font-bold text-[#1A1A1A]">{hoveredBooking.booking.customerName}</h4>
                  <p className="text-[10px] text-[#1A1A1A]/60 font-medium">{hoveredBooking.booking.email || 'No email'}</p>
                  <p className="text-[9px] font-bold text-brand-orange uppercase tracking-widest mt-1">
                    {hoveredBooking.booking.carId 
                      ? cars.find(c => c.id === hoveredBooking.booking.carId)?.name 
                      : (hoveredBooking.booking.requestedCarType || 'Unassigned')}
                  </p>
                </div>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                  (!hoveredBooking.booking.carId || hoveredBooking.booking.carId === 'unassigned') ? "bg-yellow-100 text-yellow-600" : (hoveredBooking.booking.status === 'Paid' ? "bg-green-100 text-green-600" : "bg-orange-100 text-orange-600")
                )}>
                  {hoveredBooking.booking.status}
                </span>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[10px] text-[#1A1A1A]/80">
                  <Calendar size={12} className="text-brand-orange" />
                  <span>
                    {isValid(parseISO(hoveredBooking.booking.startDate)) && isValid(parseISO(hoveredBooking.booking.endDate)) ? (
                      `${format(parseISO(hoveredBooking.booking.startDate), 'MMM d, HH:mm')} - ${format(parseISO(hoveredBooking.booking.endDate), 'MMM d, HH:mm')}`
                    ) : 'Invalid dates'}
                  </span>
                </div>
                
                {hoveredBooking.booking.mobileNumber && (
                  <div className="flex items-center gap-2 text-[10px] text-[#1A1A1A]/80">
                    <Phone size={12} className="text-brand-orange" />
                    <span>{hoveredBooking.booking.mobileNumber}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-[#1A1A1A]/5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Total Amount</span>
                  <span className="text-sm font-bold text-brand-orange">
                    ฿{(hoveredBooking.booking.amount || 0).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Arrow */}
              <div className="absolute top-0 left-4 -translate-y-full w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-white/90" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Booking Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-bg/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-white/60 backdrop-blur-xl border border-white/40 p-8 max-w-2xl w-full shadow-2xl rounded-[40px] overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h2 className="font-serif italic text-3xl text-gray-900">
                    {showDeleteConfirm ? 'Confirm Deletion' : (modalMode === 'view' ? 'Booking Details' : (editingBooking ? 'Edit Booking' : 'New Booking'))}
                  </h2>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1 ml-1">
                    {formData.carId ? (
                      <>
                        {cars.find(c => c.id === formData.carId)?.name} • {cars.find(c => c.id === formData.carId)?.plateNumber}
                      </>
                    ) : (
                      <span className="text-brand-orange">Unassigned Vehicle</span>
                    )}
                  </p>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/40 hover:bg-brand-orange hover:text-white transition-all shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>

              {showDeleteConfirm ? (
                <div className="space-y-8 py-4">
                  <div className="text-center space-y-4">
                    <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
                      <Trash2 size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Confirm Deletion</h3>
                    <p className="text-sm text-gray-500 max-w-xs mx-auto">
                      Are you sure you want to delete the booking for <span className="font-bold text-gray-900">{editingBooking?.customerName}</span>? This action cannot be undone.
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="flex-1 py-4 border border-white/60 bg-white/40 rounded-3xl font-bold uppercase tracking-widest text-[10px] hover:bg-white/60 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteBooking}
                      className="flex-1 bg-red-500 text-white py-4 rounded-3xl font-bold uppercase tracking-widest text-[10px] hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                    >
                      Delete Permanently
                    </button>
                  </div>
                </div>
              ) : modalMode === 'view' && editingBooking ? (
                <div className="space-y-8">
                  {editingBooking.email && !customerInCRM && (
                    <div className="bg-brand-orange/10 border border-brand-orange/30 p-5 rounded-3xl flex items-center justify-between gap-4 backdrop-blur-md">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-brand-orange flex items-center justify-center shadow-lg shadow-brand-orange/20">
                          <User size={24} className="text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">New Customer Detected</p>
                          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Not in your CRM yet</p>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          const names = (editingBooking.customerName || '').split(' ');
                          const firstName = names[0] || 'New';
                          const lastName = names.slice(1).join(' ') || 'Customer';
                          
                          try {
                            await addDoc(collection(db, 'customers'), {
                              firstName,
                              lastName,
                              email: editingBooking.email,
                              mobileNumber: editingBooking.mobileNumber || '',
                              createdAt: new Date().toISOString()
                            });
                            toast.success('Customer added to CRM');
                          } catch (err) {
                            console.error("Error adding customer to CRM:", err);
                            toast.error('Failed to add customer');
                          }
                        }}
                        className="h-10 px-6 bg-brand-orange text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange/90 transition-all shadow-md shadow-brand-orange/20"
                      >
                        Add to CRM
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Customer</p>
                      <p className="text-lg font-bold text-gray-900 bg-white/40 p-3 rounded-2xl border border-white/60">{editingBooking.customerName}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Email</p>
                      <p className="text-lg font-bold text-gray-900 bg-white/40 p-3 rounded-2xl border border-white/60 truncate">{editingBooking.email || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Mobile</p>
                      <p className="text-lg font-bold text-gray-900 bg-white/40 p-3 rounded-2xl border border-white/60">{editingBooking.mobileNumber || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Vehicle</p>
                      <p className="text-lg font-bold text-gray-900 bg-white/40 p-3 rounded-2xl border border-white/60">
                        {editingBooking.carId 
                          ? cars.find(c => c.id === editingBooking.carId)?.name || 'Unknown Car'
                          : (editingBooking.requestedCarType || 'Unassigned')}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Status</p>
                      <div className="h-[52px] flex items-center">
                        <span className={cn(
                          "px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-full border border-white/40 shadow-sm",
                          (!editingBooking.carId || editingBooking.carId === 'unassigned') ? "bg-yellow-500 text-white" : (editingBooking.status === 'Paid' ? "bg-emerald-500 text-white" : "bg-brand-orange text-white")
                        )}>
                          {editingBooking.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Start Date</p>
                      <p className="text-sm font-medium text-gray-900 bg-white/40 p-3 rounded-2xl border border-white/60">
                        {isValid(parseISO(editingBooking.startDate)) ? format(parseISO(editingBooking.startDate), 'PPP p') : 'Invalid Date'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">End Date</p>
                      <p className="text-sm font-medium text-gray-900 bg-white/40 p-3 rounded-2xl border border-white/60">
                        {isValid(parseISO(editingBooking.endDate)) ? format(parseISO(editingBooking.endDate), 'PPP p') : 'Invalid Date'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Amount</p>
                    <p className="text-2xl font-bold text-brand-orange bg-white/40 p-4 rounded-2xl border border-white/60">
                      {editingBooking.amount ? `${editingBooking.amount.toLocaleString()} THB` : '0 THB'}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Deposit Held</p>
                    <p className="text-2xl font-bold text-emerald-600 bg-white/40 p-4 rounded-2xl border border-white/60">
                      {editingBooking.deposit ? `${editingBooking.deposit.toLocaleString()} THB` : '0 THB'}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Notes</p>
                    <p className="text-sm text-gray-700 bg-white/40 p-4 rounded-2xl border border-white/60 min-h-[100px] leading-relaxed">
                      {editingBooking.notes || 'No notes provided.'}
                    </p>
                  </div>

                  {editingBooking.deliveryAddress && (
                    <div className="space-y-4 pt-4 border-t border-white/20">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-brand-orange/10 flex items-center justify-center">
                          <TruckIcon size={16} className="text-brand-orange" />
                        </div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Delivery Details</h4>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Delivery Address</p>
                          <p className="text-sm font-bold text-gray-900 bg-white/40 p-3 rounded-2xl border border-white/60">{editingBooking.deliveryAddress}</p>
                        </div>
                        {editingBooking.deliveryLocation && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Location Map</p>
                            <LocationPicker 
                              location={editingBooking.deliveryLocation} 
                              onChange={() => {}} 
                              disabled={true} 
                            />
                          </div>
                        )}
                        {editingBooking.deliveryNotes && (
                          <div className="p-4 bg-brand-orange/5 border border-brand-orange/10 rounded-2xl">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-2">Delivery Notes (Internal)</p>
                            <p className="text-sm text-gray-700 italic leading-relaxed">{editingBooking.deliveryNotes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4 pt-4">
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="h-12 px-6 border border-red-500/30 text-red-500 bg-red-500/5 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-[10px] rounded-full"
                    >
                      <Trash2 size={16} /> Delete
                    </button>
                    <button
                      onClick={() => setModalMode('edit')}
                      className="flex-1 bg-gray-900 text-white h-12 rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-gray-800 transition-all shadow-lg active:translate-y-[2px] active:shadow-none"
                    >
                      Edit Booking
                    </button>
                  </div>
                  {onLogIncome && (
                    <button
                      onClick={() => onLogIncome(editingBooking)}
                      className="w-full mt-4 h-12 border border-emerald-500/30 text-emerald-600 bg-emerald-500/5 rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <DollarSign size={16} /> Log Payment to Finance
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2"><FileText size={12} /> Customer Name</span>
                          {formData.customerName && (
                            <span className="text-[8px] text-emerald-500 font-bold">Search results below</span>
                          )}
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-medium focus:border-brand-orange outline-none transition-all"
                            value={formData.customerName}
                            onChange={e => {
                              setFormData({ ...formData, customerName: e.target.value });
                              setShowCustomerSuggestions(true);
                            }}
                            onFocus={() => setShowCustomerSuggestions(true)}
                            placeholder="Enter name or search existing..."
                            required
                          />
                          <AnimatePresence>
                            {showCustomerSuggestions && filteredCustomers.length > 0 && (
                              <motion.div
                                ref={suggestionsRef}
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="absolute z-50 left-0 right-0 mt-2 bg-white/90 backdrop-blur-xl border border-white/60 shadow-2xl rounded-2xl max-h-48 overflow-y-auto"
                              >
                                {filteredCustomers.map(customer => (
                                  <button
                                    key={customer.id}
                                    type="button"
                                    onClick={() => handleSelectCustomer(customer)}
                                    className="w-full p-3 text-left hover:bg-brand-orange hover:text-white flex items-center justify-between border-b border-white/20 last:border-0 transition-colors"
                                  >
                                    <div>
                                      <p className="text-xs font-bold">{customer.firstName} {customer.lastName}</p>
                                      <p className="text-[10px] opacity-60">{customer.email}</p>
                                    </div>
                                    <ChevronRight size={14} className="opacity-40" />
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                          <Mail size={12} /> Email Address
                        </label>
                        <input
                          type="email"
                          className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-medium focus:border-brand-orange outline-none transition-all"
                          value={formData.email}
                          onChange={e => setFormData({ ...formData, email: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                          <Phone size={12} /> Mobile Number
                        </label>
                        <input
                          type="text"
                          className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-medium focus:border-brand-orange outline-none transition-all"
                          value={formData.mobileNumber}
                          onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                          <DollarSign size={12} /> Amount (THB)
                        </label>
                        <input
                          type="number"
                          className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-bold focus:border-brand-orange outline-none transition-all"
                          value={formData.amount}
                          onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                          <ShieldCheck size={12} /> Deposit Held (THB)
                        </label>
                        <input
                          type="number"
                          className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-bold focus:border-brand-orange outline-none transition-all"
                          value={formData.deposit}
                          onChange={e => setFormData({ ...formData, deposit: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                          <CarIconType size={12} /> Assigned Vehicle
                        </label>
                        <div className="relative">
                          <select
                            className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-medium focus:border-brand-orange outline-none transition-all appearance-none pr-10"
                            value={formData.carId || ''}
                            onChange={e => setFormData({ ...formData, carId: e.target.value })}
                          >
                            <option value="">Unassigned</option>
                            {cars.map(car => (
                              <option key={car.id} value={car.id}>
                                {car.name} • {car.plateNumber}
                              </option>
                            ))}
                          </select>
                          <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none opacity-40" size={16} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Status</label>
                        <div className="flex gap-2">
                          {['Paid', 'Pending'].map(s => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setFormData({ ...formData, status: s as any })}
                              className={cn(
                                "flex-1 h-10 text-[10px] font-bold uppercase tracking-widest border transition-all rounded-full",
                                formData.status === s
                                  ? "bg-brand-orange text-white border-brand-orange shadow-lg shadow-brand-orange/20"
                                  : "bg-white/40 border-white/60 text-gray-400 hover:border-brand-orange/40"
                              )}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                        <Calendar size={12} /> Select Dates
                      </label>
                      <div className="border border-white/60 p-2 rounded-3xl bg-white/40 backdrop-blur-md shadow-inner">
                        <DayPicker
                          mode="range"
                          selected={dateRange}
                          onSelect={setDateRange}
                          className="m-0"
                          styles={{
                            caption: { color: '#1A1A1A', fontFamily: 'Georgia, serif', fontStyle: 'italic' },
                            head_cell: { color: '#1A1A1A', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' },
                            day: { fontSize: '12px' },
                            day_selected: { backgroundColor: '#FF6321', color: 'white' },
                            day_today: { fontWeight: 'bold', color: '#FF6321', textDecoration: 'underline' }
                          }}
                        />
                      </div>
                      {dateRange?.from && (
                        <div className="mt-2 p-3 bg-brand-orange/10 rounded-2xl text-[10px] font-bold uppercase tracking-widest flex justify-between text-brand-orange backdrop-blur-sm border border-brand-orange/20">
                          <span>{format(dateRange.from, 'PP')}</span>
                          {dateRange.to && (
                            <>
                              <span>→</span>
                              <span>{format(dateRange.to, 'PP')}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Notes</label>
                    <textarea
                      className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm focus:border-brand-orange outline-none transition-all h-24 resize-none"
                      value={formData.notes}
                      onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    />
                  </div>

                  <div className="space-y-6 pt-6 border-t border-white/20">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-brand-orange/10 flex items-center justify-center">
                        <TruckIcon size={16} className="text-brand-orange" />
                      </div>
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Delivery Details</h4>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Delivery Address</label>
                          <input
                            type="text"
                            className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-medium focus:border-brand-orange outline-none transition-all"
                            value={formData.deliveryAddress}
                            onChange={e => setFormData({ ...formData, deliveryAddress: e.target.value })}
                            placeholder="Enter delivery address..."
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Delivery Notes (Internal)</label>
                          <textarea
                            className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm focus:border-brand-orange outline-none transition-all h-32 resize-none"
                            value={formData.deliveryNotes}
                            onChange={e => setFormData({ ...formData, deliveryNotes: e.target.value })}
                            placeholder="Add internal notes for delivery..."
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex items-center justify-between ml-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Pin Location on Map</label>
                          {editingBooking?.deliveryLocation && (
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, deliveryLocation: editingBooking.deliveryLocation })}
                              className="text-[8px] font-bold uppercase tracking-widest text-brand-orange hover:underline"
                            >
                              Reset Location
                            </button>
                          )}
                        </div>
                        <LocationPicker 
                          location={formData.deliveryLocation} 
                          onChange={(loc) => setFormData({ ...formData, deliveryLocation: loc })} 
                        />
                        <p className="text-[8px] text-gray-400 italic ml-4 mt-1">Click on the map or drag the pin to set delivery location</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4 pt-4">
                    {editingBooking && (
                      <button
                        type="button"
                        onClick={() => setModalMode('view')}
                        className="px-8 h-12 border border-white/60 bg-white/40 text-gray-600 font-bold uppercase tracking-widest text-[10px] rounded-full hover:bg-white/60 transition-all"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      className="flex-1 bg-brand-orange text-white h-12 rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 active:translate-y-[2px] active:shadow-none"
                    >
                      {editingBooking ? 'Save Changes' : 'Create Booking'}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
