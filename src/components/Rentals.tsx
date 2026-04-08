import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, orderBy, onSnapshot, where, getDocs } from 'firebase/firestore';
import { Rental, Car, Customer } from '../types';
import { format, parseISO, isValid } from 'date-fns';
import { Calendar, User, Car as CarIcon, Search, Clock, ShieldCheck, Eye, X, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface RentalsProps {
  cars: Car[];
}

export const Rentals: React.FC<RentalsProps> = ({ cars }) => {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRental, setSelectedRental] = useState<Rental | null>(null);
  const [fallbackPhotos, setFallbackPhotos] = useState<string[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'rentals'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rentalsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Rental));
      setRentals(rentalsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'rentals');
    });

    // Fetch customers for names
    const qCust = query(collection(db, 'customers'));
    const unsubscribeCust = onSnapshot(qCust, (snapshot) => {
      const customersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      setCustomers(customersData);
    });

    return () => {
      unsubscribe();
      unsubscribeCust();
    };
  }, []);

  const fetchFallbackPhotos = async (rentalId: string) => {
    setLoadingPhotos(true);
    setFallbackPhotos([]);
    try {
      const q = query(collection(db, 'rental_photos'), where('rentalId', '==', rentalId), orderBy('index', 'asc'));
      const snapshot = await getDocs(q);
      const photos = snapshot.docs.map(doc => doc.data().photo as string);
      setFallbackPhotos(photos);
    } catch (error) {
      console.error('Error fetching fallback photos:', error);
    } finally {
      setLoadingPhotos(false);
    }
  };

  const filteredRentals = rentals.filter(rental => {
    const customer = customers.find(c => c.id === rental.customerId);
    const car = cars.find(c => c.id === rental.carId);
    const searchLower = searchTerm.toLowerCase();
    
    return (
      customer?.firstName.toLowerCase().includes(searchLower) ||
      customer?.lastName.toLowerCase().includes(searchLower) ||
      car?.name.toLowerCase().includes(searchLower) ||
      car?.plateNumber.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-warm-bg overflow-hidden">
      <div className="p-4 sm:p-8 border-b border-white/20 bg-white/40 backdrop-blur-xl flex flex-col gap-4 sm:gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif italic text-2xl sm:text-4xl text-[#1A1A1A]">Active Rentals</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[8px] sm:text-[10px] mt-1 font-medium">Manage Processed Vehicle Rentals</p>
          </div>
        </div>

        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30" size={16} />
          <input
            type="text"
            placeholder="Search by customer or vehicle..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 sm:h-12 pl-12 pr-4 bg-white/60 border border-white/40 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8">
        <div className="max-w-5xl mx-auto space-y-4">
          {filteredRentals.map(rental => {
            const customer = customers.find(c => c.id === rental.customerId);
            const car = cars.find(c => c.id === rental.carId);
            const dateOut = parseISO(rental.dateOut);
            
            return (
              <motion.div
                key={rental.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/60 backdrop-blur-md border border-white/60 p-4 sm:p-6 rounded-[24px] sm:rounded-[32px] hover:shadow-xl transition-all group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 sm:gap-6">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 bg-brand-orange/10 rounded-xl sm:rounded-2xl flex items-center justify-center text-brand-orange shrink-0">
                      <CarIcon size={24} className="sm:w-7 sm:h-7" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-base sm:text-lg text-[#1A1A1A] truncate">
                        {car ? `${car.name} (${car.plateNumber})` : 'Unknown Vehicle'}
                      </h3>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-[#1A1A1A]/60 font-medium">
                          <User size={12} className="opacity-40 sm:w-3.5 sm:h-3.5" />
                          <span className="truncate">{customer ? `${customer.firstName} ${customer.lastName}` : 'Unknown Customer'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-[#1A1A1A]/60 font-medium">
                          <Clock size={12} className="opacity-40 sm:w-3.5 sm:h-3.5" />
                          {isValid(dateOut) ? format(dateOut, 'dd MMM, HH:mm') : 'Invalid Date'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-4 sm:pt-0">
                    <div className="text-left sm:text-right sm:mr-4">
                      <p className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Total Charge</p>
                      <p className="text-base sm:text-lg font-bold text-brand-orange">฿{rental.totalCharge.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "px-3 py-1 sm:px-4 sm:py-2 rounded-full text-[8px] sm:text-[10px] font-bold uppercase tracking-widest",
                        rental.status === 'Active' ? "bg-green-100 text-green-600" : "bg-[#1A1A1A]/5 text-[#1A1A1A]/40"
                      )}>
                        {rental.status}
                      </div>
                      <button
                        onClick={() => {
                          setSelectedRental(rental);
                          fetchFallbackPhotos(rental.id);
                        }}
                        className="p-2 sm:p-3 bg-white rounded-xl sm:rounded-2xl text-[#1A1A1A]/40 hover:text-brand-orange hover:shadow-md transition-all"
                      >
                        <Eye size={18} className="sm:w-5 sm:h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}

          {filteredRentals.length === 0 && !loading && (
            <div className="text-center py-20">
              <div className="w-20 h-20 bg-white/40 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="text-[#1A1A1A]/10" size={40} />
              </div>
              <h2 className="font-serif italic text-2xl text-[#1A1A1A]">No Rentals Found</h2>
              <p className="text-[#1A1A1A]/40 uppercase tracking-widest text-[10px] font-bold mt-2">Processed rentals will appear here</p>
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      <AnimatePresence>
        {selectedRental && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRental(null)}
              className="absolute inset-0 bg-[#1A1A1A]/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white/90 backdrop-blur-2xl border border-white/60 w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[#1A1A1A]/5 flex items-center justify-between">
                <div>
                  <h2 className="font-serif italic text-3xl text-[#1A1A1A]">Rental Details</h2>
                  <p className="text-[#1A1A1A]/40 uppercase tracking-widest text-[10px] font-bold mt-1">Processed Record</p>
                </div>
                <button
                  onClick={() => setSelectedRental(null)}
                  className="w-10 h-10 rounded-full bg-[#1A1A1A]/5 flex items-center justify-center text-[#1A1A1A]/40 hover:bg-brand-orange hover:text-white transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 max-h-[70vh] overflow-y-auto custom-scrollbar space-y-8">
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Customer</p>
                    <p className="font-bold text-[#1A1A1A]">
                      {customers.find(c => c.id === selectedRental.customerId)?.firstName} {customers.find(c => c.id === selectedRental.customerId)?.lastName}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Vehicle</p>
                    <p className="font-bold text-[#1A1A1A]">
                      {cars.find(c => c.id === selectedRental.carId)?.name} ({cars.find(c => c.id === selectedRental.carId)?.plateNumber})
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Rental Period</p>
                    <p className="text-sm font-medium text-[#1A1A1A]/60">
                      {format(parseISO(selectedRental.dateOut), 'dd MMM yyyy')} - {format(parseISO(selectedRental.dateIn), 'dd MMM yyyy')}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Processed By</p>
                    <p className="text-sm font-medium text-[#1A1A1A]/60">{selectedRental.processedBy}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange flex items-center gap-2">
                    <ImageIcon size={14} /> Damage Inspection Photos
                  </p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {/* Storage Photos */}
                    {selectedRental.damagePhotos?.map((url, i) => (
                      <div key={`storage-${i}`} className="aspect-square rounded-2xl overflow-hidden border border-[#1A1A1A]/5 shadow-sm">
                        <img src={url} alt={`Damage ${i}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    ))}
                    
                    {/* Fallback Photos */}
                    {fallbackPhotos.map((url, i) => (
                      <div key={`fallback-${i}`} className="aspect-square rounded-2xl overflow-hidden border border-[#1A1A1A]/5 shadow-sm">
                        <img src={url} alt={`Fallback Damage ${i}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    ))}

                    {loadingPhotos && (
                      <div className="aspect-square rounded-2xl bg-[#1A1A1A]/5 flex items-center justify-center animate-pulse">
                        <ImageIcon className="text-[#1A1A1A]/10" size={24} />
                      </div>
                    )}

                    {!loadingPhotos && selectedRental.damagePhotos?.length === 0 && fallbackPhotos.length === 0 && (
                      <div className="col-span-full py-8 text-center bg-[#1A1A1A]/5 rounded-3xl">
                        <p className="text-xs text-[#1A1A1A]/40 font-medium italic">No photos recorded for this rental</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
