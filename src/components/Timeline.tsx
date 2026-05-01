import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addDays, differenceInDays, parseISO, isWithinInterval, startOfDay, endOfDay, isValid, isFuture } from 'date-fns';
import { Car, Booking, Customer } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Phone, Mail, DollarSign, FileText, Calendar, Trash2, AlertCircle, Search, User, ChevronRight, Bike, Truck as TruckIcon, Car as CarIconType, ShieldCheck, Clipboard, Scissors, Loader2, Lock, Wrench, Settings, Check, Zap, ChevronLeft } from 'lucide-react';
import { db, OperationType, handleFirestoreError, logSystemActivity, auth, safeGetDocs, getDocs } from '../firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { safeLocalStorage } from '../lib/storage';
import { DayPicker, DateRange } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { LocationPicker } from './LocationPicker';
import { ImportantInfoModal } from './ImportantInfoModal';
import { DatePickerCustom } from './ui/DatePickerCustom';

interface TimelineProps {
  cars: Car[];
  bookings: Booking[];
  currentDate: Date;
  newBookingTrigger?: number;
  onLogIncome?: (booking: Booking) => void;
  onRefresh?: () => void;
  title?: string;
}

interface CarRowProps {
  car: Car;
  daysInMonth: Date[];
  bookings: Booking[];
  handleRowClick: (e: React.MouseEvent, carId: string) => void;
  handleRowContextMenu: (e: React.MouseEvent, carId: string) => void;
  getBookingStyle: (booking: Booking) => any;
  handleMouseEnterBooking: (booking: Booking, e: React.MouseEvent) => void;
  handleMouseLeaveBooking: () => void;
  handleBookingClick: (booking: Booking) => void;
  handleBookingContextMenu: (e: React.MouseEvent, booking: Booking) => void;
  getCarTypeStyles: (type: string) => any;
  onManageBooking: (booking: Booking) => void;
}

const ManageRentalModal: React.FC<{
  booking: Booking;
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
  carName: string;
}> = ({ booking, isOpen, onClose, onRefresh, carName }) => {
  const [loading, setLoading] = useState(false);
  const [extraCharges, setExtraCharges] = useState<number>(0);
  const [extraReason, setExtraReason] = useState('');
  const [extensionPayment, setExtensionPayment] = useState<number>(0);
  const [extensionDays, setExtensionDays] = useState<number>(1);

  if (!isOpen) return null;

  const handleEndRental = async () => {
    setLoading(true);
    try {
      // 1. Update Booking Status
      await updateDoc(doc(db, 'bookings', booking.id), {
        status: 'Completed'
      });

      // 2. Log Extra Charges to Finance if > 0
      if (extraCharges > 0) {
        const accs = await getDocs(collection(db, 'accounts'));
        const defaultAcc = accs.docs.find(d => d.data().name === 'Cash Car')?.id || accs.docs[0]?.id || 'unknown';
        
        await addDoc(collection(db, 'transactions'), {
          type: 'Income',
          amount: Number(extraCharges),
          date: new Date().toISOString(),
          category: 'Extra Charges',
          carId: booking.carId,
          bookingId: booking.id,
          accountId: defaultAcc,
          description: `Extra charges for ${booking.customerName}: ${extraReason}`
        });
      }

      // 3. Send Email
      const emailHtml = `
        <div style="font-family: serif; padding: 40px; background-color: #f9f7f2; color: #1a1a1a;">
          <h1 style="italic; font-size: 24px;">Rental Return Confirmation</h1>
          <p style="text-transform: uppercase; letter-spacing: 2px; font-size: 10px; font-weight: bold; color: #666;">Pattaya Rent a Car</p>
          <div style="margin-top: 40px; background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">
            <p>Dear <strong>${booking.customerName}</strong>,</p>
            <p>Thank you for choosing Pattaya Rent a Car. Your rental of <strong>${carName}</strong> has been successfully completed.</p>
            ${extraCharges > 0 ? `
              <div style="margin-top: 20px; padding: 20px; background: #fff5f0; border-radius: 12px; border-left: 4px solid #ff5a00;">
                <p style="margin: 0; font-weight: bold; color: #ff5a00;">Extra Charges Applied</p>
                <p style="margin: 5px 0 0 0; font-size: 18px;">${extraCharges.toLocaleString()} THB</p>
                <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.6;">Reason: ${extraReason}</p>
              </div>
            ` : ''}
            <p style="margin-top: 30px;">We hope you had a pleasant experience. See you again soon!</p>
          </div>
        </div>
      `;

      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: booking.email || 'info@pattayarentacar.com',
          subject: `Rental Return Confirmation - ${carName} - Pattaya Rent a Car`,
          html: emailHtml,
        }),
      });

      await addDoc(collection(db, 'mail'), {
        to: booking.email || 'info@pattayarentacar.com',
        message: {
          subject: `Rental Return Confirmation - ${carName} - Pattaya Rent a Car`,
          html: emailHtml,
        }
      });

      toast.success('Email Sent & Calendar Updated');
      onRefresh();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Failed to complete return');
    } finally {
      setLoading(false);
    }
  };

  const handleExtendRental = async () => {
    setLoading(true);
    try {
      const currentEndDate = parseISO(booking.endDate);
      const newEndDate = addDays(currentEndDate, extensionDays);

      // 1. Update Booking
      await updateDoc(doc(db, 'bookings', booking.id), {
        endDate: newEndDate.toISOString()
      });

      // 2. Log Income to Finance
      if (extensionPayment > 0) {
        const accs = await getDocs(collection(db, 'accounts'));
        const defaultAcc = accs.docs.find(d => d.data().name === 'Cash Car')?.id || accs.docs[0]?.id || 'unknown';

        await addDoc(collection(db, 'transactions'), {
          type: 'Income',
          amount: Number(extensionPayment),
          date: new Date().toISOString(),
          category: 'Rental Extension',
          carId: booking.carId,
          bookingId: booking.id,
          accountId: defaultAcc,
          description: `Extension payment (+${extensionDays} days) from ${booking.customerName}`
        });
      }

      // 3. Send Email
      const emailHtml = `
        <div style="font-family: serif; padding: 40px; background-color: #f9f7f2; color: #1a1a1a;">
          <h1 style="italic; font-size: 24px;">Rental Extension Acknowledged</h1>
          <p style="text-transform: uppercase; letter-spacing: 2px; font-size: 10px; font-weight: bold; color: #666;">Pattaya Rent a Car</p>
          <div style="margin-top: 40px; background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">
            <p>Dear <strong>${booking.customerName}</strong>,</p>
            <p>Your rental of <strong>${carName}</strong> has been extended by <strong>${extensionDays} day(s)</strong>.</p>
            <div style="margin-top: 20px; padding: 20px; background: #f0fdf4; border-radius: 12px; border-left: 4px solid #10b981;">
              <p style="margin: 0; font-weight: bold; color: #10b981;">New Return Date</p>
              <p style="margin: 5px 0 0 0; font-size: 18px;">${format(newEndDate, 'PPP p')}</p>
              <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.6;">Payment Received: ${extensionPayment.toLocaleString()} THB</p>
            </div>
            <p style="margin-top: 30px;">Thank you for your business!</p>
          </div>
        </div>
      `;

      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: booking.email || 'info@pattayarentacar.com',
          subject: `Rental Extension Acknowledged - ${carName} - Pattaya Rent a Car`,
          html: emailHtml,
        }),
      });

      await addDoc(collection(db, 'mail'), {
        to: booking.email || 'info@pattayarentacar.com',
        message: {
          subject: `Rental Extension Acknowledged - ${carName} - Pattaya Rent a Car`,
          html: emailHtml,
        }
      });

      toast.success('Email Sent & Calendar Updated');
      onRefresh();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Failed to extend rental');
    } finally {
      setLoading(false);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-[#1A1A1A]/40 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative bg-white/95 backdrop-blur-2xl border border-white/60 w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-8 border-b border-black/5 flex items-center justify-between bg-white/50">
          <div>
            <h2 className="font-serif italic text-3xl text-[#1A1A1A]">Manage Rental: {booking.customerName}</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-1">{carName} • Command Center</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center text-[#1A1A1A]/40 hover:bg-brand-orange hover:text-white transition-all shadow-sm"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-8 overflow-y-auto space-y-12">
          {/* Feature 1: End Rental */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-brand-orange/10 flex items-center justify-center shadow-inner">
                <Check size={20} className="text-brand-orange" />
              </div>
              <h3 className="text-sm font-bold text-[#1A1A1A] uppercase tracking-wider">End Rental (Return)</h3>
            </div>

            <div className="grid grid-cols-2 gap-6 bg-white/40 p-6 rounded-[32px] border border-white/60 shadow-sm">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Final Extra Charges (THB)</label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-orange" />
                  <input
                    type="number"
                    value={extraCharges}
                    onChange={e => setExtraCharges(Number(e.target.value))}
                    className="w-full bg-black/5 border-0 p-4 pl-10 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Reason for Charge</label>
                <input
                  type="text"
                  value={extraReason}
                  onChange={e => setExtraReason(e.target.value)}
                  className="w-full bg-black/5 border-0 p-4 rounded-2xl text-sm font-medium focus:ring-2 ring-brand-orange outline-none transition-all"
                  placeholder="e.g. Fuel, Cleaning, Scratch"
                />
              </div>
              <div className="col-span-2 pt-2">
                <button
                  onClick={handleEndRental}
                  disabled={loading}
                  className="w-full h-14 bg-emerald-500 text-white rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 active:translate-y-[2px] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <><Check size={16} /> Complete Return</>}
                </button>
              </div>
            </div>
          </section>

          <div className="h-[1px] bg-black/5 relative">
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-4 text-[8px] font-bold text-black/10 uppercase tracking-[0.3em]">Quick Actions</span>
          </div>

          {/* Feature 2: Extend Rental */}
          <section className="space-y-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center shadow-inner">
                <Zap size={20} className="text-blue-500" />
              </div>
              <h3 className="text-sm font-bold text-[#1A1A1A] uppercase tracking-wider">Extend Rental</h3>
            </div>

            <div className="space-y-6 bg-white/40 p-6 rounded-[32px] border border-white/60 shadow-sm">
              <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Extension Duration</label>
                <div className="flex gap-2">
                  {[1, 2, 7].map(days => (
                    <button
                      key={days}
                      onClick={() => setExtensionDays(days)}
                      className={cn(
                        "flex-1 h-12 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all border shadow-sm",
                        extensionDays === days 
                          ? "bg-blue-500 text-white border-blue-500" 
                          : "bg-white border-black/5 text-[#1A1A1A]/40 hover:bg-blue-50"
                      )}
                    >
                      +{days} Day{days > 1 ? 's' : ''}
                    </button>
                  ))}
                  <div className="flex-[2] relative">
                    <input
                      type="number"
                      value={extensionDays}
                      onChange={e => setExtensionDays(Number(e.target.value))}
                      className="w-full h-12 bg-black/5 border-0 px-4 rounded-2xl text-xs font-bold focus:ring-2 ring-blue-500 outline-none transition-all text-center"
                      placeholder="Custom Days"
                    />
                    <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-[8px] font-bold text-black/20 uppercase">Days</div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Extension Payment Received (THB)</label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                  <input
                    type="number"
                    value={extensionPayment}
                    onChange={e => setExtensionPayment(Number(e.target.value))}
                    className="w-full bg-black/5 border-0 p-4 pl-10 rounded-2xl text-sm font-bold focus:ring-2 ring-blue-500 outline-none transition-all"
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleExtendRental}
                  disabled={loading}
                  className="w-full h-14 bg-blue-500 text-white rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 active:translate-y-[2px] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <><Zap size={16} /> Confirm Extension</>}
                </button>
              </div>
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

const getBrandSlug = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes('toyota')) return 'toyota';
  if (n.includes('honda')) return 'honda';
  if (n.includes('ford')) return 'ford';
  if (n.includes('nissan')) return 'nissan';
  if (n.includes('mg')) return 'mg';
  return null;
};

