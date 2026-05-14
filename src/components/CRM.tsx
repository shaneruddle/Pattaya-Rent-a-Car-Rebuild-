import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, orderBy, limit, addDoc, updateDoc, deleteDoc, doc, where, writeBatch, getCountFromServer } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth, logSystemActivity } from '../firebase';
import { Customer, Booking, Car } from '../types';
import { format, parseISO, isValid } from 'date-fns';
import Papa from 'papaparse';
import { LocationPicker } from './LocationPicker';
import { 
  Users, 
  Search, 
  Mail, 
  Phone, 
  MapPin, 
  Cake, 
  History, 
  Edit2, 
  Trash2, 
  Plus, 
  X, 
  Save, 
  Loader2, 
  ChevronRight,
  ExternalLink,
  User,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { safeLocalStorage } from '../lib/storage';

const CustomerSkeleton = () => (
  <div className="w-full p-5 border-b border-white/5 animate-pulse">
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-2xl bg-[#141414]/10" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-[#141414]/10 rounded w-3/4" />
        <div className="h-3 bg-[#141414]/10 rounded w-1/2" />
      </div>
      <div className="w-4 h-4 bg-[#141414]/10 rounded" />
    </div>
  </div>
);

export const CRM: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [hasLoadedAll, setHasLoadedAll] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerHistory, setCustomerHistory] = useState<Booking[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  // Default to recent mode
  const [isRecentMode, setIsRecentMode] = useState(true);
  const [formLocation, setFormLocation] = useState<{ lat: number; lng: number } | null>(null);

  const handleSearch = () => {
    setSearchQuery(localSearchQuery.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const safeFormat = (dateValue: any, formatStr: string, fallback: string = 'N/A') => {
    if (!dateValue) return fallback;
    try {
      let date: Date;
      if (typeof dateValue === 'string') {
        date = parseISO(dateValue);
      } else if (dateValue && typeof dateValue.toDate === 'function') {
        date = dateValue.toDate();
      } else if (dateValue instanceof Date) {
        date = dateValue;
      } else {
        date = new Date(dateValue);
      }
      
      if (!isValid(date)) return fallback;
      return format(date, formatStr);
    } catch (e) {
      return fallback;
    }
  };

  const safeFormatForInput = (dateValue: any, isNew: boolean = false) => {
    const formatted = safeFormat(dateValue, "yyyy-MM-dd'T'HH:mm", '');
    if (formatted) return formatted;
    return isNew ? format(new Date(), "yyyy-MM-dd'T'HH:mm") : '';
  };

  const [lastFetch, setLastFetch] = useState<number>(() => {
    const cached = safeLocalStorage.getItem('prac_crm_last_fetch');
    return cached ? parseInt(cached) : 0;
  });

  useEffect(() => {
    if (!auth.currentUser) return;
    const fetchTotalCount = async () => {
      try {
        const countSnapshot = await getCountFromServer(collection(db, 'customers'));
        setTotalCount(countSnapshot.data().count);
      } catch (error) {
        console.error("Error fetching total count:", error);
      }
    };
    fetchTotalCount();
  }, []);

  useEffect(() => {
    const fetchData = async (force = false) => {
      // Guard against running before auth is ready or if user logged out
      if (!auth.currentUser) {
        setLoading(false);
        return;
      }

      // If we've already loaded all customers and we are in search mode, 
      // no need to re-fetch as useMemo handles filtering.
      if (hasLoadedAll && searchQuery && !force) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
      const isCacheValid = !force && (Date.now() - lastFetch < CACHE_DURATION);

      if (customers.length === 0 && isCacheValid && localSearchQuery.length >= 3) {
        const cachedCustomers = safeLocalStorage.getItem('prac_cached_customers');
        const cachedCars = safeLocalStorage.getItem('prac_cached_crm_cars');
        if (cachedCustomers && cachedCars) {
          try {
            const parsedCustomers = JSON.parse(cachedCustomers);
            setCustomers(parsedCustomers);
            setCars(JSON.parse(cachedCars));
            setLoading(false);
            return;
          } catch (e) {
            console.error('Error parsing cached CRM data:', e);
          }
        }
      }

      try {
        const custRef = collection(db, 'customers');
        let q;
        
        if (!searchQuery) {
          // Default: 5 most recent
          q = query(custRef, orderBy('creationDate', 'desc'), limit(5));
          const snapshot = await getDocs(q);
          const customerData = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Customer));
          setCustomers(customerData);
          setIsRecentMode(true);
        } else if (!hasLoadedAll) {
          // DATABASE SEARCH: Load ALL customers once on the first search to support 
          // 'includes' and case-insensitive logic requested, as Firestore doesn't support 'contains' natively.
          const snapshot = await getDocs(custRef);
          const allData = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Customer));
          setAllCustomers(allData);
          setHasLoadedAll(true);
          setIsRecentMode(false);
        } else {
          // Already have all customers, just switch modes
          setIsRecentMode(false);
        }
        
        const carsSnapshot = await getDocs(collection(db, 'cars'));
        const carsData = carsSnapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Car));
        setCars(carsData);
        
        if (localSearchQuery.length >= 3) {
          const now = Date.now();
          setLastFetch(now);
          safeLocalStorage.setItem('prac_crm_last_fetch', now.toString(), true);
          safeLocalStorage.setItem('prac_cached_customers', JSON.stringify(hasLoadedAll ? allCustomers : customers), true);
          safeLocalStorage.setItem('prac_cached_crm_cars', JSON.stringify(carsData), true);
        }

        setLoading(false);
      } catch (error: any) {
        console.error("CRM: Firestore error:", error);
        setLoading(false);
        const errorMessage = error.message || String(error);

        // Fallback to stale cache
        const cachedCustomers = safeLocalStorage.getItem('prac_cached_customers');
        const cachedCars = safeLocalStorage.getItem('prac_cached_crm_cars');
        if (cachedCustomers && cachedCars) {
          try {
            setCustomers(JSON.parse(cachedCustomers));
            setCars(JSON.parse(cachedCars));
            toast.error("Using cached CRM data.");
            return;
          } catch (e) {}
        }

        if (errorMessage.includes('Quota exceeded') || errorMessage.includes('resource-exhausted')) {
          toast.error("Firestore quota exceeded. Using cached data if available.");
        } else {
          handleFirestoreError(error, OperationType.LIST, 'customers');
        }
      }
    };

    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        fetchData();
      } else {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [searchQuery]);

  useEffect(() => {
    if (!auth.currentUser || !selectedCustomer) {
      setCustomerHistory([]);
      return;
    }

    const fetchHistory = async () => {
      if (!auth.currentUser) return;
      try {
        const q = query(
          collection(db, 'bookings'),
          where('email', '==', selectedCustomer.email)
        );
        const snapshot = await getDocs(q);
        const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking));
        setCustomerHistory(history.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()));
      } catch (error) {
        console.error("Error fetching customer history:", error);
      }
    };

    fetchHistory();
  }, [selectedCustomer]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExportCSV = () => {
    if (customers.length === 0) {
      toast.error('No customers to export');
      return;
    }

    const exportData = customers.map(c => ({
      'Unique ID': c.uniqueId || '',
      'First Name': c.firstName,
      'Surname': c.lastName || '',
      'Email': c.email,
      'Mobile Number': c.mobileNumber || '',
      'Date of Birth': c.dob || '',
      'Address': c.address || '',
      'Address / Hotel': c.addressHotel || '',
      'Driving Licence': c.drivingLicence || '',
      'Bike Licence Expiry': c.bikeLicenceExpiry || '',
      'Car Licence Expiry': c.carLicenceExpiry || '',
      'Notes': c.notes || '',
      'Creation Date': c.creationDate || '',
      'Latitude': c.location?.lat || '',
      'Longitude': c.location?.lng || '',
      'Location Address': c.location?.address || ''
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `crm_export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success("CRM data exported successfully");
  };

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => (header || '').toString()?.toLowerCase()?.trim()?.replace(/\s+/g, '_') || '',
      complete: async (results) => {
        const data = results.data as any[];
        
        // Map common CSV headers to our Customer type
        const seenEmails = new Set<string>();
        const existingEmails = new Set(customers.map(c => c.email.toLowerCase()));
        let skippedDuplicates = 0;
        let skippedInvalid = 0;

        const validData = data.map(item => {
          // Normalize keys to find values regardless of exact header name
          const getVal = (keys: string[]) => {
            for (const k of keys) {
              const normalizedK = k?.toString()?.toLowerCase()?.replace(/\s+/g, '_') || '';
              if (item[normalizedK] !== undefined) return item[normalizedK];
            }
            return null;
          };

          const email = getVal(['email', 'email_address', 'e-mail', 'mail', 'customer_email']);
          const firstName = getVal(['first_name', 'name', 'firstname', 'first', 'given_name']);
          
          if (!email || !firstName) {
            skippedInvalid++;
            return null;
          }

          const lowerEmail = email.toLowerCase().trim();

          // Check for duplicates in database OR within the CSV itself
          if (existingEmails.has(lowerEmail) || seenEmails.has(lowerEmail)) {
            skippedDuplicates++;
            return null;
          }

          seenEmails.add(lowerEmail);

          return {
            firstName,
            lastName: getVal(['surname', 'last_name', 'lastname', 'last', 'family_name']) || '',
            email: lowerEmail,
            mobileNumber: getVal(['mobile_number', 'phone', 'mobile', 'tel', 'telephone']) || '',
            address: getVal(['address', 'permanent_address']) || '',
            addressHotel: getVal(['address_/_hotel', 'address_hotel', 'hotel', 'staying_at']) || '',
            dob: getVal(['date_of_birth', 'dob', 'birth_date']) || '',
            drivingLicence: getVal(['driving_licence', 'licence', 'license', 'dl']) || '',
            bikeLicenceExpiry: getVal(['bike_licence_expiry', 'bike_expiry']) || '',
            carLicenceExpiry: getVal(['car_licence_expiry', 'car_expiry']) || '',
            notes: getVal(['notes', 'comments', 'remarks']) || '',
            creationDate: getVal(['creation_date', 'created_at', 'date']) || new Date().toISOString(),
            uniqueId: getVal(['unique_id', 'id', 'customer_id']) || '',
            location: {
              lat: parseFloat(getVal(['lat', 'latitude']) || '0') || 0,
              lng: parseFloat(getVal(['lng', 'longitude']) || '0') || 0,
              address: getVal(['location_address', 'location_label', 'location']) || ''
            }
          };
        }).filter(item => item !== null);

        console.log(`Import Summary: ${validData.length} valid, ${skippedDuplicates} duplicates, ${skippedInvalid} invalid rows.`);

        if (validData.length === 0) {
          toast.error(`No new customers to import. (${skippedDuplicates} duplicates skipped, ${skippedInvalid} invalid rows)`);
          return;
        }

        toast.promise(async () => {
          const { writeBatch, db } = await import('../firebase');
          const { collection, doc, serverTimestamp } = await import('firebase/firestore');
          
          const chunks = [];
          for (let i = 0; i < validData.length; i += 500) {
            chunks.push(validData.slice(i, i + 500));
          }

          let totalImported = 0;
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`Importing chunk ${i + 1}/${chunks.length} (${chunk.length} customers)...`);
            const batch = writeBatch(db);
            const customersRef = collection(db, 'customers');
            
            chunk.forEach(customer => {
              const newDocRef = doc(customersRef);
              batch.set(newDocRef, {
                ...customer,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              });
            });
            
            await batch.commit();
            totalImported += chunk.length;
            console.log(`Successfully committed chunk ${i + 1}. Total imported: ${totalImported}`);
          }
          
          await logSystemActivity(
            'CSV Import',
            `Imported ${totalImported} customers via CSV`,
            'CRM',
            { count: totalImported }
          );

          return totalImported;
        }, {
          loading: 'Importing customers...',
          success: (count) => `Successfully imported ${count} customers!`,
          error: (err) => `Failed to import customers: ${err.message}`
        });

        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      error: (error) => {
        console.error('PapaParse error:', error);
        toast.error('Failed to parse CSV file');
      }
    });
  };

  const handleSaveCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const customerData = {
      firstName: formData.get('firstName') as string,
      lastName: formData.get('lastName') as string,
      email: formData.get('email') as string,
      mobileNumber: formData.get('mobileNumber') as string,
      address: formData.get('address') as string,
      addressHotel: formData.get('addressHotel') as string,
      dob: formData.get('dob') as string,
      drivingLicence: formData.get('drivingLicence') as string,
      bikeLicenceExpiry: formData.get('bikeLicenceExpiry') as string,
      carLicenceExpiry: formData.get('carLicenceExpiry') as string,
      notes: formData.get('notes') as string,
      creationDate: formData.get('creationDate') as string || (isAdding ? new Date().toISOString() : selectedCustomer?.creationDate),
      updatedAt: new Date().toISOString(),
      uniqueId: formData.get('uniqueId') as string,
      location: {
        lat: formLocation?.lat || 0,
        lng: formLocation?.lng || 0,
        address: formData.get('locationAddress') as string
      }
    };

    try {
      if (isAdding) {
        // Check if email already exists
        const existing = customers.find(c => (c.email || '').toLowerCase() === (customerData.email || '').toLowerCase());
        if (existing) {
          toast.error('A customer with this email already exists');
          return;
        }
        const docRef = await addDoc(collection(db, 'customers'), customerData);
        
        await logSystemActivity(
          'New Customer',
          `Created new customer ${customerData.firstName} ${customerData.lastName}`,
          'CRM',
          { customerId: docRef.id, email: customerData.email }
        );

        toast.success('Customer added successfully');
        setIsAdding(false);
      } else if (selectedCustomer) {
        await updateDoc(doc(db, 'customers', selectedCustomer.id), customerData);
        
        await logSystemActivity(
          'Update Customer',
          `Updated customer ${customerData.firstName} ${customerData.lastName}`,
          'CRM',
          { customerId: selectedCustomer.id, email: customerData.email }
        );

        toast.success('Customer updated successfully');
        setIsEditing(false);
      }
    } catch (error) {
      handleFirestoreError(error, isAdding ? OperationType.CREATE : OperationType.UPDATE, 'customers');
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    const customer = customers.find(c => c.id === id);
    try {
      await deleteDoc(doc(db, 'customers', id));
      
      if (customer) {
        await logSystemActivity(
          'Delete Customer',
          `Deleted customer ${customer.firstName} ${customer.lastName}`,
          'CRM',
          { customerId: id, email: customer.email }
        );
      }

      setSelectedCustomer(null);
      toast.success('Customer deleted successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `customers/${id}`);
    }
  };

  const filteredCustomers = useMemo(() => {
    // If no search query, return the recent customers
    if (!searchQuery) return customers;
    
    const queryStr = searchQuery.toLowerCase();
    const results = [];
    
    // If we've loaded all customers, search the entire set. Otherwise use what we have.
    const searchTarget = hasLoadedAll ? allCustomers : customers;
    
    for (let i = 0; i < searchTarget.length; i++) {
      const c = searchTarget[i];
      if (
        (c.firstName || '').toLowerCase().includes(queryStr) ||
        (c.lastName || '').toLowerCase().includes(queryStr) ||
        (c.email || '').toLowerCase().includes(queryStr) ||
        (c.mobileNumber || '').includes(queryStr)
      ) {
        results.push(c);
        if (results.length >= 50) break; // Limit for performance
      }
    }
    return results;
  }, [customers, allCustomers, searchQuery, hasLoadedAll]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-warm-bg">
        <Loader2 className="animate-spin text-brand-orange" size={48} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-warm-bg overflow-hidden">
      {/* Header */}
      <div className="p-8 border-b border-white/20 bg-white/40 backdrop-blur-xl flex items-center justify-between">
        <div>
          <h1 className="font-serif italic text-4xl text-[#141414]">CRM</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[#141414]/60 uppercase tracking-widest text-[10px]">Customer Relationship Management</p>
            <span className="w-1 h-1 rounded-full bg-[#141414]/20" />
            <p className="text-brand-orange font-bold uppercase tracking-widest text-[10px]">
              <span id="total-customers-count">{totalCount !== null ? totalCount.toLocaleString() : '...'}</span> Total Customers
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/40" size={18} />
            <input 
              type="text" 
              placeholder="Search by first name..." 
              className="pl-11 pr-24 py-2.5 bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all w-72"
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {localSearchQuery && (
                <button
                  onClick={() => {
                    setLocalSearchQuery('');
                    setSearchQuery('');
                  }}
                  className="p-1.5 text-[#141414]/40 hover:text-brand-orange transition-colors"
                  title="Reset"
                >
                  <X size={14} />
                </button>
              )}
              <button 
                onClick={handleSearch}
                className="p-1.5 bg-brand-orange text-white rounded-xl hover:bg-[#1A1A1A] transition-colors"
              >
                <Search size={14} />
              </button>
            </div>
          </div>
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleImportCSV}
            accept=".csv"
            className="hidden"
          />
          <button 
            onClick={handleExportCSV}
            className="bg-white/40 backdrop-blur-md border border-white/60 text-[#141414] px-6 py-2.5 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all shadow-sm"
          >
            <Download size={16} /> Export CSV
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="bg-white/40 backdrop-blur-md border border-white/60 text-[#141414] px-6 py-2.5 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all shadow-sm"
          >
            Import CSV
          </button>
          <button 
            onClick={() => {
              setIsAdding(true);
              setSelectedCustomer(null);
              setFormLocation({ lat: 12.914909448882886, lng: 100.86727314994509 }); // Default to office
            }}
            className="bg-brand-orange text-white px-6 py-2.5 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-brand-orange/20"
          >
            <Plus size={16} /> Add Customer
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Customer List */}
        <div className="w-80 border-r border-white/10 bg-white/20 backdrop-blur-md overflow-y-auto custom-scrollbar flex flex-col">
          {loading ? (
            <div className="flex-1">
              {[...Array(8)].map((_, i) => (
                <CustomerSkeleton key={i} />
              ))}
            </div>
          ) : isRecentMode && searchQuery.length < 3 ? (
            <>
              <div className="p-4 border-b border-white/5 bg-white/20">
                <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest flex items-center gap-2">
                  <History size={12} /> Recently Added
                </p>
              </div>
              <div className="flex-1">
                {customers.map(customer => (
                  <button
                    key={customer.id}
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setIsEditing(false);
                      setIsAdding(false);
                      setFormLocation(customer.location || null);
                    }}
                    className={cn(
                      "w-full p-5 text-left border-b border-white/5 transition-all hover:bg-white/40",
                      selectedCustomer?.id === customer.id ? "bg-white/60 backdrop-blur-xl shadow-sm border-l-4 border-l-brand-orange" : ""
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-white/40 flex items-center justify-center border border-white/60 shadow-sm">
                        <User size={22} className="text-brand-orange" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-[#141414] truncate">{(customer.firstName + ' ' + (customer.lastName || '')).toUpperCase()}</p>
                        <p className="text-[10px] text-[#141414]/50 uppercase tracking-widest truncate mt-0.5">{customer.email}</p>
                      </div>
                      <ChevronRight size={16} className={cn("text-[#141414]/20 transition-transform", selectedCustomer?.id === customer.id ? "rotate-90 text-brand-orange" : "")} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : filteredCustomers.length > 0 ? (
            <div className="flex-1">
              {filteredCustomers.map(customer => (
                <button
                  key={customer.id}
                  onClick={() => {
                    setSelectedCustomer(customer);
                    setIsEditing(false);
                    setIsAdding(false);
                    setFormLocation(customer.location || null);
                  }}
                  className={cn(
                    "w-full p-5 text-left border-b border-white/5 transition-all hover:bg-white/40",
                    selectedCustomer?.id === customer.id ? "bg-white/60 backdrop-blur-xl shadow-sm border-l-4 border-l-brand-orange" : ""
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/40 flex items-center justify-center border border-white/60 shadow-sm">
                      <User size={22} className="text-brand-orange" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-[#141414] truncate">{(customer.firstName + ' ' + (customer.lastName || '')).toUpperCase()}</p>
                      <p className="text-[10px] text-[#141414]/50 uppercase tracking-widest truncate mt-0.5">{customer.email}</p>
                    </div>
                    <ChevronRight size={16} className={cn("text-[#141414]/20 transition-transform", selectedCustomer?.id === customer.id ? "rotate-90 text-brand-orange" : "")} />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center flex-1 flex flex-col items-center justify-center">
              <motion.div 
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-24 h-24 rounded-full bg-white/40 border border-white/60 flex items-center justify-center mb-6 shadow-2xl"
              >
                <Search className="text-brand-orange/20" size={48} />
              </motion.div>
              <h3 className="font-serif italic text-xl text-[#141414] mb-2">No Customers Found</h3>
              <p className="text-[#141414]/40 font-bold uppercase tracking-widest text-[10px] max-w-[200px]">
                Try a different name, phone number or email address.
              </p>
            </div>
          )}
        </div>

        {/* Details View */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          <AnimatePresence mode="wait">
            {isAdding || isEditing ? (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto"
              >
                <div className="bg-white/60 backdrop-blur-xl border border-white/40 p-10 rounded-[32px] shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-orange/50 to-transparent" />
                  
                  <div className="flex justify-between items-center mb-10">
                    <div>
                      <h2 className="font-serif italic text-3xl text-[#141414]">{isAdding ? 'Add New Customer' : 'Edit Customer Profile'}</h2>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 mt-1">Complete the details below</p>
                    </div>
                    <button 
                      onClick={() => { setIsAdding(false); setIsEditing(false); }} 
                      className="p-3 bg-white/40 hover:bg-white/60 text-[#141414] rounded-2xl border border-white/60 transition-all"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <form onSubmit={handleSaveCustomer} className="space-y-8">
                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Unique ID</label>
                        <input name="uniqueId" defaultValue={selectedCustomer?.uniqueId} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" placeholder="e.g. CUST-001" />
                      </div>
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Creation Date</label>
                        <input 
                          name="creationDate" 
                          type="datetime-local" 
                          defaultValue={safeFormatForInput(selectedCustomer?.creationDate || (selectedCustomer as any)?.createdAt, isAdding)} 
                          className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" 
                        />
                      </div>
                    </div>

                    {!isAdding && selectedCustomer?.updatedAt && (
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Modified Date</label>
                        <input 
                          type="datetime-local" 
                          defaultValue={safeFormatForInput(selectedCustomer.updatedAt)} 
                          readOnly 
                          className="w-full bg-black/5 border-b-2 border-black/10 px-4 py-3 rounded-t-xl outline-none font-bold transition-all text-black/40 cursor-not-allowed" 
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">First Name *</label>
                        <input name="firstName" defaultValue={selectedCustomer?.firstName} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" required />
                      </div>
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Surname</label>
                        <input name="lastName" defaultValue={selectedCustomer?.lastName} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Email Address *</label>
                        <input name="email" type="email" defaultValue={selectedCustomer?.email} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" required />
                      </div>
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Mobile Number</label>
                        <input name="mobileNumber" defaultValue={selectedCustomer?.mobileNumber} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Date of Birth</label>
                      <input name="dob" type="date" defaultValue={selectedCustomer?.dob} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Address</label>
                        <textarea name="address" defaultValue={selectedCustomer?.address} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold min-h-[80px] resize-none transition-all" />
                      </div>
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Address / Hotel</label>
                        <textarea name="addressHotel" defaultValue={selectedCustomer?.addressHotel} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold min-h-[80px] resize-none transition-all" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Driving Licence</label>
                        <input name="drivingLicence" defaultValue={selectedCustomer?.drivingLicence} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
                      </div>
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Notes</label>
                        <input name="notes" defaultValue={selectedCustomer?.notes} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Bike Licence Expiry</label>
                        <input name="bikeLicenceExpiry" type="date" defaultValue={selectedCustomer?.bikeLicenceExpiry} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
                      </div>
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Car Licence Expiry</label>
                        <input name="carLicenceExpiry" type="date" defaultValue={selectedCustomer?.carLicenceExpiry} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
                      </div>
                    </div>

                    <div className="space-y-6 pt-6 border-t border-white/20">
                      <div className="flex items-center gap-3">
                        <MapPin size={16} className="text-brand-orange" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Home Location (Coordinates)</p>
                      </div>

                      <div className="bg-white/40 rounded-3xl overflow-hidden border border-white/60 shadow-inner">
                        <LocationPicker 
                          location={formLocation || undefined} 
                          onChange={(loc) => setFormLocation(loc)}
                          height="300px"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-2.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Latitude</label>
                          <input 
                            name="lat" 
                            type="number" 
                            step="any" 
                            value={formLocation?.lat || ''} 
                            onChange={(e) => setFormLocation(prev => ({ ...prev!, lat: parseFloat(e.target.value) || 0 }))}
                            className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" 
                          />
                        </div>
                        <div className="space-y-2.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Longitude</label>
                          <input 
                            name="lng" 
                            type="number" 
                            step="any" 
                            value={formLocation?.lng || ''} 
                            onChange={(e) => setFormLocation(prev => ({ ...prev!, lng: parseFloat(e.target.value) || 0 }))}
                            className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" 
                          />
                        </div>
                      </div>
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Location Label / Address</label>
                        <input name="locationAddress" defaultValue={selectedCustomer?.location?.address} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" placeholder="e.g. Home, Office" />
                      </div>
                    </div>

                    <button type="submit" className="w-full bg-brand-orange text-white py-4 rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-brand-orange/30 mt-4">
                      <Save size={20} /> {isAdding ? 'Create Customer' : 'Save Changes'}
                    </button>
                  </form>
                </div>
              </motion.div>
            ) : selectedCustomer ? (
              <motion.div
                key={selectedCustomer.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto space-y-10"
              >
                {/* Profile Card */}
                <div className="bg-white/60 backdrop-blur-xl border border-white/40 p-10 rounded-[40px] shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-brand-orange/5 rounded-full -mr-32 -mt-32 blur-3xl" />
                  
                  <div className="flex justify-between items-start mb-12 relative">
                    <div className="flex items-center gap-8">
                      <div className="w-24 h-24 rounded-[32px] bg-brand-orange text-white flex items-center justify-center text-4xl font-serif italic shadow-2xl shadow-brand-orange/30">
                        {selectedCustomer.firstName[0].toUpperCase()}{selectedCustomer.lastName?.[0]?.toUpperCase() || ''}
                      </div>
                      <div>
                        <h2 className="text-5xl font-bold text-[#141414] tracking-tight">{(selectedCustomer.firstName + ' ' + (selectedCustomer.lastName || '')).toUpperCase()}</h2>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="px-3 py-1 bg-brand-orange/10 text-brand-orange text-[10px] font-bold uppercase tracking-widest rounded-full">
                            {selectedCustomer.uniqueId || 'Active Customer'}
                          </span>
                          <p className="text-[#141414]/40 uppercase tracking-widest text-[10px]">
                            Since {safeFormat(selectedCustomer.creationDate || (selectedCustomer as any).createdAt, 'dd MMM yyyy', format(new Date(), 'yyyy'))}
                          </p>
                          {selectedCustomer.updatedAt && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-[#141414]/20" />
                              <p className="text-[#141414]/40 uppercase tracking-widest text-[10px]">
                                Last Modified: {safeFormat(selectedCustomer.updatedAt, 'dd MMM yyyy, HH:mm')}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => {
                          setIsEditing(true);
                          setFormLocation(selectedCustomer.location || null);
                        }}
                        className="p-4 bg-white/40 hover:bg-white/80 text-[#141414] rounded-2xl border border-white/60 shadow-sm transition-all hover:scale-110"
                      >
                        <Edit2 size={22} />
                      </button>
                      <button 
                        onClick={() => handleDeleteCustomer(selectedCustomer.id)}
                        className="p-4 bg-red-50 hover:bg-red-500 text-red-500 hover:text-white rounded-2xl border border-red-100 transition-all hover:scale-110"
                      >
                        <Trash2 size={22} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
                    <div className="space-y-8">
                      <div className="space-y-3">
                        <p className="text-[10px] font-bold text-brand-orange uppercase tracking-widest">Contact Information</p>
                        <div className="space-y-4 pt-2">
                          <div className="flex items-center gap-4 group">
                            <div className="w-10 h-10 rounded-xl bg-white/40 flex items-center justify-center border border-white/60 group-hover:bg-brand-orange/10 transition-colors">
                              <Mail size={18} className="text-brand-orange" />
                            </div>
                            <p className="font-bold text-sm text-[#141414]">{selectedCustomer.email}</p>
                          </div>
                          <div className="flex items-center gap-4 group">
                            <div className="w-10 h-10 rounded-xl bg-white/40 flex items-center justify-center border border-white/60 group-hover:bg-brand-orange/10 transition-colors">
                              <Phone size={18} className="text-brand-orange" />
                            </div>
                            <p className="font-bold text-sm text-[#141414]">{selectedCustomer.mobileNumber || 'No phone'}</p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <p className="text-[10px] font-bold text-brand-orange uppercase tracking-widest">Personal Details</p>
                        <div className="space-y-4 pt-2">
                          <div className="flex items-center gap-4 group">
                            <div className="w-10 h-10 rounded-xl bg-white/40 flex items-center justify-center border border-white/60 group-hover:bg-brand-orange/10 transition-colors">
                              <Cake size={18} className="text-brand-orange" />
                            </div>
                            <p className="font-bold text-sm text-[#141414]">{safeFormat(selectedCustomer.dob, 'dd MMM yyyy', 'No DOB')}</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <p className="text-[10px] font-bold text-brand-orange uppercase tracking-widest">Licence & Notes</p>
                        <div className="space-y-2 pt-2">
                          <p className="text-xs font-bold text-[#141414]"><span className="text-[#141414]/40 uppercase tracking-widest text-[9px] mr-2">Driving Licence:</span> {selectedCustomer.drivingLicence || 'N/A'}</p>
                          <p className="text-xs font-bold text-[#141414]"><span className="text-[#141414]/40 uppercase tracking-widest text-[9px] mr-2">Bike Expiry:</span> {selectedCustomer.bikeLicenceExpiry || 'N/A'}</p>
                          <p className="text-xs font-bold text-[#141414]"><span className="text-[#141414]/40 uppercase tracking-widest text-[9px] mr-2">Car Expiry:</span> {selectedCustomer.carLicenceExpiry || 'N/A'}</p>
                          <div className="mt-4 p-3 bg-white/40 rounded-xl border border-white/60">
                            <p className="text-[9px] font-bold text-brand-orange uppercase tracking-widest mb-1">Notes</p>
                            <p className="text-xs text-[#141414]/60 italic leading-relaxed">{selectedCustomer.notes || 'No notes'}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-2 space-y-8">
                      <div className="space-y-3">
                        <p className="text-[10px] font-bold text-brand-orange uppercase tracking-widest">Address & Hotel</p>
                        <div className="space-y-6 pt-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex items-start gap-4 group">
                              <div className="w-10 h-10 rounded-xl bg-white/40 flex items-center justify-center border border-white/60 group-hover:bg-brand-orange/10 transition-colors shrink-0">
                                <MapPin size={18} className="text-brand-orange" />
                              </div>
                              <div>
                                <p className="text-[9px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Permanent Address</p>
                                <p className="font-bold text-sm text-[#141414] leading-relaxed">{selectedCustomer.address || 'No address provided'}</p>
                              </div>
                            </div>
                            <div className="flex items-start gap-4 group">
                              <div className="w-10 h-10 rounded-xl bg-white/40 flex items-center justify-center border border-white/60 group-hover:bg-brand-orange/10 transition-colors shrink-0">
                                <MapPin size={18} className="text-brand-orange" />
                              </div>
                              <div>
                                <p className="text-[9px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Address / Hotel</p>
                                <p className="font-bold text-sm text-[#141414] leading-relaxed">{selectedCustomer.addressHotel || 'No hotel provided'}</p>
                              </div>
                            </div>
                          </div>
                          {selectedCustomer.location?.lat && selectedCustomer.location?.lng && (
                            <div className="pl-14">
                              <a 
                                href={`https://www.google.com/maps?q=${selectedCustomer.location.lat},${selectedCustomer.location.lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-3 bg-brand-orange text-white px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-lg shadow-brand-orange/20"
                              >
                                <ExternalLink size={14} /> View on Google Maps
                              </a>
                              {selectedCustomer.location.address && (
                                <p className="text-[10px] text-[#141414]/40 font-bold uppercase tracking-widest mt-3 ml-1">
                                  Label: {selectedCustomer.location.address}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rental History */}
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-white/40 backdrop-blur-md border border-white/60 flex items-center justify-center shadow-sm">
                        <History size={24} className="text-brand-orange" />
                      </div>
                      <div>
                        <h3 className="font-serif italic text-3xl text-[#141414]">Rental History</h3>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 mt-0.5">Past and current bookings</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest bg-white/60 backdrop-blur-md border border-white/60 text-brand-orange px-5 py-2 rounded-2xl shadow-sm">
                      {customerHistory.length} Bookings
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    {customerHistory.length > 0 ? (
                      customerHistory.map(booking => {
                        const car = cars.find(c => c.id === booking.carId);
                        return (
                          <div key={booking.id} className="bg-white/40 backdrop-blur-md border border-white/60 p-8 rounded-[32px] hover:bg-white/60 transition-all group shadow-sm hover:shadow-xl">
                            <div className="flex flex-col md:flex-row justify-between gap-8">
                              <div className="flex gap-6">
                                <div className="w-24 h-24 bg-white/60 border border-white/80 rounded-3xl overflow-hidden shrink-0 shadow-inner p-2">
                                  {car?.imageUrl ? (
                                    <img src={car.imageUrl} alt={car.name} className="w-full h-full object-cover rounded-2xl" referrerPolicy="no-referrer" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[#141414]/10"><User size={32} /></div>
                                  )}
                                </div>
                                <div>
                                  <div className="flex items-center gap-3">
                                    <h4 className="font-bold text-xl text-[#141414]">{car?.name || 'Unknown Vehicle'}</h4>
                                    <span className="px-2 py-0.5 bg-white/60 border border-white/80 text-[10px] font-bold uppercase tracking-widest rounded-lg text-[#141414]/60">
                                      {car?.plateNumber}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-6 mt-4">
                                    <div className="flex items-center gap-2.5 text-xs font-bold text-[#141414]/60 bg-white/40 px-3 py-1.5 rounded-xl border border-white/60">
                                      <History size={14} className="text-brand-orange" />
                                      {safeFormat(booking.startDate, 'dd MMM')} - {safeFormat(booking.endDate, 'dd MMM yyyy')}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col items-end justify-between py-1">
                                <span className={cn(
                                  "text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-xl border",
                                  booking.status === 'Paid' 
                                    ? "bg-green-50 text-green-600 border-green-100" 
                                    : "bg-orange-50 text-brand-orange border-orange-100"
                                )}>
                                  {booking.status}
                                </span>
                                <p className="font-serif italic text-3xl text-[#141414]">฿{(booking.amount || 0).toLocaleString()}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-20 bg-white/20 backdrop-blur-md border-2 border-dashed border-white/40 rounded-[40px]">
                        <div className="w-20 h-20 rounded-full bg-white/40 border border-white/60 flex items-center justify-center mx-auto mb-6">
                          <History className="text-[#141414]/10" size={40} />
                        </div>
                        <p className="text-[#141414]/40 font-bold uppercase tracking-widest text-xs">No rental history found for this email</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-32 h-32 rounded-[40px] bg-white/40 backdrop-blur-xl border border-white/60 flex items-center justify-center mb-8 shadow-2xl relative group">
                  <div className="absolute inset-0 bg-brand-orange/5 rounded-[40px] blur-xl group-hover:bg-brand-orange/10 transition-colors" />
                  <Users size={56} className="text-brand-orange/20 relative" />
                </div>
                <h2 className="font-serif italic text-4xl text-[#141414] mb-3">Select a Customer</h2>
                <p className="text-[#141414]/40 uppercase tracking-widest text-[10px] max-w-xs leading-relaxed">Search and manage customer profiles, contact details, and rental history in one place.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
