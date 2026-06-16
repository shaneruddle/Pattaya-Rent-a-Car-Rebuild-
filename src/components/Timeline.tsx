import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addDays, differenceInDays, parseISO, isWithinInterval, startOfDay, endOfDay, isValid, isFuture } from 'date-fns';
import { Car, Booking, Customer } from '../types';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Plus, X, Phone, Mail, DollarSign, FileText, Calendar, Trash2, AlertCircle, AlertTriangle, Search, User, ChevronRight, Bike, Truck as TruckIcon, Car as CarIconType, ShieldCheck, Clipboard, Scissors, Loader2, Lock, Wrench, Settings, Check, Zap, ChevronLeft, ArrowUpDown, GripVertical } from 'lucide-react';
import { db, OperationType, handleFirestoreError, logSystemActivity, auth, safeGetDocs, getDocs } from '../firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, writeBatch, getDoc } from 'firebase/firestore';
import { upsertCustomer } from '../lib/customerService';
import { onAuthStateChanged } from 'firebase/auth';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { safeLocalStorage } from '../lib/storage';
import { sendTemplatedEmail } from '../lib/emailUtils';
import { DateRange } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { LocationPicker } from './LocationPicker';
import { ImportantInfoModal } from './ImportantInfoModal';
import { DatePickerCustom } from './ui/DatePickerCustom';

interface TimelineProps {
  cars: Car[]
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
  handleBookingBarClick: (booking: Booking, e: React.MouseEvent) => void;
  handleBookingContextMenu: (e: React.MouseEvent, booking: Booking) => void;
  getCarTypeStyles: (type: string) => any;
  onManageBooking: (booking: Booking) => void;
  onQuickNoteEdit: (booking: Booking, field: 'deliveryNotes' | 'returnNote', rect: DOMRect) => void;
  isReorderMode?: boolean;
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
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [returnAccountId, setReturnAccountId] = useState('');

