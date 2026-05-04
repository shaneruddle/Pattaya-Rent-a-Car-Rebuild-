import React, { useState, useMemo } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, addDoc, serverTimestamp, getDocs, where, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, logSystemActivity } from '../firebase';
import { processTemplate } from '../lib/emailUtils';
import { Booking, Car } from '../types';
import { format, parseISO, isValid, formatDistanceToNow, isToday } from 'date-fns';
import { 
  Search, 
  Filter, 
  MoreVertical, 
  Calendar, 
  User, 
  Phone, 
  Mail, 
  Car as CarIcon, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Edit2, 
  Trash2,
  MapPin,
  Truck,
  ArrowRight,
  Loader2,
  DollarSign,
  ShieldCheck,
  Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { LocationPicker } from './LocationPicker';

interface LiveEnquiriesProps {
  bookings: Booking[];
  cars: Car[];
  onRefresh?: () => void;
}

export const LiveEnquiries: React.FC<LiveEnquiriesProps> = ({ bookings = [], cars = [], onRefresh }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEnquiry, setSelectedEnquiry] = useState<Booking | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Partial<Booking>>({});

  const enquiries = useMemo(() => {
    return bookings
      .filter(b => !b.carId || b.carId === '')
      .filter(b => {
        const searchLower = (searchQuery || '').toLowerCase();
        const matchesSearch = 
          (b.customerName?.toLowerCase() || '').includes(searchLower) ||
          (b.email?.toLowerCase() || '').includes(searchLower) ||
          (b.mobileNumber && b.mobileNumber.includes(searchQuery));
        return matchesSearch;
      })
      .sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        
        if (dateA && dateB) return dateB - dateA;
        // Fallback to startDate if createdAt is missing for some reason
        return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
      });
  }, [bookings, searchQuery]);

  const formatEnquiryTime = (createdAt: any) => {
    if (!createdAt) return null;
    
    let date: Date;
    try {
      if (createdAt?.toDate) {
        date = createdAt.toDate();
      } else if (typeof createdAt === 'string') {
        date = parseISO(createdAt);
      } else {
        date = new Date(createdAt);
      }
    } catch (e) {
      return null;
    }

    if (!isValid(date)) return null;

    if (isToday(date)) {
      return `Received Today, ${format(date, 'HH:mm')} (${formatDistanceToNow(date, { addSuffix: true })})`;
    }
    return `Received: ${format(date, 'MMM d, HH:mm')}`;
  };

  const handleEdit = (enquiry: Booking) => {
    setSelectedEnquiry(enquiry);
    setFormData(enquiry);
    setIsEditing(true);
  };

  const handleConvert = (enquiry: Booking) => {
    setSelectedEnquiry(enquiry);
    setFormData({ ...enquiry, carId: '' });
    setIsConverting(true);
  };

  const saveEnquiry = async () => {
    if (!selectedEnquiry || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const docRef = doc(db, 'bookings', selectedEnquiry.id);
      await updateDoc(docRef, {
        ...formData,
        updatedAt: serverTimestamp()
      });
      toast.success('Enquiry updated successfully');
      setIsEditing(false);
      setSelectedEnquiry(null);
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Failed to update enquiry');
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmBooking = async () => {
    if (!selectedEnquiry || !formData.carId || isSubmitting) {
      if (!formData.carId && !isSubmitting) toast.error('Please select a car to confirm the booking');
      return;
    }
    setIsSubmitting(true);
    try {
      const docRef = doc(db, 'bookings', selectedEnquiry.id);
      await updateDoc(docRef, {
        ...formData,
        status: 'Pending', // Or 'Confirmed' if we add that status
        updatedAt: serverTimestamp()
      });
      
      // Log system activity
      await logSystemActivity(
        'Booking Confirmed',
        `Enquiry for ${selectedEnquiry.customerName} converted to booking`,
        'Bookings',
        { bookingId: selectedEnquiry.id, carId: formData.carId }
      );

      // Handle CRM update/creation
      if (selectedEnquiry.email) {
        const customersRef = collection(db, 'customers');
        const q = query(customersRef, where('email', '==', selectedEnquiry.email));
        const snapshot = await getDocs(q);
        
        const customerData: any = {
          firstName: selectedEnquiry.customerName.split(' ')[0] || 'Customer',
          lastName: selectedEnquiry.customerName.split(' ').slice(1).join(' ') || '',
          email: selectedEnquiry.email,
          mobileNumber: selectedEnquiry.mobileNumber || '',
          updatedAt: serverTimestamp()
        };

        // If enquiry has a delivery location, save it to the customer profile
        if (formData.deliveryLocation) {
          customerData.location = {
            lat: formData.deliveryLocation.lat,
            lng: formData.deliveryLocation.lng,
            address: formData.deliveryAddress || 'Delivery Location'
          };
        }

        if (snapshot.empty) {
          // Create new customer
          await addDoc(customersRef, {
            ...customerData,
            createdAt: serverTimestamp()
          });
          toast.success('New customer created in CRM');
        } else {
          // Update existing customer
          const customerId = snapshot.docs[0].id;
          const existingData = snapshot.docs[0].data();
          
          // Only update location if it's not already set or if we have a new one
          const updatePayload: any = { ...customerData };
          if (!formData.deliveryLocation && existingData.location) {
            delete updatePayload.location;
          }

          await updateDoc(doc(db, 'customers', customerId), updatePayload);
          toast.success('Customer profile updated in CRM');
        }
      }

      toast.success('Enquiry converted to booking successfully');
      setIsConverting(false);
      setSelectedEnquiry(null);
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Failed to confirm booking');
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteEnquiry = async (id: string) => {
    toast('Delete this enquiry?', {
      description: "This action cannot be undone.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteDoc(doc(db, 'bookings', id));
            toast.success('Enquiry deleted');
            if (onRefresh) onRefresh();
          } catch (error) {
            toast.error('Failed to delete enquiry');
            handleFirestoreError(error, OperationType.DELETE, 'bookings');
          }
        }
      }
    });
  };

  const copyEmailTemplate = async (enquiry: Booking) => {
    try {
      // 1. Fetch the template
      const templateDoc = await getDoc(doc(db, 'email_templates', 'enquiry_reply'));
      
      let bodyTemplate = `Hi {{customer_name}},

Thanks for your email. We can confirm availability of the {{vehicle_model}} (or similar) at a total rate of {{total_price}}

Included in your rental:

- First Class Rental Insurance
- Unlimited kms
- 24 hour breakdown cover for your piece of mind
- Additional drivers
- All taxes

In addition you can book now, pay later and cancel at anytime free of charge

Do you wish to proceed with the booking ?`;

      if (templateDoc.exists()) {
        bodyTemplate = templateDoc.data().body;
      }

      // 2. Process template
      const placeholders = {
        '{{customer_name}}': enquiry.customerName.split(' ')[0] || 'Customer',
        '{{vehicle_model}}': enquiry.requestedCarType || 'requested car',
        '{{total_price}}': (enquiry.amount || 0).toLocaleString(),
        '{{return_date}}': `${format(parseISO(enquiry.startDate), 'dd MMM yyyy')} to ${format(parseISO(enquiry.endDate), 'dd MMM yyyy')}`
      };

      const finalBody = processTemplate(bodyTemplate, placeholders);

      // 3. Copy to clipboard
      await navigator.clipboard.writeText(finalBody);
      toast.success('Email template copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy: ', err);
      toast.error('Failed to copy template');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-warm-bg overflow-hidden">
      {/* Header */}
      <header className="h-24 bg-white/40 backdrop-blur-xl border-b border-white/60 flex items-center justify-between px-12 shrink-0 z-10">
        <div>
          <h1 className="font-serif italic text-3xl text-[#1A1A1A]">Live Enquiries</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-1">
            {enquiries.length} Pending Enquiries from Booking Engine
          </p>
        </div>

        <div className="flex items-center gap-6">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30 group-focus-within:text-brand-orange transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search enquiries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-80 bg-white/40 border border-white/60 rounded-2xl py-3 pl-12 pr-6 text-sm focus:outline-none focus:bg-white/60 focus:border-brand-orange transition-all font-medium"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <AnimatePresence mode="popLayout">
            {enquiries.map((enquiry) => (
              <motion.div
                key={enquiry.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-8 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden"
              >
                {/* Status Badge */}
                  <div className="absolute top-8 right-8 flex flex-col items-end gap-2">
                    <span className="px-3 py-1 bg-brand-orange/10 text-brand-orange text-[8px] font-bold uppercase tracking-widest rounded-full">
                      Pending Enquiry
                    </span>
                    {enquiry.createdAt && (
                      <span className="text-[9px] font-bold text-black/40 uppercase tracking-widest">
                        {formatEnquiryTime(enquiry.createdAt)}
                      </span>
                    )}
                    <div className="relative group/menu">
                    <button className="p-2 hover:bg-black/5 rounded-full transition-colors">
                      <MoreVertical size={16} className="text-black/40" />
                    </button>
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white/90 backdrop-blur-xl border border-white/60 rounded-2xl shadow-xl opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all z-20 overflow-hidden">
                      <button 
                        onClick={() => handleEdit(enquiry)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-black/60 hover:bg-black/5 hover:text-brand-orange transition-all"
                      >
                        <Edit2 size={14} /> Edit Enquiry
                      </button>
                      <button 
                        onClick={() => deleteEnquiry(enquiry.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col h-full">
                  <div className="flex items-start gap-6 mb-8">
                    <div className="w-16 h-16 bg-brand-orange/10 rounded-2xl flex items-center justify-center text-brand-orange shrink-0">
                      <User size={32} />
                    </div>
                    <div>
                      <h3 className="text-xl font-serif italic text-black mb-1">{enquiry.customerName}</h3>
                      <div className="flex flex-wrap gap-4">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/40">
                          <Phone size={12} /> {enquiry.mobileNumber || 'No mobile'}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/40">
                          <Mail size={12} /> {enquiry.email || 'No email'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8 mb-8">
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                          <Calendar size={16} />
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Pick Up</p>
                          <p className="text-xs font-bold text-black">{format(parseISO(enquiry.startDate), 'dd MMM yyyy, HH:mm')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                          <Clock size={16} />
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Drop Off</p>
                          <p className="text-xs font-bold text-black">{format(parseISO(enquiry.endDate), 'dd MMM yyyy, HH:mm')}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                          <CarIcon size={16} />
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Requested Car</p>
                          <p className="text-xs font-bold text-black">{enquiry.requestedCarType || 'Not specified'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                          <DollarSign size={16} />
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Estimated Total</p>
                          <p className="text-xs font-bold text-brand-orange">฿{(enquiry.amount || 0).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {enquiry.deliveryAddress && (
                    <div className="mb-8 p-4 bg-brand-orange/5 rounded-2xl border border-brand-orange/10">
                      <div className="flex items-center gap-2 mb-2">
                        <Truck size={14} className="text-brand-orange" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-orange">Delivery Requested</span>
                      </div>
                      <p className="text-xs text-black/60 leading-relaxed">{enquiry.deliveryAddress}</p>
                    </div>
                  )}

                  {enquiry.notes && (
                    <div className="mb-8 p-4 bg-black/5 rounded-2xl border border-black/5">
                      <p className="text-[8px] font-bold uppercase tracking-widest text-black/30 mb-1">Customer Comments</p>
                      <p className="text-xs text-black/60 leading-relaxed italic">"{enquiry.notes}"</p>
                    </div>
                  )}

                  <div className="mt-auto pt-6 border-t border-black/5 flex gap-4">
                    <button
                      onClick={() => copyEmailTemplate(enquiry)}
                      className="flex-1 bg-white border border-black/10 text-black/60 py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-black/5 transition-all"
                    >
                      <Copy size={14} /> Copy Email Reply
                    </button>
                    <button
                      onClick={() => handleConvert(enquiry)}
                      className="flex-1 bg-brand-orange text-white py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20"
                    >
                      Confirm & Assign Car <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {enquiries.length === 0 && (
            <div className="col-span-full py-20 text-center">
              <div className="w-20 h-20 bg-black/5 rounded-full flex items-center justify-center text-black/20 mx-auto mb-6">
                <Mail size={40} />
              </div>
              <h3 className="text-xl font-serif italic text-black/40">No pending enquiries</h3>
              <p className="text-xs font-bold uppercase tracking-widest text-black/20 mt-2">New enquiries from the booking engine will appear here</p>
            </div>
          )}
        </div>
      </div>

      {/* Edit/Convert Modal */}
      <AnimatePresence>
        {(isEditing || isConverting) && selectedEnquiry && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsEditing(false);
                setIsConverting(false);
                setSelectedEnquiry(null);
              }}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white/80 backdrop-blur-2xl rounded-[40px] shadow-2xl border border-white/60 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-12 overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h2 className="font-serif italic text-4xl text-black">
                      {isConverting ? 'Confirm Booking' : 'Edit Enquiry'}
                    </h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mt-2">
                      {selectedEnquiry.customerName}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setIsConverting(false);
                      setSelectedEnquiry(null);
                    }}
                    className="w-12 h-12 bg-black/5 rounded-full flex items-center justify-center text-black/40 hover:bg-black/10 hover:text-black transition-all"
                  >
                    <XCircle size={24} />
                  </button>
                </div>

                <div className="space-y-8">
                  {/* Customer Info */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Customer Name</label>
                      <input
                        type="text"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.customerName}
                        onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Mobile Number</label>
                      <input
                        type="text"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.mobileNumber}
                        onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Pick Up</label>
                      <input
                        type="datetime-local"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.startDate?.slice(0, 16)}
                        onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Drop Off</label>
                      <input
                        type="datetime-local"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.endDate?.slice(0, 16)}
                        onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Financials */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Total Amount (THB)</label>
                      <input
                        type="number"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.amount || 0}
                        onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Deposit Held (THB)</label>
                      <input
                        type="number"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.deposit || 0}
                        onChange={e => setFormData({ ...formData, deposit: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  {isConverting && (
                    <div className="space-y-4 p-8 bg-brand-orange/5 rounded-[32px] border border-brand-orange/20">
                      <div className="flex items-center gap-3 mb-2">
                        <CarIcon className="text-brand-orange" size={20} />
                        <h3 className="text-sm font-bold uppercase tracking-widest text-brand-orange">Assign Vehicle</h3>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        <select
                          className="w-full bg-white border-none p-4 rounded-2xl text-sm focus:ring-2 focus:ring-brand-orange outline-none transition-all font-bold"
                          value={formData.carId}
                          onChange={e => setFormData({ ...formData, carId: e.target.value })}
                        >
                          <option value="">Select a car...</option>
                          {cars.map(car => (
                            <option key={car.id} value={car.id}>
                              {car.name} ({car.plateNumber}) - {car.type}
                            </option>
                          ))}
                        </select>
                        <p className="text-[10px] text-brand-orange/60 font-bold uppercase tracking-widest ml-4 italic">
                          Requested: {selectedEnquiry.requestedCarType}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Delivery Info */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <Truck className="text-black/40" size={20} />
                      <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Delivery Details</h3>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Delivery Address</label>
                        <input
                          type="text"
                          className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                          value={formData.deliveryAddress || ''}
                          onChange={e => setFormData({ ...formData, deliveryAddress: e.target.value })}
                          placeholder="Enter delivery address..."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Delivery Notes</label>
                        <textarea
                          className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all h-24 resize-none font-bold"
                          value={formData.deliveryNotes || ''}
                          onChange={e => setFormData({ ...formData, deliveryNotes: e.target.value })}
                          placeholder="Internal delivery notes..."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Pin Location</label>
                        <LocationPicker 
                          location={formData.deliveryLocation} 
                          onChange={(loc) => setFormData({ ...formData, deliveryLocation: loc })}
                          height="300px"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Comments */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Customer Comments</label>
                    <textarea
                      className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all h-32 resize-none font-bold"
                      value={formData.notes || ''}
                      onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="mt-12 flex gap-4">
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setIsConverting(false);
                      setSelectedEnquiry(null);
                    }}
                    className="flex-1 h-16 bg-black/5 text-black font-bold uppercase tracking-widest text-[10px] rounded-2xl hover:bg-black/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={isConverting ? confirmBooking : saveEnquiry}
                    disabled={isSubmitting}
                    className="flex-1 h-16 bg-brand-orange text-white font-bold uppercase tracking-widest text-[10px] rounded-2xl hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      isConverting ? 'Confirm Booking' : 'Save Changes'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
