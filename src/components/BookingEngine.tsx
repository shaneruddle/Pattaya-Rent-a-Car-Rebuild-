import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, logSystemActivity } from '../firebase';
import { Car, PricingRule, WebsiteCar } from '../types';
import { format, addDays, differenceInDays, differenceInHours, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, addMonths, subMonths } from 'date-fns';
import { 
  Calendar as CalendarIcon, 
  User, 
  Phone, 
  MessageSquare, 
  CheckCircle2, 
  ChevronRight,
  Car as CarIcon,
  ShieldCheck,
  Clock,
  MapPin,
  ChevronLeft,
  X,
  ChevronDown,
  Info,
  Check,
  Globe,
  Loader2,
  Users,
  Settings,
  Zap,
  Fuel,
  Search,
  Truck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { WhyChooseUs, GoogleReviews, EnquiryForm, Footer } from './HomeSections';
import { FAQ } from './FAQ';
import { AboutUs, ContactUs, LongTermHire } from './Pages';
import { useLanguage } from '../LanguageContext';
import { Helmet } from 'react-helmet-async';
import { AIAssistant } from './AIAssistant';
import { Language } from '../translations';
import { LocationPicker } from './LocationPicker';

interface BookingEngineProps {
  onLoginClick: () => void;
}

interface CalendarProps {
  selectedRange: { from: Date; to: Date };
  setSelectedRange: (range: { from: Date; to: Date }) => void;
  setShowCalendar: (show: boolean) => void;
  calendarRef: React.RefObject<HTMLDivElement | null>;
  setView: (view: 'landing' | 'results' | 'about' | 'contact' | 'long-term') => void;
  pickUpTime: string;
  setPickUpTime: (time: string) => void;
  dropOffTime: string;
  setDropOffTime: (time: string) => void;
}

const Calendar: React.FC<CalendarProps> = ({ 
  selectedRange, 
  setSelectedRange, 
  setShowCalendar, 
  calendarRef,
  setView,
  pickUpTime,
  setPickUpTime,
  dropOffTime,
  setDropOffTime
}) => {
  const { t } = useLanguage();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [tempRange, setTempRange] = useState<{ from: Date | null; to: Date | null }>({
    from: selectedRange.from,
    to: selectedRange.to
  });
  const nextMonth = addMonths(currentMonth, 1);

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
          <h3 className="font-bold text-white text-lg tracking-tight">
            {format(month, 'MMMM yyyy')}
          </h3>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {[t('calendar.sun'), t('calendar.mon'), t('calendar.tue'), t('calendar.wed'), t('calendar.thu'), t('calendar.fri'), t('calendar.sat')].map(d => (
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
                disabled={isPast}
                onMouseEnter={() => setHoverDate(day)}
                onMouseLeave={() => setHoverDate(null)}
                onClick={() => handleDayClick(day)}
                className={cn(
                  "h-10 w-10 flex items-center justify-center text-xs font-bold transition-all relative",
                  isStart && !tempRange.to ? "bg-[#0084ff] text-white rounded-full z-10 shadow-lg" :
                  isStart ? "bg-[#0084ff] text-white rounded-l-full z-10" : 
                  isEnd ? "bg-[#0084ff] text-white rounded-r-full z-10" : 
                  inRange ? "bg-[#0084ff]/20 text-white" : 
                  isPast ? "text-white/10 cursor-not-allowed" : "text-white hover:bg-white/10 rounded-full"
                )}
              >
                {format(day, 'd')}
                {isStart && tempRange.to && (
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#0084ff] text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-xl whitespace-nowrap z-50">
                    {calculateDays()} days
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#0084ff] rotate-45" />
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
      setSelectedRange({ from: tempRange.from, to: tempRange.to });
      setShowCalendar(false);
      setView('results');
    } else if (tempRange.from) {
      const to = addDays(tempRange.from, 1);
      setSelectedRange({ from: tempRange.from, to });
      setShowCalendar(false);
      setView('results');
    }
  };

  const timeOptions = Array.from({ length: 24 }).flatMap((_, i) => {
    const hour = i.toString().padStart(2, '0');
    return [`${hour}:00`, `${hour}:30`];
  });

  return (
    <div ref={calendarRef} className="absolute top-full left-1/2 -translate-x-1/2 mt-4 bg-[#f27d26] rounded-[40px] overflow-hidden z-[100] w-[700px] max-w-[95vw] shadow-2xl border-4 border-[#f27d26]">
      <div className="flex flex-col md:flex-row relative border-b border-white/10">
        <button 
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="absolute left-6 top-8 p-2 text-white hover:bg-white/10 rounded-full z-20 transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        {renderMonth(currentMonth)}
        <div className="w-px bg-white/10 hidden md:block" />
        {renderMonth(nextMonth)}
        <button 
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="absolute right-6 top-8 p-2 text-white hover:bg-white/10 rounded-full z-20 transition-colors"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Time Selection Section */}
      <div className="grid grid-cols-2 border-b border-white/10">
        <div className="p-8 border-r border-white/10">
          <div className="flex items-start gap-4">
            <span className="text-6xl font-bold text-white/40 leading-none">
              {tempRange.from ? format(tempRange.from, 'd') : '--'}
            </span>
            <div>
              <p className="text-white font-bold text-lg leading-tight">
                {tempRange.from ? format(tempRange.from, 'MMMM yyyy') : 'Select Date'}
              </p>
              <p className="text-white/60 text-sm font-medium">
                {tempRange.from ? format(tempRange.from, 'EEEE') : ''}
              </p>
            </div>
          </div>
          <div className="mt-8 relative">
            <select 
              value={pickUpTime}
              onChange={(e) => setPickUpTime(e.target.value)}
              className="w-full bg-transparent text-white text-5xl font-bold outline-none appearance-none cursor-pointer"
            >
              {timeOptions.map(time => (
                <option key={time} value={time} className="bg-[#f27d26] text-white text-base">{time}</option>
              ))}
            </select>
            <ChevronDown size={32} className="absolute right-0 top-1/2 -translate-y-1/2 text-white pointer-events-none" />
          </div>
        </div>

        <div className="p-8">
          <div className="flex items-start gap-4">
            <span className="text-6xl font-bold text-white/40 leading-none">
              {tempRange.to ? format(tempRange.to, 'd') : '--'}
            </span>
            <div>
              <p className="text-white font-bold text-lg leading-tight">
                {tempRange.to ? format(tempRange.to, 'MMMM yyyy') : 'Select Date'}
              </p>
              <p className="text-white/60 text-sm font-medium">
                {tempRange.to ? format(tempRange.to, 'EEEE') : ''}
              </p>
            </div>
          </div>
          <div className="mt-8 relative">
            <select 
              value={dropOffTime}
              onChange={(e) => setDropOffTime(e.target.value)}
              className="w-full bg-transparent text-white text-5xl font-bold outline-none appearance-none cursor-pointer"
            >
              {timeOptions.map(time => (
                <option key={time} value={time} className="bg-[#f27d26] text-white text-base">{time}</option>
              ))}
            </select>
            <ChevronDown size={32} className="absolute right-0 top-1/2 -translate-y-1/2 text-white pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="bg-black/20 py-4 text-center">
        <span className="text-white font-bold text-lg uppercase tracking-widest">
          {calculateDays()} days
        </span>
      </div>

      <div className="p-8 flex items-center justify-end gap-4 bg-black/10">
        <button 
          onClick={() => setShowCalendar(false)}
          className="px-10 py-4 bg-[#ff3b30] text-white rounded-2xl font-bold uppercase tracking-widest text-sm hover:opacity-90 transition-all shadow-lg"
        >
          Cancel
        </button>
        <button 
          onClick={handleApply}
          className="px-10 py-4 bg-[#4cd964] text-white rounded-2xl font-bold uppercase tracking-widest text-sm hover:opacity-90 transition-all shadow-lg"
        >
          Apply
        </button>
      </div>
    </div>
  );
};

export const BookingEngine: React.FC<BookingEngineProps> = ({ onLoginClick }) => {
  console.log('BookingEngine: Rendering');
  const { t, language, setLanguage } = useLanguage();
  const [cars, setCars] = useState<WebsiteCar[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [sheetPricing, setSheetPricing] = useState<{ [carType: string]: { headers: number[], data: { [date: string]: number[] } } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [view, setView] = useState<'landing' | 'results' | 'about' | 'contact' | 'long-term'>('landing');

  const getSeoMetadata = () => {
    switch (view) {
      case 'about':
        return {
          title: "About Us | Pattaya Rent a Car",
          description: "Learn about Pattaya's most trusted car rental service. Established in 2009, we provide quality vehicles and exceptional service."
        };
      case 'contact':
        return {
          title: "Contact Us | Pattaya Rent a Car",
          description: "Get in touch with Pattaya Rent a Car. Find our location, phone number, and email for all your car rental enquiries."
        };
      case 'long-term':
        return {
          title: "Long Term Car Hire | Pattaya Rent a Car",
          description: "Looking for a car for a month or longer? Our long-term hire solutions offer the best value in Pattaya with flexible terms."
        };
      case 'results':
        return {
          title: "Available Vehicles | Pattaya Rent a Car",
          description: "Browse our wide selection of available rental vehicles in Pattaya. Find the perfect car for your journey."
        };
      default:
        return {
          title: "Pattaya Rent a Car | Trusted Car Rental in Pattaya Since 2005",
          description: "Rent a car in Pattaya with Thailand's most trusted service. First-class insurance, free delivery, and 24/7 support. Book your perfect car today."
        };
    }
  };

  const seo = getSeoMetadata();
  const [selectedRange, setSelectedRange] = useState<{ from: Date; to: Date }>({
    from: addDays(new Date(), 1),
    to: addDays(new Date(), 6)
  });
  const [pickUpTime, setPickUpTime] = useState('09:00');
  const [dropOffTime, setDropOffTime] = useState('09:00');
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedCar, setSelectedCar] = useState<WebsiteCar | null>(null);
  const [showEnquiryModal, setShowEnquiryModal] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobile: '',
    comments: '',
    requireDelivery: false,
    deliveryAddress: '',
    deliveryLocation: undefined as { lat: number; lng: number } | undefined,
    deliveryNotes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Filters
  const [filters, setFilters] = useState({
    seats: 'all',
    transmission: 'all',
    fuel: 'all',
    engine: 'all'
  });

  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('BookingEngine: Starting car data fetch...');
    // Add a safety timeout to prevent infinite loading if Firestore is unresponsive
    const timeout = setTimeout(() => {
      setLoading(prevLoading => {
        if (prevLoading) {
          console.warn('Firestore onSnapshot timed out for "cars" collection');
          setLoadingError('Connection timed out. Please check your internet or try again.');
          return false;
        }
        return prevLoading;
      });
    }, 10000);

    const unsubscribe = onSnapshot(collection(db, 'website_cars'), (snapshot) => {
      console.log(`BookingEngine: Received snapshot with ${snapshot.docs.length} website cars`);
      clearTimeout(timeout);
      const carsData = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as WebsiteCar))
        .filter(car => car.isActive !== false);
      setCars(carsData.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)));
      setLoading(false);
      setLoadingError(null);
    }, (error) => {
      console.error('BookingEngine: Firestore error:', error);
      clearTimeout(timeout);
      setLoading(false);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setLoadingError(`Failed to load vehicles: ${errorMessage}`);
      try {
        handleFirestoreError(error, OperationType.LIST, 'website_cars');
      } catch (e) {
        console.error('Error in handleFirestoreError:', e);
      }
    });

    const unsubscribePricing = onSnapshot(collection(db, 'pricing'), (snapshot) => {
      const pricingData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PricingRule));
      setPricingRules(pricingData);
    }, (error) => {
      console.error('BookingEngine: Pricing fetch error:', error);
    });

    // Fetch Google Sheet Pricing
    const fetchSheetPricing = async (retries = 3) => {
      try {
        console.log(`BookingEngine: Fetching sheet pricing... (Retries left: ${retries})`);
        const response = await fetch('/api/pricing/sheet');
        if (response.ok) {
          const data = await response.json();
          setSheetPricing(data);
          console.log('BookingEngine: Sheet pricing fetched successfully');
        } else if (response.status === 503 && retries > 0) {
          console.warn(`Server is busy fetching pricing, retrying in 3s... (${retries} left)`);
          await new Promise(r => setTimeout(r, 3000));
          return fetchSheetPricing(retries - 1);
        } else {
          // Try to parse error message from server
          let errorMessage = 'Failed to fetch pricing data';
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            // If not JSON, use status text
            errorMessage = response.statusText || errorMessage;
          }
          
          console.error('Error fetching sheet pricing:', errorMessage);
          
          // Show toast for significant errors
          if (errorMessage.toLowerCase().includes('timeout') || 
              errorMessage.toLowerCase().includes('access denied') ||
              errorMessage.toLowerCase().includes('not found')) {
            toast.error('Pricing Data Error', {
              description: errorMessage,
              duration: 5000
            });
          }
        }
      } catch (error) {
        console.error('Error fetching sheet pricing:', error);
        // If it's a TypeError "Failed to fetch", it's likely a network issue or server down
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
          console.warn('Network error or server unreachable while fetching pricing');
          if (retries > 0) {
            console.log('Retrying in 5s due to network error...');
            await new Promise(r => setTimeout(r, 5000));
            return fetchSheetPricing(retries - 1);
          }
        }
      }
    };
    fetchSheetPricing();

    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      unsubscribe();
      unsubscribePricing();
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const getFullDate = (date: Date, time: string) => {
    const d = new Date(date);
    const [h, m] = time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const totalHours = differenceInHours(
    getFullDate(selectedRange.to, dropOffTime),
    getFullDate(selectedRange.from, pickUpTime)
  );
  const totalDays = Math.max(1, Math.ceil(totalHours / 12) / 2);

  const filteredCars = cars.filter(car => {
    if (filters.seats !== 'all' && car.passengers !== parseInt(filters.seats)) return false;
    if (filters.transmission !== 'all' && car.transmission?.toLowerCase() !== filters.transmission.toLowerCase()) return false;
    if (filters.fuel !== 'all' && car.fuelType?.toLowerCase() !== filters.fuel.toLowerCase()) return false;
    if (filters.engine !== 'all' && car.engineSize !== filters.engine) return false;
    return true;
  });

  const calculateTotal = (car: WebsiteCar) => {
    // Try Google Sheet pricing first
    if (sheetPricing && selectedRange.from) {
      const dateKey = format(selectedRange.from, "yyyy-MM-dd");
      
      // Find the best matching tab for the car name
      const carNameLower = car.name.toLowerCase();
      let searchName = carNameLower;
      
      // Use priceGridVehicle if available, otherwise fallback to name-based matching
      if (car.priceGridVehicle) {
        searchName = car.priceGridVehicle.toLowerCase();
      } else {
        if (carNameLower.includes('vios')) searchName = 'vios';
        else if (carNameLower.includes('ativ')) searchName = 'ativ';
        else if (carNameLower.includes('city')) searchName = 'city';
        else if (carNameLower.includes('fortuner')) {
          if (carNameLower.includes('new')) searchName = 'new fortuner';
          else if (carNameLower.includes('old')) searchName = 'old fortuner';
          else searchName = 'new fortuner';
        }
        else if (carNameLower.includes('yaris')) searchName = 'yaris';
        else if (carNameLower.includes('veloz')) searchName = 'veloz';
        else if (carNameLower.includes('everest')) searchName = 'everest';
        else if (carNameLower.includes('benz')) searchName = 'benz';
        else if (carNameLower.includes('revo')) searchName = 'revo';
        else if (carNameLower.includes('extender')) searchName = 'extender';
      }

      const tabName = Object.keys(sheetPricing).find(tab => 
        searchName === tab || tab.includes(searchName) || searchName.includes(tab)
      );

      if (tabName) {
        const pricing = sheetPricing[tabName];
        const rates = pricing.data[dateKey];
        if (rates) {
          const duration = totalDays;
          let total = 0;
          let lastRate = 0;
          
          pricing.headers.forEach((h, index) => {
            if (h <= duration) {
              total += rates[index];
              lastRate = rates[index];
            }
          });

          // If duration exceeds headers, add the last rate for remaining 0.5 intervals
          const maxHeader = pricing.headers[pricing.headers.length - 1];
          if (duration > maxHeader) {
            const extraHalfDays = (duration - maxHeader) / 0.5;
            total += extraHalfDays * lastRate;
          }

          return total;
        }
      }
    }

    // Fallback to Firestore pricing rules or WebsiteCar base price
    const searchName = car.priceGridVehicle || car.name;
    const rule = pricingRules.find(r => r.carType === searchName);
    const baseRate = car.pricePerDay || 1200;
    
    if (!rule) return baseRate * totalDays;

    const days = totalDays;
    let dailyRate = baseRate;
    if (days >= 30) dailyRate = rule.rates['30+'] || baseRate;
    else if (days >= 15) dailyRate = rule.rates['15-29'] || baseRate;
    else if (days >= 8) dailyRate = rule.rates['8-14'] || baseRate;
    else if (days >= 4) dailyRate = rule.rates['4-7'] || baseRate;
    else dailyRate = rule.rates['1-3'] || baseRate;

    return dailyRate * totalDays;
  };

  const getDailyRate = (car: WebsiteCar) => {
    const total = calculateTotal(car);
    return total / totalDays;
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCar) return;

    setIsSubmitting(true);
    try {
      const bookingData = {
        carId: '',
        requestedCarType: selectedCar.name,
        customerName: `${formData.firstName} ${formData.lastName}`,
        mobileNumber: formData.mobile,
        email: formData.email,
        startDate: format(selectedRange.from, "yyyy-MM-dd") + 'T' + pickUpTime,
        endDate: format(selectedRange.to, "yyyy-MM-dd") + 'T' + dropOffTime,
        status: 'Pending',
        notes: formData.comments,
        amount: calculateTotal(selectedCar),
        deliveryAddress: formData.requireDelivery ? formData.deliveryAddress : '',
        deliveryLocation: formData.requireDelivery ? formData.deliveryLocation : null,
        deliveryNotes: formData.requireDelivery ? formData.deliveryNotes : ''
      };

      // Save to bookings collection
      const docRef = await addDoc(collection(db, 'bookings'), bookingData);

      // Log activity
      await logSystemActivity(
        'New Booking Enquiry',
        `New booking enquiry from ${bookingData.customerName} for ${selectedCar.name}`,
        'Bookings',
        { bookingId: docRef.id, customerName: bookingData.customerName, carName: selectedCar.name }
      );

      // Save to mail collection for Trigger Email extension
      await addDoc(collection(db, 'mail'), {
        to: 'info@pattayarentacar.com',
        message: {
          subject: `New Booking Enquiry: ${selectedCar.name} - ${bookingData.customerName}`,
          html: `
            <h3>New Booking Enquiry</h3>
            <p><strong>Vehicle:</strong> ${selectedCar.name}</p>
            <p><strong>Customer:</strong> ${bookingData.customerName}</p>
            <p><strong>Email:</strong> ${bookingData.email}</p>
            <p><strong>Mobile:</strong> ${bookingData.mobileNumber}</p>
            <p><strong>Dates:</strong> ${format(selectedRange.from, 'dd MMM yyyy')} to ${format(selectedRange.to, 'dd MMM yyyy')}</p>
            <p><strong>Times:</strong> ${pickUpTime} to ${dropOffTime}</p>
            <p><strong>Total Amount:</strong> THB ${bookingData.amount.toLocaleString()}</p>
            ${bookingData.deliveryAddress ? `
              <hr />
              <h4>Delivery Requested</h4>
              <p><strong>Address:</strong> ${bookingData.deliveryAddress}</p>
              ${bookingData.deliveryLocation ? `<p><strong>Location:</strong> ${bookingData.deliveryLocation.lat}, ${bookingData.deliveryLocation.lng}</p>` : ''}
              <p><strong>Delivery Notes:</strong> ${bookingData.deliveryNotes}</p>
              <p><a href="https://www.google.com/maps?q=${bookingData.deliveryLocation?.lat},${bookingData.deliveryLocation?.lng}">View on Google Maps</a></p>
            ` : ''}
            <hr />
            <p><strong>Comments:</strong></p>
            <p>${bookingData.notes.replace(/\n/g, '<br>')}</p>
          `,
        },
      });

      setIsSuccess(true);
      setShowEnquiryModal(false);
      toast.success("Enquiry submitted successfully!");
    } catch (error) {
      console.error("Error submitting enquiry:", error);
      toast.error("Failed to submit enquiry. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-warm-bg flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-modal p-12 rounded-3xl text-center max-w-md"
        >
          <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-8">
            <Check size={40} />
          </div>
          <h2 className="text-3xl font-bold mb-4 tracking-tight">{t('bookingModal.successTitle')}</h2>
          <p className="text-black/60 mb-10 leading-relaxed">
            {t('bookingModal.successMessage')}
          </p>
          <button 
            onClick={() => {
              setIsSuccess(false);
              setView('landing');
            }}
            className="w-full bg-brand-orange text-white px-8 py-4 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
          >
            {t('bookingModal.backToHome')}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-warm-bg font-sans text-[#1A1A1A]">
      <Helmet>
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
      </Helmet>
      {/* Header */}
      <header className="sticky top-0 z-[60] bg-warm-bg/80 backdrop-blur-lg border-b border-black/5">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-12">
            <img 
              src="https://7f8bfb441a72f33e442dece0180dba1f.cdn.bubble.io/cdn-cgi/image/w=192,h=70,f=auto,dpr=2,fit=contain/f1630376828262x344914557261106300/PRAC-Logo-1.png" 
              alt="Pattaya Rent A Car" 
              className="h-10 cursor-pointer"
              onClick={() => setView('landing')}
              referrerPolicy="no-referrer"
            />
            <nav className="hidden lg:flex items-center gap-8 text-[10px] font-bold uppercase tracking-widest text-black/40">
              <button onClick={() => setView('landing')} className="hover:text-brand-orange transition-colors">{t('nav.rentACar')}</button>
              <button onClick={() => setView('long-term')} className="hover:text-brand-orange transition-colors">{t('nav.longTerm')}</button>
              <button onClick={() => setView('about')} className="hover:text-brand-orange transition-colors">{t('nav.aboutUs')}</button>
              <button onClick={() => setView('contact')} className="hover:text-brand-orange transition-colors">{t('nav.contact')}</button>
            </nav>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative group">
              <div className="flex items-center gap-2 px-4 py-2 bg-black/5 rounded-full cursor-pointer hover:bg-black/10 transition-colors">
                <Globe size={14} className="text-black/40" />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {language === 'en' ? 'English' : 
                   language === 'th' ? 'ไทย' : 
                   language === 'ru' ? 'Русский' : 
                   language === 'de' ? 'Deutsch' : 
                   language === 'zh' ? '中文' : 'English'}
                </span>
                <ChevronDown size={12} className="text-black/40" />
              </div>
              <div className="absolute right-0 mt-2 w-48 glass-modal rounded-2xl overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] p-2">
                {[
                  { code: 'en', label: 'English' },
                  { code: 'th', label: 'ไทย' },
                  { code: 'ru', label: 'Русский' },
                  { code: 'de', label: 'Deutsch' },
                  { code: 'zh', label: '中文' }
                ].map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setLanguage(lang.code as Language)}
                    className={cn(
                      "w-full text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-colors",
                      language === lang.code ? "bg-brand-orange text-white" : "text-black/60 hover:bg-black/5"
                    )}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
            <button 
              onClick={onLoginClick}
              className="text-[10px] font-bold uppercase tracking-widest text-black/20 hover:text-black transition-colors"
            >
              {t('nav.staffLogin')}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main>
        {view === 'about' ? (
          <AboutUs />
        ) : view === 'contact' ? (
          <ContactUs />
        ) : view === 'long-term' ? (
          <LongTermHire />
        ) : view === 'landing' ? (
          <>
            {/* Hero Section */}
          <section className="pt-24 pb-40 px-4 text-center">
            <h1 className="text-4xl md:text-6xl font-bold text-black mb-12 tracking-tight">
              {t('hero.title')} <br />
              <span className="text-brand-orange">{t('hero.subtitle')}</span>
            </h1>

            <div className="max-w-5xl mx-auto relative">
              <div className="flex flex-col md:flex-row items-stretch glass-card rounded-[2.5rem] overflow-hidden">
                <div 
                  onClick={() => setShowCalendar(true)}
                  className="flex-[1.5] p-8 text-left cursor-pointer hover:bg-white/20 transition-colors flex items-center gap-6 border-b md:border-b-0 md:border-r border-black/5"
                >
                  <CalendarIcon className="text-brand-orange" size={28} />
                  <div>
                    <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('hero.pickupDate')}</p>
                    <p className="text-black font-mono text-xl tracking-tight">{format(selectedRange.from, 'EEE dd MMM')}</p>
                  </div>
                </div>
                <div className="p-8 text-left flex items-center gap-6 border-b md:border-b-0 md:border-r border-black/5 min-w-[180px]">
                  <Clock className="text-brand-orange" size={28} />
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('hero.time')}</p>
                    <div className="relative">
                      <select 
                        value={pickUpTime}
                        onChange={(e) => setPickUpTime(e.target.value)}
                        className="bg-transparent text-black font-mono text-xl outline-none w-full appearance-none cursor-pointer pr-8"
                      >
                        {Array.from({ length: 24 }).map((_, i) => {
                          const hour = i.toString().padStart(2, '0');
                          return (
                            <React.Fragment key={hour}>
                              <option value={`${hour}:00`}>{hour}:00</option>
                              <option value={`${hour}:30`}>{hour}:30</option>
                            </React.Fragment>
                          );
                        })}
                      </select>
                      <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-black/20 pointer-events-none" />
                    </div>
                  </div>
                </div>
                <div 
                  onClick={() => setShowCalendar(true)}
                  className="flex-[1.5] p-8 text-left cursor-pointer hover:bg-white/20 transition-colors flex items-center gap-6 border-b md:border-b-0 md:border-r border-black/5"
                >
                  <CalendarIcon className="text-brand-orange" size={28} />
                  <div>
                    <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('hero.dropoffDate')}</p>
                    <p className="text-black font-mono text-xl tracking-tight">{format(selectedRange.to, 'EEE dd MMM')}</p>
                  </div>
                </div>
                <div className="p-8 text-left flex items-center gap-6 border-b md:border-b-0 md:border-r border-black/5 min-w-[180px]">
                  <Clock className="text-brand-orange" size={28} />
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('hero.time')}</p>
                    <div className="relative">
                      <select 
                        value={dropOffTime}
                        onChange={(e) => setDropOffTime(e.target.value)}
                        className="bg-transparent text-black font-mono text-xl outline-none w-full appearance-none cursor-pointer pr-8"
                      >
                        {Array.from({ length: 24 }).map((_, i) => {
                          const hour = i.toString().padStart(2, '0');
                          return (
                            <React.Fragment key={hour}>
                              <option value={`${hour}:00`}>{hour}:00</option>
                              <option value={`${hour}:30`}>{hour}:30</option>
                            </React.Fragment>
                          );
                        })}
                      </select>
                      <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-black/20 pointer-events-none" />
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setView('results')}
                  className="bg-brand-orange text-white px-12 py-8 font-bold uppercase tracking-widest text-sm hover:opacity-90 transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl shadow-brand-orange/20"
                >
                  {t('hero.search')} <ChevronRight size={20} />
                </button>
              </div>

              <AnimatePresence>
                {showCalendar && (
                  <Calendar 
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    setShowCalendar={setShowCalendar}
                    calendarRef={calendarRef}
                    setView={setView}
                    pickUpTime={pickUpTime}
                    setPickUpTime={setPickUpTime}
                    dropOffTime={dropOffTime}
                    setDropOffTime={setDropOffTime}
                  />
                )}
              </AnimatePresence>

              <div className="mt-16">
                <h2 className="text-xl font-bold text-black/40 uppercase tracking-[0.2em]">
                  {t('hero.bookNow')} <span className="text-black/20">{t('hero.noCancellation')}</span>
                </h2>
              </div>
            </div>
          </section>

          <WhyChooseUs />
          <GoogleReviews />
          <FAQ />
          <EnquiryForm />
        </>
      ) : (
        /* Results Page */
        <main className="max-w-7xl mx-auto px-4 py-12">
          {/* Summary Bar */}
          <div className="glass-card rounded-[2.5rem] p-8 mb-16 flex flex-wrap items-center justify-between gap-8">
            <div className="flex flex-wrap items-center gap-12 md:gap-20">
              <div className="flex items-center gap-6">
                <CalendarIcon className="text-brand-orange" size={28} />
                <div>
                  <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('results.pickup')}</p>
                  <p className="text-black font-mono text-lg tracking-tight">{format(selectedRange.from, 'EEE dd MMM')} <span className="text-black/40 ml-2">{pickUpTime}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <CalendarIcon className="text-brand-orange" size={28} />
                <div>
                  <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('results.dropoff')}</p>
                  <p className="text-black font-mono text-lg tracking-tight">{format(selectedRange.to, 'EEE dd MMM')} <span className="text-black/40 ml-2">{dropOffTime}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-brand-orange/10 rounded-full flex items-center justify-center text-brand-orange">
                  <Clock size={24} />
                </div>
                <div className="text-3xl font-bold tracking-tighter">
                  {totalDays} <span className="text-sm uppercase tracking-widest text-black/30 ml-1">{t('results.days')}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setView('landing')}
                className="px-8 py-3 bg-black/5 text-black/60 font-bold uppercase tracking-widest text-[10px] rounded-full hover:bg-black/10 transition-colors"
              >
                {t('results.modifySearch')}
              </button>
              <div className="px-5 py-3 bg-black/5 rounded-full flex items-center gap-2 text-[10px] font-bold text-black/40 uppercase tracking-widest">
                THB <ChevronDown size={14} />
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="glass-card rounded-3xl p-6 mb-12 flex flex-wrap items-center gap-8">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-black/30 uppercase tracking-widest">{t('filters.seats')}:</span>
              <select 
                value={filters.seats}
                onChange={(e) => setFilters({...filters, seats: e.target.value})}
                className="bg-black/5 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest outline-none focus:bg-black/10 transition-colors appearance-none cursor-pointer"
              >
                <option value="all">{t('filters.all')}</option>
                <option value="2">{t('filters.seats2')}</option>
                <option value="4">{t('filters.seats4')}</option>
                <option value="5">{t('filters.seats5')}</option>
                <option value="7">{t('filters.seats7')}</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-black/30 uppercase tracking-widest">{t('filters.transmission')}:</span>
              <select 
                value={filters.transmission}
                onChange={(e) => setFilters({...filters, transmission: e.target.value})}
                className="bg-black/5 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest outline-none focus:bg-black/10 transition-colors appearance-none cursor-pointer"
              >
                <option value="all">{t('filters.all')}</option>
                <option value="automatic">{t('filters.automatic')}</option>
                <option value="manual">{t('filters.manual')}</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-black/30 uppercase tracking-widest">{t('filters.fuel')}:</span>
              <select 
                value={filters.fuel}
                onChange={(e) => setFilters({...filters, fuel: e.target.value})}
                className="bg-black/5 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest outline-none focus:bg-black/10 transition-colors appearance-none cursor-pointer"
              >
                <option value="all">{t('filters.all')}</option>
                <option value="petrol">{t('filters.petrol')}</option>
                <option value="diesel">{t('filters.diesel')}</option>
                <option value="hybrid">{t('filters.hybrid')}</option>
                <option value="electric">{t('filters.electric')}</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-black/30 uppercase tracking-widest">{t('filters.engine')}:</span>
              <select 
                value={filters.engine}
                onChange={(e) => setFilters({...filters, engine: e.target.value})}
                className="bg-black/5 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest outline-none focus:bg-black/10 transition-colors appearance-none cursor-pointer"
              >
                <option value="all">{t('filters.all')}</option>
                <option value="1.2">1.2L</option>
                <option value="1.5">1.5L</option>
                <option value="1.6">1.6L</option>
                <option value="2.0">2.0L</option>
                <option value="2.4">2.4L</option>
                <option value="2.8">2.8L</option>
                <option value="3.0">3.0L</option>
              </select>
            </div>
            <button 
              onClick={() => setFilters({ seats: 'all', transmission: 'all', fuel: 'all', engine: 'all' })}
              className="text-[10px] font-bold text-brand-orange uppercase tracking-widest hover:opacity-70 transition-opacity ml-auto"
            >
              {t('filters.reset')}
            </button>
          </div>

          {/* Car List */}
          <div className="space-y-8">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-32 glass-card rounded-[3rem]">
                <Loader2 className="animate-spin text-brand-orange mb-6" size={48} />
                <p className="text-black/40 font-bold uppercase tracking-widest text-xs">Loading available vehicles...</p>
              </div>
            ) : loadingError ? (
              <div className="flex flex-col items-center justify-center py-32 glass-card rounded-[3rem] border-red-500/20">
                <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-8">
                  <Info size={40} />
                </div>
                <h3 className="text-2xl font-bold mb-4 tracking-tight">Something went wrong</h3>
                <p className="text-black/60 mb-10 text-center max-w-md leading-relaxed">{loadingError}</p>
                <button 
                  onClick={() => window.location.reload()}
                  className="px-10 py-4 bg-brand-orange text-white font-bold uppercase tracking-widest text-xs rounded-full hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                >
                  Try Again
                </button>
              </div>
            ) : filteredCars.length > 0 ? (
              filteredCars.map(car => (
                <div key={car.id} className="glass-card rounded-[2.5rem] overflow-hidden hover:shadow-2xl hover:shadow-black/5 transition-all flex flex-col md:flex-row group">
                  <div className="p-10 flex-1">
                    <div className="flex flex-col md:flex-row justify-between gap-10">
                      <div className="space-y-8">
                        <div>
                          <h3 className="text-3xl font-bold text-black tracking-tight mb-2">{car.name} <span className="text-black/20 font-normal text-xl">{t('car.orSimilar')}</span></h3>
                          <div className="inline-flex px-3 py-1 bg-brand-orange/10 rounded-full">
                            <p className="text-brand-orange font-bold uppercase tracking-widest text-[10px]">{t('car.model')} {car.yearRange || '2018 - 2021'}</p>
                          </div>
                        </div>
                        
                        <ul className="grid grid-cols-2 gap-x-12 gap-y-4 text-[10px] font-bold uppercase tracking-widest text-black/40">
                          <li className="flex items-center gap-3"><Users size={16} className="text-brand-orange" /> {t('car.seats', { count: car.passengers || 5 })}</li>
                          <li className="flex items-center gap-3"><Settings size={16} className="text-brand-orange" /> {car.transmission?.toLowerCase() === 'automatic' ? t('car.automatic') : t('car.manual')}</li>
                          <li className="flex items-center gap-3"><Zap size={16} className="text-brand-orange" /> {t('filters.engine')} {car.engineSize || '1.5'}</li>
                          <li className="flex items-center gap-3"><Fuel size={16} className="text-brand-orange" /> {t(`car.${(car.fuelType || 'Petrol').toLowerCase()}`)}</li>
                        </ul>

                        <div className="bg-green-50/50 border border-green-500/10 rounded-2xl p-6 flex items-center gap-4 mt-8">
                          <div className="bg-green-500 text-white rounded-full p-1.5">
                            <CheckCircle2 size={18} />
                          </div>
                          <span className="text-xs font-bold uppercase tracking-widest text-green-700/70">{t('car.driversIncluded')}</span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end justify-between text-right">
                        <div className="relative mb-8">
                          <div className="absolute inset-0 bg-brand-orange/5 blur-3xl rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                          <img 
                            src={car.mainImage || `https://picsum.photos/seed/${car.name}/400/250`} 
                            alt={car.name} 
                            className="w-72 h-auto object-contain relative z-10 drop-shadow-2xl transform group-hover:scale-105 transition-transform duration-500"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="space-y-4">
                          <div>
                            <p className="text-[10px] font-bold text-black/20 uppercase tracking-widest mb-1">{t('car.total', { days: totalDays })}</p>
                            <p className="text-5xl font-bold text-black tracking-tighter font-mono">THB {calculateTotal(car).toLocaleString()}</p>
                          </div>
                          <button 
                            onClick={() => {
                              setSelectedCar(car);
                              setShowEnquiryModal(true);
                            }}
                            className="w-full bg-brand-orange text-white px-12 py-4 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                          >
                            {t('car.viewDeal')}
                          </button>
                          <div className="flex items-center justify-end gap-6 text-[10px] font-bold uppercase tracking-widest text-black/20">
                            <span className="hover:text-brand-orange cursor-pointer transition-colors">{t('car.subjectToAvailability')}</span>
                            <span className="flex items-center gap-2 hover:text-brand-orange cursor-pointer transition-colors">
                              <Info size={14} /> {t('car.importantInfo')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : cars.length > 0 ? (
              <div className="glass-card rounded-[3rem] p-20 text-center">
                <div className="w-24 h-24 bg-black/5 text-black/20 rounded-full flex items-center justify-center mx-auto mb-8">
                  <Search size={48} />
                </div>
                <h3 className="text-3xl font-bold mb-4 tracking-tight">{t('noResults.filterTitle')}</h3>
                <p className="text-black/40 mb-12 max-w-md mx-auto leading-relaxed">
                  {t('noResults.filterDesc')}
                </p>
                <button 
                  onClick={() => setFilters({ seats: 'all', transmission: 'all', fuel: 'all', engine: 'all' })}
                  className="px-12 py-4 bg-brand-orange text-white rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                >
                  {t('noResults.clearFilters')}
                </button>
              </div>
            ) : (
              <div className="glass-card rounded-[3rem] p-20 text-center">
                <div className="w-24 h-24 bg-black/5 text-black/20 rounded-full flex items-center justify-center mx-auto mb-8">
                  <CarIcon size={48} />
                </div>
                <h3 className="text-3xl font-bold mb-4 tracking-tight">{t('noResults.searchTitle')}</h3>
                <p className="text-black/40 mb-12 max-w-md mx-auto leading-relaxed">
                  {t('noResults.searchDesc')}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                  <button 
                    onClick={() => setView('landing')}
                    className="w-full sm:w-auto px-12 py-4 bg-brand-orange text-white rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                  >
                    {t('noResults.modifySearch')}
                  </button>
                  <button 
                    onClick={onLoginClick}
                    className="w-full sm:w-auto px-12 py-4 bg-black text-white rounded-full font-bold uppercase tracking-widest text-xs hover:bg-black/80 transition-all"
                  >
                    {t('nav.staffLogin')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* Enquiry Modal */}
      <AnimatePresence>
        {showEnquiryModal && selectedCar && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEnquiryModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.95 }}
              className="relative glass-modal rounded-[3rem] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <button 
                onClick={() => setShowEnquiryModal(false)}
                className="absolute top-8 right-8 p-3 text-black/20 hover:text-black transition-colors z-10 hover:bg-black/5 rounded-full"
              >
                <X size={24} />
              </button>

              <div className="p-12">
                <div className="flex flex-col md:flex-row gap-12 mb-12">
                  <div className="flex-1">
                    <img 
                      src="https://7f8bfb441a72f33e442dece0180dba1f.cdn.bubble.io/cdn-cgi/image/w=192,h=70,f=auto,dpr=2,fit=contain/f1630376828262x344914557261106300/PRAC-Logo-1.png" 
                      alt="Logo" 
                      className="h-10 mb-10"
                      referrerPolicy="no-referrer"
                    />
                    <h2 className="text-4xl font-bold text-black tracking-tight mb-4">{selectedCar.name} <span className="text-black/20 font-normal text-2xl">{t('car.orSimilar')}</span></h2>
                    <div className="inline-flex px-3 py-1 bg-brand-orange/10 rounded-full mb-10">
                      <p className="text-brand-orange font-bold uppercase tracking-widest text-[10px]">{t('car.model')} {selectedCar.yearRange || '2018 - 2021'}</p>
                    </div>
                    
                    <ul className="grid grid-cols-2 gap-6 text-[10px] font-bold uppercase tracking-widest text-black/40 mb-12">
                      <li className="flex items-center gap-3"><Users size={16} className="text-brand-orange" /> {t('car.seats', { count: selectedCar.passengers || 5 })}</li>
                      <li className="flex items-center gap-3"><MessageSquare size={16} className="text-brand-orange" /> CD/USB/AUX</li>
                      <li className="flex items-center gap-3"><CarIcon size={16} className="text-brand-orange" /> {selectedCar.transmission?.toLowerCase() === 'automatic' ? t('car.automatic') : t('car.manual')}</li>
                      <li className="flex items-center gap-3"><Zap size={16} className="text-brand-orange" /> {t('filters.engine')} {selectedCar.engineSize || '1.5'}</li>
                      <li className="flex items-center gap-3"><Fuel size={16} className="text-brand-orange" /> {t(`car.${(selectedCar.fuelType || 'Petrol').toLowerCase()}`)}</li>
                    </ul>

                    <div className="grid grid-cols-2 gap-8 mb-12">
                      <div>
                        <p className="text-black/20 font-bold uppercase tracking-widest text-[10px] mb-2">{t('results.pickup')}</p>
                        <p className="font-mono text-lg tracking-tight">{format(selectedRange.from, 'EEE, MMM dd, yyyy')}</p>
                      </div>
                      <div>
                        <p className="text-black/20 font-bold uppercase tracking-widest text-[10px] mb-2">{t('results.dropoff')}</p>
                        <p className="font-mono text-lg tracking-tight">{format(selectedRange.to, 'EEE, MMM dd, yyyy')}</p>
                      </div>
                    </div>

                    <div className="mb-12 p-8 bg-brand-orange/5 rounded-[2rem] border border-brand-orange/10">
                      <p className="text-brand-orange text-3xl font-bold tracking-tighter mb-2">{totalDays} {t('results.days')}</p>
                      <p className="text-5xl font-bold tracking-tighter font-mono">THB {calculateTotal(selectedCar).toLocaleString()}</p>
                    </div>

                    <div className="space-y-6">
                      <p className="font-bold uppercase tracking-widest text-[10px] text-black/30">{t('car.includedTitle')}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
                        {[
                          t('car.includedItems.cancellation'), t('car.includedItems.theft'), t('car.includedItems.breakdown'), t('car.includedItems.ammendments'),
                          t('car.includedItems.insurance'), t('car.includedItems.unlimitedKms'), t('car.includedItems.drivers'), t('car.includedItems.taxes')
                        ].map(item => (
                          <div key={item} className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-black/60">
                            <div className="bg-green-500 text-white rounded-full p-0.5">
                              <Check size={12} />
                            </div>
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="w-full md:w-80 flex flex-col items-center justify-start pt-20">
                    <div className="relative">
                      <div className="absolute inset-0 bg-brand-orange/5 blur-3xl rounded-full scale-150" />
                      <img 
                        src={selectedCar.mainImage || `https://picsum.photos/seed/${selectedCar.name}/400/250`} 
                        alt={selectedCar.name} 
                        className="w-full h-auto object-contain relative z-10 drop-shadow-2xl"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t border-black/5 pt-12">
                  <h3 className="text-3xl font-bold mb-10 tracking-tight">{t('bookingModal.title')}</h3>
                  <form onSubmit={handleBookingSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <input 
                        type="text" 
                        placeholder={t('bookingModal.firstName')} 
                        required
                        className="w-full px-6 py-4 bg-black/5 rounded-2xl focus:outline-none focus:bg-black/10 transition-all font-bold uppercase tracking-widest text-[10px]"
                        value={formData.firstName}
                        onChange={e => setFormData({...formData, firstName: e.target.value})}
                      />
                      <input 
                        type="text" 
                        placeholder={t('bookingModal.lastName')} 
                        required
                        className="w-full px-6 py-4 bg-black/5 rounded-2xl focus:outline-none focus:bg-black/10 transition-all font-bold uppercase tracking-widest text-[10px]"
                        value={formData.lastName}
                        onChange={e => setFormData({...formData, lastName: e.target.value})}
                      />
                    </div>
                    <input 
                      type="email" 
                      placeholder={t('bookingModal.email')} 
                      required
                      className="w-full px-6 py-4 bg-black/5 rounded-2xl focus:outline-none focus:bg-black/10 transition-all font-bold uppercase tracking-widest text-[10px]"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                    <input 
                      type="tel" 
                      placeholder={t('bookingModal.mobile')} 
                      required
                      className="w-full px-6 py-4 bg-black/5 rounded-2xl focus:outline-none focus:bg-black/10 transition-all font-bold uppercase tracking-widest text-[10px]"
                      value={formData.mobile}
                      onChange={e => setFormData({...formData, mobile: e.target.value})}
                    />
                    <textarea 
                      placeholder={t('bookingModal.comments')} 
                      className="w-full px-6 py-4 bg-black/5 rounded-2xl focus:outline-none focus:bg-black/10 transition-all font-bold uppercase tracking-widest text-[10px] h-40 resize-none"
                      value={formData.comments}
                      onChange={e => setFormData({...formData, comments: e.target.value})}
                    />

                    {/* Delivery Section */}
                    <div className="space-y-6 pt-6 border-t border-black/5">
                      <button
                        type="button"
                        onClick={() => {
                          const nextVal = !formData.requireDelivery;
                          setFormData({ 
                            ...formData, 
                            requireDelivery: nextVal,
                            deliveryLocation: (nextVal && !formData.deliveryLocation) 
                              ? { lat: 12.914909448882886, lng: 100.86727314994509 } 
                              : formData.deliveryLocation
                          });
                        }}
                        className={cn(
                          "w-full flex items-center justify-between p-6 rounded-2xl border-2 transition-all group",
                          formData.requireDelivery 
                            ? "bg-brand-orange/5 border-brand-orange" 
                            : "bg-black/5 border-transparent hover:bg-black/10"
                        )}
                      >
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                            formData.requireDelivery ? "bg-brand-orange text-white" : "bg-black/10 text-black/40"
                          )}>
                            <Truck size={24} />
                          </div>
                          <div className="text-left">
                            <p className="text-xs font-bold uppercase tracking-widest text-black">I require delivery</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-black/40">We deliver to your location in Pattaya</p>
                          </div>
                        </div>
                        <div className={cn(
                          "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                          formData.requireDelivery ? "bg-brand-orange border-brand-orange" : "border-black/10"
                        )}>
                          {formData.requireDelivery && <Check size={14} className="text-white" />}
                        </div>
                      </button>

                      <AnimatePresence>
                        {formData.requireDelivery && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="space-y-6 overflow-hidden"
                          >
                            <div className="space-y-4">
                              <input 
                                type="text" 
                                placeholder="Delivery Address" 
                                required={formData.requireDelivery}
                                className="w-full px-6 py-4 bg-black/5 rounded-2xl focus:outline-none focus:bg-black/10 transition-all font-bold uppercase tracking-widest text-[10px]"
                                value={formData.deliveryAddress}
                                onChange={e => setFormData({...formData, deliveryAddress: e.target.value})}
                              />
                              <textarea 
                                placeholder="Delivery Notes (e.g. Hotel name, Room number)" 
                                className="w-full px-6 py-4 bg-black/5 rounded-2xl focus:outline-none focus:bg-black/10 transition-all font-bold uppercase tracking-widest text-[10px] h-24 resize-none"
                                value={formData.deliveryNotes}
                                onChange={e => setFormData({...formData, deliveryNotes: e.target.value})}
                              />
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Pin your location on the map</p>
                                <LocationPicker 
                                  location={formData.deliveryLocation} 
                                  onChange={(loc) => setFormData({ ...formData, deliveryLocation: loc })}
                                  height="300px"
                                />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    
                    <div className="text-[10px] font-bold uppercase tracking-widest text-black/20 mb-8 leading-relaxed">
                      {t('bookingModal.disclaimer')}
                    </div>

                    <div className="flex items-center justify-center gap-3 text-brand-orange font-bold uppercase tracking-widest text-[10px] mb-10 cursor-pointer hover:opacity-70 transition-opacity">
                      <Info size={16} /> {t('car.importantInfo')}
                    </div>

                    <button 
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-brand-orange text-white py-5 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                    >
                      {isSubmitting ? t('enquiry.send') : t('bookingModal.submit')}
                    </button>
                  </form>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      </main>

      <Footer onPageChange={(v) => setView(v as any)} />
      <AIAssistant />
    </div>
  );
};

