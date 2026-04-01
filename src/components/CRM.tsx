import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth, logSystemActivity } from '../firebase';
import { Customer, Booking, Car } from '../types';
import { format, parseISO } from 'date-fns';
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
  User
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

export const CRM: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerHistory, setCustomerHistory] = useState<Booking[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'customers'), orderBy('firstName', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const customerData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      setCustomers(customerData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'customers');
    });

    const carsUnsubscribe = onSnapshot(collection(db, 'cars'), (snapshot) => {
      setCars(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Car)));
    });

    return () => {
      unsubscribe();
      carsUnsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerHistory([]);
      return;
    }

    const q = query(
      collection(db, 'bookings'),
      where('email', '==', selectedCustomer.email)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking));
      // Sort client-side because we might not have a composite index for email + date yet
      setCustomerHistory(history.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()));
    }, (error) => {
      console.error("Error fetching customer history:", error);
    });

    return () => unsubscribe();
  }, [selectedCustomer]);

  const handleSaveCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const customerData = {
      firstName: formData.get('firstName') as string,
      lastName: formData.get('lastName') as string,
      email: formData.get('email') as string,
      mobileNumber: formData.get('mobileNumber') as string,
      address: formData.get('address') as string,
      dob: formData.get('dob') as string,
      location: {
        lat: parseFloat(formData.get('lat') as string) || 0,
        lng: parseFloat(formData.get('lng') as string) || 0,
        address: formData.get('locationAddress') as string
      }
    };

    try {
      if (isAdding) {
        // Check if email already exists
        const existing = customers.find(c => c.email.toLowerCase() === customerData.email.toLowerCase());
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

  const filteredCustomers = customers.filter(c => 
    c.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.lastName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <p className="text-[#141414]/60 uppercase tracking-widest text-[10px] mt-1">Customer Relationship Management</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/40" size={18} />
            <input 
              type="text" 
              placeholder="Search customers..." 
              className="pl-11 pr-6 py-2.5 bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all w-72"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              setIsAdding(true);
              setSelectedCustomer(null);
            }}
            className="bg-brand-orange text-white px-6 py-2.5 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-brand-orange/20"
          >
            <Plus size={16} /> Add Customer
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Customer List */}
        <div className="w-80 border-r border-white/10 bg-white/20 backdrop-blur-md overflow-y-auto custom-scrollbar">
          {filteredCustomers.length > 0 ? (
            filteredCustomers.map(customer => (
              <button
                key={customer.id}
                onClick={() => {
                  setSelectedCustomer(customer);
                  setIsEditing(false);
                  setIsAdding(false);
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
                    <p className="font-bold text-sm text-[#141414] truncate">{customer.firstName} {customer.lastName}</p>
                    <p className="text-[10px] text-[#141414]/50 uppercase tracking-widest truncate mt-0.5">{customer.email}</p>
                  </div>
                  <ChevronRight size={16} className={cn("text-[#141414]/20 transition-transform", selectedCustomer?.id === customer.id ? "rotate-90 text-brand-orange" : "")} />
                </div>
              </button>
            ))
          ) : (
            <div className="p-12 text-center">
              <div className="w-16 h-16 rounded-3xl bg-white/40 border border-white/60 flex items-center justify-center mx-auto mb-4">
                <Users className="text-[#141414]/20" size={32} />
              </div>
              <p className="text-[#141414]/40 font-bold uppercase tracking-widest text-[10px]">No customers found</p>
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
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">First Name *</label>
                        <input name="firstName" defaultValue={selectedCustomer?.firstName} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" required />
                      </div>
                      <div className="space-y-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Last Name</label>
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

                    <div className="space-y-2.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Address</label>
                      <textarea name="address" defaultValue={selectedCustomer?.address} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold min-h-[100px] resize-none transition-all" />
                    </div>

                    <div className="space-y-6 pt-6 border-t border-white/20">
                      <div className="flex items-center gap-3">
                        <MapPin size={16} className="text-brand-orange" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Home Location (Coordinates)</p>
                      </div>
                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-2.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Latitude</label>
                          <input name="lat" type="number" step="any" defaultValue={selectedCustomer?.location?.lat} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
                        </div>
                        <div className="space-y-2.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 ml-1">Longitude</label>
                          <input name="lng" type="number" step="any" defaultValue={selectedCustomer?.location?.lng} className="w-full bg-white/40 border-b-2 border-white/60 px-4 py-3 rounded-t-xl focus:border-brand-orange focus:bg-white/60 outline-none font-bold transition-all" />
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
                        {selectedCustomer.firstName[0]}{selectedCustomer.lastName?.[0] || ''}
                      </div>
                      <div>
                        <h2 className="text-5xl font-bold text-[#141414] tracking-tight">{selectedCustomer.firstName} {selectedCustomer.lastName}</h2>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="px-3 py-1 bg-brand-orange/10 text-brand-orange text-[10px] font-bold uppercase tracking-widest rounded-full">Active Customer</span>
                          <p className="text-[#141414]/40 uppercase tracking-widest text-[10px]">Since {format(parseISO(new Date().toISOString()), 'yyyy')}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setIsEditing(true)}
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
                            <p className="font-bold text-sm text-[#141414]">{selectedCustomer.dob ? format(parseISO(selectedCustomer.dob), 'dd MMM yyyy') : 'No DOB'}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-2 space-y-8">
                      <div className="space-y-3">
                        <p className="text-[10px] font-bold text-brand-orange uppercase tracking-widest">Address & Location</p>
                        <div className="space-y-6 pt-2">
                          <div className="flex items-start gap-4 group">
                            <div className="w-10 h-10 rounded-xl bg-white/40 flex items-center justify-center border border-white/60 group-hover:bg-brand-orange/10 transition-colors shrink-0">
                              <MapPin size={18} className="text-brand-orange" />
                            </div>
                            <p className="font-bold text-sm text-[#141414] leading-relaxed pt-2">{selectedCustomer.address || 'No address provided'}</p>
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
                                      {format(parseISO(booking.startDate), 'dd MMM')} - {format(parseISO(booking.endDate), 'dd MMM yyyy')}
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
