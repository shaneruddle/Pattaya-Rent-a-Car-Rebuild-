/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged, User, getRedirectResult } from 'firebase/auth';
import { collection, getDocs, query, orderBy, addDoc, doc, setDoc, getDoc, limit, where, onSnapshot } from 'firebase/firestore';
import { auth, db, signIn, signInRedirect, handleFirestoreError, OperationType, safeGetDocs } from './firebase';
import { Car, Booking } from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Timeline } from './components/Timeline';
import { Finance } from './components/Finance';
import { PricingManager } from './components/PricingManager';
import { FleetManager } from './components/FleetManager';
import { Bookings } from './components/Bookings';
import { WebsiteFleetManager } from './components/WebsiteFleetManager';
import { CRM } from './components/CRM';
import { UserManagement } from './components/UserManagement';
import { Logs } from './components/Logs';
import { ImageManagement } from './components/ImageManagement';
import { MarketingFAQ } from './components/MarketingFAQ';
import { BlogManager } from './components/BlogManager';
import { LiveEnquiries } from './components/LiveEnquiries';
import { AIAssistant } from './components/AIAssistant';
import { NewRental } from './components/NewRental';
import { Rentals } from './components/Rentals';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster, toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { LogIn, Loader2 } from 'lucide-react';
import { isWithinInterval, parseISO, startOfDay, endOfDay, isValid, subMonths } from 'date-fns';
import { safeLocalStorage } from './lib/storage';

import { BookingEngine } from './components/BookingEngine';
import { LanguageProvider } from './LanguageContext';
import { PricingProvider } from './contexts/PricingContext';
import { Helmet } from 'react-helmet-async';
import { SystemLog } from './types';

