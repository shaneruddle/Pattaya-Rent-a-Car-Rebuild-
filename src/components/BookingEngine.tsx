import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, logSystemActivity, storage } from '../firebase';
import { sendTemplatedEmail } from '../lib/emailUtils';
import { ref, getDownloadURL } from 'firebase/storage';
import { Car, WebsiteCar } from '../types';
import { format, addDays, differenceInDays, differenceInHours, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, addMonths, subMonths, parseISO } from 'date-fns';
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
  Truck,
  Menu
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import ReactGA from 'react-ga4';
import { safeLocalStorage } from '../lib/storage';
import { StorageImage } from './StorageImage';
import { WhyChooseUs, GoogleReviews, EnquiryForm, Footer } from './HomeSections';
import { FAQ } from './FAQ';
import { AboutUs, ContactUs, LongTermHire } from './Pages';
import { BlogList } from './BlogList';
import { BlogPostView } from './BlogPostView';
import { useLanguage } from '../LanguageContext';
import { usePricing } from '../contexts/PricingContext';
import { Helmet } from 'react-helmet-async';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import MarketingPageView from './MarketingPageView';
import { Language } from '../translations';
import { LocationPicker } from './LocationPicker';
import { ImportantInfoModal } from './ImportantInfoModal';
import { useCompanyConfig } from '../hooks/useCompanyConfig';
import BikeRentalLanding from './BikeRentalLanding';
import { DatePickerCustom } from './ui/DatePickerCustom';

const timeOptions = Array.from({ length: 24 }).flatMap((_, i) => {
  const hour = i.toString().padStart(2, '0');
  return [`${hour}:00`, `${hour}:30`];
}).filter(time => {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m;
  return totalMinutes >= 9 * 60 + 30 && totalMinutes <= 16 * 60 + 30;
});

interface BookingEngineProps {
  onLoginClick: () => void;
}