const cleanCarName = (name: string) => {
  return name.replace(/Toyota|Honda|Ford|MG|Nissan/gi, '').trim();
};

const CarRow: React.FC<CarRowProps> = React.memo(({
  car,
  daysInMonth,
  bookings,
  handleRowClick,
  handleRowContextMenu,
  getBookingStyle,
  handleMouseEnterBooking,
  handleMouseLeaveBooking,
  handleBookingClick,
  handleBookingContextMenu,
  getCarTypeStyles,
  onManageBooking
}) => {
  const typeStyles = getCarTypeStyles(car.type || car.category || '');
  
  const brandSlug = getBrandSlug(car.name);
  const displayName = cleanCarName(car.make && car.model ? `${car.make} ${car.model}` : car.name);

  const isMaintenanceToday = useMemo(() => {
    const today = startOfDay(new Date());
    return bookings.some(b => 
      b.carId === car.id && 
      b.isMaintenance && 
      isWithinInterval(today, { start: startOfDay(parseISO(b.startDate)), end: endOfDay(parseISO(b.endDate)) })
    );
  }, [bookings, car.id]);

  return (
    <div className="flex group h-8 virtual-row">
      <div className="w-[200px] min-w-[200px] max-w-[200px] flex-shrink-0 border-r border-b border-black/10 bg-white/60 sticky left-0 z-20 px-2 py-0.5 flex items-center gap-1 backdrop-blur-md group-hover:bg-brand-orange/5 transition-colors overflow-hidden">
        <div className={cn("w-1 h-full absolute left-0", typeStyles.bg)} />
        
        {brandSlug ? (
          <img 
            src={`https://cdn.simpleicons.org/${brandSlug}`}
            alt={brandSlug}
            className="w-4 h-4 shrink-0"
          />
        ) : (
          <typeStyles.icon size={12} className={cn("shrink-0", typeStyles.color)} />
        )}
        <div className="flex-1 flex items-center justify-between min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] font-bold text-[#1A1A1A] truncate leading-tight">
              {displayName}
            </span>
            <span className="text-[9px] text-[#1A1A1A]/40 font-medium shrink-0">
              {car.yearOfManufacture && car.yearOfManufacture.toString().slice(-4)}
            </span>
            {car.engineSize && (
              <span className="text-[8px] text-[#1A1A1A]/40 font-medium shrink-0">
                {car.engineSize.toString().replace(/cc/gi, '')}
              </span>
            )}
            {isMaintenanceToday && (
              <Wrench size={10} className="text-gray-500 animate-pulse shrink-0" />
            )}
          </div>
          <span className="text-[9px] text-slate-500 font-mono leading-tight ml-auto whitespace-nowrap">
            {car.plateNumber}
          </span>
        </div>
      </div>
      <div 
        className="flex relative timeline-grid-bg cursor-pointer border-b border-black/5 grow"
        style={{ width: `${daysInMonth.length * 72}px` }}
        onClick={(e) => handleRowClick(e, car.id)}
        onContextMenu={(e) => handleRowContextMenu(e, car.id)}
      >
        {bookings.filter(b => b.carId === car.id).map(booking => {
          const style = getBookingStyle(booking);
          if (!style) return null;
          return (
              <div
              key={booking.id}
              onMouseEnter={(e) => handleMouseEnterBooking(booking, e)}
              onMouseLeave={handleMouseLeaveBooking}
              onClick={(e) => { e.stopPropagation(); handleBookingClick(booking); }}
              onContextMenu={(e) => { e.preventDefault(); handleBookingContextMenu(e, booking); }}
              className={cn(
                "absolute h-6 top-1 rounded-md shadow-sm cursor-pointer z-10 px-1.5 py-0 flex flex-col justify-center border border-white/20 backdrop-blur-sm booking-bar group/booking",
                booking.isMaintenance && "maintenance-pattern"
              )}
              style={style || {}}
            >
              <div className="flex items-center justify-between w-full h-full relative overflow-hidden">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-widest truncate leading-none flex-1 flex items-center gap-1",
                  booking.isMaintenance ? "text-white/90" : "text-[#1A1A1A]"
                )}>
                  {!booking.isMaintenance && booking.notes && booking.notes.trim() !== '' && (
                    <FileText size={10} className="shrink-0 opacity-60" />
                  )}
                  {booking.isMaintenance ? (booking.maintenanceDescription || 'Maintenance') : booking.customerName}
                </span>
                
                {!booking.isMaintenance && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onManageBooking(booking);
                    }}
                    className="opacity-0 group-hover/booking:opacity-100 p-0.5 bg-white/40 hover:bg-white/60 rounded-md transition-all shadow-sm ml-1"
                    title="Manage Rental"
                  >
                    <Settings size={10} className="text-[#1A1A1A]" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const Timeline: React.FC<TimelineProps> = ({ cars = [], bookings = [], currentDate, newBookingTrigger, onLogIncome, onRefresh, title = "Car Fleet" }) => {
  const [selectedSlot, setSelectedSlot] = useState<{ carId: string; date: Date; slot: 'AM' | 'PM' } | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    deliveryLocation: undefined,
    isMaintenance: false,
    maintenanceDescription: ''
  });

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [pickUpTime, setPickUpTime] = useState('09:30');
  const [dropOffTime, setDropOffTime] = useState('09:30');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showImportantInfo, setShowImportantInfo] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const vehicleSuggestionsRef = useRef<HTMLDivElement>(null);
  const [vehicleSearchQuery, setVehicleSearchQuery] = useState('');
  const [isVehicleDropdownOpen, setIsVehicleDropdownOpen] = useState(false);

  const filteredFleet = useMemo(() => {
    const query = vehicleSearchQuery.toLowerCase();
    if (!query) return cars.slice(0, 10);
    return cars
      .filter(car => {
        const name = car.name.toLowerCase();
        const model = (car.model || '').toLowerCase();
        const make = (car.make || '').toLowerCase();
        const plate = (car.plateNumber || '').toLowerCase();
        return name.includes(query) || model.includes(query) || make.includes(query) || plate.includes(query);
      })
      .slice(0, 10);
  }, [cars, vehicleSearchQuery]);

  const timelineContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to current month start (skipping the 5-day buffer) on mount or month change
    const timer = setTimeout(() => {
      if (timelineContainerRef.current) {
        // Each day is 72px. We want to skip 5 days.
        const scrollPosition = (5 * 72); 
        timelineContainerRef.current.scrollTo({
          left: scrollPosition,
          behavior: 'smooth'
        });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [currentDate]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowCustomerSuggestions(false);
      }
      if (vehicleSuggestionsRef.current && !vehicleSuggestionsRef.current.contains(event.target as Node)) {
        setIsVehicleDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [lastFetch, setLastFetch] = useState<number>(() => {
    const cached = safeLocalStorage.getItem('prac_timeline_last_fetch');
    return cached ? parseInt(cached) : 0;
  });

  const [sortedCars, setSortedCars] = useState<Car[]>([]);
  const [manageBooking, setManageBooking] = useState<Booking | null>(null);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);

  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolling(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => setIsScrolling(false), 150);
  };

  const isTimeValid = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m;
    return total >= 9 * 60 && total <= 17 * 60 + 30;
  };

  useEffect(() => {
    const sorted = [...cars].sort((a, b) => {
      const orderA = a.sortOrder ?? a.order ?? 0;
      const orderB = b.sortOrder ?? b.order ?? 0;
      return orderA - orderB;
    });
    setSortedCars(sorted);
  }, [cars]);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; booking?: Booking; carId?: string; date?: Date; slot?: 'AM' | 'PM' } | null>(null);
  const [clipboard, setClipboard] = useState<{ booking: Booking } | null>(null);

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const handleBookingContextMenu = React.useCallback((e: React.MouseEvent, booking: Booking) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, booking });
  }, []);

  const handleSlotContextMenu = React.useCallback((e: React.MouseEvent, carId: string, date: Date, slot: 'AM' | 'PM') => {
    e.preventDefault();
    if (clipboard) {
      setContextMenu({ x: e.clientX, y: e.clientY, carId, date, slot });
    }
  }, [clipboard]);

  const handleCutBooking = (booking: Booking) => {
    setClipboard({ booking });
    toast.success(`Cut booking for ${booking.customerName}`);
    setContextMenu(null);
  };

  const handlePasteBooking = async (carId: string, date: Date, slot: 'AM' | 'PM') => {
    if (!clipboard) return;
    const { booking: sourceBooking } = clipboard;

    const start = parseISO(sourceBooking.startDate);
    const end = parseISO(sourceBooking.endDate);
    const durationMs = end.getTime() - start.getTime();

    const newStart = new Date(date);
    newStart.setHours(slot === 'AM' ? 8 : 14, 0, 0, 0);
    const newEnd = new Date(newStart.getTime() + durationMs);

    try {
      const { id, ...bookingData } = sourceBooking;
      const dataToSave = {
        ...bookingData,
        carId: carId === 'unassigned' ? '' : carId,
        startDate: newStart.toISOString(),
        endDate: newEnd.toISOString(),
        createdAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'bookings'), dataToSave);
      
      const car = cars.find(c => c.id === dataToSave.carId);
      await logSystemActivity(
        'Move Booking (Timeline)',
        `Moved booking for ${dataToSave.customerName} to ${car?.name || 'Unassigned'}`,
        'Bookings',
        { bookingId: docRef.id, customerName: dataToSave.customerName }
      );

      await deleteDoc(doc(db, 'bookings', sourceBooking.id));
      setClipboard(null);
      toast.success('Booking moved');
      
      if (onRefresh) {
        onRefresh();
      }
      
      setContextMenu(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    }
  };

  useEffect(() => {
    const fetchCustomers = async (force = false) => {
      if (!auth.currentUser) return;
      const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
      const isCacheValid = !force && (Date.now() - lastFetch < CACHE_DURATION);

      if (customers.length === 0 && isCacheValid) {
        const cached = safeLocalStorage.getItem('prac_cached_timeline_customers');
        if (cached) {
          try {
            setCustomers(JSON.parse(cached));
            return;
          } catch (e) {
            console.error('Error parsing cached timeline customers:', e);
          }
        }
      }

      try {
        const snapshot = await safeGetDocs(collection(db, 'customers'));
        const customerData = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Customer));
        setCustomers(customerData);
        
        const now = Date.now();
        setLastFetch(now);
        safeLocalStorage.setItem('prac_timeline_last_fetch', now.toString(), true);
        
        // Prune customer data for cache to save space
        const prunedCustomers = customerData.map(c => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          mobileNumber: c.mobileNumber
        }));
        safeLocalStorage.setItem('prac_cached_timeline_customers', JSON.stringify(prunedCustomers), true);
      } catch (error: any) {
        console.error('Error fetching customers for timeline:', error);
        
        // Fallback to stale cache
        const cached = safeLocalStorage.getItem('prac_cached_timeline_customers');
        if (cached) {
          try {
            setCustomers(JSON.parse(cached));
          } catch (e) {}
        }
      }
    };
    fetchCustomers();
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

  const visibleDays = useMemo(() => {
    const start = addDays(startOfMonth(currentDate), -5);
    const end = addDays(endOfMonth(currentDate), 15);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const availabilityData = useMemo(() => {
    const activeCarsCount = cars.filter(c => c.isActive !== false).length;
    return visibleDays.map(day => {
      const amStart = new Date(day);
      amStart.setHours(9, 0, 0, 0);
      const amEnd = new Date(day);
      amEnd.setHours(13, 59, 59, 999);

      const pmStart = new Date(day);
      pmStart.setHours(14, 0, 0, 0);
      const pmEnd = new Date(day);
      pmEnd.setHours(23, 59, 59, 999);

      const amBooked = bookings.filter(b => {
        if (!b.carId) return false;
        const start = parseISO(b.startDate);
        const end = parseISO(b.endDate);
        return (start <= amEnd && end >= amStart);
      }).length;

      const pmBooked = bookings.filter(b => {
        if (!b.carId) return false;
        const start = parseISO(b.startDate);
        const end = parseISO(b.endDate);
        return (start <= pmEnd && end >= pmStart);
      }).length;

      return {
        am: activeCarsCount - amBooked,
        pm: activeCarsCount - pmBooked
      };
    });
  }, [cars, bookings, visibleDays]);

  const monthsInView = useMemo(() => {
    const months: { month: Date; days: Date[] }[] = [];
    visibleDays.forEach(day => {
      const lastMonth = months[months.length - 1];
      if (!lastMonth || !isSameMonth(lastMonth.month, day)) {
        months.push({ month: startOfMonth(day), days: [day] });
      } else {
        lastMonth.days.push(day);
      }
    });
    return months;
  }, [visibleDays]);

  const daysInMonth = visibleDays; // Maintain compatibility with existing variable name or replace all

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSlotClick = React.useCallback((carId: string, date: Date, slot: 'AM' | 'PM') => {
    setSelectedSlot({ carId, date, slot });
    setEditingBooking(null);
    setModalMode('edit');
    setShowDeleteConfirm(false);
    const start = new Date(date);
    start.setHours(slot === 'AM' ? 9 : 14, slot === 'AM' ? 30 : 0, 0, 0);
    const end = new Date(date);
    end.setHours(slot === 'AM' ? 14 : 16, 0, 0, 0);
    
    setPickUpTime(format(start, 'HH:mm'));
    setDropOffTime(format(end, 'HH:mm'));
    
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
      deliveryLocation: undefined,
      isMaintenance: false,
      maintenanceDescription: ''
    });
    setDateRange({ from: start, to: end });
    setIsModalOpen(true);
  }, [cars]); // cars needed for potentially filtering or validating, though not strictly used here, good to keep dependencies clean

  useEffect(() => {
    if (newBookingTrigger && newBookingTrigger > 0) {
      handleSlotClick('unassigned', new Date(), 'AM');
    }
  }, [newBookingTrigger]);

  const handleBookingClick = React.useCallback((booking: Booking) => {
    setEditingBooking(booking);
    setFormData({ 
      ...booking,
      deliveryAddress: booking.deliveryAddress || '',
      deliveryNotes: booking.deliveryNotes || '',
      deliveryLocation: booking.deliveryLocation,
      isMaintenance: booking.isMaintenance || false,
      maintenanceDescription: booking.maintenanceDescription || ''
    });
    setModalMode('view');
    setShowDeleteConfirm(false);
    const start = parseISO(booking.startDate);
    const end = parseISO(booking.endDate);
    setPickUpTime(format(start, 'HH:mm'));
    setDropOffTime(format(end, 'HH:mm'));
    setDateRange({ 
      from: start, 
      to: end 
    });
    setIsModalOpen(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const start = dateRange?.from ? new Date(dateRange.from) : new Date(formData.startDate || new Date());
      const [startH, startM] = pickUpTime.split(':').map(Number);
      start.setHours(startH, startM, 0, 0);

      const end = dateRange?.to ? new Date(dateRange.to) : new Date(dateRange?.from || formData.endDate || new Date());
      const [endH, endM] = dropOffTime.split(':').map(Number);
      end.setHours(endH, endM, 0, 0);

      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      if (startMinutes < 9 * 60 || startMinutes > 17 * 60 + 30 || endMinutes < 9 * 60 || endMinutes > 17 * 60 + 30) {
        toast.error('Office hours are 09:00 - 17:30');
        setIsSubmitting(false);
        return;
      }

      // Check for overlaps (excluding the current booking if editing)
      const overlapping = bookings.find(b => {
        if (editingBooking && b.id === editingBooking.id) return false;
        if (b.carId !== formData.carId && b.carId !== (formData.carId === '' ? '' : formData.carId)) return false;
        if (!b.carId && formData.carId) return false; // Both are unassigned, or one is unassigned
        
        // Match cars if both have IDs
        if (b.carId && formData.carId && b.carId !== formData.carId) return false;

        const bStart = parseISO(b.startDate);
        const bEnd = parseISO(b.endDate);
        
        return (start < bEnd && end > bStart);
      });

      if (overlapping && formData.carId !== '') {
        toast.error(`Schedule conflict: Car is already booked or in maintenance for this period.`);
        setIsSubmitting(false);
        return;
      }

      const dataToSave = {
        ...formData,
        customerName: formData.isMaintenance ? `Maintenance: ${formData.maintenanceDescription?.slice(0, 20) || ''}` : formData.customerName,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
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
        if (onRefresh) onRefresh();
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
      
      if (onRefresh) {
        onRefresh();
      }
      
      setIsModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBooking = async () => {
    if (!editingBooking || isSubmitting) return;
    setIsSubmitting(true);
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
      
      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      toast.error('Failed to delete booking');
      handleFirestoreError(error, OperationType.DELETE, `bookings/${editingBooking.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Tooltip Logic
  const [hoveredBooking, setHoveredBooking] = useState<{ booking: Booking; x: number; y: number } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnterBooking = React.useCallback((booking: Booking, e: React.MouseEvent) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredBooking({ 
      booking, 
      x: rect.left, 
      y: rect.bottom 
    });
  }, []);

  const handleMouseLeaveBooking = React.useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredBooking(null);
    }, 300); // 300ms delay to allow moving mouse to tooltip
  }, []);

  const handleMouseEnterTooltip = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
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

    const timelineStart = visibleDays[0];
    const timelineEnd = visibleDays[visibleDays.length - 1];

    // Filter bookings that overlap with visible range
    if (end < timelineStart || start > timelineEnd) return null;

    const visibleStart = start < timelineStart ? timelineStart : start;
    const visibleEnd = end > timelineEnd ? timelineEnd : end;

    const startDayIdx = differenceInDays(visibleStart, timelineStart);
    const startSlot = visibleStart.getHours() >= 14 ? 1 : 0;
    const totalSlots = differenceInDays(visibleEnd, visibleStart) * 2 + (visibleEnd.getHours() >= 14 ? 1 : 0) - (visibleStart.getHours() >= 14 ? 1 : 0);

    const isFutureBooking = isFuture(start);
    const isUnpaid = start < new Date() && booking.status !== 'Paid';
    
    let bgColor = '#FF6321'; // Default brand-orange
    
    if (booking.isMaintenance) {
      bgColor = '#4B5563'; // Dark Grey (gray-600)
    } else if (booking.status === 'Paid') {
      bgColor = '#10B981'; // Green (emerald-500)
    } else if (isUnpaid) {
      bgColor = '#EAB308'; // Yellow (yellow-500) - Unpaid
    } else if (isFutureBooking) {
      bgColor = '#EF4444'; // Red (red-500)
    } else if (!booking.carId || booking.carId === 'unassigned') {
      bgColor = '#EAB308'; // Yellow (yellow-500)
    }

    return {
      left: `${(startDayIdx * 2 + startSlot) * 36}px`,
      width: `${Math.max(totalSlots, 1) * 36}px`,
      backgroundColor: bgColor
    };
  };

  const getSlotFromEvent = (e: React.MouseEvent | React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.floor(x / 36);
    const dayIdx = Math.floor(idx / 2);
    const isPM = idx % 2 === 1;
    return { day: visibleDays[dayIdx], slot: (isPM ? 'PM' : 'AM') as 'AM' | 'PM' };
  };

  const handleRowClick = useCallback((e: React.MouseEvent, carId: string) => {
    const target = e.target as HTMLElement;
    // Don't trigger if clicking a booking bar
    if (target.closest('.booking-bar')) return;
    const { day, slot } = getSlotFromEvent(e);
    handleSlotClick(carId, day, slot);
  }, [visibleDays, handleSlotClick]);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, carId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('.booking-bar')) return;
    const { day, slot } = getSlotFromEvent(e);
    handleSlotContextMenu(e, carId, day, slot);
  }, [visibleDays, clipboard, handleSlotContextMenu]);

  if (!auth.currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-warm-bg text-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Lock className="w-12 h-12 text-black/10 mx-auto mb-4" />
          <h2 className="text-xl font-serif italic mb-2">Fleet Timeline Restricted</h2>
          <p className="text-xs text-black/40 mb-6">Please sign in to view the live booking timeline.</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-black text-white rounded-full text-[10px] font-bold uppercase tracking-widest">Sign In / Refresh</button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-warm-bg">
      <div 
        ref={timelineContainerRef} 
        onScroll={handleScroll}
        className={cn(
          "flex-1 overflow-auto custom-scrollbar relative will-change-transform",
          isScrolling && "is-scrolling"
        )}
      >
        <div className="inline-block min-w-full">
          {/* Timeline Header */}
          <div className="flex flex-col sticky top-0 z-30 shadow-md">
            <div className="flex bg-white/40 backdrop-blur-xl">
              <div className="w-[200px] min-w-[200px] max-w-[200px] flex-shrink-0 border-r border-b border-black/10 bg-white/80 sticky left-0 z-50 p-2 flex items-center justify-between backdrop-blur-md">
                <div className="flex flex-col">
                  <span className="font-serif italic text-sm text-[#1A1A1A]">{title}</span>
                </div>
              </div>
              <div className="flex">
                {monthsInView.map(({ month, days }) => (
                  <div key={month.toISOString()} className="flex flex-col border-r border-black/10 last:border-r-0">
                    <div className="sticky top-0 z-40 py-1.5 px-4 text-[10px] font-bold uppercase tracking-[0.3em] bg-white/90 backdrop-blur-sm text-[#1A1A1A]/80 border-b border-black/5 flex items-center gap-2">
                      <Calendar size={10} className="text-brand-orange" />
                      {format(month, 'MMMM yyyy')}
                    </div>
                    <div className="flex">
                      {days.map(day => (
                        <div key={day.toISOString()} className="w-[72px] flex-shrink-0 border-r last:border-r-0 border-black/5 bg-white/20">
                          <div className={cn(
                            "text-center py-1 text-[9px] font-bold uppercase tracking-wider",
                            isSameDay(day, new Date()) ? "bg-brand-orange text-white" : "bg-brand-orange/5 text-brand-orange"
                          )}>
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
                ))}
              </div>
            </div>

            {/* Availability Row */}
            <div className="flex h-7 bg-green-50 border-b border-black/10">
              <div className="w-[200px] min-w-[200px] max-w-[200px] flex-shrink-0 border-r border-black/10 bg-green-100 sticky left-0 z-50 px-3 flex items-center backdrop-blur-md">
                <span className="text-[10px] font-bold text-green-800 uppercase tracking-widest whitespace-nowrap">Cars Available</span>
              </div>
              <div className="flex timeline-grid-bg">
                {availabilityData.map((data, idx) => (
                  <div key={idx} className="w-[72px] flex-shrink-0 flex items-center">
                    <div className={cn(
                      "w-1/2 text-center text-[10px] leading-none",
                      data.am < 5 ? "text-red-600 font-bold" : "text-green-800 font-medium"
                    )}>
                      {data.am}
                    </div>
                    <div className={cn(
                      "w-1/2 text-center text-[10px] leading-none",
                      data.pm < 5 ? "text-red-600 font-bold" : "text-green-800 font-medium"
                    )}>
                      {data.pm}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Timeline Body */}
          <div className="relative">
            {/* Today Indicator Line */}
            {(() => {
              const today = new Date();
              const timelineStart = visibleDays[0];
              const timelineEnd = visibleDays[visibleDays.length - 1];
              if (today >= timelineStart && today <= timelineEnd) {
                const startDayIdx = differenceInDays(today, timelineStart);
                const hour = today.getHours();
                const minute = today.getMinutes();
                const progressInDay = (hour * 60 + minute) / 1440;
                const left = 200 + (startDayIdx * 72) + (progressInDay * 72); // Added 200 offset
                
                return (
                  <div 
                    className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-20 pointer-events-none"
                    style={{ left: `${left}px` }}
                  >
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500" />
                  </div>
                );
              }
              return null;
            })()}

            {/* Unassigned Row */}
            <div className="flex group h-8 bg-brand-orange/5 virtual-row">
              <div className="w-[200px] min-w-[200px] max-w-[200px] flex-shrink-0 border-r border-b border-black/10 bg-white/60 sticky left-0 z-20 px-3 py-0 flex items-center gap-2 backdrop-blur-md group-hover:bg-brand-orange/10 transition-colors">
                <div className="w-1 h-full absolute left-0 bg-brand-orange" />
                <AlertCircle size={10} className="shrink-0 text-brand-orange" />
                <span className="text-[10px] font-bold text-brand-orange truncate leading-tight uppercase tracking-widest">Unassigned</span>
              </div>
              <div 
                className="flex relative timeline-grid-bg cursor-pointer border-b border-black/5 grow"
                style={{ width: `${visibleDays.length * 72}px` }}
                onClick={(e) => handleRowClick(e, 'unassigned')}
                onContextMenu={(e) => handleRowContextMenu(e, 'unassigned')}
              >
                {bookings.filter(b => !b.carId || b.carId === '').map(booking => {
                  const style = getBookingStyle(booking);
                  if (!style) return null;
                  return (
                    <div
                      key={booking.id}
                      onMouseEnter={(e) => handleMouseEnterBooking(booking, e)}
                      onMouseLeave={handleMouseLeaveBooking}
                      onClick={(e) => { e.stopPropagation(); handleBookingClick(booking); }}
                      onContextMenu={(e) => { e.preventDefault(); handleBookingContextMenu(e, booking); }}
                      className={cn(
                        "absolute h-6 top-1 rounded-md shadow-sm cursor-pointer z-10 px-1.5 py-0 flex flex-col justify-center border border-white/20 backdrop-blur-sm booking-bar group/booking",
                        booking.isMaintenance && "maintenance-pattern"
                      )}
                      style={style || {}}
                    >
                      <div className="flex items-center justify-between w-full h-full relative overflow-hidden">
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-widest truncate leading-none flex-1 flex items-center gap-1",
                          booking.isMaintenance ? "text-white/90" : "text-[#1A1A1A]"
                        )}>
                          {!booking.isMaintenance && booking.notes && booking.notes.trim() !== '' && (
                            <FileText size={10} className="shrink-0 opacity-60" />
                          )}
                          {booking.isMaintenance ? (booking.maintenanceDescription || 'Maintenance') : booking.customerName}
                        </span>
                        
                        {!booking.isMaintenance && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setManageBooking(booking);
                              setIsManageModalOpen(true);
                            }}
                            className="opacity-0 group-hover/booking:opacity-100 p-0.5 bg-white/40 hover:bg-white/60 rounded-md transition-all shadow-sm ml-1"
                            title="Manage Rental"
                          >
                            <Settings size={10} className="text-[#1A1A1A]" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="relative">
              {sortedCars.map(car => (
                <CarRow
                  key={car.id}
                  car={car}
                  daysInMonth={visibleDays}
                  bookings={bookings}
                  handleRowClick={handleRowClick}
                  handleRowContextMenu={handleRowContextMenu}
                  getBookingStyle={getBookingStyle}
                  handleMouseEnterBooking={handleMouseEnterBooking}
                  handleMouseLeaveBooking={handleMouseLeaveBooking}
                  handleBookingClick={handleBookingClick}
                  handleBookingContextMenu={handleBookingContextMenu}
                  getCarTypeStyles={getCarTypeStyles}
                  onManageBooking={(booking) => {
                    setManageBooking(booking);
                    setIsManageModalOpen(true);
                  }}
                />
              ))}
            </div>
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
            onMouseEnter={handleMouseEnterTooltip}
            onMouseLeave={handleMouseLeaveBooking}
            className="fixed z-[200]"
            style={{
              left: hoveredBooking.x,
              top: hoveredBooking.y + 10,
              transform: 'translateY(0)'
            }}
          >
            <div className="bg-white/90 backdrop-blur-2xl border border-black/10 shadow-2xl rounded-2xl p-4 min-w-[240px] relative">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="text-sm font-bold text-[#1A1A1A]">
                    {hoveredBooking.booking.isMaintenance ? (
                      <span className="flex items-center gap-2">
                        <Wrench size={14} className="text-gray-600" /> Maintenance
                      </span>
                    ) : hoveredBooking.booking.customerName}
                  </h4>
                  {hoveredBooking.booking.isMaintenance ? (
                    <p className="text-[10px] text-[#1A1A1A]/60 font-medium italic mt-1">
                      {hoveredBooking.booking.maintenanceDescription}
                    </p>
                  ) : (
                    <p className="text-[10px] text-[#1A1A1A]/60 font-medium">{hoveredBooking.booking.email || 'No email'}</p>
                  )}
                  <p className="text-[9px] font-bold text-brand-orange uppercase tracking-widest mt-1">
                    {hoveredBooking.booking.carId 
                      ? cars.find(c => c.id === hoveredBooking.booking.carId)?.name 
                      : (hoveredBooking.booking.requestedCarType || 'Unassigned')}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                    hoveredBooking.booking.isMaintenance
                      ? "bg-gray-100 text-gray-600"
                      : (hoveredBooking.booking.status === 'Paid' 
                          ? "bg-green-100 text-green-600" 
                          : (parseISO(hoveredBooking.booking.startDate) < new Date()
                              ? "bg-yellow-100 text-yellow-600"
                              : (isFuture(parseISO(hoveredBooking.booking.startDate)) 
                                  ? "bg-red-100 text-red-600" 
                                  : ((!hoveredBooking.booking.carId || hoveredBooking.booking.carId === 'unassigned') ? "bg-yellow-100 text-yellow-600" : "bg-orange-100 text-orange-600"))))
                  )}>
                    {hoveredBooking.booking.isMaintenance ? 'Maintenance' : hoveredBooking.booking.status}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCutBooking(hoveredBooking.booking);
                      }}
                      className="p-1.5 bg-brand-orange/10 text-brand-orange rounded-lg hover:bg-brand-orange hover:text-white transition-all pointer-events-auto"
                      title="Cut Booking"
                    >
                      <Scissors size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingBooking(hoveredBooking.booking);
                        setShowDeleteConfirm(true);
                        setHoveredBooking(null);
                      }}
                      className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-all pointer-events-auto"
                      title="Delete Booking"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
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

                <div className="pt-3 mt-1 border-t border-[#1A1A1A]/5">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/30 mb-1">Notes</p>
                  <p className={cn(
                    "text-[10px] leading-relaxed break-words",
                    hoveredBooking.booking.notes ? "text-slate-600 italic" : "text-[#1A1A1A]/20 font-medium"
                  )}>
                    {hoveredBooking.booking.notes || 'No notes added'}
                  </p>
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
              className="bg-white/60 backdrop-blur-xl border border-black/10 p-8 max-w-2xl w-full shadow-2xl rounded-[40px] overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h2 className="font-serif italic text-3xl text-gray-900">
                    {showDeleteConfirm ? 'Confirm Deletion' : (modalMode === 'view' ? 'Booking Details' : (editingBooking ? 'Edit Booking' : 'New Booking'))}
                  </h2>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1 ml-1">
                    {formData.carId ? (
                      (() => {
                        const car = cars.find(c => c.id === formData.carId);
                        if (!car) return <span className="text-brand-orange">Unassigned Vehicle</span>;
                        return (
                          <span className="flex items-center gap-2">
                            <span>{car.make && car.model ? `${car.make} ${car.model}` : car.name}</span>
                            <span className="bg-white border border-[#1A1A1A]/20 px-1.5 py-0.5 rounded text-[8px] font-bold font-mono shadow-sm">
                              {car.plateNumber}
                            </span>
                          </span>
                        );
                      })()
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
                      disabled={isSubmitting}
                      className="flex-1 bg-red-500 text-white py-4 rounded-3xl font-bold uppercase tracking-widest text-[10px] hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <Loader2 className="animate-spin" size={14} />
                      ) : (
                        'Delete Permanently'
                      )}
                    </button>
                  </div>
                </div>
              ) : modalMode === 'view' && editingBooking ? (
                <div className="space-y-8">
                  {editingBooking.isMaintenance && (
                    <div className="bg-gray-100 border border-gray-300 p-5 rounded-3xl flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-gray-600 flex items-center justify-center shadow-lg">
                        <Wrench size={24} className="text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">Maintenance Mode Active</p>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest text-[#1A1A1A]">Vehicle is scheduled for repair</p>
                      </div>
                    </div>
                  )}
                  {editingBooking.email && !customerInCRM && !editingBooking.isMaintenance && (
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
                    {!editingBooking.isMaintenance ? (
                      <>
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
                      </>
                    ) : (
                      <div className="col-span-2 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1"><Wrench size={12} className="inline mr-1" /> Repair Description</p>
                        <p className="text-lg font-bold text-gray-900 bg-gray-50 p-3 rounded-2xl border border-gray-200">
                          {editingBooking.maintenanceDescription || 'Scheduled Maintenance'}
                        </p>
                      </div>
                    )}
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
                          "px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-full border border-black/10 shadow-sm",
                          editingBooking.isMaintenance 
                            ? "bg-gray-600 text-white"
                            : (editingBooking.status === 'Paid' 
                                ? "bg-emerald-500 text-white" 
                                : (isFuture(parseISO(editingBooking.startDate)) 
                                    ? "bg-red-500 text-white" 
                                    : ((!editingBooking.carId || editingBooking.carId === 'unassigned') ? "bg-yellow-500 text-white" : "bg-brand-orange text-white")))
                        )}>
                          {editingBooking.isMaintenance ? 'Maintenance' : editingBooking.status}
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
                  <div className="flex items-center gap-2 pb-4 border-b border-white/20">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, isMaintenance: !formData.isMaintenance })}
                      className={cn(
                        "flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all",
                        !formData.isMaintenance 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "bg-white/40 text-[#1A1A1A]/40 hover:bg-white/60"
                      )}
                    >
                      <User size={14} /> Rental Booking
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, isMaintenance: !formData.isMaintenance })}
                      className={cn(
                        "flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all",
                        formData.isMaintenance 
                          ? "bg-gray-600 text-white shadow-lg shadow-gray-600/20" 
                          : "bg-white/40 text-[#1A1A1A]/40 hover:bg-white/60"
                      )}
                    >
                      <Wrench size={14} /> Maintenance
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-6">
                      {!formData.isMaintenance ? (
                        <>
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
                                required={!formData.isMaintenance}
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
                        </>
                      ) : (
                        <div className="space-y-6">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                              <Wrench size={12} /> Repair Detail
                            </label>
                            <textarea
                              className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-medium focus:border-gray-600 outline-none transition-all min-h-[120px]"
                              value={formData.maintenanceDescription}
                              onChange={e => setFormData({ ...formData, maintenanceDescription: e.target.value })}
                              placeholder="Describe the repair or service needed..."
                              required={formData.isMaintenance}
                            />
                          </div>
                          <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Maintenance Note</p>
                            <p className="text-[11px] text-gray-500 leading-relaxed italic">
                              Switching to Maintenance Mode hides customer fields and marks this period as "Fleet Repair". The vehicle will be unavailable for rentals during this time.
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                          <CarIconType size={12} /> Assigned Vehicle
                        </label>
                        <div className="relative" ref={vehicleSuggestionsRef}>
                          <div 
                            className="w-full bg-white/40 border-b-2 border-white/60 p-3 rounded-t-2xl text-sm font-medium focus-within:border-brand-orange outline-none transition-all cursor-pointer flex items-center justify-between"
                            onClick={() => setIsVehicleDropdownOpen(!isVehicleDropdownOpen)}
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              {formData.carId ? (
                                (() => {
                                  const car = cars.find(c => c.id === formData.carId);
                                  if (!car) return <span>Unassigned</span>;
                                  const brandSlug = getBrandSlug(car.name);
                                  const typeStyles = getCarTypeStyles(car.type || car.category || '');
                                  const displayName = cleanCarName(car.make && car.model ? `${car.make} ${car.model}` : car.name);
                                  return (
                                    <>
                                      {brandSlug ? (
                                        <img src={`https://cdn.simpleicons.org/${brandSlug}`} className="w-4 h-4 shrink-0" alt="" />
                                      ) : (
                                        <typeStyles.icon size={12} className={cn("shrink-0", typeStyles.color)} />
                                      )}
                                      <span className="truncate">{car.make} {car.model} {car.yearOfManufacture} • {car.plateNumber}</span>
                                    </>
                                  );
                                })()
                              ) : (
                                <span className="text-gray-400">Unassigned</span>
                              )}
                            </div>
                            <ChevronRight className={cn("rotate-90 opacity-40 transition-transform", isVehicleDropdownOpen && "-rotate-90")} size={16} />
                          </div>

                          <AnimatePresence>
                            {isVehicleDropdownOpen && (
                              <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="absolute z-50 left-0 right-0 mt-2 bg-white/95 backdrop-blur-xl border border-white/60 shadow-2xl rounded-3xl overflow-hidden flex flex-col"
                              >
                                <div className="p-2 border-b border-white/20">
                                  <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                    <input 
                                      autoFocus
                                      type="text"
                                      className="w-full bg-black/5 p-2 pl-9 rounded-xl text-xs outline-none border-0"
                                      placeholder="Search model or plate..."
                                      value={vehicleSearchQuery}
                                      onChange={e => setVehicleSearchQuery(e.target.value)}
                                      onClick={e => e.stopPropagation()}
                                    />
                                  </div>
                                </div>
                                <div className="max-h-60 overflow-y-auto">
                                  <button
                                    type="button"
                                    className="w-full p-3 text-left hover:bg-brand-orange hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest border-b border-white/10"
                                    onClick={() => {
                                      setFormData({ ...formData, carId: '' });
                                      setIsVehicleDropdownOpen(false);
                                      setVehicleSearchQuery('');
                                    }}
                                  >
                                    Unassigned
                                  </button>
                                  {filteredFleet.length > 0 ? (
                                    filteredFleet.map(car => {
                                      const brandSlug = getBrandSlug(car.name);
                                      const typeStyles = getCarTypeStyles(car.type || car.category || '');
                                      return (
                                        <button
                                          key={car.id}
                                          type="button"
                                          className="w-full p-3 text-left hover:bg-brand-orange hover:text-white transition-colors flex items-center gap-3 border-b border-white/10 last:border-0"
                                          onClick={() => {
                                            setFormData({ ...formData, carId: car.id });
                                            setIsVehicleDropdownOpen(false);
                                            setVehicleSearchQuery('');
                                          }}
                                        >
                                          {brandSlug ? (
                                            <img src={`https://cdn.simpleicons.org/${brandSlug}`} className="w-4 h-4" alt="" />
                                          ) : (
                                            <typeStyles.icon size={12} className={typeStyles.color} />
                                          )}
                                          <div className="flex flex-col">
                                            <span className="text-xs font-bold">{car.make} {car.model} {car.yearOfManufacture}</span>
                                            <span className="text-[10px] opacity-60 font-mono">{car.plateNumber}</span>
                                          </div>
                                        </button>
                                      );
                                    })
                                  ) : (
                                    <div className="p-8 text-center">
                                      <Search size={24} className="mx-auto text-gray-300 mb-2" />
                                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">No vehicle found</p>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
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

                    <div className="space-y-4">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                        <Calendar size={12} /> Select Dates & Times
                      </label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowDatePicker(true)}
                          className={cn(
                            "w-full bg-white/40 border-b-2 p-4 rounded-t-2xl text-left hover:bg-white/60 transition-all shadow-sm",
                            (!isTimeValid(pickUpTime) || !isTimeValid(dropOffTime)) ? "border-red-500" : "border-white/60"
                          )}
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-1">Pick-up</p>
                              <p className="text-sm font-bold text-gray-900">
                                {dateRange?.from ? format(dateRange.from, 'PPP') : 'Select date'} at {pickUpTime}
                              </p>
                            </div>
                            <div className="h-8 w-px bg-black/10 mx-4" />
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-1">Drop-off</p>
                              <p className="text-sm font-bold text-gray-900">
                                {dateRange?.to ? format(dateRange.to, 'PPP') : (dateRange?.from ? format(dateRange.from, 'PPP') : 'Select date')} at {dropOffTime}
                              </p>
                            </div>
                          </div>
                          {(!isTimeValid(pickUpTime) || !isTimeValid(dropOffTime)) && (
                            <p className="text-[10px] text-red-500 font-bold mt-2 animate-pulse">
                              Office hours are 09:00 - 17:30
                            </p>
                          )}
                        </button>

                        <AnimatePresence>
                          {showDatePicker && (
                            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="w-full max-w-[700px]"
                              >
                                <DatePickerCustom
                                  selectedRange={{ 
                                    from: dateRange?.from || new Date(), 
                                    to: dateRange?.to || addDays(dateRange?.from || new Date(), 1) 
                                  }}
                                  onRangeChange={(range) => {
                                    setDateRange({ from: range.from, to: range.to });
                                  }}
                                  pickUpTime={pickUpTime}
                                  onPickUpTimeChange={setPickUpTime}
                                  dropOffTime={dropOffTime}
                                  onDropOffTimeChange={setDropOffTime}
                                  onClose={() => setShowDatePicker(false)}
                                  onApply={() => setShowDatePicker(false)}
                                  isBikeMode={title?.toLowerCase().includes('bike')}
                                  useFilteredTimes={true}
                                />
                              </motion.div>
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => setShowImportantInfo(true)}
                          className="flex items-center gap-2 text-brand-orange hover:text-[#1A1A1A] transition-colors"
                        >
                          <AlertCircle size={12} />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-brand-orange">Important Info</span>
                        </button>
                      </div>
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

      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-[300] bg-white/90 backdrop-blur-2xl border border-black/10 shadow-2xl rounded-2xl p-1.5 min-w-[160px]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.booking ? (
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleCutBooking(contextMenu.booking!)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A] hover:bg-brand-orange hover:text-white rounded-xl transition-all"
                >
                  <Scissors size={14} />
                  Cut Booking
                </button>
                <div className="h-[1px] bg-black/5 my-1" />
                <button
                  onClick={() => {
                    setEditingBooking(contextMenu.booking!);
                    setShowDeleteConfirm(true);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all"
                >
                  <Trash2 size={14} />
                  Delete Booking
                </button>
              </div>
            ) : contextMenu.carId ? (
              <button
                onClick={() => handlePasteBooking(contextMenu.carId!, contextMenu.date!, contextMenu.slot!)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A] hover:bg-brand-orange hover:text-white rounded-xl transition-all"
              >
                <Clipboard size={14} />
                Paste Booking
              </button>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {clipboard && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[400] bg-[#1A1A1A] text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 border border-white/10"
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest">
                Cut: {clipboard.booking.customerName}
              </span>
            </div>
            <div className="h-4 w-[1px] bg-white/20" />
            <button
              onClick={() => setClipboard(null)}
              className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <p className="text-[8px] text-white/20 uppercase tracking-widest font-bold">
              Right-click slot to paste
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <ImportantInfoModal 
        isOpen={showImportantInfo} 
        onClose={() => setShowImportantInfo(false)} 
        isBikeMode={editingBooking?.requestedCarType === 'Motorbike' || cars.find(c => c.id === formData.carId)?.category === 'Motorbike' || title?.toLowerCase().includes('bike')}
      />

      <AnimatePresence>
        {isManageModalOpen && manageBooking && (
          <ManageRentalModal
            booking={manageBooking}
            isOpen={isManageModalOpen}
            onClose={() => setIsManageModalOpen(false)}
            onRefresh={onRefresh}
            carName={cars.find(c => c.id === manageBooking.carId)?.name || 'Vehicle'}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