export default function App() {
  console.log('App: Rendering top-level component');
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <PricingProvider>
          <Helmet>
            <title>Pattaya Rent a Car | Trusted Car Rental in Pattaya Since 2005</title>
            <meta name="description" content="Rent a car in Pattaya with Thailand's most trusted service. First-class insurance, free delivery, and 24/7 support. Book your perfect car today." />
            <link rel="icon" type="image/jpeg" href="https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0665145746.firebasestorage.app/o/PRAC-Icon.jpg?alt=media&token=2bca69cd-f667-4ea4-9ff2-5ea04fce3c23" />
            <meta property="og:title" content="Pattaya Rent a Car | Trusted Car Rental in Pattaya" />
            <meta property="og:description" content="Pattaya's most trusted car rental service since 2005. Quality vehicles, transparent pricing, and exceptional service." />
            <meta property="og:url" content="https://pattayarentacar.com/" />
            <meta property="og:image" content="https://firebasestorage.googleapis.com/v0/b/pattaya-rent-a-car-rebuild.firebasestorage.app/o/PRAC-Logo-1.png?alt=media" />
          </Helmet>
          <AppContent />
        </PricingProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  console.log('AppContent: Initializing');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [cars, setCars] = useState<Car[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState<'timeline_cars' | 'timeline_bikes' | 'finance' | 'booking' | 'pricing' | 'fleet' | 'crm' | 'website_fleet' | 'bookings' | 'rentals' | 'logs' | 'enquiries' | 'user_management' | 'new_rental' | 'image_management' | 'marketing_faq' | 'blog'>('timeline_cars');
  const [financePreFill, setFinancePreFill] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  // Connection check removed from early mount to avoid Permission Denied on first turn
  // Authenticated users will implicitly check connection via fetchData

  useEffect(() => {
    console.log('App: Current Domain:', window.location.hostname);
    console.log('App: Firebase Auth State:', auth.currentUser ? 'Logged In' : 'Logged Out');
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  console.log('AppContent: Current State:', { loading, user: !!user, currentView });

  // Filtering State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [newBookingTrigger, setNewBookingTrigger] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastDataFetch, setLastDataFetch] = useState<number>(() => {
    const cached = safeLocalStorage.getItem('prac_last_fetch');
    return cached ? parseInt(cached) : 0;
  });

  const isStaff = useMemo(() => {
    const email = user?.email?.toLowerCase().trim();
    return email?.endsWith('@pattayarentacar.com') || email === 'info@pattayarentacar.com';
  }, [user]);

  const isAdmin = useMemo(() => {
    const email = user?.email?.toLowerCase();
    return [
      'info@pattayarentacar.com',
      'gift@pattayarentacar.com',
      'rak@pattayarentacar.com'
    ].includes(email || '');
  }, [user]);

  // Redirect mobile employees to allowed sections
  useEffect(() => {
    if (isMobile && !isAdmin && user && isStaff) {
      const allowedViews = ['new_rental', 'rentals'];
      if (!allowedViews.includes(currentView)) {
        setCurrentView('new_rental');
      }
    }
  }, [isMobile, isAdmin, user, isStaff, currentView]);

  useEffect(() => {
    console.log('AppContent: Setting up auth listener');
    
    // Check for redirect result
    const checkRedirect = async () => {
      try {
        console.log('AppContent: Checking redirect result...');
        const result = await getRedirectResult(auth);
        if (result?.user) {
          console.log('AppContent: Redirect sign in successful for:', result.user.email);
          setUser(result.user);
          setShowLogin(false);
          toast.success(`Welcome back, ${result.user.displayName || result.user.email}`);
        } else {
          console.log('AppContent: No redirect result found');
        }
      } catch (error: any) {
        console.error('AppContent: Redirect sign in error:', error);
        setLastError(`Redirect Error: ${error.message}`);
        toast.error(`Redirect sign in failed: ${error.message}`);
      }
    };
    checkRedirect();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('AppContent: Auth state changed:', !!user, user?.email);
      setUser(user);
      setLoading(false);
      if (user) {
        setShowLogin(false);
        console.log('AppContent: User detected, hiding login screen');
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchData = React.useCallback(async (force = false) => {
    // Only fetch if authenticated to avoid PERMISSION_DENIED
    if (!auth.currentUser) return;

    // Cache for 10 minutes to save quota
    const CACHE_DURATION = 10 * 60 * 1000;
    
    // Using a ref or a functional state update wouldn't work easily here
    // with the current structure. Let's just use the current values at call time.
    // We can use a guard inside to check against the global state.
    
    // Using localStorage directly for the check prevents the dependency loop with lastDataFetch state
    const lastFetch = Number(safeLocalStorage.getItem('prac_last_fetch') || 0);
    const isCacheValid = !force && (Date.now() - lastFetch < CACHE_DURATION);

    if (isCacheValid) {
      const cachedCars = safeLocalStorage.getItem('prac_cached_cars');
      if (cachedCars) {
        console.log('AppContent: Using cached data to save reads');
        // We still set state to ensure UI is in sync, but we don't fetch from network
        try {
          const parsedCars = JSON.parse(cachedCars);
          const parsedBookings = JSON.parse(safeLocalStorage.getItem('prac_cached_bookings') || '[]');
          const parsedLogs = JSON.parse(safeLocalStorage.getItem('prac_cached_logs') || '[]');
          setCars(parsedCars);
          setBookings(parsedBookings);
          setLogs(parsedLogs);
          return;
        } catch (e) {
          console.error('Error parsing cached data:', e);
        }
      }
    }

    try {
      console.log('AppContent: Fetching fresh data from Firestore...');
      const carsQuery = query(collection(db, 'cars'), orderBy('order', 'asc'));
      const carsSnapshot = await safeGetDocs(carsQuery);
      
      const carsData = carsSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Car));
      const sortedCars = carsData.sort((a, b) => (a.order || 0) - (b.order || 0));
      console.log(`AppContent: Fetched ${sortedCars.length} cars`);
      setCars(sortedCars);

      // Fetch all bookings (limited to 500) to ensure we see data
      const bookingsQuery = query(
        collection(db, 'bookings'), 
        limit(500)
      );
      
      const bookingsSnapshot = await safeGetDocs(bookingsQuery);
      const bookingsData = bookingsSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as Booking));
      setBookings(bookingsData);
  
      setConnectionStatus('online');
  
        // Update cache
        const now = Date.now();
        setLastDataFetch(now);
        setLastError(null);
        safeLocalStorage.setItem('prac_last_fetch', now.toString(), true);
        safeLocalStorage.setItem('prac_cached_cars', JSON.stringify(sortedCars), true);
        safeLocalStorage.setItem('prac_cached_bookings', JSON.stringify(bookingsData), true);
      } catch (error: any) {
      console.error('Error fetching initial data:', error);
      const errorMessage = error.message || String(error);
      setLastError(`Data Fetch Error: ${errorMessage}`);
    }
  }, []); // Empty dependency array breaks the loop!

  useEffect(() => {
    if (!user || !isStaff) {
      console.log('Not attaching listeners: user=', !!user, 'isStaff=', isStaff);
      return;
    }

    // Ensure user document exists in Firestore for rules to work correctly
    const ensureUserDoc = async () => {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        let docSnap;
        try {
          docSnap = await getDoc(userDocRef);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
          return;
        }

        const isAdminEmail = [
          'info@pattayarentacar.com',
          'gift@pattayarentacar.com',
          'rak@pattayarentacar.com'
        ].includes(user.email?.toLowerCase() || '');

        if (!docSnap.exists()) {
          console.log('Creating user document for:', user.email);
          await setDoc(userDocRef, {
            email: user.email,
            displayName: user.displayName,
            role: isAdminEmail ? 'admin' : 'staff',
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
          });
        } else {
          // Update last login
          await setDoc(userDocRef, {
            lastLogin: new Date().toISOString(),
            displayName: user.displayName || docSnap.data().displayName,
            // Ensure initial admins are always admins if they exist but don't have the role
            role: isAdminEmail ? 'admin' : (docSnap.data().role || 'staff')
          }, { merge: true });
        }
      } catch (error) {
        console.error('Error ensuring user document:', error);
      }
    };
    ensureUserDoc();

    console.log('Fetching data for user:', user.email);
    fetchData();
  }, [user, isStaff, fetchData]);

  useEffect(() => {
    if (!user || loading) return;
  }, [user, loading]);

  const availability = useMemo(() => {
    const activeCars = cars.filter(c => c.isActive !== false);
    if (activeCars.length === 0) return { free: 0, total: 0 };
    
    const now = new Date();
    const activeBookings = bookings.filter(booking => {
      try {
        const start = parseISO(booking.startDate);
        const end = parseISO(booking.endDate);
        if (!isValid(start) || !isValid(end)) return false;
        
        return isWithinInterval(now, {
          start,
          end
        });
      } catch (e) {
        return false;
      }
    });

    const occupiedCarIds = new Set(activeBookings.map(b => b.carId));
    return {
      free: activeCars.length - occupiedCarIds.size,
      total: activeCars.length
    };
  }, [cars, bookings]);

  const filteredBookings = useMemo(() => {
    const result = bookings.filter(booking => {
      const car = cars.find(c => c.id === booking.carId);
      
      // Search query (Customer Name or Mobile)
      const matchesSearch = 
        booking.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (booking.mobileNumber && booking.mobileNumber.includes(searchQuery));
      
      // Status filter
      const matchesStatus = !statusFilter || booking.status === statusFilter;
      
      // Car Type filter
      const matchesType = !typeFilter || car?.type === typeFilter;
      
      return matchesSearch && matchesStatus && matchesType;
    });

    if (bookings.length > 0 && result.length < bookings.length) {
      console.log(`Filtered bookings: ${result.length} out of ${bookings.length}`);
      // Find which bookings are filtered out and why
      const filteredOut = bookings.filter(b => !result.includes(b));
      filteredOut.forEach(b => {
        const car = cars.find(c => c.id === b.carId);
        if (!car) {
          console.warn(`Booking for ${b.customerName} has invalid carId: ${b.carId}`);
        }
      });
    }

    return result;
  }, [bookings, cars, searchQuery, statusFilter, typeFilter]);

  console.log('AppContent: Auth state:', { loading, user: !!user, isStaff });

  const handleSignIn = async () => {
    setSigningIn(true);
    setLastError(null);
    try {
      console.log('AppContent: Starting sign in...');
      const result = await signIn();
      console.log('AppContent: Sign in successful, user:', result.user.email);
      setUser(result.user);
      setShowLogin(false);
      toast.success(`Signed in as ${result.user.email}`);

      // On custom domains, sometimes the state doesn't sync immediately to the main window
      // If after 2 seconds we still don't have a user in the auth object, try a reload
      if (window.location.hostname !== 'localhost' && !window.location.hostname.includes('run.app')) {
        setTimeout(() => {
          if (!auth.currentUser) {
            console.log('AppContent: Auth state not persisted on custom domain, reloading...');
            window.location.reload();
          }
        }, 2000);
      }
    } catch (error: any) {
      console.error('AppContent: Sign in error:', error);
      setLastError(error.message || 'Unknown sign-in error');
      toast.error(`Sign in failed: ${error.message || 'Unknown error'}`);
      
      // If it's a domain error, give specific advice
      if (error.code === 'auth/unauthorized-domain') {
        toast.error('This domain is not authorized in Firebase. Please add new1.pattayarentacar.com to Authorized Domains in Firebase Console.', {
          duration: 10000
        });
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignInRedirect = async () => {
    setSigningIn(true);
    try {
      console.log('AppContent: Starting redirect sign in...');
      await signInRedirect();
    } catch (error: any) {
      console.error('AppContent: Redirect sign in error:', error);
      toast.error(`Redirect sign in failed: ${error.message}`);
      setSigningIn(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-warm-bg flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-orange" size={48} />
      </div>
    );
  }

  if (!user && !showLogin) {
    return (
      <ErrorBoundary>
        <BookingEngine onLoginClick={() => setShowLogin(true)} />
        <AIAssistant />
      </ErrorBoundary>
    );
  }

  if (!user && showLogin) {
    return (
      <div className="h-screen bg-warm-bg flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white/40 backdrop-blur-xl border border-white/60 p-12 max-w-md w-full shadow-2xl rounded-[40px] text-center"
        >
          <div className="flex justify-between items-center mb-10">
            <img
              src="https://firebasestorage.googleapis.com/v0/b/pattaya-rent-a-car-rebuild.firebasestorage.app/o/PRAC-Logo-1.png?alt=media"
              alt="PRAC Logo"
              className="w-32"
              referrerPolicy="no-referrer"
            />
            <button 
              onClick={() => setShowLogin(false)}
              className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 hover:text-brand-orange transition-colors"
            >
              Cancel
            </button>
          </div>
          <h1 className="font-serif italic text-4xl text-[#1A1A1A] mb-4">Staff Login</h1>
          <p className="text-[#1A1A1A]/60 mb-6 uppercase tracking-widest text-xs">Fleet Management Dashboard</p>
          
          <div className="bg-black/5 rounded-2xl p-4 mb-8 text-[10px] font-mono text-left space-y-1">
            <p className="text-black/40 uppercase font-bold mb-2">System Status</p>
            <p>Domain: {window.location.hostname}</p>
            <p>Protocol: {window.location.protocol}</p>
            <p>Auth Ready: {loading ? '⏳ Loading...' : '✅ Ready'}</p>
            <p>Current User: {user ? user.email : 'None'}</p>
            <p>Is Staff: {user ? (isStaff ? '✅ Yes' : '❌ No') : 'N/A'}</p>
            {lastError && <p className="text-red-500 mt-2">Error: {lastError}</p>}
            <button 
              onClick={() => {
                console.log('Manual Auth Refresh. Current:', auth.currentUser?.email);
                setUser(auth.currentUser);
                if (auth.currentUser) setShowLogin(false);
                toast.info(`Auth State: ${auth.currentUser ? auth.currentUser.email : 'No user'}`);
              }}
              className="mt-2 text-brand-orange hover:underline font-bold"
            >
              [ Refresh Auth State ]
            </button>
          </div>

          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full bg-brand-orange text-white py-4 rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
          >
            {signingIn ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <LogIn size={20} />
            )}
            {signingIn ? 'Signing In...' : 'Sign In with Google'}
          </button>
          
          <button
            onClick={handleSignInRedirect}
            disabled={signingIn}
            className="w-full text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 hover:text-brand-orange transition-colors mb-6"
          >
            Trouble with popup? Try Redirect Sign In
          </button>

          <div className="pt-6 border-t border-black/5 space-y-4">
            <p className="text-[9px] text-black/40 leading-relaxed">
              If you are redirected to the internal Cloud Run URL, please log in there first, then return to this domain.
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={() => {
                  console.log('Current Auth User:', auth.currentUser);
                  toast.info(`Current User: ${auth.currentUser?.email || 'None'}`);
                }}
                className="text-[8px] font-bold uppercase tracking-widest text-black/20 hover:text-black transition-colors"
              >
                Check Auth Status
              </button>
              <button
                onClick={() => {
                  auth.signOut();
                  toast.success('Signed out successfully');
                }}
                className="text-[8px] font-bold uppercase tracking-widest text-black/20 hover:text-red-500 transition-colors"
              >
                Force Sign Out
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (user && !isStaff) {
    return (
      <div className="h-screen bg-warm-bg flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white/40 backdrop-blur-xl border border-white/60 p-12 max-w-md w-full shadow-2xl rounded-[40px] text-center"
        >
          <div className="flex justify-center mb-8">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500">
              <LogIn size={32} />
            </div>
          </div>
          <h1 className="font-serif italic text-3xl text-[#1A1A1A] mb-4">Access Denied</h1>
          <p className="text-[#1A1A1A]/60 mb-8 leading-relaxed">
            Only authorized staff with a <span className="font-bold text-[#1A1A1A]">@pattayarentacar.com</span> email address can access the management dashboard.
          </p>
          <div className="space-y-4">
            <button
              onClick={() => auth.signOut()}
              className="w-full bg-brand-orange text-white py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20"
            >
              Sign Out
            </button>
            <button
              onClick={() => setShowLogin(false)}
              className="w-full text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 hover:text-brand-orange transition-colors"
            >
              Return to Booking Engine
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-warm-bg font-sans text-[#1A1A1A] selection:bg-brand-orange selection:text-white">
        <Sidebar 
          user={user} 
          isAdmin={isAdmin}
          isMobile={isMobile}
          onNewBooking={() => setNewBookingTrigger(prev => prev + 1)} 
          currentView={currentView}
          onViewChange={setCurrentView}
        />
        <main className="flex-1 flex flex-col min-w-0">
          {user && (
            <div className="fixed bottom-4 right-4 z-[100] bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-white/60 shadow-xl text-[10px] font-mono pointer-events-none">
              {lastError && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-2xl mb-6 flex items-center justify-between">
                  <p className="text-red-500 font-bold text-xs">
                    ❌ {lastError}
                  </p>
                  <button 
                    onClick={() => fetchData(true)}
                    className="bg-red-500 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-600 transition-all pointer-events-auto"
                  >
                    Retry Fetch
                  </button>
                </div>
              )}
            </div>
          )}
          {currentView === 'timeline_cars' || currentView === 'timeline_bikes' ? (
            <>
              <Header
                currentDate={currentDate}
                setCurrentDate={setCurrentDate}
                availability={availability}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                typeFilter={typeFilter}
                setTypeFilter={setTypeFilter}
                carTypes={Array.from(new Set(cars.filter(c => c.isActive !== false).map(c => c.type)))}
                onNewBooking={() => setNewBookingTrigger(prev => prev + 1)}
              />
              <Timeline
                cars={cars.filter(c => (currentView === 'timeline_cars' ? c.category === 'Car' : c.category === 'Motorbike') && c.isActive !== false)}
                bookings={filteredBookings}
                currentDate={currentDate}
                newBookingTrigger={newBookingTrigger}
                title={currentView === 'timeline_bikes' ? "Bike Fleet" : "Car Fleet"}
                onRefresh={() => fetchData(true)}
                onLogIncome={(booking) => {
                  setFinancePreFill({
                    type: 'Income',
                    amount: booking.amount || 0,
                    carId: booking.carId,
                    bookingId: booking.id,
                    description: `Rental payment from ${booking.customerName}`,
                    category: 'Rental'
                  });
                  setCurrentView('finance');
                }}
              />
            </>
          ) : currentView === 'finance' ? (
            <Finance 
              cars={cars} 
              bookings={bookings}
              preFill={financePreFill} 
              onClearPreFill={() => setFinancePreFill(null)} 
            />
          ) : currentView === 'pricing' ? (
            <PricingManager />
          ) : currentView === 'fleet' ? (
            <FleetManager />
          ) : currentView === 'bookings' ? (
            <Bookings bookings={bookings} cars={cars.filter(c => c.isActive !== false)} onRefresh={() => fetchData(true)} />
          ) : currentView === 'rentals' ? (
            <Rentals cars={cars} />
          ) : currentView === 'enquiries' ? (
            <LiveEnquiries bookings={bookings} cars={cars} onRefresh={() => fetchData(true)} />
          ) : currentView === 'website_fleet' ? (
            <WebsiteFleetManager />
          ) : currentView === 'crm' ? (
            <CRM />
          ) : currentView === 'user_management' ? (
            <UserManagement />
          ) : currentView === 'logs' ? (
            <Logs logs={logs} />
          ) : currentView === 'new_rental' ? (
            <NewRental cars={cars.filter(c => c.isActive !== false)} bookings={bookings} onComplete={() => setCurrentView('rentals')} />
          ) : currentView === 'image_management' ? (
            <ImageManagement />
          ) : currentView === 'marketing_faq' ? (
            <MarketingFAQ />
          ) : currentView === 'blog' ? (
            <BlogManager />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <BookingEngine onLoginClick={() => {}} />
            </div>
          )}
        </main>
        <Toaster position="bottom-right" toastOptions={{
          style: {
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(16px)',
            color: '#1A1A1A',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.4)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)'
          }
        }} />
      </div>
    </ErrorBoundary>
  );
}