export const BookingEngine: React.FC<BookingEngineProps> = ({ onLoginClick }) => {
  console.log('BookingEngine: Rendering');
  const { t, language, setLanguage } = useLanguage();
  const { config, loading: configLoading } = useCompanyConfig();
  const { sheetPricing, loading: pricingLoading, calculatePrice, useNewEngine, classPrices, classPricesLoading, fetchClassPrices, getQuoteForCar } = usePricing();
  const location = useLocation();
  const navigate = useNavigate();
  
  const [cars, setCars] = useState<WebsiteCar[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [view, setView] = useState<'landing' | 'results' | 'about' | 'contact' | 'long-term' | 'rent-a-bike' | 'blog' | 'blog-post' | 'marketing-page'>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('from') && params.get('to')) ? 'results' : 'landing';
  });
  const [selectedBlogSlug, setSelectedBlogSlug] = useState<string | null>(null);
  const [isBikeMode, setIsBikeMode] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Track page views on view change
  useEffect(() => {
    const ga_id = import.meta.env.VITE_GA_MEASUREMENT_ID || 'G-8FHJNX2F1T';
    if (ga_id) {
      const seo = getSeoMetadata();
      ReactGA.send({ 
        hitType: "pageview", 
        page: view === 'landing' ? '/' : `/${view}`,
        title: seo.title
      });
    }
  }, [view]);

  useEffect(() => {
    if (view === 'rent-a-bike') {
      setIsBikeMode(true);
    } else if (view === 'landing') {
      setIsBikeMode(false);
    }
  }, [view]);


  console.log('BookingEngine: Current state - loading:', loading, 'view:', view, 'cars count:', cars.length, 'isBikeMode:', isBikeMode);

  const getSeoMetadata = () => {
    switch (view) {
      case 'about':
        return {
          title: `About Us | ${config.companyName}`,
          description: `Learn about ${config.companyName}. Established since 2005, we provide quality vehicles and exceptional service.`
        };
      case 'contact':
        return {
          title: `Contact Us | ${config.companyName}`,
          description: `Get in touch with ${config.companyName}. Find our location, phone number, and email for all your car rental enquiries.`
        };
      case 'long-term':
        return {
          title: `Long Term Car Hire | ${config.companyName}`,
          description: "Looking for a car for a month or longer? Our long-term hire solutions offer the best value in Pattaya with flexible terms."
        };
      case 'blog':
        return {
          title: `Blog | ${config.companyName}`,
          description: `Explore our blog for travel tips, local guides, and the latest news about car rentals in Pattaya.`
        };
      case 'blog-post':
        return {
          title: `Blog Post | ${config.companyName}`,
          description: `Read our latest blog post on ${config.companyName}.`
        };
      case 'results':
        return {
          title: isBikeMode ? `Available Bikes | ${config.companyName}` : `Available Vehicles | ${config.companyName}`,
          description: isBikeMode ? "Browse our wide selection of available rental motorbikes in Pattaya." : "Browse our wide selection of available rental vehicles in Pattaya. Find the perfect car for your journey."
        };
      case 'rent-a-bike':
        return {
          title: `${config.companyName} | Trusted Motorbike Rental in Pattaya Since 2005`,
          description: "Rent a motorbike in Pattaya with Thailand's most trusted service. First-class insurance, free delivery, and 24/7 support. Book your perfect bike today."
        };
      default:
        return {
          title: `${config.companyName} | Trusted Rental Service in Pattaya Since 2005`,
          description: isBikeMode ? "Rent a motorbike in Pattaya with Thailand's most trusted service. First-class insurance, free delivery, and 24/7 support. Book your perfect bike today." : "Rent a car in Pattaya with Thailand's most trusted service. First-class insurance, free delivery, and 24/7 support. Book your perfect car today."
        };
    }
  };

  const seo = getSeoMetadata();
  const [selectedRange, setSelectedRange] = useState<{ from: Date; to: Date }>(() => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get('from');
    const t = params.get('to');
    if (f && t) {
      try {
        const fromDate = parseISO(f);
        const toDate = parseISO(t);
        if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
          return { from: fromDate, to: toDate };
        }
      } catch (e) {}
    }
    return { from: addDays(new Date(), 1), to: addDays(new Date(), 6) };
  });
  const [pickUpTime, setPickUpTime] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('pickupTime');
    return t || '09:30';
  });
  const [dropOffTime, setDropOffTime] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('dropoffTime');
    return t || '09:30';
  });
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedCar, setSelectedCar] = useState<WebsiteCar | null>(null);
  const [showEnquiryModal, setShowEnquiryModal] = useState(false);
  const [showImportantInfoModal, setShowImportantInfoModal] = useState(false);
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

  const [lastFetch, setLastFetch] = useState<number>(() => {
    const cached = safeLocalStorage.getItem('prac_be_last_fetch');
    return cached ? parseInt(cached) : 0;
  });

  useEffect(() => {
    if (showCalendar) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showCalendar]);

  useEffect(() => {
    console.log('BookingEngine: Starting car data fetch...');
    
    const fetchData = async (force = false) => {
      const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
      const isCacheValid = !force && (Date.now() - lastFetch < CACHE_DURATION);

      if (cars.length === 0 && isCacheValid) {
        const cachedCars = safeLocalStorage.getItem('prac_be_cached_cars');
        if (cachedCars) {
          try {
            console.log('BookingEngine: Using cached data');
            setCars(JSON.parse(cachedCars));
            setLoading(false);
            return;
          } catch (e) {
            console.error('Error parsing cached data:', e);
          }
        }
      }

      try {
        console.log('BookingEngine: Fetching fresh data from Firestore...');
        const carsSnapshot = await getDocs(collection(db, 'website_cars'));
        console.log(`BookingEngine: Received snapshot with ${carsSnapshot.docs.length} website cars`);
        const carsData = carsSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as WebsiteCar))
          .filter(car => car.isActive !== false);
        const sortedCars = carsData.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
        setCars(sortedCars);
        
        const now = Date.now();
        setLastFetch(now);
        safeLocalStorage.setItem('prac_be_last_fetch', now.toString());
        safeLocalStorage.setItem('prac_be_cached_cars', JSON.stringify(sortedCars));

        setLoading(false);
        setLoadingError(null);
      } catch (error: any) {
        console.error('BookingEngine: Firestore error:', error);
        setLoading(false);
        const errorMessage = error.message || String(error);
        
        // Fallback to stale cache on error
        const cachedCars = safeLocalStorage.getItem('prac_be_cached_cars');
        if (cachedCars) {
          try {
            setCars(JSON.parse(cachedCars));
            toast.error("Using cached car data due to connection issues.");
            return;
          } catch (e) {}
        }

        if (errorMessage.includes('Quota exceeded') || errorMessage.includes('resource-exhausted')) {
          setLoadingError('The system is currently at maximum capacity for today. Please try again tomorrow or contact us directly.');
        } else {
          setLoadingError(`Failed to load vehicles: ${errorMessage}`);
        }
      }
    };

    fetchData();

    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
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
    // Filter by category first
    const category = car.category || 'Car';
    if (isBikeMode && category === 'Car') return false;
    if (!isBikeMode && category === 'Motorbike') return false;

    if (filters.seats !== 'all' && car.passengers !== parseInt(filters.seats)) return false;
    if (filters.transmission !== 'all' && 
        !((car.transmission?.toLowerCase() || '').startsWith('auto') && filters.transmission === 'automatic') &&
        !((car.transmission?.toLowerCase() || '') === 'manual' && filters.transmission === 'manual')
    ) return false;
    if (filters.fuel !== 'all' && (car.fuelType?.toLowerCase() || '') !== (filters.fuel?.toLowerCase() || '')) return false;
    if (filters.engine !== 'all' && car.engineSize !== filters.engine) return false;
    return true;
  });

    // --- New pricing engine: fetch per-class quotes when dates or visible classes change (flag-gated) ---
  // Derive a STABLE key from the distinct classes + dates so the effect doesn't loop on filteredCars' changing array identity.
  const visibleClasses = Array.from(new Set(filteredCars.map(c => c.type).filter(Boolean) as string[])).sort();
  const visibleClassesKey = visibleClasses.join(',');
  const quoteFrom = selectedRange.from ? format(selectedRange.from, "yyyy-MM-dd") : '';
  const quoteTo = selectedRange.to ? format(selectedRange.to, "yyyy-MM-dd") : '';

  useEffect(() => {
    if (!useNewEngine) return;                       // flag off -> do nothing
    if (!quoteFrom || !quoteTo) return;              // need dates
    if (visibleClasses.length === 0) return;         // need at least one class
    fetchClassPrices(visibleClasses, quoteFrom, quoteTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useNewEngine, visibleClassesKey, quoteFrom, quoteTo]);

// Old sheet-based total (unchanged logic, now an inner helper used as fallback)
  const sheetCalculateTotal = (car: WebsiteCar) => {
    const dateKey = selectedRange.from ? format(selectedRange.from, "yyyy-MM-dd") : null;
    if (!dateKey) return 0;
    // @ts-ignore â calculatePrice is in the context
    const price = calculatePrice ? calculatePrice(car, dateKey, totalDays) : null;
    if (price !== null) return price;
    return (car.pricePerDay || 1200) * totalDays;
  };

  // Numeric total. When the new engine is on: quotable -> totalPrice; monthly redirect -> 0 (display shows message);
  // not-loaded / error / not-configured -> fall back to the sheet total so the display never breaks.
  const calculateTotal = (car: WebsiteCar) => {
    if (!useNewEngine) return sheetCalculateTotal(car);
    const q = getQuoteForCar(car);
    if (q === null) return sheetCalculateTotal(car);
    if (q.quotable === true) return q.totalPrice;
    if (q.reason === 'monthly_redirect') return 0;
    return sheetCalculateTotal(car);
  };

    // What to DISPLAY for a car's price: either a formatted price or the monthly-redirect message.
  // Returns { kind, text } so the render sites can style price vs message differently.
  const getPriceDisplay = (car: WebsiteCar): { kind: 'price' | 'message'; text: string } => {
    if (useNewEngine) {
      const q = getQuoteForCar(car);
      if (q && q.quotable === false && q.reason === 'monthly_redirect') {
        return { kind: 'message', text: 'Contact us for monthly rates' };
      }
    }
    return { kind: 'price', text: 'THB ' + calculateTotal(car).toLocaleString() };
  };

  const getDailyRate = (car: WebsiteCar) => {
    const total = calculateTotal(car);
    return total / totalDays;
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCar) return;

    setIsSubmitting(true);
    console.log('BookingEngine: Starting submission...', formData);
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
        amount: (useNewEngine && (() => { const q = getQuoteForCar(selectedCar); return q && q.quotable === false && q.reason === 'monthly_redirect'; })()) ? null : calculateTotal(selectedCar),
        deliveryAddress: formData.requireDelivery ? formData.deliveryAddress : '',
        deliveryLocation: formData.requireDelivery ? formData.deliveryLocation : null,
        deliveryNotes: formData.requireDelivery ? formData.deliveryNotes : '',
        createdAt: serverTimestamp()
      };

      // Save to bookings collection
      console.log('BookingEngine: Saving to bookings collection...');
      const docRef = await addDoc(collection(db, 'bookings'), bookingData);
      console.log('BookingEngine: Saved to bookings, ID:', docRef.id);

      // Log activity
      console.log('BookingEngine: Logging system activity...');
      await logSystemActivity(
        'New Booking Enquiry',
        `New booking enquiry from ${bookingData.customerName} for ${selectedCar.name}`,
        'Bookings',
        { bookingId: docRef.id, customerName: bookingData.customerName, carName: selectedCar.name }
      );
      console.log('BookingEngine: Activity logged');

      // Send emails via API
      console.log('BookingEngine: Sending emails via helpers...');
      let emailSuccess = true;
      try {
        // 1. Send Confirmation to Customer using template
        const startDate = selectedRange.from;
        const endDate = selectedRange.to;
        await sendTemplatedEmail('booking_enquiry', formData.email, {
          '{{customer_name}}': `${formData.firstName} ${formData.lastName}`,
          '{{customer_email}}': formData.email,
          '{{customer_phone}}': formData.mobile,
          '{{vehicle_model}}': selectedCar.name,
          '{{pickup_date}}': format(startDate, 'dd MMM yyyy'),
          '{{pickup_time}}': pickUpTime,
          '{{return_date}}': format(endDate, 'dd MMM yyyy'),
          '{{return_time}}': dropOffTime,
          '{{rental_period}}': `${format(startDate, 'dd MMM yyyy')} to ${format(endDate, 'dd MMM yyyy')}`,
          '{{total_price}}': bookingData.amount.toLocaleString(),
          '{{delivery_address}}': formData.requireDelivery ? formData.deliveryAddress : '',
          '{{comments}}': formData.comments || ''
        });
        console.log('BookingEngine: Customer confirmation triggered');

        // 2. Send Notification to Staff
        const emailResponse = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: config.email,
            replyTo: formData.email,
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
          }),
        });
        
        if (!emailResponse.ok) {
          const errorData = await emailResponse.json();
          console.error('BookingEngine: Staff email API failed:', errorData);
          emailSuccess = false;
        } else {
          console.log('BookingEngine: Staff notification sent successfully');
        }
      } catch (emailErr) {
        console.error('BookingEngine: Error handling emails:', emailErr);
        emailSuccess = false;
      }

      // Save to mail collection for logging (Customer copy)
      try {
        await addDoc(collection(db, 'mail'), {
          to: formData.email,
          message: {
            subject: `Booking Enquiry Received - ${config.companyName}`,
            html: `<p>Thank you for your enquiry for ${selectedCar.name}. We will contact you soon.</p>`
          },
        });

        // Save to mail collection for logging (Staff copy)
        await addDoc(collection(db, 'mail'), {
          to: config.email,
          replyTo: formData.email,
          message: {
            subject: `New Booking Enquiry: ${selectedCar.name} - ${bookingData.customerName}`,
            html: `Enquiry received from ${bookingData.customerName} for ${selectedCar.name}. Check dashboard for details.`
          },
        });
        console.log('BookingEngine: Email logs created in Firestore');
      } catch (logErr) {
        console.error('BookingEngine: Error creating email logs:', logErr);
      }

      setIsSuccess(true);
      setShowEnquiryModal(false);
      
      if (emailSuccess) {
        toast.success("Enquiry submitted successfully!");
      } else {
        toast.warning("Booking recorded, but we had trouble sending confirmation emails. We'll check the dashboard!");
      }
    } catch (error: any) {
      console.error("BookingEngine: Error submitting enquiry:", error);
      const errorMessage = error.message || 'Unknown error';
      toast.error(`Failed to submit enquiry: ${errorMessage}`);
      
      try {
        handleFirestoreError(error, OperationType.WRITE, 'bookings');
      } catch (e) {
        // Already logged by handleFirestoreError
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePageChange = (newView: string) => {
    if (newView.startsWith('/')) {
      navigate(newView);
    } else if (newView === 'blog') {
      navigate('/blog');
    } else if (newView === 'landing') {
      setView('landing');
      setIsBikeMode(false);
      navigate('/');
    } else if (newView === 'rent-a-bike') {
      setView('rent-a-bike');
      setIsBikeMode(true);
      navigate('/rent-a-bike');
    } else if (newView === 'long-term') {
      navigate('/long-term-rental');
    } else if (newView === 'about') {
      navigate('/about');
    } else if (newView === 'contact') {
      navigate('/contact');
    } else if (newView === 'faq') {
      navigate('/faq');
    } else {
      setView(newView as any);
    }
    window.scrollTo(0, 0);
  };

  const handleBlogPostClick = (slug: string) => {
    navigate(`/blog/${slug}`);
    window.scrollTo(0, 0);
  };

  // Sync view state with URL
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('from') && p.get('to')) return;

    const path = location.pathname;
    const segments = path.split('/').filter(Boolean);
    console.log(`[BookingEngine] Route Sync: path="${path}", segments=${segments.length}`);
    
    if (path === '/blog') {
      setView('blog');
    } else if (path.startsWith('/blog/')) {
      const slug = path.split('/')[2];
      setSelectedBlogSlug(slug);
      setView('blog-post');
    } else if (path === '/rent-a-bike') {
      setView('rent-a-bike');
      setIsBikeMode(true);
    } else if (path === '/rent-a-car') {
      setView('landing');
      setIsBikeMode(false);
    } else if (path === '/about') {
      setView('about');
    } else if (path === '/contact') {
      setView('contact');
    } else if (path === '/long-term-rental' || path === '/long-term') {
      setView('long-term');
    } else if (path === '/faq' && segments.length === 1) {
      setView('landing'); 
    } else if (segments.length >= 1 && (
               segments.length >= 2 || 
               path.startsWith('/pages/') || 
               path.startsWith('/services/') || 
               path.startsWith('/locations/') ||
               path.startsWith('/vehicles/') ||
               path.startsWith('/vehicle/') ||
               !['blog', 'rent-a-bike', 'rent-a-car', 'about', 'contact', 'long-term-rental', 'long-term', 'faq'].includes(segments[0])
             )) {
      console.log(`[BookingEngine] Route match: Setting view to marketing-page for: ${path}`);
      setView('marketing-page');
    } else if (path === '/') {
      setView('landing');
      setIsBikeMode(false);
    }
  }, [location.pathname]);

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
          <div className="flex flex-col gap-3 mt-2">
            <button
              onClick={() => setIsSuccess(false)}
              className={cn(
                "w-full text-white px-8 py-4 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg",
                isBikeMode ? "bg-brand-blue shadow-brand-blue/20" : "bg-brand-orange shadow-brand-orange/20"
              )}
            >
              Continue Browsing
            </button>
            <button
              onClick={() => { window.location.href = 'https://pattayarentacar.com'; }}
              className="w-full text-black/40 px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:text-black/70 transition-colors"
            >
              Return to pattayarentacar.com
            </button>
          </div>
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
      {view === 'results' ? (
        <header className="sticky top-0 z-[60] bg-warm-bg/80 backdrop-blur-lg border-b border-black/5">
          <div className="max-w-7xl mx-auto px-4 h-20 flex items-center">
            {isBikeMode ? (
              <a href="https://pattayarentabike.com" rel="noopener"><StorageImage
                path="PRAB-Logo-1.png"
                alt="Pattaya Rent A Bike"
                className="h-10 cursor-pointer"
                fallback="https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0665145746.firebasestorage.app/o/PRAB-Logo-1.png?alt=media"
              /></a>
            ) : (
              <a href="https://pattayarentacar.com" rel="noopener"><img
                src="https://firebasestorage.googleapis.com/v0/b/pattaya-rent-a-car-rebuild.firebasestorage.app/o/PRAC-Logo-1.png?alt=media"
                alt="Pattaya Rent A Car"
                className="h-10 cursor-pointer"
                referrerPolicy="no-referrer"
              /></a>
            )}
          </div>
        </header>
      ) : (
      <header className="sticky top-0 z-[60] bg-warm-bg/80 backdrop-blur-lg border-b border-black/5">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-12">
            {isBikeMode ? (
              <a href="https://pattayarentabike.com" rel="noopener"><StorageImage 
                path="PRAB-Logo-1.png"
                alt="Pattaya Rent A Bike"
                className="h-10 cursor-pointer"
                fallback="https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0665145746.firebasestorage.app/o/PRAB-Logo-1.png?alt=media"
              /></a>
            ) : (
              <a href="https://pattayarentacar.com" rel="noopener"><img 
                src="https://firebasestorage.googleapis.com/v0/b/pattaya-rent-a-car-rebuild.firebasestorage.app/o/PRAC-Logo-1.png?alt=media"
                alt="Pattaya Rent A Car"
                className="h-10 cursor-pointer"
                referrerPolicy="no-referrer"
              /></a>
            )}
            <nav className="hidden lg:flex items-center gap-8">
              <button 
                onClick={() => {
                  setView('landing');
                  setIsBikeMode(false);
                }}
                className={cn(
                  "text-[10px] font-bold uppercase tracking-widest transition-colors",
                  view === 'landing' && !isBikeMode ? (isBikeMode ? "text-brand-blue" : "text-brand-orange") : "text-black/60 hover:text-black"
                )}
              >
                {t('nav.rentACar')}
              </button>
              <button 
                onClick={() => {
                  setView('rent-a-bike');
                  setIsBikeMode(true);
                }}
                className={cn(
                  "text-[10px] font-bold uppercase tracking-widest transition-colors",
                  isBikeMode ? (isBikeMode ? "text-brand-blue" : "text-brand-orange") : "text-black/60 hover:text-black"
                )}
              >
                {t('nav.rentABike')}
              </button>
              <button 
                onClick={() => setView('long-term')}
                className={cn(
                  "text-[10px] font-bold uppercase tracking-widest transition-colors",
                  view === 'long-term' ? (isBikeMode ? "text-brand-blue" : "text-brand-orange") : "text-black/60 hover:text-black"
                )}
              >
                {t('nav.longTerm')}
              </button>
              <button 
                onClick={() => handlePageChange('about')}
                className={cn(
                  "text-[10px] font-bold uppercase tracking-widest transition-colors",
                  view === 'about' ? (isBikeMode ? "text-brand-blue" : "text-brand-orange") : "text-black/60 hover:text-black"
                )}
              >
                {t('nav.aboutUs')}
              </button>
              <button 
                onClick={() => handlePageChange('contact')}
                className={cn(
                  "text-[10px] font-bold uppercase tracking-widest transition-colors",
                  view === 'contact' ? (isBikeMode ? "text-brand-blue" : "text-brand-orange") : "text-black/60 hover:text-black"
                )}
              >
                {t('nav.contact')}
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative group">
              <div className="flex items-center gap-2 px-4 py-2 bg-black/5 rounded-full cursor-pointer hover:bg-black/10 transition-colors">
                <Globe size={14} className="text-black/40" />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {language === 'en' ? 'English' : 
                   language === 'th' ? 'à¹à¸à¸¢' : 
                   language === 'ru' ? 'Ð ÑÑÑÐºÐ¸Ð¹' : 
                   language === 'de' ? 'Deutsch' : 
                   language === 'zh' ? 'ä¸­æ' : 'English'}
                </span>
                <ChevronDown size={12} className="text-black/40" />
              </div>
              <div className="absolute right-0 mt-2 w-48 glass-modal rounded-2xl overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] p-2">
                {[
                  { code: 'en', label: 'English' },
                  { code: 'th', label: 'à¹à¸à¸¢' },
                  { code: 'ru', label: 'Ð ÑÑÑÐºÐ¸Ð¹' },
                  { code: 'de', label: 'Deutsch' },
                  { code: 'zh', label: 'ä¸­æ' }
                ].map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setLanguage(lang.code as Language)}
                    className={cn(
                      "w-full text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-colors",
                      language === lang.code 
                        ? (isBikeMode ? "bg-brand-blue text-white" : "bg-brand-orange text-white") 
                        : "text-black/60 hover:bg-black/5"
                    )}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
            <button 
              onClick={onLoginClick}
              className="hidden lg:block text-[10px] font-bold uppercase tracking-widest text-black/20 hover:text-black transition-colors"
            >
              {t('nav.staffLogin')}
            </button>
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 text-black/60 hover:text-black transition-colors"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden bg-warm-bg border-t border-black/5 overflow-hidden"
            >
              <div className="flex flex-col p-4 gap-4">
                <button 
                  onClick={() => {
                    handlePageChange('landing');
                    setIsBikeMode(false);
                    setIsMobileMenuOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-6 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-colors",
                    view === 'landing' && !isBikeMode ? (isBikeMode ? "bg-brand-blue text-white" : "bg-brand-orange text-white") : "bg-black/5 text-black/60"
                  )}
                >
                  {t('nav.rentACar')}
                </button>
                <button 
                  onClick={() => {
                    handlePageChange('rent-a-bike');
                    setIsBikeMode(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-6 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-colors",
                    isBikeMode ? "bg-brand-blue text-white" : "bg-black/5 text-black/60"
                  )}
                >
                  {t('nav.rentABike')}
                </button>
                <button 
                  onClick={() => {
                    handlePageChange('long-term');
                    setIsMobileMenuOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-6 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-colors",
                    view === 'long-term' ? (isBikeMode ? "bg-brand-blue text-white" : "bg-brand-orange text-white") : "bg-black/5 text-black/60"
                  )}
                >
                  {t('nav.longTerm')}
                </button>
                <button 
                  onClick={() => {
                    handlePageChange('about');
                    setIsMobileMenuOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-6 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-colors",
                    view === 'about' ? (isBikeMode ? "bg-brand-blue text-white" : "bg-brand-orange text-white") : "bg-black/5 text-black/60"
                  )}
                >
                  {t('nav.aboutUs')}
                </button>
                <button 
                  onClick={() => {
                    handlePageChange('contact');
                    setIsMobileMenuOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-6 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-colors",
                    view === 'contact' ? (isBikeMode ? "bg-brand-blue text-white" : "bg-brand-orange text-white") : "bg-black/5 text-black/60"
                  )}
                >
                  {t('nav.contact')}
                </button>
                <button 
                  onClick={() => {
                    onLoginClick();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full text-left px-6 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest bg-black text-white"
                >
                  {t('nav.staffLogin')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      )}

      {/* Main Content */}
      <div className="flex-1">
        {view === 'about' ? (
          <AboutUs isBikeMode={isBikeMode} />
        ) : view === 'contact' ? (
          <ContactUs isBikeMode={isBikeMode} />
        ) : view === 'long-term' ? (
          <LongTermHire isBikeMode={isBikeMode} />
        ) : view === 'blog' ? (
          <BlogList isBikeMode={isBikeMode} onPostClick={handleBlogPostClick} />
        ) : view === 'blog-post' && selectedBlogSlug ? (
          <BlogPostView isBikeMode={isBikeMode} slug={selectedBlogSlug} onBack={() => handlePageChange('blog')} />
        ) : view === 'marketing-page' ? (
          <MarketingPageView fullPath={location.pathname} isBikeMode={isBikeMode} />
        ) : view === 'landing' || view === 'rent-a-bike' ? (
          isBikeMode ? (
            <BikeRentalLanding />
          ) : (
            <>
              {/* Hero Section */}
              <section className="pt-10 md:pt-16 pb-20 md:pb-32 px-4 text-center">
                <h1 className="text-4xl md:text-6xl font-bold text-black mb-8 md:mb-12 tracking-tight">
                  {isBikeMode ? "Let's find your perfect bike." : t('hero.title')} <br />
                  <span className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")}>{t('hero.subtitle')}</span>
                </h1>

                <div className="max-w-5xl mx-auto relative">
                  <div className="flex flex-col md:flex-row items-stretch glass-card rounded-[2.5rem] overflow-hidden">
                    <button 
                      onClick={() => setShowCalendar(true)}
                      className="flex-[1.5] p-8 text-left hover:bg-white/20 transition-colors flex items-center gap-6 border-b md:border-b-0 md:border-r border-black/5"
                    >
                      <CalendarIcon className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} size={28} />
                      <div>
                        <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('hero.pickupDate')}</p>
                        <p className="text-black font-mono text-xl tracking-tight">{format(selectedRange.from, 'EEE dd MMM')}</p>
                      </div>
                    </button>
                    <div className="p-8 text-left flex items-center gap-6 border-b md:border-b-0 md:border-r border-black/5 min-w-[180px]">
                      <Clock className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} size={28} />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('hero.time')}</p>
                        <div className="relative">
                          <select 
                            value={pickUpTime}
                            onChange={(e) => setPickUpTime(e.target.value)}
                            className="bg-transparent text-black font-mono text-xl outline-none w-full appearance-none cursor-pointer pr-8"
                          >
                            {timeOptions.map(time => (
                              <option key={time} value={time}>{time}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-black/20 pointer-events-none" />
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowCalendar(true)}
                      className="flex-[1.5] p-8 text-left hover:bg-white/20 transition-colors flex items-center gap-6 border-b md:border-b-0 md:border-r border-black/5"
                    >
                      <CalendarIcon className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} size={28} />
                      <div>
                        <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('hero.dropoffDate')}</p>
                        <p className="text-black font-mono text-xl tracking-tight">{format(selectedRange.to, 'EEE dd MMM')}</p>
                      </div>
                    </button>
                    <div className="p-8 text-left flex items-center gap-6 border-b md:border-b-0 md:border-r border-black/5 min-w-[180px]">
                      <Clock className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} size={28} />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('hero.time')}</p>
                        <div className="relative">
                          <select 
                            value={dropOffTime}
                            onChange={(e) => setDropOffTime(e.target.value)}
                            className="bg-transparent text-black font-mono text-xl outline-none w-full appearance-none cursor-pointer pr-8"
                          >
                            {timeOptions.map(time => (
                              <option key={time} value={time}>{time}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-black/20 pointer-events-none" />
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => handlePageChange('results')}
                      className={cn(
                        "text-white px-12 py-8 font-bold uppercase tracking-widest text-sm hover:opacity-90 transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl",
                        isBikeMode ? "bg-brand-blue shadow-brand-blue/20" : "bg-brand-orange shadow-brand-orange/20"
                      )}
                    >
                      {t('hero.search')} <ChevronRight size={20} />
                    </button>
                  </div>


                  <div className="mt-16">
                    <h2 className="text-xl font-bold text-black/40 uppercase tracking-[0.2em]">
                      {t('hero.bookNow')} <span className="text-black/20">{t('hero.noCancellation')}</span>
                    </h2>
                  </div>
                </div>
              </section>

              <WhyChooseUs isBikeMode={isBikeMode} />
              <GoogleReviews isBikeMode={isBikeMode} />
              <FAQ isBikeMode={isBikeMode} />
              <EnquiryForm isBikeMode={isBikeMode} />
            </>
          )
        ) : (
        /* Results Page */
        <main className="max-w-7xl mx-auto px-4 py-12">
          {/* Summary Bar */}
          <div className="glass-card rounded-[2.5rem] p-8 mb-16 flex flex-wrap items-center justify-between gap-8">
            <div className="flex flex-wrap items-center gap-12 md:gap-20 cursor-pointer hover:opacity-70 transition-opacity" onClick={() => setShowCalendar(true)}>
              <div className="flex items-center gap-6">
                <CalendarIcon className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} size={28} />
                <div>
                  <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('results.pickup')}</p>
                  <p className="text-black font-mono text-lg tracking-tight">{format(selectedRange.from, 'EEE dd MMM')} <span className="text-black/40 ml-2">{pickUpTime}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <CalendarIcon className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} size={28} />
                <div>
                  <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-1.5">{t('results.dropoff')}</p>
                  <p className="text-black font-mono text-lg tracking-tight">{format(selectedRange.to, 'EEE dd MMM')} <span className="text-black/40 ml-2">{dropOffTime}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center",
                  isBikeMode ? "bg-brand-blue/10 text-brand-blue" : "bg-brand-orange/10 text-brand-orange"
                )}>
                  <Clock size={24} />
                </div>
                <div className="text-3xl font-bold tracking-tighter">
                  {totalDays} <span className="text-sm uppercase tracking-widest text-black/30 ml-1">{t('results.days')}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setShowCalendar(true)}
                className="px-8 py-3 bg-black/5 text-black/60 font-bold uppercase tracking-widest text-[10px] rounded-full hover:bg-black/10 transition-colors"
              >
                {t('results.modifySearch')}
              </button>

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
              className={cn(
                "text-[10px] font-bold uppercase tracking-widest hover:opacity-70 transition-opacity ml-auto",
                isBikeMode ? "text-brand-blue" : "text-brand-orange"
              )}
            >
              {t('filters.reset')}
            </button>
          </div>

          {/* Car List */}
          <div className="space-y-8">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-32 glass-card rounded-[3rem]">
                <Loader2 className={cn("animate-spin mb-6", isBikeMode ? "text-brand-blue" : "text-brand-orange")} size={48} />
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
                  className={cn(
                    "px-10 py-4 text-white font-bold uppercase tracking-widest text-xs rounded-full hover:opacity-90 transition-all shadow-lg",
                    isBikeMode ? "bg-brand-blue shadow-brand-blue/20" : "bg-brand-orange shadow-brand-orange/20"
                  )}
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
                          <h3 className="text-3xl font-bold text-black tracking-tight mb-2">{car.name} <span className="text-black/40 font-normal text-xl">{t('car.orSimilar')}</span></h3>
                          <div className={cn(
                            "inline-flex px-3 py-1 rounded-full",
                            isBikeMode ? "bg-brand-blue/10" : "bg-brand-orange/10"
                          )}>
                            <p className={cn(
                              "font-bold uppercase tracking-widest text-[10px]",
                              isBikeMode ? "text-brand-blue" : "text-brand-orange"
                            )}>{t('car.model')} {car.yearRange || '2018 - 2021'}</p>
                          </div>
                        </div>
                        
                        <ul className="grid grid-cols-2 gap-x-12 gap-y-4 text-[10px] font-bold uppercase tracking-widest text-black/40">
                          <li className="flex items-center gap-3"><Users size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> {t('car.seats', { count: car.passengers || 5 })}</li>
                          <li className="flex items-center gap-3"><Settings size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> {(car.transmission?.toLowerCase() || '').startsWith('auto') ? t('car.automatic') : t('car.manual')}</li>
                          <li className="flex items-center gap-3"><Zap size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> {t('filters.engine')} {car.engineSize || '1.5'}</li>
                          <li className="flex items-center gap-3"><Fuel size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> {t(`car.${(car.fuelType?.toLowerCase() || 'petrol')}`)}</li>
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
                          <div className={cn(
                            "absolute inset-0 blur-3xl rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-opacity duration-700",
                            isBikeMode ? "bg-brand-blue/5" : "bg-brand-orange/5"
                          )} />
                          <StorageImage 
                            path={car.mainImage || `https://picsum.photos/seed/${car.name}/400/250`} 
                            alt={car.name} 
                            className="w-[240px] h-auto object-contain relative z-10 drop-shadow-2xl transform group-hover:scale-105 transition-transform duration-500"
                            fallback={`https://picsum.photos/seed/${car.name}/400/250`}
                          />
                        </div>
                        <div className="space-y-4">
                          <div>
                            <p className="text-[10px] font-bold text-black/20 uppercase tracking-widest mb-1">{t('car.total', { days: totalDays })}</p>
                            {(() => { const pd = getPriceDisplay(car); return (
                      <p className={pd.kind === 'message'
                        ? "text-2xl font-bold text-black tracking-tight"
                        : "text-5xl font-bold text-black tracking-tighter font-mono"}>{pd.text}</p>
                    ); })()}
                          </div>
                          <button 
                            onClick={() => {
                              setSelectedCar(car);
                              setShowEnquiryModal(true);
                            }}
                            className={cn(
                              "w-full text-white px-12 py-4 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg",
                              isBikeMode ? "bg-brand-blue shadow-brand-blue/20" : "bg-brand-orange shadow-brand-orange/20"
                            )}
                          >
                            {t('car.viewDeal')}
                          </button>
                          <div className="flex items-center justify-end gap-6 text-[10px] font-bold uppercase tracking-widest text-black/20">
                            <span className={cn("cursor-pointer transition-colors", isBikeMode ? "hover:text-brand-blue" : "hover:text-brand-orange")}>{t('car.subjectToAvailability')}</span>
                            <span 
                              onClick={() => setShowImportantInfoModal(true)}
                              className={cn(
                                "flex items-center gap-2 cursor-pointer transition-all px-3 py-1.5 rounded-lg bg-black/5 hover:bg-black/10",
                                isBikeMode ? "text-brand-blue" : "text-brand-orange"
                              )}
                            >
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
                  className={cn(
                    "px-12 py-4 text-white rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg",
                    isBikeMode ? "bg-brand-blue shadow-brand-blue/20" : "bg-brand-orange shadow-brand-orange/20"
                  )}
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
                    onClick={() => handlePageChange('landing')}
                    className={cn(
                      "w-full sm:w-auto px-12 py-4 text-white rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg",
                      isBikeMode ? "bg-brand-blue shadow-brand-blue/20" : "bg-brand-orange shadow-brand-orange/20"
                    )}
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

      <ImportantInfoModal 
        isOpen={showImportantInfoModal} 
        onClose={() => setShowImportantInfoModal(false)} 
        isBikeMode={isBikeMode}
      />

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
                      src="https://firebasestorage.googleapis.com/v0/b/pattaya-rent-a-car-rebuild.firebasestorage.app/o/PRAC-Logo-1.png?alt=media"
                      alt="Logo" 
                      className="h-10 mb-10"
                      referrerPolicy="no-referrer"
                    />
                    <h2 className="text-4xl font-bold text-black tracking-tight mb-4">{selectedCar.name} <span className="text-black/20 font-normal text-2xl">{t('car.orSimilar')}</span></h2>
                    <div className={cn(
                      "inline-flex px-3 py-1 rounded-full mb-10",
                      isBikeMode ? "bg-brand-blue/10" : "bg-brand-orange/10"
                    )}>
                      <p className={cn(
                        "font-bold uppercase tracking-widest text-[10px]",
                        isBikeMode ? "text-brand-blue" : "text-brand-orange"
                      )}>{t('car.model')} {selectedCar.yearRange || '2018 - 2021'}</p>
                    </div>
                    
                    <ul className="grid grid-cols-2 gap-6 text-[10px] font-bold uppercase tracking-widest text-black/40 mb-12">
                      <li className="flex items-center gap-3"><Users size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> {t('car.seats', { count: selectedCar.passengers || 5 })}</li>
                      <li className="flex items-center gap-3"><MessageSquare size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> CD/USB/AUX</li>
                      <li className="flex items-center gap-3"><CarIcon size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> {(selectedCar.transmission?.toLowerCase() || '').startsWith('auto') ? t('car.automatic') : t('car.manual')}</li>
                      <li className="flex items-center gap-3"><Zap size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> {t('filters.engine')} {selectedCar.engineSize || '1.5'}</li>
                      <li className="flex items-center gap-3"><Fuel size={16} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} /> {t(`car.${(selectedCar.fuelType?.toLowerCase() || 'petrol')}`)}</li>
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

                    <div className={cn(
                      "mb-12 p-8 rounded-[2rem] border",
                      isBikeMode ? "bg-brand-blue/5 border-brand-blue/10" : "bg-brand-orange/5 border-brand-orange/10"
                    )}>
                      <p className={cn("text-3xl font-bold tracking-tighter mb-2", isBikeMode ? "text-brand-blue" : "text-brand-orange")}>{totalDays} {t('results.days')}</p>
                      {(() => { const pd = getPriceDisplay(selectedCar); return (
                          <p className={pd.kind === 'message'
                            ? "text-2xl font-bold tracking-tight"
                            : "text-5xl font-bold tracking-tighter font-mono"}>{pd.text}</p>
                        ); })()}
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
                      <div className={cn(
                        "absolute inset-0 blur-3xl rounded-full scale-150",
                        isBikeMode ? "bg-brand-blue/5" : "bg-brand-orange/5"
                      )} />
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
                            ? (isBikeMode ? "bg-brand-blue/5 border-brand-blue" : "bg-brand-orange/5 border-brand-orange")
                            : "bg-black/5 border-transparent hover:bg-black/10"
                        )}
                      >
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                            formData.requireDelivery 
                              ? (isBikeMode ? "bg-brand-blue text-white" : "bg-brand-orange text-white") 
                              : "bg-black/10 text-black/40"
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
                          formData.requireDelivery 
                            ? (isBikeMode ? "bg-brand-blue border-brand-blue" : "bg-brand-orange border-brand-orange") 
                            : "border-black/10"
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

                    <div 
                      onClick={() => setShowImportantInfoModal(true)}
                      className={cn(
                        "flex items-center justify-center gap-3 font-bold uppercase tracking-widest text-[10px] mb-10 cursor-pointer hover:opacity-70 transition-all px-6 py-3 bg-black/5 rounded-2xl mx-auto w-fit",
                        isBikeMode ? "text-brand-blue" : "text-brand-orange"
                      )}
                    >
                      <Info size={16} /> 
                      <span>{t('car.importantInfo')}</span>
                    </div>

                    <button 
                      type="submit"
                      disabled={isSubmitting}
                      className={cn(
                        "w-full text-white py-5 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg",
                        isBikeMode ? "bg-brand-blue shadow-brand-blue/20" : "bg-brand-orange shadow-brand-orange/20"
                      )}
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

      {/* Date picker overlay - available on all views */}
                  <AnimatePresence>
                    {showCalendar && (
                      <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center p-0 md:p-4">
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={() => setShowCalendar(false)}
                          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div 
                          ref={calendarRef}
                          initial={{ opacity: 0, scale: 0.95, y: 20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 20 }}
                          className={cn(
                            "relative z-10 w-full md:w-[700px] max-w-full md:max-w-[95vw]",
                            "bg-white dark:bg-[#1A1A1A] shadow-2xl rounded-t-[2.5rem] md:rounded-[2.5rem]",
                            "flex flex-col h-[85vh] md:h-auto md:max-h-[85vh] overflow-hidden"
                          )}
                        >
                          <DatePickerCustom 
                            selectedRange={selectedRange}
                            onRangeChange={setSelectedRange}
                            pickUpTime={pickUpTime}
                            onPickUpTimeChange={setPickUpTime}
                            dropOffTime={dropOffTime}
                            onDropOffTimeChange={setDropOffTime}
                            isBikeMode={isBikeMode}
                            onClose={() => setShowCalendar(false)}
                            onApply={() => { setShowCalendar(false); handlePageChange('results'); }}
                            useFilteredTimes={true}
                          />
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>


      </div>

      {view !== 'results' && <Footer onPageChange={handlePageChange} isBikeMode={isBikeMode} />}
    </div>
  );
};