  useEffect(() => {
    if (isOpen) {
      const fetchAccounts = async () => {
        const querySnapshot = await getDocs(collection(db, 'accounts'));
        const accs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAccounts(accs);
        // Default to 'Cash Car' or first available
        const defaultAcc = accs.find((a: any) => a.name === 'Cash Car') || accs[0];
        if (defaultAcc) {
          setSelectedAccountId(defaultAcc.id);
          setReturnAccountId(defaultAcc.id);
        }
      };
      fetchAccounts();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEndRental = async () => {
    if (extraCharges > 0 && !returnAccountId) {
      toast.error('Please select an account for the extra charges');
      return;
    }

    setLoading(true);
    try {
      // 1. Update Booking Status
      await updateDoc(doc(db, 'bookings', booking.id), {
        status: 'Completed'
      });

      // 2. Log Extra Charges to Finance if > 0
      if (extraCharges > 0) {
        const account = accounts.find(a => a.id === returnAccountId);
        
        await addDoc(collection(db, 'transactions'), {
          type: 'Income',
          amount: Number(extraCharges),
          date: new Date().toISOString(),
          category: 'Extra Charges',
          carId: booking.carId,
          bookingId: booking.id,
          accountId: returnAccountId,
          description: `Extra charges for ${booking.customerName}: ${extraReason}`
        });

        // Update Account Balance
        if (account) {
          await updateDoc(doc(db, 'accounts', account.id), {
            balance: (account.balance || 0) + Number(extraCharges)
          });
        }
      }

      // 3. Send Email
      try {
        const carSnap = await getDoc(doc(db, 'cars', booking.carId));
        const plateNumber = carSnap.exists() ? carSnap.data().plateNumber : '';
        const startDate = parseISO(booking.startDate);
        const endDate = parseISO(booking.endDate);

        await sendTemplatedEmail('return_confirmation', booking.email || 'info@pattayarentacar.com', {
          '{{customer_name}}': booking.customerName,
          '{{customer_email}}': booking.email || '',
          '{{customer_phone}}': booking.mobileNumber || '',
          '{{vehicle_model}}': carName,
          '{{plate_number}}': plateNumber,
          '{{pickup_date}}': format(startDate, 'dd MMM yyyy'),
          '{{pickup_time}}': format(startDate, 'HH:mm'),
          '{{return_date}}': format(endDate, 'dd MMM yyyy'),
          '{{return_time}}': format(endDate, 'HH:mm'),
          '{{rental_period}}': `${format(startDate, 'dd MMM yyyy')} to ${format(endDate, 'dd MMM yyyy')}`,
          '{{total_price}}': extraCharges > 0 ? extraCharges.toLocaleString() : (booking.amount || 0).toLocaleString(),
          '{{delivery_address}}': booking.deliveryAddress || '',
          '{{comments}}': booking.notes || ''
        });
      } catch (emailError) {
        console.error('Failed to send templated email:', emailError);
        // Fallback or just ignore if it's secondary
      }

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
    if (extensionPayment > 0 && !selectedAccountId) {
      toast.error('Please select an account for the payment');
      return;
    }

    setLoading(true);
    try {
      const currentEndDate = parseISO(booking.endDate);
      const newEndDate = addDays(currentEndDate, extensionDays);

      // 1. Update Booking
      await updateDoc(doc(db, 'bookings', booking.id), {
        endDate: newEndDate.toISOString(),
        paymentStatus: 'pending'
      });

      // 2. Log Income to Finance
      if (extensionPayment > 0) {
        const account = accounts.find(a => a.id === selectedAccountId);
        
        await addDoc(collection(db, 'transactions'), {
          type: 'Income',
          amount: Number(extensionPayment),
          date: new Date().toISOString(),
          category: 'Rental Extension',
          carId: booking.carId,
          bookingId: booking.id,
          accountId: selectedAccountId,
          description: `Extension payment (+${extensionDays} days) from ${booking.customerName}`
        });

        // Update Account Balance
        if (account) {
          await updateDoc(doc(db, 'accounts', account.id), {
            balance: (account.balance || 0) + Number(extensionPayment)
          });
        }
      }

      // 3. Send Email
      try {
        const startDate = parseISO(booking.startDate);
        const endDate = newEndDate;

        await sendTemplatedEmail('extension_acknowledged', booking.email || 'info@pattayarentacar.com', {
          '{{customer_name}}': booking.customerName,
          '{{customer_email}}': booking.email || '',
          '{{customer_phone}}': booking.mobileNumber || '',
          '{{vehicle_model}}': carName,
          '{{pickup_date}}': format(startDate, 'dd MMM yyyy'),
          '{{pickup_time}}': format(startDate, 'HH:mm'),
          '{{return_date}}': format(endDate, 'dd MMM yyyy'),
          '{{return_time}}': format(endDate, 'HH:mm'),
          '{{rental_period}}': `${format(startDate, 'dd MMM yyyy')} to ${format(endDate, 'dd MMM yyyy')}`,
          '{{total_price}}': extensionPayment.toLocaleString(),
          '{{delivery_address}}': booking.deliveryAddress || '',
          '{{comments}}': booking.notes || ''
        });
      } catch (emailError) {
        console.error('Failed to send templated email:', emailError);
      }

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
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Final Extra Charges (฿)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-orange font-bold text-sm">฿</span>
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
              <div className="space-y-2 col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Account Type / Payment Method</label>
                <select
                  value={returnAccountId}
                  onChange={e => setReturnAccountId(e.target.value)}
                  className="w-full bg-black/5 border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all appearance-none"
                >
                  <option value="" disabled>Select Account</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <div className="h-[1px] bg-black/5 relative">
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-4 text-[8px] font-bold text-black/10 uppercase tracking-[0.3em]">Quick Actions</span>
          </div>

          {/* Feature 2: Extend Rental */}
          <section className="space-y-6">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 text-left">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Extension Payment (฿)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 font-bold text-sm">฿</span>
                    <input
                      type="number"
                      value={extensionPayment}
                      onChange={e => setExtensionPayment(Number(e.target.value))}
                      className="w-full bg-black/5 border-0 p-4 pl-10 rounded-2xl text-sm font-bold focus:ring-2 ring-blue-500 outline-none transition-all"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="space-y-2 text-left">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Payment Account</label>
                  <select
                    value={selectedAccountId}
                    onChange={e => setSelectedAccountId(e.target.value)}
                    className="w-full bg-black/5 border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-blue-500 outline-none transition-all appearance-none"
                  >
                    <option value="" disabled>Select Account</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Floating Action Bar (Manage Rental) */}
        <div className="p-6 bg-white/60 backdrop-blur-xl border-t border-black/5 flex gap-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
          <button
            onClick={handleEndRental}
            disabled={loading}
            className="flex-1 h-14 bg-emerald-500 text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 active:translate-y-[2px] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Check size={16} /> Complete Return</>}
          </button>
          <button
            onClick={handleExtendRental}
            disabled={loading}
            className="flex-1 h-14 bg-blue-500 text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 active:translate-y-[2px] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Zap size={16} /> Confirm Extension</>}
          </button>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

const getBrandSlug = (name: string) => {
  const n = (name || '').toLowerCase();
  if (n.includes('toyota')) return 'toyota';
  if (n.includes('honda')) return 'honda';
  if (n.includes('ford')) return 'ford';
  if (n.includes('nissan')) return 'nissan';
  if (n.includes('mg')) return 'mg';
  return null;
};

const cleanCarName = (name: string) => {
  if (!name) return '';
  return name?.replace(/Toyota|Honda|Ford|MG|Nissan/gi, '')?.trim() || '';
};

const CarRow: React.FC<CarRowProps> = React.memo(({
  car,
  daysInMonth,
  bookings,
  handleRowClick,
  handleRowContextMenu,
  getBookingStyle,
  handleBookingBarClick,
  handleBookingContextMenu,
  getCarTypeStyles,
  onManageBooking,
  onQuickNoteEdit,
  isReorderMode
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
      <div className="w-[120px] md:w-[200px] min-w-[120px] md:min-w-[200px] max-w-[120px] md:max-w-[200px] flex-shrink-0 border-r border-b border-black/10 bg-white/60 sticky left-0 z-20 px-2 py-0.5 flex items-center gap-1 backdrop-blur-md group-hover:bg-brand-orange/5 transition-colors overflow-hidden">
        <div className={cn("w-1 h-full absolute left-0", typeStyles.bg)} />
        
        {isReorderMode && (
          <div className="cursor-grab active:cursor-grabbing p-1 hover:bg-black/5 rounded text-black/20 group-hover:text-black/40">
            <GripVertical size={12} />
          </div>
        )}

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
              {car.yearOfManufacture ? car.yearOfManufacture.toString().slice(-4) : ''}
            </span>
            {car.engineSize && (
              <span className="text-[8px] text-[#1A1A1A]/40 font-medium shrink-0">
                {car.engineSize?.toString()?.replace(/cc/gi, '') || ''}
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
        {[...bookings.filter(b => b.carId === car.id)].sort((a, b) => differenceInDays(parseISO(b.endDate), parseISO(b.startDate)) - differenceInDays(parseISO(a.endDate), parseISO(a.startDate))).map(booking => {
          const style = getBookingStyle(booking);
          if (!style) return null;
          return (
              <div
              key={booking.id}
              onClick={(e) => handleBookingBarClick(booking, e)}
              onContextMenu={(e) => { e.preventDefault(); handleBookingContextMenu(e, booking); }}
              className={cn(
                "absolute h-6 top-1 rounded-md shadow-sm cursor-pointer z-10 px-1.5 py-0 flex flex-col justify-center border border-white/20 backdrop-blur-sm booking-bar group/booking",
                booking.isMaintenance && "maintenance-pattern"
              )}
              style={style || {}}
            >
              <div className="flex items-center w-full h-full relative">
                {!booking.isMaintenance && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickNoteEdit(booking, 'deliveryNotes', e.currentTarget.getBoundingClientRect());
                    }}
                    className={cn(
                      "absolute left-1 z-20 p-0.5 rounded transition-all shadow-sm flex items-center justify-center",
                      booking.deliveryNotes?.trim() 
                        ? "text-emerald-700 bg-white ring-1 ring-emerald-500/50" 
                        : "text-[#1A1A1A]/40 bg-white/40 ring-1 ring-black/5"
                    )}
                    title="Start Note"
                  >
                    <Clipboard size={10} />
                  </button>
                )}

                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-widest truncate leading-none flex-1 min-w-0 text-left pl-6 pr-12",
                  booking.isMaintenance ? "text-white/90" : (booking.paymentStatus === 'pending' ? "text-black" : "text-[#1A1A1A]")
                )}>
                  {booking.isMaintenance ? (booking.maintenanceDescription || 'Maintenance') : booking.customerName}
                </span>
                
                {!booking.isMaintenance && (
                  <div className="absolute right-1 z-20 flex items-center gap-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickNoteEdit(booking, 'returnNote', e.currentTarget.getBoundingClientRect());
                      }}
                      className={cn(
                        "p-0.5 rounded transition-all shadow-sm flex items-center justify-center",
                        booking.returnNote?.trim() 
                          ? "text-amber-700 bg-white ring-1 ring-amber-500/50" 
                          : "text-[#1A1A1A]/40 bg-white/40 ring-1 ring-black/5"
                      )}
                      title="End Note"
                    >
                      <AlertTriangle size={10} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onManageBooking(booking);
                      }}
                      className="p-0.5 bg-white/60 hover:bg-white rounded-md transition-all shadow-sm border border-black/5"
                      title="Manage Rental"
                    >
                      <Settings size={10} className="text-[#1A1A1A]" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const QuickNotePopup: React.FC<{
  booking: Booking;
  field: 'deliveryNotes' | 'returnNote';
  rect: DOMRect;
  onSave: (notes: string) => Promise<void>;
  onClose: () => void;
}> = ({ booking, field, rect, onSave, onClose }) => {
  const [value, setValue] = useState(booking[field] || '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSavedValue = useRef(booking[field] || '');
  
  // Debounce save
  useEffect(() => {
    if (value === lastSavedValue.current) return;
    
    const timer = setTimeout(() => {
      saveData(value);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [value]);

  const saveData = async (newValue: string) => {
    if (newValue === lastSavedValue.current) return;
    setStatus('saving');
    try {
      await onSave(newValue);
      lastSavedValue.current = newValue;
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (error) {
      setStatus('error');
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.quick-note-popup')) {
        // Save one last time on close if needed
        if (value !== lastSavedValue.current) {
          saveData(value).finally(onClose);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, value]);

  const isBottomHalf = rect.bottom > window.innerHeight * 0.6;
  
  return (
    <div 
      className="fixed z-[1000000] quick-note-popup bg-white shadow-2xl rounded-xl border border-black/10 p-3 w-64 animate-in fade-in zoom-in duration-200"
      style={{ 
        top: isBottomHalf ? `${rect.top - 8}px` : `${rect.bottom + 8}px`,
        left: `${Math.min(window.innerWidth - 264, Math.max(8, rect.left - 110))}px`,
        transform: isBottomHalf ? 'translateY(-100%)' : 'translateY(0)'
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-6 h-6 rounded-lg flex items-center justify-center",
            field === 'deliveryNotes' ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
          )}>
            {field === 'deliveryNotes' ? <Clipboard size={14} /> : <AlertTriangle size={14} />}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">
            {field === 'deliveryNotes' ? 'Start Note' : 'End Note'}
          </span>
        </div>
        
        <div className="flex items-center gap-1">
          {status === 'saving' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 animate-pulse">
              <Loader2 size={10} className="animate-spin" />
              <span className="text-[8px] font-bold uppercase tracking-wider">Saving</span>
            </div>
          )}
          {status === 'saved' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
              <Check size={10} />
              <span className="text-[8px] font-bold uppercase tracking-wider">Saved</span>
            </div>
          )}
          {status === 'error' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
              <AlertCircle size={10} />
              <span className="text-[8px] font-bold uppercase tracking-wider">Failed</span>
            </div>
          )}
        </div>
      </div>
      <textarea
        autoFocus
        className="w-full h-24 text-xs p-2 bg-gray-50 rounded-lg border border-transparent focus:border-brand-orange/30 outline-none resize-none transition-all"
        placeholder={`Add a ${field === 'deliveryNotes' ? 'start' : 'end'} note...`}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => saveData(value)}
      />
    </div>
  );
};

export const Timeline: React.FC<TimelineProps> = ({ cars = [], bookings = [], currentDate, newBookingTrigger, onLogIncome, onRefresh, title = "Car Fleet" }) => {
  const [quickNoteEdit, setQuickNoteEdit] = useState<{
    booking: Booking;
    field: 'deliveryNotes' | 'returnNote';
    rect: DOMRect;
  } | null>(null);

  const handleQuickNoteSave = async (notes: string) => {
    if (!quickNoteEdit) return;
    try {
      await updateDoc(doc(db, 'bookings', quickNoteEdit.booking.id), {
        [quickNoteEdit.field]: notes
      });
      // We don't close the popup here to allow continuous editing with feedback
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${quickNoteEdit.booking.id}`);
      throw error;
    }
  };

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
    returnNote: '',
    deliveryLocation: undefined,
    isMaintenance: false,
    maintenanceDescription: '',
    paymentStatus: 'paid'
  });

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [pickUpTime, setPickUpTime] = useState('09:30');
  const [dropOffTime, setDropOffTime] = useState('09:30');
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
  
  const [showImportantInfo, setShowImportantInfo] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const vehicleSuggestionsRef = useRef<HTMLDivElement>(null);
  const [vehicleSearchQuery, setVehicleSearchQuery] = useState('');
  const [isVehicleDropdownOpen, setIsVehicleDropdownOpen] = useState(false);

  const filteredFleet = useMemo(() => {
    const query = (vehicleSearchQuery || '').toLowerCase();
    if (!query) return cars.slice(0, 10);
    return cars
      .filter(car => {
        const name = (car.name || '').toLowerCase();
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
      // Click outside to close summary
      const target = event.target as HTMLElement;
      if (summaryBookingInfo && !target.closest('.booking-summary-popover') && !target.closest('.booking-bar')) {
        setSummaryBookingInfo(null);
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
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

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
    const sorted = [...cars].filter(c => c.name && c.name.trim()).sort((a, b) => {
      const orderA = a.sortOrder ?? a.order ?? 0;
      const orderB = b.sortOrder ?? b.order ?? 0;
      return orderA - orderB;
    });
    setSortedCars(sorted);
  }, [cars, isReorderMode]); // Re-sort when reorder mode is toggled if we cancelled

  const handleSaveOrder = async () => {
    setIsSavingOrder(true);
    try {
      const batch = writeBatch(db);
      sortedCars.forEach((car, index) => {
        const carRef = doc(db, 'cars', car.id);
        batch.update(carRef, { sortOrder: index });
      });
      await batch.commit();
      
      await logSystemActivity(
        'Rearrange Fleet',
        `Updated vehicle display order for ${title}`,
        'Fleet'
      );
      
      toast.success('Vehicle order saved');
      setIsReorderMode(false);
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Error saving car order:', error);
      toast.error('Failed to save vehicle order');
    } finally {
      setIsSavingOrder(false);
    }
  };

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

  const handleSaveMaintenancePeriod = React.useCallback(async (bookingId: string, newStart: string, newEnd: string) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), {
        startDate: new Date(newStart + 'T00:00:00').toISOString(),
        endDate: new Date(newEnd + 'T23:59:59').toISOString(),
      });
      setMaintenanceEditModal(null);
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Failed to update maintenance period:', error);
    }
  }, [onRefresh]);

  const [earlyReturnModal, setEarlyReturnModal] = useState<{ booking: Booking } | null>(null);
  const [earlyReturnDate, setEarlyReturnDate] = useState('');
  const [earlyReturnRefund, setEarlyReturnRefund] = useState('');
  const [earlyReturnAccountId, setEarlyReturnAccountId] = useState('');
  const [earlyReturnSaving, setEarlyReturnSaving] = useState(false);

  const handleEarlyReturn = React.useCallback(async () => {
    if (!earlyReturnModal) return;
    const booking = earlyReturnModal.booking;
    setEarlyReturnSaving(true);
    try {
      const newEndDate = new Date(earlyReturnDate + 'T23:59:59').toISOString();

      // 1. Update booking
      await updateDoc(doc(db, 'bookings', booking.id), {
        endDate: newEndDate,
        status: 'Completed',
      });

      // 2. Log refund transaction if amount entered
      const refundAmount = parseFloat(earlyReturnRefund) || 0;
      if (refundAmount > 0 && earlyReturnAccountId) {
        const txRef = doc(collection(db, 'transactions'));
        const accSnap = await getDoc(doc(db, 'accounts', earlyReturnAccountId));
        const currentBalance = accSnap.exists() ? (accSnap.data().balance || 0) : 0;
        const batch = writeBatch(db);
        batch.set(txRef, {
          type: 'Expense',
          amount: refundAmount,
          date: new Date().toISOString(),
          category: 'Rental Refund',
          carId: booking.carId || null,
          bookingId: booking.id,
          accountId: earlyReturnAccountId,
          description: `Early return refund - ${booking.customerName}`,
        });
        batch.update(doc(db, 'accounts', earlyReturnAccountId), {
          balance: currentBalance - refundAmount,
        });
        await batch.commit();
      }

      // 3. Send return confirmation email
      if (booking.email) {
        try {
          const carSnap = await getDoc(doc(db, 'cars', booking.carId || ''));
          const carName = carSnap.exists() ? carSnap.data().name : (booking.requestedCarType || 'Vehicle');
          const plateNumber = carSnap.exists() ? (carSnap.data().plateNumber || '') : '';
          const startDate = parseISO(booking.startDate);
          const returnDate = new Date(earlyReturnDate + 'T23:59:59');
          await sendTemplatedEmail('return_confirmation', booking.email, {
            '{{customer_name}}': booking.customerName,
            '{{customer_email}}': booking.email,
            '{{customer_phone}}': booking.mobileNumber || '',
            '{{vehicle_model}}': carName,
            '{{plate_number}}': plateNumber,
            '{{pickup_date}}': format(startDate, 'dd MMM yyyy'),
            '{{pickup_time}}': format(startDate, 'HH:mm'),
            '{{return_date}}': format(returnDate, 'dd MMM yyyy'),
            '{{return_time}}': format(returnDate, 'HH:mm'),
            '{{rental_period}}': `${format(startDate, 'dd MMM yyyy')} to ${format(returnDate, 'dd MMM yyyy')}`,
            '{{total_price}}': (booking.amount || 0).toLocaleString(),
            '{{delivery_address}}': booking.deliveryAddress || '',
            '{{comments}}': booking.notes || '',
          });
        } catch (emailErr) {
          console.error('Early return email failed:', emailErr);
        }
      }

      setEarlyReturnModal(null);
      if (onRefresh) onRefresh();
      toast.success('Rental ended. Booking updated, refund logged, email sent.');
    } catch (err) {
      console.error('Early return failed:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setEarlyReturnSaving(false);
    }
  }, [earlyReturnModal, earlyReturnDate, earlyReturnRefund, earlyReturnAccountId, onRefresh]);

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

  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Auth observer to handle reactive updates and loading state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;
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
      (c.firstName || '').toLowerCase().includes(search) ||
      (c.lastName || '').toLowerCase().includes(search) ||
      (c.email || '').toLowerCase().includes(search)
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
    const activeCars = cars.filter(c => c.isActive !== false);
    
    return visibleDays.map(day => {
      const amStart = startOfDay(day);
      const amEnd = new Date(day);
      amEnd.setHours(11, 59, 59, 999);

      const pmStart = new Date(day);
      pmStart.setHours(12, 0, 0, 0);
      const pmEnd = endOfDay(day);

      let amAvailable = 0;
      let pmAvailable = 0;

      activeCars.forEach(car => {
        const carBookings = bookings.filter(b => b.carId === car.id);
        
        const isAmBooked = carBookings.some(b => {
          const start = parseISO(b.startDate);
          const end = parseISO(b.endDate);
          return (start <= amEnd && end >= amStart);
        });

        const isPmBooked = carBookings.some(b => {
          const start = parseISO(b.startDate);
          const end = parseISO(b.endDate);
          return (start <= pmEnd && end >= pmStart);
        });

        if (!isAmBooked) amAvailable++;
        if (!isPmBooked) pmAvailable++;
      });

      return {
        am: amAvailable,
        pm: pmAvailable
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
  const [maintenanceEditModal, setMaintenanceEditModal] = useState<{ booking: Booking } | null>(null);
  const [maintenanceStartDate, setMaintenanceStartDate] = useState('');
  const [maintenanceEndDate, setMaintenanceEndDate] = useState('');

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
          const names = (dataToSave.customerName || '').split(' ');
          const firstName = names[0] || '';
          const lastName = names.slice(1).join(' ');

          try {
            const customerResult = await upsertCustomer({
              firstName,
              lastName,
              email: dataToSave.email,
              mobileNumber: dataToSave.mobileNumber || '',
              source: 'staff_booking',
            });

            // Legacy: write delivery location to customer.location for Timeline pre-fill UX
            if (dataToSave.deliveryLocation) {
              await updateDoc(doc(db, 'customers', customerResult.customerId), {
                location: {
                  ...dataToSave.deliveryLocation,
                  address: dataToSave.deliveryAddress,
                },
              });
            }

            if (customerResult.created) {
              toast.success('New customer added to CRM');
            }
          } catch (err) {
            console.error("Error upserting customer:", err);
            toast.error('Failed to add customer to CRM');
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
  const [summaryBookingInfo, setSummaryBookingInfo] = useState<{ id: string; clientX: number; clientY: number } | null>(null);
  
  const summaryBooking = useMemo(() => {
    if (!summaryBookingInfo) return null;
    const b = bookings.find(x => x.id === summaryBookingInfo.id);
    if (!b) return null;
    return { booking: b, clientX: summaryBookingInfo.clientX, clientY: summaryBookingInfo.clientY };
  }, [bookings, summaryBookingInfo]);

  const handleBookingBarClick = (booking: Booking, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setSummaryBookingInfo({ 
      id: booking.id, 
      clientX: e.clientX, 
      clientY: e.clientY
    });
  };

  const handleOpenManageModal = (booking: Booking) => {
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
  };

  const getCarTypeStyles = (type: string) => {
    const t = (type || '').toLowerCase();
    if (t.includes('economy') || t.includes('small')) return { color: 'text-blue-500', bg: 'bg-blue-500', icon: CarIconType };
    if (t.includes('sedan') || t.includes('medium')) return { color: 'text-emerald-500', bg: 'bg-emerald-500', icon: CarIconType };
    if (t.includes('suv') || t.includes('large')) return { color: 'text-purple-500', bg: 'bg-purple-500', icon: CarIconType };
    if (t.includes('truck') || t.includes('van')) return { color: 'text-amber-500', bg: 'bg-amber-500', icon: TruckIcon };
    if (t.includes('luxury')) return { color: 'text-rose-500', bg: 'bg-rose-500', icon: CarIconType };
    if (t.includes('bike') || t.includes('motor')) return { color: 'text-indigo-500', bg: 'bg-indigo-500', icon: Bike };
    if (t.includes('mpv')) return { color: 'text-teal-500', bg: 'bg-teal-500', icon: CarIconType };
    return { color: 'text-gray-500', bg: 'bg-gray-500', icon: CarIconType };
  };

  const getBookingStyle = (booking: Booking) => {
    const start = parseISO(booking.startDate);
    const end = parseISO(booking.endDate);
    
    if (!isValid(start) || !isValid(end)) return null;

    const timelineStart = startOfDay(visibleDays[0]);
    const timelineEnd = endOfDay(visibleDays[visibleDays.length - 1]);

    // Filter bookings that overlap with visible range
    if (end < timelineStart || start > timelineEnd) return null;

    const visibleStart = start < timelineStart ? timelineStart : start;
    const visibleEnd = end > timelineEnd ? timelineEnd : end;

    const startDayIdx = differenceInDays(startOfDay(visibleStart), timelineStart);
    const startSlot = visibleStart.getHours() >= 12 ? 1 : 0;
    
    const endDayIdx = differenceInDays(startOfDay(visibleEnd), timelineStart);
    const endSlot = visibleEnd.getHours() >= 12 ? 1 : 0;
    
    const startSlotIdx = startDayIdx * 2 + startSlot;
    const endSlotIdx = endDayIdx * 2 + endSlot;
    const totalSlots = Math.max(endSlotIdx - startSlotIdx + 1, 1);

    const status = (booking.status || '').toLowerCase();
    const isPaid = status === 'paid' || status === 'completed';
    const isCompleted = status === 'completed';
    const isMaintenance = !!booking.isMaintenance;
    const paymentPending = booking.paymentStatus === 'pending';
    const isFutureBooking = isFuture(startOfDay(start));
    const car = cars.find(c => c.id === (booking.carId || 'unassigned'));
    const pricePerDay = car?.pricePerDay || 0;

    const RED_500 = '#EF4444';
    const EMERALD_500 = '#10B981';
    const YELLOW_400 = '#FACC15';
    const GRAY_600 = '#4B5563';

    const isUnassigned = !booking.carId || booking.carId === '' || booking.carId === 'unassigned';

    let background = EMERALD_500;

    if (isMaintenance) {
      background = GRAY_600;
    } else if (isUnassigned) {
      background = 'rgba(139, 92, 246, 0.72)';
    } else if (isCompleted) {
      // Completed returns are always solid green
      background = EMERALD_500;
    } else if (isFutureBooking && !isPaid) {
      // High Priority - Future Unpaid (Red)
      background = RED_500;
    } else if (isPaid && paymentPending) {
      // Medium Priority - Paid with Unpaid Extension (Split)
      // Calculate split point based on original payment
      let splitPercentage = 70; 
      if (pricePerDay > 0 && (booking.amount || 0) > 0) {
        const originalDays = Math.round((booking.amount || 0) / pricePerDay);
        const originalEndDate = addDays(start, originalDays);
        const originalEndSlotIdxOverall = differenceInDays(startOfDay(originalEndDate), timelineStart) * 2 + (originalEndDate.getHours() >= 12 ? 1 : 0);
        
        if (originalEndSlotIdxOverall > startSlotIdx && originalEndSlotIdxOverall < endSlotIdx) {
          const relativeSplit = originalEndSlotIdxOverall - startSlotIdx;
          splitPercentage = (relativeSplit / totalSlots) * 100;
        }
      }
      background = `linear-gradient(to right, ${EMERALD_500} 0%, ${EMERALD_500} ${splitPercentage}%, ${YELLOW_400} ${splitPercentage}%, ${YELLOW_400} 100%)`;
    } else if (!isPaid) {
      // Low Priority - Standard Unpaid (Yellow)
      // Catch bookings starting today or in the past that aren't paid
      background = YELLOW_400;
    } else {
      // Default - Fully Paid (Green)
      background = EMERALD_500;
    }

    return {
      left: `${startSlotIdx * 36}px`,
      width: `${totalSlots * 36}px`,
      background: background,
      border: '1px solid rgba(0,0,0,0.1)'
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

  const handleRowClick = useCallback((e: React.MouseEvent, _carId: string) => {
    const target = e.target as HTMLElement;
    // Don't trigger if clicking a booking bar
    if (target.closest('.booking-bar')) return;
    
    // Close summary if open
    if (summaryBookingInfo) {
      setSummaryBookingInfo(null);
    }
  }, [summaryBookingInfo]);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, carId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('.booking-bar')) return;
    const { day, slot } = getSlotFromEvent(e);
    handleSlotContextMenu(e, carId, day, slot);
  }, [visibleDays, clipboard, handleSlotContextMenu]);

  if (isAuthLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-warm-bg text-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Loader2 className="w-12 h-12 text-brand-orange animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-serif italic mb-2">Loading Timeline...</h2>
          <p className="text-xs text-black/40">Synchronizing your fleet data...</p>
        </motion.div>
      </div>
    );
  }

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
    <div className="flex-1 flex flex-col bg-warm-bg overflow-hidden h-full">
      <div 
        ref={timelineContainerRef} 
        onScroll={handleScroll}
        className={cn(
          "flex-1 overflow-auto custom-scrollbar relative",
          isScrolling && "is-scrolling"
        )}
      >
        <div className="inline-block min-w-full">
          {/* Timeline Header */}
          <div className="flex flex-col sticky top-0 z-[90] bg-warm-bg border-b border-black/10">
            <div className="flex bg-warm-bg">
              <div className="w-[120px] md:w-[200px] min-w-[120px] md:min-w-[200px] max-w-[120px] md:max-w-[200px] flex-shrink-0 border-r border-b border-black/10 bg-warm-bg sticky left-0 z-50 p-2 flex items-center justify-between backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <span className="font-serif italic text-sm text-[#1A1A1A]">{title}</span>
                  </div>
                </div>
                {!isReorderMode ? (
                  <button
                    onClick={() => setIsReorderMode(true)}
                    className="p-1.5 hover:bg-black/5 rounded-lg text-black/40 hover:text-brand-orange transition-all group/btn"
                    title="Rearrange Vehicles"
                  >
                    <ArrowUpDown size={14} className="group-hover/btn:scale-110 transition-transform" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setIsReorderMode(false)}
                      disabled={isSavingOrder}
                      className="p-1 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors"
                      title="Cancel"
                    >
                      <X size={12} />
                    </button>
                    <button
                      onClick={handleSaveOrder}
                      disabled={isSavingOrder}
                      className="p-1 bg-emerald-50 text-emerald-600 rounded-md hover:bg-emerald-100 transition-colors"
                      title="Save Order"
                    >
                      {isSavingOrder ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex">
                {monthsInView.map(({ month, days }) => (
                  <div key={month.toISOString()} className="flex flex-col border-r border-black/10 last:border-r-0">
                    <div className="sticky top-0 z-50 py-1.5 px-4 text-[10px] font-bold uppercase tracking-[0.3em] bg-warm-bg text-[#1A1A1A]/80 border-b border-black/5 flex items-center gap-2">
                      <Calendar size={10} className="text-brand-orange" />
                      {format(month, 'MMMM yyyy')}
                    </div>
                    <div className="flex">
                      {days.map(day => (
                        <div key={day.toISOString()} className="w-[72px] flex-shrink-0 border-r last:border-r-0 border-black/5 bg-warm-bg">
                          <div className={cn(
                            "text-center py-1 text-[9px] font-bold uppercase tracking-wider",
                            isSameDay(day, new Date()) ? "bg-brand-orange text-white" : "bg-brand-orange/5 text-brand-orange"
                          )}>
                            {format(day, 'EEE d')}
                          </div>
                          <div className="flex text-[8px] font-bold text-center border-t border-black/5 text-[#1A1A1A]/60">
                            <div className="w-1/2 py-1 border-r border-black/5 font-mono">AM</div>
                            <div className="w-1/2 py-1 font-mono">PM</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Availability Row */}
            <div className="flex h-7 bg-green-50/50 border-b border-black/10">
              <div className="w-[120px] md:w-[200px] min-w-[120px] md:min-w-[200px] max-w-[120px] md:max-w-[200px] flex-shrink-0 border-r border-black/10 bg-green-50 sticky left-0 z-50 px-3 flex items-center backdrop-blur-md">
                <span className="text-[10px] font-bold text-green-700 uppercase tracking-widest whitespace-nowrap">Cars Available</span>
              </div>
              <div className="flex bg-warm-bg/50">
                {availabilityData.map((data, idx) => (
                  <div key={idx} className="w-[72px] flex-shrink-0 flex items-center border-r border-black/5 last:border-r-0">
                    <div className={cn(
                      "w-1/2 text-center text-[10px] leading-none",
                      data.am < 5 ? "text-red-600 font-bold" : "text-green-700 font-medium"
                    )}>
                      {data.am}
                    </div>
                    <div className={cn(
                      "w-1/2 text-center text-[10px] leading-none",
                      data.pm < 5 ? "text-red-600 font-bold" : "text-green-700 font-medium"
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
              <div className="w-[120px] md:w-[200px] min-w-[120px] md:min-w-[200px] max-w-[120px] md:max-w-[200px] flex-shrink-0 border-r border-b border-black/10 bg-white/60 sticky left-0 z-20 px-3 py-0 flex items-center gap-2 backdrop-blur-md group-hover:bg-brand-orange/10 transition-colors">
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
                {[...bookings.filter(b => !b.carId || b.carId === '')].sort((a, b) => differenceInDays(parseISO(b.endDate), parseISO(b.startDate)) - differenceInDays(parseISO(a.endDate), parseISO(a.startDate))).map(booking => {
                  const style = getBookingStyle(booking);
                  if (!style) return null;
                  return (
                    <div
                      key={booking.id}
                      onClick={(e) => handleBookingBarClick(booking, e)}
                      onContextMenu={(e) => { e.preventDefault(); handleBookingContextMenu(e, booking); }}
                      className={cn(
                        "absolute h-6 top-1 rounded-md shadow-sm cursor-pointer z-10 px-1.5 py-0 flex flex-col justify-center border border-white/20 backdrop-blur-sm booking-bar group/booking",
                        booking.isMaintenance && "maintenance-pattern"
                      )}
                      style={style || {}}
                    >
                      <div className="flex items-center w-full h-full relative">
                        {!booking.isMaintenance && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setQuickNoteEdit({
                                booking,
                                field: 'deliveryNotes',
                                rect: e.currentTarget.getBoundingClientRect()
                              });
                            }}
                            className={cn(
                              "absolute left-1 z-20 p-0.5 rounded transition-all shadow-sm flex items-center justify-center",
                              booking.deliveryNotes?.trim() 
                                ? "text-emerald-700 bg-white ring-1 ring-emerald-500/50" 
                                : "text-[#1A1A1A]/40 bg-white/40 ring-1 ring-black/5"
                            )}
                            title="Start Note"
                          >
                            <Clipboard size={10} />
                          </button>
                        )}

                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-widest truncate leading-none flex-1 min-w-0 text-left pl-6 pr-12",
                          booking.isMaintenance ? "text-white/90" : "text-[#1A1A1A]"
                        )}>
                          {booking.isMaintenance ? (booking.maintenanceDescription || 'Maintenance') : booking.customerName}
                        </span>
                        
                        {!booking.isMaintenance && (
                          <div className="absolute right-1 z-20 flex items-center gap-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setQuickNoteEdit({
                                  booking,
                                  field: 'returnNote',
                                  rect: e.currentTarget.getBoundingClientRect()
                                });
                              }}
                              className={cn(
                                "p-0.5 rounded transition-all shadow-sm flex items-center justify-center",
                                booking.returnNote?.trim() 
                                  ? "text-amber-700 bg-white ring-1 ring-amber-500/50" 
                                  : "text-[#1A1A1A]/40 bg-white/40 ring-1 ring-black/5"
                              )}
                              title="End Note"
                            >
                              <AlertTriangle size={10} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setManageBooking(booking);
                                setIsManageModalOpen(true);
                              }}
                              className="p-0.5 bg-white/60 hover:bg-white rounded-md transition-all shadow-sm border border-black/5"
                              title="Manage Rental"
                            >
                              <Settings size={10} className="text-[#1A1A1A]" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="relative overflow-visible">
              {cars.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <div className="bg-white/40 backdrop-blur-md p-8 border border-white/60 rounded-[32px] flex flex-col items-center gap-4 shadow-xl max-w-sm text-center">
                    <div className="w-16 h-16 bg-brand-orange/10 rounded-2xl flex items-center justify-center">
                      <TruckIcon size={32} className="text-brand-orange/20" />
                    </div>
                    <h3 className="font-serif italic text-lg text-[#1A1A1A]">No Vehicles Found</h3>
                    <p className="text-xs text-[#1A1A1A]/40 leading-relaxed uppercase tracking-widest font-bold">
                      There are no active {(title?.toLowerCase() || 'vehicles')} in this category.
                    </p>
                  </div>
                </div>
              ) : isReorderMode ? (
                <Reorder.Group axis="y" values={sortedCars} onReorder={setSortedCars} as="div">
                  {sortedCars.map(car => (
                    <Reorder.Item key={car.id} value={car} as="div">
                      <CarRow
                        car={car}
                        daysInMonth={visibleDays}
                        bookings={bookings}
                        handleRowClick={handleRowClick}
                        handleRowContextMenu={handleRowContextMenu}
                        getBookingStyle={getBookingStyle}
                        handleBookingBarClick={handleBookingBarClick}
                        handleBookingContextMenu={handleBookingContextMenu}
                        getCarTypeStyles={getCarTypeStyles}
                        onManageBooking={(booking) => {
                          setManageBooking(booking);
                          setIsManageModalOpen(true);
                        }}
                        onQuickNoteEdit={(booking, field, rect) => {
                          setQuickNoteEdit({ booking, field, rect });
                        }}
                        isReorderMode={true}
                      />
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              ) : (
                sortedCars.map(car => (
                  <CarRow
                    key={car.id}
                    car={car}
                    daysInMonth={visibleDays}
                    bookings={bookings}
                    handleRowClick={handleRowClick}
                    handleRowContextMenu={handleRowContextMenu}
                    getBookingStyle={getBookingStyle}
                    handleBookingBarClick={handleBookingBarClick}
                    handleBookingContextMenu={handleBookingContextMenu}
                    getCarTypeStyles={getCarTypeStyles}
                    onManageBooking={(booking) => {
                      setManageBooking(booking);
                      setIsManageModalOpen(true);
                    }}
                    onQuickNoteEdit={(booking, field, rect) => {
                      setQuickNoteEdit({ booking, field, rect });
                    }}
                    isReorderMode={false}
                  />
                ))
              )}
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

      {/* Booking Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md pointer-events-auto">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-white border border-black/10 max-w-2xl w-full shadow-2xl rounded-[40px] flex flex-col max-h-[90vh] overflow-y-auto relative"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-white/80 backdrop-blur-xl border-b border-black/5 p-8 flex justify-between items-start shrink-0 relative">
                <div>
                  <h2 className="font-serif italic text-3xl text-gray-900 pr-12">
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
                  className="absolute top-8 right-8 w-10 h-10 flex items-center justify-center rounded-full bg-black/5 hover:bg-brand-orange hover:text-white transition-all shadow-sm shrink-0 z-[100]"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="grow p-8 flex flex-col">
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
              const firstName = names[0] || '';
              const lastName = names.slice(1).join(' ');

              try {
                const result = await upsertCustomer({
                  firstName,
                  lastName,
                  email: editingBooking.email,
                  mobileNumber: editingBooking.mobileNumber || '',
                  source: 'crm_manual',
                });
                if (result.created) {
                  toast.success('Customer added to CRM');
                } else {
                  toast.success('Customer already in CRM — enriched with booking details');
                }
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
                      {editingBooking.amount ? `฿${editingBooking.amount.toLocaleString()}` : '฿0'}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-1">Deposit Held</p>
                    <p className="text-2xl font-bold text-emerald-600 bg-white/40 p-4 rounded-2xl border border-white/60">
                      {editingBooking.deposit ? `฿${editingBooking.deposit.toLocaleString()}` : '฿0'}
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
                            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-2">Start Note</p>
                            <p className="text-sm text-gray-700 italic leading-relaxed">{editingBooking.deliveryNotes}</p>
                          </div>
                        )}
                        {editingBooking.returnNote && (
                          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-2">End Note</p>
                            <p className="text-sm text-gray-700 font-medium leading-relaxed">{editingBooking.returnNote}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4 pt-4">
                    <button
                      onClick={async () => {
                        try {
                          const newStatus = editingBooking.paymentStatus === 'pending' ? 'paid' : 'pending';
                          await updateDoc(doc(db, 'bookings', editingBooking.id), {
                            paymentStatus: newStatus
                          });
                          toast.success(`Payment marked as ${newStatus}`);
                        } catch (error) {
                          handleFirestoreError(error, OperationType.UPDATE, `bookings/${editingBooking.id}`);
                        }
                      }}
                      className={cn(
                        "h-12 px-6 border transition-all flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-[10px] rounded-full",
                        editingBooking.paymentStatus === 'pending'
                          ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/5 hover:bg-emerald-500 hover:text-white"
                          : "border-red-500/30 text-red-500 bg-red-500/5 hover:bg-red-500 hover:text-white"
                      )}
                    >
                      <Check size={16} /> 
                      {editingBooking.paymentStatus === 'pending' ? 'Mark as Paid' : 'Mark as Pending'}
                    </button>
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
                      <Check size={16} /> Log Payment to Finance
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="contents">
                  <div className="space-y-8">
                    <div className="flex items-center gap-2 pb-6 border-b border-black/5">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, isMaintenance: false })}
                        className={cn(
                          "flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all",
                          !formData.isMaintenance 
                            ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                            : "bg-black/5 text-[#1A1A1A]/40 hover:bg-black/10"
                        )}
                      >
                        <User size={14} /> Rental Booking
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, isMaintenance: true })}
                        className={cn(
                          "flex-1 h-12 flex items-center justify-center gap-2 rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all",
                          formData.isMaintenance 
                            ? "bg-gray-600 text-white shadow-lg shadow-gray-600/20" 
                            : "bg-black/5 text-[#1A1A1A]/40 hover:bg-black/10"
                        )}
                      >
                        <Wrench size={14} /> Maintenance
                      </button>
                    </div>

                    <div className="space-y-8">
                      {/* Section 1: Customer & Payment */}
                      <div className="space-y-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-brand-orange/10 flex items-center justify-center">
                            <DollarSign size={16} className="text-brand-orange" />
                          </div>
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Payment & Identity</h3>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                          <div className="space-y-2">
                             <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Payment Status</label>
                             <div className="flex gap-2 p-1 bg-black/5 rounded-[20px]">
                                <button
                                  type="button"
                                  onClick={() => setFormData({ ...formData, paymentStatus: 'paid' })}
                                  className={cn(
                                    "flex-1 h-10 rounded-[16px] font-bold uppercase tracking-widest text-[9px] transition-all",
                                    formData.paymentStatus === 'paid' ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/20" : "text-gray-400 hover:text-gray-600"
                                  )}
                                >
                                  Paid
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setFormData({ ...formData, paymentStatus: 'pending' })}
                                  className={cn(
                                    "flex-1 h-10 rounded-[16px] font-bold uppercase tracking-widest text-[9px] transition-all",
                                    formData.paymentStatus === 'pending' ? "bg-amber-400 text-black shadow-md shadow-amber-400/20" : "text-gray-400 hover:text-gray-600"
                                  )}
                                >
                                  Pending
                                </button>
                             </div>
                          </div>
                        </div>

                        {!formData.isMaintenance ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Customer Name</label>
                              <div className="relative">
                                <input
                                  type="text"
                                  className="w-full bg-black/5 border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all"
                                  value={formData.customerName}
                                  onChange={e => {
                                    setFormData({ ...formData, customerName: e.target.value });
                                    setShowCustomerSuggestions(true);
                                  }}
                                  onFocus={() => setShowCustomerSuggestions(true)}
                                  placeholder="Full Name"
                                  required={!formData.isMaintenance}
                                />
                                <AnimatePresence>
                                  {showCustomerSuggestions && filteredCustomers.length > 0 && (
                                    <motion.div
                                      ref={suggestionsRef}
                                      initial={{ opacity: 0, y: -10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: -10 }}
                                      className="absolute z-50 left-0 right-0 mt-2 bg-white border border-black/10 shadow-2xl rounded-2xl max-h-48 overflow-y-auto"
                                    >
                                      {filteredCustomers.map(customer => (
                                        <button
                                          key={customer.id}
                                          type="button"
                                          onClick={() => handleSelectCustomer(customer)}
                                          className="w-full p-3 text-left hover:bg-brand-orange hover:text-white flex items-center justify-between border-b border-black/5 last:border-0 transition-colors"
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
                              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Email Address</label>
                              <input
                                type="email"
                                className="w-full bg-black/5 border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                placeholder="customer@email.com"
                              />
                            </div>
                            <div className="col-span-1 md:col-span-2 space-y-2">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Mobile Number</label>
                              <input
                                type="text"
                                className="w-full bg-black/5 border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all"
                                value={formData.mobileNumber}
                                onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })}
                                placeholder="+66 ..."
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Repair Description</label>
                              <textarea
                                className="w-full bg-black/5 border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-gray-400 outline-none transition-all min-h-[100px]"
                                value={formData.maintenanceDescription}
                                onChange={e => setFormData({ ...formData, maintenanceDescription: e.target.value })}
                                placeholder="What needs fixing?"
                                required={formData.isMaintenance}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Section 2: Vehicle & Scheduling */}
                      <div className="space-y-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                            <CarIconType size={16} className="text-blue-500" />
                          </div>
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Vehicle & Scheduling</h3>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Assign Vehicle</label>
                          <div className="relative" ref={vehicleSuggestionsRef}>
                            <div 
                              className="w-full bg-black/5 border border-black/5 p-4 rounded-2xl text-sm font-bold focus-within:ring-2 ring-brand-orange outline-none transition-all cursor-pointer flex items-center justify-between"
                              onClick={() => setIsVehicleDropdownOpen(!isVehicleDropdownOpen)}
                            >
                              <div className="flex items-center gap-2 overflow-hidden">
                                {formData.carId ? (
                                  (() => {
                                    const car = cars.find(c => c.id === formData.carId);
                                    if (!car) return <span className="text-gray-400">Select Vehicle</span>;
                                    const brandSlug = getBrandSlug(car.name);
                                    return (
                                      <>
                                        {brandSlug ? (
                                          <img src={`https://cdn.simpleicons.org/${brandSlug}`} className="w-4 h-4 shrink-0" alt="" />
                                        ) : (
                                          <CarIconType size={14} className="text-blue-500 shrink-0" />
                                        )}
                                        <span className="truncate">{car.make} {car.model} • {car.plateNumber}</span>
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
                                  className="absolute z-50 left-0 right-0 mt-2 bg-white border border-black/10 shadow-2xl rounded-3xl overflow-hidden flex flex-col"
                                >
                                  <div className="p-2 border-b border-black/5 bg-gray-50">
                                    <div className="relative">
                                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                      <input 
                                        autoFocus
                                        type="text"
                                        className="w-full bg-white p-2 pl-9 rounded-xl text-xs outline-none border border-black/5"
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
                                      className="w-full p-3 text-left hover:bg-brand-orange hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest border-b border-black/5"
                                      onClick={() => {
                                        setFormData({ ...formData, carId: '' });
                                        setIsVehicleDropdownOpen(false);
                                        setVehicleSearchQuery('');
                                      }}
                                    >
                                      Unassigned
                                    </button>
                                    {filteredFleet.map(car => {
                                      const brandSlug = getBrandSlug(car.name);
                                      return (
                                        <button
                                          key={car.id}
                                          type="button"
                                          className="w-full p-3 text-left hover:bg-brand-orange hover:text-white transition-colors flex items-center justify-between border-b border-black/5 last:border-0"
                                          onClick={() => {
                                            setFormData({ ...formData, carId: car.id });
                                            setIsVehicleDropdownOpen(false);
                                            setVehicleSearchQuery('');
                                          }}
                                        >
                                          <div className="flex items-center gap-3">
                                            {brandSlug ? (
                                              <img src={`https://cdn.simpleicons.org/${brandSlug}`} className="w-4 h-4" alt="" />
                                            ) : (
                                              <CarIconType size={14} />
                                            )}
                                            <div className="flex flex-col">
                                              <span className="text-xs font-bold">{car.make} {car.model}</span>
                                              <span className="text-[10px] opacity-60 font-mono">{car.plateNumber}</span>
                                            </div>
                                          </div>
                                          <ChevronRight size={14} className="opacity-20" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Select Dates & Times</label>
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => setShowDatePicker(true)}
                              className={cn(
                                "w-full bg-black/5 border border-black/5 p-4 rounded-2xl text-left hover:bg-black/10 transition-all flex flex-col gap-4",
                                (!isTimeValid(pickUpTime) || !isTimeValid(dropOffTime)) ? "ring-2 ring-red-500" : ""
                              )}
                            >
                              <div className="flex justify-between items-center w-full">
                                <div className="space-y-1">
                                  <p className="text-[9px] font-bold uppercase tracking-widest text-brand-orange">Pick-up</p>
                                  <p className="text-xs font-bold text-gray-900">
                                    {dateRange?.from ? format(dateRange.from, 'PPP') : 'Select date'} • {pickUpTime}
                                  </p>
                                </div>
                                <Calendar size={16} className="text-gray-400 group-hover:text-brand-orange transition-colors" />
                                <div className="space-y-1 text-right">
                                  <p className="text-[9px] font-bold uppercase tracking-widest text-brand-orange">Drop-off</p>
                                  <p className="text-xs font-bold text-gray-900">
                                    {dateRange?.to ? format(dateRange.to, 'PPP') : (dateRange?.from ? format(dateRange.from, 'PPP') : 'Select date')} • {dropOffTime}
                                  </p>
                                </div>
                              </div>
                              {(!isTimeValid(pickUpTime) || !isTimeValid(dropOffTime)) && (
                                <div className="flex items-center gap-2 text-[9px] text-red-500 font-bold bg-red-500/10 p-2 rounded-xl border border-red-500/20">
                                  <AlertCircle size={12} />
                                  Office hours: 09:00 - 17:30
                                </div>
                              )}
                            </button>

                            <AnimatePresence>
                              {showDatePicker && (
                                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                                  <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={() => setShowDatePicker(false)}
                                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                                  />
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="relative z-10 w-full max-w-[700px] bg-white dark:bg-[#1A1A1A] rounded-[2.5rem] overflow-hidden shadow-2xl max-h-[90vh] flex flex-col"
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
                                      isBikeMode={title?.toLowerCase()?.includes('bike') || false}
                                      useFilteredTimes={true}
                                    />
                                  </motion.div>
                                </div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>

                      {/* Section 3: Delivery Details */}
                      <div className="space-y-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                            <TruckIcon size={16} className="text-emerald-500" />
                          </div>
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Delivery & Logistics</h3>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Delivery Address</label>
                            <input
                              type="text"
                              className="w-full bg-black/5 border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-emerald-500 outline-none transition-all"
                              value={formData.deliveryAddress}
                              onChange={e => setFormData({ ...formData, deliveryAddress: e.target.value })}
                              placeholder="Hotel, Condo, or Villa name..."
                            />
                          </div>

                          <div className="space-y-3">
                             <div className="flex items-center justify-between ml-4">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Geographic Pin</label>
                                {editingBooking?.deliveryLocation && (
                                  <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, deliveryLocation: editingBooking.deliveryLocation })}
                                    className="text-[8px] font-bold uppercase tracking-widest text-brand-orange hover:underline px-2 py-1 bg-brand-orange/5 rounded-lg"
                                  >
                                    Reset to current
                                  </button>
                                )}
                             </div>
                             <div className="rounded-[32px] overflow-hidden border border-black/5 shadow-inner">
                               <LocationPicker 
                                 location={formData.deliveryLocation} 
                                 onChange={(loc) => setFormData({ ...formData, deliveryLocation: loc })} 
                               />
                             </div>
                             <p className="text-[8px] text-gray-400 font-bold uppercase tracking-wider ml-4 flex items-center gap-1.5">
                               <Search size={10} /> Drag pin to precise drop spot
                             </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer Action Bar */}
                  <div className="bg-white/90 backdrop-blur-2xl border-t border-black/5 p-8 -mx-8 mt-12 space-y-8 shadow-[0_-20px_60px_rgba(0,0,0,0.05)] z-[70] shrink-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">Logistics Notes</label>
                        <div className="grid grid-cols-1 gap-3">
                          <textarea
                            rows={1}
                            className="w-full bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl text-xs font-medium focus:ring-2 ring-emerald-500 outline-none transition-all resize-none min-h-[52px]"
                            value={formData.deliveryNotes}
                            onChange={e => setFormData({ ...formData, deliveryNotes: e.target.value })}
                            placeholder="Pick-up/Delivery notes..."
                          />
                          <textarea
                            rows={1}
                            className="w-full bg-amber-500/5 border border-amber-500/10 p-4 rounded-2xl text-xs font-medium focus:ring-2 ring-amber-500 outline-none transition-all resize-none min-h-[52px]"
                            value={formData.returnNote}
                            onChange={e => setFormData({ ...formData, returnNote: e.target.value })}
                            placeholder="Return/Inspection notes..."
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">Financial Overview</label>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-brand-orange/5 p-4 rounded-[24px] border border-brand-orange/10">
                            <label className="text-[8px] font-bold uppercase text-brand-orange block mb-1">Total Fee (฿)</label>
                            <input
                              type="number"
                              className="w-full bg-transparent border-0 p-0 text-lg font-bold text-gray-900 focus:ring-0 outline-none"
                              value={formData.amount}
                              onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
                            />
                          </div>
                          <div className="bg-black/5 p-4 rounded-[24px] border border-black/5">
                            <label className="text-[8px] font-bold uppercase text-gray-500 block mb-1">Deposit (฿)</label>
                            <input
                              type="number"
                              className="w-full bg-transparent border-0 p-0 text-lg font-bold text-gray-900 focus:ring-0 outline-none"
                              value={formData.deposit}
                              onChange={e => setFormData({ ...formData, deposit: Number(e.target.value) })}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      {editingBooking && (
                        <button
                          type="button"
                          onClick={() => setModalMode('view')}
                          className="px-10 h-14 border border-black/10 bg-white/50 text-gray-600 font-bold uppercase tracking-widest text-[10px] rounded-[24px] hover:bg-black/5 transition-all shadow-sm"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        className="flex-1 bg-gray-900 text-white h-14 rounded-[24px] font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange transition-all shadow-xl shadow-gray-900/10 active:translate-y-1"
                      >
                        {editingBooking ? 'Update Reservation' : 'Confirm New Booking'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
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
            {contextMenu.booking?.isMaintenance && (
              <button
                onClick={() => {
                  setMaintenanceStartDate(contextMenu.booking!.startDate.slice(0, 10));
                  setMaintenanceEndDate(contextMenu.booking!.endDate.slice(0, 10));
                  setMaintenanceEditModal({ booking: contextMenu.booking! });
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-orange-600 hover:bg-orange-50 transition-colors rounded-xl"
              >
                <Wrench size={14} />
                Edit Period
              </button>
            )}
            {!contextMenu.booking?.isMaintenance && contextMenu.booking?.status !== 'Completed' && (
              <button
                onClick={() => {
                  setEarlyReturnDate(new Date().toISOString().slice(0, 10));
                  setEarlyReturnRefund('');
                  setEarlyReturnAccountId(accounts[0]?.id || '');
                  setEarlyReturnModal({ booking: contextMenu.booking! });
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors rounded-xl"
              >
                <X size={14} />
                End Rental Early
              </button>
            )}
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

      {/* Maintenance Period Edit Modal */}
      <AnimatePresence>
        {maintenanceEditModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40"
            onClick={() => setMaintenanceEditModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-900 mb-4">Edit Maintenance Period</h3>
              {maintenanceEditModal.booking.maintenanceDescription && (
                <p className="text-xs text-gray-500 mb-4">{maintenanceEditModal.booking.maintenanceDescription}</p>
              )}
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Start Date</label>
                  <input
                    type="date"
                    value={maintenanceStartDate}
                    onChange={(e) => setMaintenanceStartDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">End Date</label>
                  <input
                    type="date"
                    value={maintenanceEndDate}
                    onChange={(e) => setMaintenanceEndDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:border-orange-400"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setMaintenanceEditModal(null)}
                  className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveMaintenancePeriod(maintenanceEditModal.booking.id, maintenanceStartDate, maintenanceEndDate)}
                  disabled={!maintenanceStartDate || !maintenanceEndDate}
                  className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Early Return Modal */}
      <AnimatePresence>
        {earlyReturnModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40"
            onClick={() => !earlyReturnSaving && setEarlyReturnModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-900 mb-1">End Rental Early</h3>
              <p className="text-xs text-gray-500 mb-4">{earlyReturnModal.booking.customerName}</p>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Return Date</label>
                  <input
                    type="date"
                    value={earlyReturnDate}
                    max={earlyReturnModal.booking.endDate.slice(0, 10)}
                    onChange={(e) => setEarlyReturnDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:border-red-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Refund Amount (฿)</label>
                  <input
                    type="number"
                    value={earlyReturnRefund}
                    onChange={(e) => setEarlyReturnRefund(e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:border-red-400"
                  />
                </div>
                {parseFloat(earlyReturnRefund) > 0 && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Refund From Account</label>
                    <select
                      value={earlyReturnAccountId}
                      onChange={(e) => setEarlyReturnAccountId(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:border-red-400"
                    >
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setEarlyReturnModal(null)}
                  disabled={earlyReturnSaving}
                  className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 rounded-xl transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEarlyReturn}
                  disabled={!earlyReturnDate || earlyReturnSaving}
                  className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors disabled:opacity-40"
                >
                  {earlyReturnSaving ? 'Saving...' : 'Confirm'}
                </button>
              </div>
            </motion.div>
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
        isBikeMode={editingBooking?.requestedCarType === 'Motorbike' || cars.find(c => c.id === formData.carId)?.category === 'Motorbike' || (title?.toLowerCase()?.includes('bike') || false)}
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

      {quickNoteEdit && (
        <QuickNotePopup
          booking={quickNoteEdit.booking}
          field={quickNoteEdit.field}
          rect={quickNoteEdit.rect}
          onSave={handleQuickNoteSave}
          onClose={() => setQuickNoteEdit(null)}
        />
      )}

      <AnimatePresence>
        {summaryBooking && (() => {
          const isBottomHalf = summaryBooking.clientY > window.innerHeight - 300;
          
          return (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-[1000000] booking-summary-popover"
              style={{
                left: Math.min(window.innerWidth - 300, Math.max(16, summaryBooking.clientX)),
                ...(isBottomHalf 
                  ? { bottom: window.innerHeight - summaryBooking.clientY + 10 }
                  : { top: summaryBooking.clientY + 10 }
                ),
              }}
            >
              <div className="bg-white/90 backdrop-blur-2xl border border-black/10 shadow-2xl rounded-2xl p-4 min-w-[240px] relative">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-[#1A1A1A]">
                      {summaryBooking.booking.isMaintenance ? (
                        <span className="flex items-center gap-2">
                          <Wrench size={14} className="text-gray-600" /> Maintenance
                        </span>
                      ) : summaryBooking.booking.customerName}
                    </h4>
                    {summaryBooking.booking.isMaintenance ? (
                      <p className="text-[10px] text-[#1A1A1A]/60 font-medium italic mt-1">
                        {summaryBooking.booking.maintenanceDescription}
                      </p>
                    ) : (
                      <p className="text-[10px] text-[#1A1A1A]/60 font-medium">{summaryBooking.booking.email || 'No email'}</p>
                    )}
                    <p className="text-[9px] font-bold text-brand-orange uppercase tracking-widest mt-1">
                      {summaryBooking.booking.carId 
                        ? cars.find(c => c.id === summaryBooking.booking.carId)?.name 
                        : (summaryBooking.booking.requestedCarType || 'Unassigned')}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                      summaryBooking.booking.isMaintenance
                        ? "bg-gray-100 text-gray-600"
                        : (summaryBooking.booking.status === 'Paid' 
                            ? "bg-green-100 text-green-600" 
                            : (parseISO(summaryBooking.booking.startDate) < new Date()
                                ? "bg-yellow-100 text-yellow-600"
                                : (isFuture(parseISO(summaryBooking.booking.startDate)) 
                                    ? "bg-red-100 text-red-600" 
                                    : ((!summaryBooking.booking.carId || summaryBooking.booking.carId === 'unassigned') ? "bg-yellow-100 text-yellow-600" : "bg-orange-100 text-orange-600"))))
                    )}>
                      {summaryBooking.booking.isMaintenance ? 'Maintenance' : summaryBooking.booking.status}
                    </span>
                    <div className="flex gap-1.5 pointer-events-auto">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenManageModal(summaryBooking.booking);
                          setSummaryBookingInfo(null);
                        }}
                        className="px-3 py-1.5 bg-brand-orange text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-brand-orange/90 transition-all flex items-center gap-2 shadow-sm"
                      >
                        <Settings size={12} />
                        Manage
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCutBooking(summaryBooking.booking);
                          setSummaryBookingInfo(null);
                        }}
                        className="p-1.5 bg-brand-orange/10 text-brand-orange rounded-lg hover:bg-brand-orange hover:text-white transition-all"
                        title="Cut Booking"
                      >
                        <Scissors size={12} />
                        </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingBooking(summaryBooking.booking);
                          setShowDeleteConfirm(true);
                          setSummaryBookingInfo(null);
                        }}
                        className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-all"
                        title="Delete Booking"
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSummaryBookingInfo(null);
                        }}
                        className="p-1.5 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-200 transition-all"
                        title="Close Summary"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] text-[#1A1A1A]/80">
                    <Calendar size={12} className="text-brand-orange" />
                    <span>
                      {isValid(parseISO(summaryBooking.booking.startDate)) && isValid(parseISO(summaryBooking.booking.endDate)) ? (
                        `${format(parseISO(summaryBooking.booking.startDate), 'MMM d, HH:mm')} - ${format(parseISO(summaryBooking.booking.endDate), 'MMM d, HH:mm')}`
                      ) : 'Invalid dates'}
                    </span>
                  </div>

                  {summaryBooking.booking.returnNote && (
                    <div className="flex items-start gap-2 text-[10px] bg-brand-orange/10 p-2 rounded-lg border border-brand-orange/20 mt-1">
                      <AlertTriangle size={12} className="text-brand-orange shrink-0 mt-0.5" />
                      <div className="text-[#1A1A1A] font-medium leading-relaxed">
                        <span className="font-bold uppercase text-[8px] block mb-0.5">End Note:</span>
                        {summaryBooking.booking.returnNote}
                      </div>
                    </div>
                  )}
                  
                  {summaryBooking.booking.mobileNumber && (
                    <div className="flex items-center gap-2 text-[10px] text-[#1A1A1A]/80">
                      <Phone size={12} className="text-brand-orange" />
                      <span>{summaryBooking.booking.mobileNumber}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-[#1A1A1A]/5 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Total Amount</span>
                    <span className="text-sm font-bold text-brand-orange">
                      ฿{(summaryBooking.booking.amount || 0).toLocaleString()}
                    </span>
                  </div>

                  <div className="pt-3 mt-1 border-t border-[#1A1A1A]/5">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A]/30 mb-1">Notes</p>
                    <p className={cn(
                      "text-[10px] leading-relaxed break-words",
                      summaryBooking.booking.notes ? "text-slate-600 italic" : "text-[#1A1A1A]/20 font-medium"
                    )}>
                      {summaryBooking.booking.notes || 'No notes added'}
                    </p>
                  </div>
                </div>

                {/* Arrow */}
                {isBottomHalf ? (
                  <div className="absolute bottom-0 left-4 translate-y-full w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-white/90" />
                ) : (
                  <div className="absolute top-0 left-4 -translate-y-full w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-white/90" />
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
      </div>
    </div>
  );
};
