/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, query, orderBy, addDoc, doc, setDoc, getDocFromServer } from 'firebase/firestore';
import { auth, db, signIn, handleFirestoreError, OperationType } from './firebase';
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
import { Logs } from './components/Logs';
import { AITraining } from './components/AITraining';
import { TrafficInsights } from './components/TrafficInsights';
import { LiveEnquiries } from './components/LiveEnquiries';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster, toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { LogIn, Loader2 } from 'lucide-react';
import { isWithinInterval, parseISO, startOfDay, endOfDay, isValid } from 'date-fns';

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
            <meta property="og:title" content="Pattaya Rent a Car | Trusted Car Rental in Pattaya" />
            <meta property="og:description" content="Pattaya's most trusted car rental service since 2005. Quality vehicles, transparent pricing, and exceptional service." />
            <meta property="og:url" content="https://pattayarentacar.com/" />
            <meta property="og:image" content="https://7f8bfb441a72f33e442dece0180dba1f.cdn.bubble.io/cdn-cgi/image/w=1200,h=630,f=auto,dpr=2,fit=contain/f1630376828262x344914557261106300/PRAC-Logo-1.png" />
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
  const [showLogin, setShowLogin] = useState(false);
  const [cars, setCars] = useState<Car[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState<'timeline' | 'finance' | 'booking' | 'pricing' | 'fleet' | 'website_fleet' | 'crm' | 'bookings' | 'logs' | 'enquiries' | 'ai_training' | 'traffic_insights'>('timeline');
  const [financePreFill, setFinancePreFill] = useState<any>(null);

  // Filtering State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [newBookingTrigger, setNewBookingTrigger] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const isStaff = useMemo(() => {
    const email = user?.email?.toLowerCase();
    return email?.endsWith('@pattayarentacar.com') || email === 'info@pattayarentacar.com';
  }, [user]);

  useEffect(() => {
    console.log('AppContent: Setting up auth listener');
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('AppContent: Auth state changed:', !!user);
      setUser(user);
      setLoading(false);
      if (user) setShowLogin(false);
    });
    return () => unsubscribe();
  }, []);

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
          docSnap = await getDocFromServer(userDocRef);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
          return;
        }
        if (!docSnap.exists()) {
          console.log('Creating user document for:', user.email);
          await setDoc(userDocRef, {
            email: user.email,
            displayName: user.displayName,
            role: user.email === 'info@pattayarentacar.com' ? 'admin' : 'staff',
            createdAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('Error ensuring user document:', error);
        // If it's a permission error, we might still be able to create it if it doesn't exist
        // but we'll let the rules handle that.
      }
    };
    ensureUserDoc();

    console.log('Fetching data for user:', user.email);

    const carsQuery = query(collection(db, 'cars'), orderBy('order', 'asc'));
    const unsubscribeCars = onSnapshot(carsQuery, (snapshot) => {
      const carsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Car));
      console.log('Fetched cars count:', carsData.length);
      setCars(carsData.sort((a, b) => (a.order || 0) - (b.order || 0)));
    }, (error) => {
      console.error('Error fetching cars:', error);
      setLastError(`Cars: ${error.message}`);
      handleFirestoreError(error, OperationType.LIST, 'cars');
    });

    const bookingsQuery = collection(db, 'bookings');
    const unsubscribeBookings = onSnapshot(bookingsQuery, (snapshot) => {
      const bookingsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking));
      console.log('Fetched bookings count:', bookingsData.length);
      setBookings(bookingsData);
    }, (error) => {
      console.error('Error fetching bookings:', error);
      setLastError(`Bookings: ${error.message}`);
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    });

    const logsQuery = query(collection(db, 'system_logs'), orderBy('timestamp', 'desc'));
    const unsubscribeLogs = onSnapshot(logsQuery, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SystemLog));
      console.log('Fetched logs count:', logsData.length);
      setLogs(logsData);
    }, (error) => {
      console.error('Error fetching logs:', error);
      setLastError(`Logs: ${error.message}`);
      handleFirestoreError(error, OperationType.LIST, 'system_logs');
    });

    return () => {
      unsubscribeCars();
      unsubscribeBookings();
      unsubscribeLogs();
    };
  }, [user, isStaff]);

  useEffect(() => {
    if (!user || loading) return;
  }, [user, loading]);

  const availability = useMemo(() => {
    if (cars.length === 0) return { free: 0, total: 0 };
    
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
      free: cars.length - occupiedCarIds.size,
      total: cars.length
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
              src="https://7f8bfb441a72f33e442dece0180dba1f.cdn.bubble.io/cdn-cgi/image/w=192,h=70,f=auto,dpr=2,fit=contain/f1630376828262x344914557261106300/PRAC-Logo-1.png"
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
          <p className="text-[#1A1A1A]/60 mb-10 uppercase tracking-widest text-xs">Fleet Management Dashboard</p>
          <button
            onClick={signIn}
            className="w-full bg-brand-orange text-white py-4 rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20"
          >
            <LogIn size={20} /> Sign In with Google
          </button>
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
          onNewBooking={() => setNewBookingTrigger(prev => prev + 1)} 
          currentView={currentView}
          onViewChange={setCurrentView}
        />
        <main className="flex-1 flex flex-col min-w-0">
          {user && (
            <div className="fixed bottom-4 right-4 z-[100] bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-white/60 shadow-xl text-[10px] font-mono pointer-events-none">
              <p className="font-bold text-brand-orange mb-1">Diagnostic Info</p>
              <p>User: {user?.email}</p>
              <p>Verified: {user?.emailVerified ? '✅ Yes' : '❌ No'}</p>
              <p>Staff: {isStaff ? '✅ Yes' : '❌ No'}</p>
              <p>Cars: {cars.length}</p>
              <p>Bookings: {bookings.filter(b => b.carId && b.carId !== '').length}</p>
              <p>Enquiries: {bookings.filter(b => !b.carId || b.carId === '').length}</p>
              <p>Logs: {logs.length}</p>
              <p>Filtered: {filteredBookings.length}</p>
              {(() => {
                const plates = cars.map(c => c.plateNumber);
                const duplicates = plates.filter((item, index) => plates.indexOf(item) !== index);
                return duplicates.length > 0 && (
                  <p className="text-orange-500 font-bold mt-1">
                    ⚠️ {duplicates.length} duplicate plates found
                  </p>
                );
              })()}
              {bookings.length > filteredBookings.length && (
                <p className="text-red-500 font-bold mt-1">
                  ⚠️ {bookings.length - filteredBookings.length} bookings filtered out
                </p>
              )}
              {lastError && (
                <p className="text-red-500 font-bold mt-1">
                  ❌ {lastError}
                </p>
              )}
            </div>
          )}
          {currentView === 'timeline' ? (
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
                carTypes={Array.from(new Set(cars.map(c => c.type)))}
                onNewBooking={() => setNewBookingTrigger(prev => prev + 1)}
              />
              <Timeline
                cars={cars}
                bookings={filteredBookings}
                currentDate={currentDate}
                newBookingTrigger={newBookingTrigger}
                onLogIncome={(booking) => {
                  setFinancePreFill({
                    type: 'Income',
                    amount: booking.amount || 0,
                    carId: booking.carId,
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
            <Bookings bookings={bookings} cars={cars} />
          ) : currentView === 'enquiries' ? (
            <LiveEnquiries bookings={bookings} cars={cars} />
          ) : currentView === 'website_fleet' ? (
            <WebsiteFleetManager />
          ) : currentView === 'crm' ? (
            <CRM />
          ) : currentView === 'logs' ? (
            <Logs logs={logs} />
          ) : currentView === 'ai_training' ? (
            <AITraining />
          ) : currentView === 'traffic_insights' ? (
            <TrafficInsights />
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
