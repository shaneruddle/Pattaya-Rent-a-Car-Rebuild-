import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  UserPlus, 
  Car as CarIcon, 
  Bike, 
  Camera, 
  X, 
  Check, 
  ChevronRight, 
  ChevronLeft, 
  Upload,
  AlertCircle,
  Loader2,
  Mail,
  Smartphone,
  Calendar,
  DollarSign,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth, storage, handleFirestoreError, OperationType, logSystemActivity } from '../firebase';
import { sendTemplatedEmail } from '../lib/emailUtils';
import { collection, addDoc, updateDoc, doc, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Car, Booking, Customer, Rental } from '../types';
import { format, parseISO, startOfDay, addDays } from 'date-fns';
import { cn } from '../lib/utils';
import { LocationPicker } from './LocationPicker';
import { DatePickerCustom } from './ui/DatePickerCustom';
import { ImportantInfoModal } from './ImportantInfoModal';
import { toast } from 'sonner';

interface NewRentalProps {
  cars: Car[];
  bookings: Booking[];
  onComplete: () => void;
}

type Step = 'selection' | 'vehicle_type' | 'details' | 'photos' | 'confirmation';

export const NewRental: React.FC<NewRentalProps> = ({ cars = [], bookings = [], onComplete }) => {
  const [step, setStep] = useState<Step>('selection');
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  // Selection State
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [pickUpTime, setPickUpTime] = useState('09:30');
  const [dropOffTime, setDropOffTime] = useState('09:30');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: new Date(),
    to: addDays(new Date(), 1)
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showImportantInfo, setShowImportantInfo] = useState(false);
  
  // Form State
  const [vehicleType, setVehicleType] = useState<'Car' | 'Motorbike' | null>(null);
  const [formData, setFormData] = useState({
    carId: '',
    dateOut: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    dateIn: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), "yyyy-MM-dd'T'HH:mm"),
    totalCharge: 0,
    depositAmount: 3000,
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    returnNote: '',
    totalPaid: 0,
  });

  // Photos State
  const [photos, setPhotos] = useState<string[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Stop camera on unmount or when step changes away from photos
  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (step !== 'photos') {
      stopCamera();
    }
  }, [step]);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    if (!auth.currentUser) return;
    try {
      const q = query(collection(db, 'customers'), limit(20));
      const snapshot = await getDocs(q);
      const customerData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      setCustomers(customerData);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const handleBookingSelect = (booking: Booking) => {
    setSelectedBooking(booking);
    setVehicleType(booking.requestedCarType === 'Motorbike' ? 'Motorbike' : 'Car');
    
    const start = parseISO(booking.startDate);
    const end = parseISO(booking.endDate);
    setPickUpTime(format(start, 'HH:mm'));
    setDropOffTime(format(end, 'HH:mm'));
    setDateRange({ from: start, to: end });

    setFormData({
      ...formData,
      carId: booking.carId || '',
      dateOut: booking.startDate,
      dateIn: booking.endDate,
      totalCharge: booking.amount || 0,
      totalPaid: booking.amount || 0,
      depositAmount: booking.deposit || 3000,
      customerName: booking.customerName,
      customerEmail: booking.email || '',
      customerPhone: booking.mobileNumber || '',
      returnNote: booking.returnNote || '',
    });
    setStep('vehicle_type');
  };

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData({
      ...formData,
      customerName: `${customer.firstName} ${customer.lastName || ''}`.trim(),
      customerEmail: customer.email,
      customerPhone: customer.mobileNumber || '',
    });
    setStep('vehicle_type');
  };

  const requestCameraPermissions = async () => {
    setIsCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' },
        audio: false 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      toast.error("Could not access camera");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current && photos.length < 10) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPhotos([...photos, dataUrl]);
        toast.success(`Photo ${photos.length + 1} captured`);
      }
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      // Helper function to compress image before upload
      const compressImage = async (dataUrl: string): Promise<Blob> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // Max dimension 1024px
            const MAX_DIM = 1024;
            if (width > height) {
              if (width > MAX_DIM) {
                height *= MAX_DIM / width;
                width = MAX_DIM;
              }
            } else {
              if (height > MAX_DIM) {
                width *= MAX_DIM / height;
                height = MAX_DIM;
              }
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Canvas toBlob failed'));
            }, 'image/jpeg', 0.6); // 0.6 quality to reduce size
          };
          img.onerror = reject;
          img.src = dataUrl;
        });
      };

      // 1. Upload photos to Firebase Storage in parallel with fallback
      const photoUploadPromises = photos.map(async (photo, i) => {
        try {
          if (!storage) throw new Error('Firebase Storage not initialized');
          
          const compressedBlob = await compressImage(photo);
          const photoRef = ref(storage, `rentals/${Date.now()}_${i}.jpg`);
          
          // Try uploading with a timeout logic
          const uploadPromise = uploadBytes(photoRef, compressedBlob);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Upload timeout after 30 seconds')), 30000)
          );
          
          await Promise.race([uploadPromise, timeoutPromise]);
          return await getDownloadURL(photoRef);
        } catch (error) {
          console.error(`Failed to upload photo ${i}, using base64 fallback:`, error);
          toast.warning(`Photo ${i+1} upload failed, using fallback storage.`);
          // If storage fails, fallback to the original data URL (base64)
          return photo; 
        }
      });
      const photoUrls = await Promise.all(photoUploadPromises);

      // 2. Create or Update Customer if needed
      let customerId = selectedCustomer?.id;
      if (!customerId) {
        const customerRef = await addDoc(collection(db, 'customers'), {
          firstName: formData.customerName.split(' ')[0],
          lastName: formData.customerName.split(' ').slice(1).join(' '),
          email: formData.customerEmail,
          mobileNumber: formData.customerPhone,
          createdAt: new Date().toISOString()
        });
        customerId = customerRef.id;
      }

      // 3. Create Rental Record
      const rentalData: Omit<Rental, 'id'> = {
        bookingId: selectedBooking?.id,
        customerId,
        carId: formData.carId,
        dateOut: formData.dateOut,
        dateIn: formData.dateIn,
        totalCharge: formData.totalCharge,
        depositAmount: formData.depositAmount,
        damagePhotos: photoUrls.filter(url => !url.startsWith('data:')), // Store only storage URLs in the main doc
        status: 'Active',
        paymentStatus: formData.totalPaid < formData.totalCharge ? 'pending' : 'paid',
        createdAt: new Date().toISOString(),
        processedBy: auth.currentUser?.email || 'Unknown'
      };

      const rentalRef = await addDoc(collection(db, 'rentals'), rentalData);

      // 3.1 Update optional returnNote in booking if it came from booking
      if (selectedBooking && formData.returnNote) {
        await updateDoc(doc(db, 'bookings', selectedBooking.id), {
          returnNote: formData.returnNote
        });
      }

      // 3a. Store base64 photos in a separate collection to avoid 1MB limit
      const base64Photos = photoUrls.filter(url => url.startsWith('data:'));
      if (base64Photos.length > 0) {
        const photoUploadPromises = base64Photos.map(async (base64, i) => {
          await addDoc(collection(db, 'rental_photos'), {
            rentalId: rentalRef.id,
            photo: base64,
            index: i,
            createdAt: new Date().toISOString()
          });
        });
        await Promise.all(photoUploadPromises);
      }

      // 4. Update Booking Status if exists
      if (selectedBooking) {
        await updateDoc(doc(db, 'bookings', selectedBooking.id), {
          status: 'Paid',
          paymentStatus: formData.totalPaid < formData.totalCharge ? 'pending' : 'paid'
        });
      }

      // 5. Log Activity
      await logSystemActivity(
        'Rental Processed',
        `New rental processed for ${formData.customerName} (Vehicle ID: ${formData.carId})`,
        'Bookings',
        { rentalId: rentalRef.id, customerId }
      );

      // 6. Send Templated Confirmation Email
      const carName = cars.find(c => c.id === formData.carId)?.name || 'Vehicle';
      const plateNumber = cars.find(c => c.id === formData.carId)?.plateNumber || '';
      
      const photoGridHtml = photoUrls.length > 0 ? `
        <div style="margin-top: 20px;">
          <h3 style="font-size: 14px; text-transform: uppercase; color: #666;">Damage Inspection Photos</h3>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 10px;">
            ${photoUrls.map(url => `
              <div style="margin-bottom: 5px;">
                <img src="${url}" style="width: 100%; border-radius: 8px; border: 1px solid #eee;" alt="Car Photo" />
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';

      try {
        // 1. Send to Customer using template
        await sendTemplatedEmail('rental_confirmation', formData.customerEmail, {
          '{{customer_name}}': formData.customerName,
          '{{vehicle_model}}': carName,
          '{{plate_number}}': plateNumber,
          '{{return_date}}': format(new Date(formData.dateIn), 'dd MMM yyyy HH:mm'),
          '{{total_price}}': formData.totalCharge.toLocaleString(),
          '{{photos}}': photoGridHtml
        });

        // 2. Send to Staff (Simple notification)
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: 'info@pattayarentacar.com',
            replyTo: formData.customerEmail,
            subject: `[STAFF] New Rental Processed: ${formData.customerName}`,
            html: `
              <h3>New Rental Processed</h3>
              <p><strong>Customer:</strong> ${formData.customerName}</p>
              <p><strong>Vehicle:</strong> ${carName} (${plateNumber})</p>
              <p><strong>Processed By:</strong> ${auth.currentUser?.email}</p>
              <p><a href="${window.location.origin}/bookings">View in Dashboard</a></p>
            `,
          }),
        });

        console.log('NewRental: Emails handled successfully');
      } catch (emailErr) {
        console.error('NewRental: Error handling emails:', emailErr);
      }

      // 7. Success log
      toast.success('Rental processed and confirmation email sent!');
      
      onComplete();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'rentals');
      toast.error('Failed to process rental');
    } finally {
      setLoading(false);
    }
  };

  const filteredBookings = bookings.filter(b => 
    b.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.email?.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 5);

  const filteredCustomers = customers.filter(c => 
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 5);

  return (
    <div className="min-h-screen bg-gray-50 pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-30">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <h2 className="text-lg font-bold text-[#1A1A1A]">New Rental</h2>
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", step === 'selection' ? "bg-brand-orange" : "bg-gray-200")} />
            <div className={cn("w-2 h-2 rounded-full", step === 'vehicle_type' ? "bg-brand-orange" : "bg-gray-200")} />
            <div className={cn("w-2 h-2 rounded-full", step === 'details' ? "bg-brand-orange" : "bg-gray-200")} />
            <div className={cn("w-2 h-2 rounded-full", step === 'photos' ? "bg-brand-orange" : "bg-gray-200")} />
            <div className={cn("w-2 h-2 rounded-full", step === 'confirmation' ? "bg-brand-orange" : "bg-gray-200")} />
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto p-4">
        <AnimatePresence mode="wait">
          {/* Step 1: Selection */}
          {step === 'selection' && (
            <motion.div
              key="selection"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4">Find Booking or Customer</h3>
                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    placeholder="Search by name, email..."
                    className="w-full h-12 pl-12 pr-4 bg-gray-50 border border-gray-200 rounded-2xl focus:border-brand-orange outline-none transition-all"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {searchQuery.length > 0 && (
                  <div className="space-y-6">
                    {filteredBookings.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-2">Existing Bookings</h4>
                        <div className="space-y-2">
                          {filteredBookings.map(booking => (
                            <button
                              key={booking.id}
                              onClick={() => handleBookingSelect(booking)}
                              className="w-full p-4 bg-gray-50 hover:bg-brand-orange/5 border border-gray-100 rounded-2xl text-left transition-all flex items-center justify-between group"
                            >
                              <div>
                                <p className="font-bold text-sm">{booking.customerName}</p>
                                <p className="text-xs text-gray-500">{format(new Date(booking.startDate), 'MMM d')} - {format(new Date(booking.endDate), 'MMM d')}</p>
                              </div>
                              <ChevronRight size={18} className="text-gray-300 group-hover:text-brand-orange" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {filteredCustomers.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2">CRM Customers</h4>
                        <div className="space-y-2">
                          {filteredCustomers.map(customer => (
                            <button
                              key={customer.id}
                              onClick={() => handleCustomerSelect(customer)}
                              className="w-full p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 rounded-2xl text-left transition-all flex items-center justify-between group"
                            >
                              <div>
                                <p className="font-bold text-sm">{customer.firstName} {customer.lastName}</p>
                                <p className="text-xs text-gray-500">{customer.email}</p>
                              </div>
                              <ChevronRight size={18} className="text-gray-300 group-hover:text-blue-500" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-8 pt-8 border-t border-gray-100">
                  <button
                    onClick={() => {
                      setIsNewCustomer(true);
                      setStep('vehicle_type');
                    }}
                    className="w-full h-14 bg-[#1A1A1A] text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-3 hover:bg-brand-orange transition-all shadow-lg"
                  >
                    <UserPlus size={18} />
                    New Customer / Walk-in
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: Vehicle Type */}
          {step === 'vehicle_type' && (
            <motion.div
              key="vehicle_type"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <button onClick={() => setStep('selection')} className="flex items-center gap-2 text-gray-400 hover:text-brand-orange transition-colors">
                <ChevronLeft size={18} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
              </button>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => {
                    setVehicleType('Car');
                    setStep('details');
                  }}
                  className={cn(
                    "aspect-square rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all",
                    vehicleType === 'Car' ? "border-brand-orange bg-brand-orange/5" : "border-gray-100 bg-white hover:border-brand-orange/30"
                  )}
                >
                  <div className={cn("p-4 rounded-full", vehicleType === 'Car' ? "bg-brand-orange text-white" : "bg-gray-50 text-gray-400")}>
                    <CarIcon size={32} />
                  </div>
                  <span className="font-bold uppercase tracking-widest text-xs">Rent a Car</span>
                </button>

                <button
                  onClick={() => {
                    setVehicleType('Motorbike');
                    setStep('details');
                  }}
                  className={cn(
                    "aspect-square rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all",
                    vehicleType === 'Motorbike' ? "border-brand-orange bg-brand-orange/5" : "border-gray-100 bg-white hover:border-brand-orange/30"
                  )}
                >
                  <div className={cn("p-4 rounded-full", vehicleType === 'Motorbike' ? "bg-brand-orange text-white" : "bg-gray-50 text-gray-400")}>
                    <Bike size={32} />
                  </div>
                  <span className="font-bold uppercase tracking-widest text-xs">Rent a Bike</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Details */}
          {step === 'details' && (
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <button onClick={() => setStep('vehicle_type')} className="flex items-center gap-2 text-gray-400 hover:text-brand-orange transition-colors">
                <ChevronLeft size={18} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
              </button>

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-6">
                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Rental Details</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Select Vehicle</label>
                    <select
                      className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-2xl focus:border-brand-orange outline-none"
                      value={formData.carId}
                      onChange={(e) => setFormData({ ...formData, carId: e.target.value })}
                    >
                      <option value="">Select a {vehicleType}</option>
                      {cars.filter(c => c.category === (vehicleType === 'Motorbike' ? 'Motorbike' : 'Car')).map(car => (
                        <option key={car.id} value={car.id}>{car.name} ({car.plateNumber})</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Rental Period</label>
                    <button
                      type="button"
                      onClick={() => setShowDatePicker(true)}
                      className="w-full bg-gray-50 border border-gray-200 p-4 rounded-2xl text-left hover:bg-gray-100 transition-all outline-none"
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-1">Pick-up</p>
                          <p className="text-xs font-bold text-gray-900">
                            {format(dateRange.from, 'PPP')} at {pickUpTime}
                          </p>
                        </div>
                        <div className="h-8 w-px bg-black/10 mx-4" />
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-orange mb-1">Drop-off</p>
                          <p className="text-xs font-bold text-gray-900">
                            {format(dateRange.to, 'PPP')} at {dropOffTime}
                          </p>
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center justify-end mt-2">
                      <button
                        type="button"
                        onClick={() => setShowImportantInfo(true)}
                        className="flex items-center gap-2 text-brand-orange hover:text-[#1A1A1A] transition-colors"
                      >
                        <AlertCircle size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Important Info</span>
                      </button>
                    </div>

                    <AnimatePresence>
                      {showDatePicker && (
                        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="w-full max-w-[700px]"
                          >
                            <DatePickerCustom
                              selectedRange={dateRange}
                              onRangeChange={(range) => {
                                setDateRange(range);
                                const start = new Date(range.from);
                                const [sh, sm] = pickUpTime.split(':').map(Number);
                                start.setHours(sh, sm, 0, 0);

                                const end = new Date(range.to);
                                const [eh, em] = dropOffTime.split(':').map(Number);
                                end.setHours(eh, em, 0, 0);

                                setFormData({ 
                                  ...formData, 
                                  dateOut: start.toISOString(),
                                  dateIn: end.toISOString()
                                });
                              }}
                              pickUpTime={pickUpTime}
                              onPickUpTimeChange={(time) => {
                                setPickUpTime(time);
                                const start = new Date(dateRange.from);
                                const [sh, sm] = time.split(':').map(Number);
                                start.setHours(sh, sm, 0, 0);
                                setFormData({ ...formData, dateOut: start.toISOString() });
                              }}
                              dropOffTime={dropOffTime}
                              onDropOffTimeChange={(time) => {
                                setDropOffTime(time);
                                const end = new Date(dateRange.to);
                                const [eh, em] = time.split(':').map(Number);
                                end.setHours(eh, em, 0, 0);
                                setFormData({ ...formData, dateIn: end.toISOString() });
                              }}
                              onClose={() => setShowDatePicker(false)}
                              onApply={() => setShowDatePicker(false)}
                              isBikeMode={vehicleType === 'Motorbike'}
                            />
                          </motion.div>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Total Charge (THB)</label>
                      <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                        <input
                          type="number"
                          className="w-full h-12 pl-10 pr-4 bg-gray-50 border border-gray-200 rounded-2xl focus:border-brand-orange outline-none"
                          value={formData.totalCharge}
                          onChange={(e) => setFormData({ ...formData, totalCharge: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Total Paid (THB)</label>
                      <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500" size={14} />
                        <input
                          type="number"
                          className="w-full h-12 pl-10 pr-4 bg-gray-50 border border-gray-200 rounded-2xl focus:border-brand-orange outline-none"
                          value={formData.totalPaid}
                          onChange={(e) => setFormData({ ...formData, totalPaid: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Deposit (THB)</label>
                    <div className="relative">
                      <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                      <input
                        type="number"
                        className="w-full h-12 pl-10 pr-4 bg-gray-50 border border-gray-200 rounded-2xl focus:border-brand-orange outline-none"
                        value={formData.depositAmount}
                        onChange={(e) => setFormData({ ...formData, depositAmount: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-50">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">Customer Info</h4>
                    <div className="space-y-4">
                      <input
                        type="text"
                        placeholder="Full Name"
                        className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-2xl focus:border-brand-orange outline-none"
                        value={formData.customerName}
                        onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                      />
                      <input
                        type="email"
                        placeholder="Email Address"
                        className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-2xl focus:border-brand-orange outline-none"
                        value={formData.customerEmail}
                        onChange={(e) => setFormData({ ...formData, customerEmail: e.target.value })}
                      />
                      <input
                        type="tel"
                        placeholder="Mobile Number"
                        className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-2xl focus:border-brand-orange outline-none"
                        value={formData.customerPhone}
                        onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                      />
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">Return Note</label>
                        <textarea
                          rows={2}
                          value={formData.returnNote}
                          onChange={(e) => setFormData({ ...formData, returnNote: e.target.value })}
                          className="w-full p-4 bg-amber-50/50 border border-amber-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 resize-none transition-all"
                          placeholder="e.g. Collect from house, Owes 2000 baht..."
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setStep('photos')}
                  disabled={!formData.carId || !formData.customerName || !formData.customerEmail}
                  className="w-full h-14 bg-brand-orange text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-3 hover:bg-[#1A1A1A] transition-all shadow-lg shadow-brand-orange/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue to Photos
                  <ChevronRight size={18} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 4: Photos */}
          {step === 'photos' && (
            <motion.div
              key="photos"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <button onClick={() => setStep('details')} className="flex items-center gap-2 text-gray-400 hover:text-brand-orange transition-colors">
                <ChevronLeft size={18} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
              </button>

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Damage Photos ({photos.length}/10)</h3>
                  <button
                    onClick={requestCameraPermissions}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-orange text-white rounded-xl hover:bg-[#1A1A1A] transition-all shadow-lg shadow-brand-orange/20 text-[10px] font-bold uppercase tracking-widest"
                  >
                    <Camera size={16} />
                    Take Photo
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {photos.map((photo, index) => (
                    <div key={index} className="relative aspect-video rounded-2xl overflow-hidden border border-gray-100 group">
                      <img src={photo} alt={`Damage ${index + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => removePhoto(index)}
                        className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {photos.length === 0 && (
                    <div className="col-span-2 py-12 flex flex-col items-center justify-center text-gray-300 border-2 border-dashed border-gray-100 rounded-3xl">
                      <Camera size={48} className="mb-4 opacity-20" />
                      <p className="text-[10px] font-bold uppercase tracking-widest">No photos taken yet</p>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setStep('confirmation')}
                  disabled={photos.length === 0}
                  className="w-full h-14 bg-brand-orange text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-3 hover:bg-[#1A1A1A] transition-all shadow-lg shadow-brand-orange/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Review & Confirm
                  <ChevronRight size={18} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 5: Confirmation */}
          {step === 'confirmation' && (
            <motion.div
              key="confirmation"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <button onClick={() => setStep('photos')} className="flex items-center gap-2 text-gray-400 hover:text-brand-orange transition-colors">
                <ChevronLeft size={18} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
              </button>

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-8">
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-[#1A1A1A]">Confirm Rental</h3>
                  <p className="text-sm text-gray-500">Please review all details before completing</p>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between py-3 border-b border-gray-50">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Customer</span>
                    <span className="text-sm font-bold">{formData.customerName}</span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-gray-50">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Vehicle</span>
                    <span className="text-sm font-bold">{cars.find(c => c.id === formData.carId)?.name}</span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-gray-50">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Dates</span>
                    <span className="text-sm font-bold">{format(new Date(formData.dateOut), 'MMM d')} - {format(new Date(formData.dateIn), 'MMM d')}</span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-gray-50">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Total Charge</span>
                    <span className="text-sm font-bold text-brand-orange">{formData.totalCharge.toLocaleString()} THB</span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-gray-50">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Total Paid</span>
                    <span className="text-sm font-bold text-emerald-600">{formData.totalPaid.toLocaleString()} THB</span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-gray-50">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Deposit</span>
                    <span className="text-sm font-bold">{formData.depositAmount.toLocaleString()} THB</span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-gray-50">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Photos</span>
                    <span className="text-sm font-bold">{photos.length} Images</span>
                  </div>
                </div>

                <div className="bg-blue-50 p-4 rounded-2xl flex gap-3">
                  <Mail className="text-blue-500 shrink-0" size={20} />
                  <p className="text-xs text-blue-700 leading-relaxed">
                    A confirmation email with all rental details and damage photos will be sent to <strong>{formData.customerEmail}</strong> upon completion.
                  </p>
                </div>

                <button
                  onClick={handleComplete}
                  disabled={loading}
                  className="w-full h-16 bg-[#1A1A1A] text-white rounded-2xl font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:bg-brand-orange transition-all shadow-xl disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" size={20} />
                  ) : (
                    <>
                      Complete Rental & Send Email
                      <Check size={20} />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <ImportantInfoModal 
        isOpen={showImportantInfo} 
        onClose={() => setShowImportantInfo(false)} 
        isBikeMode={vehicleType === 'Motorbike'}
      />

      {/* Camera Modal */}
      <AnimatePresence>
        {isCameraActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex flex-col"
          >
            <div className="relative flex-1">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <button
                onClick={stopCamera}
                className="absolute top-6 right-6 p-3 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/40 transition-all"
              >
                <X size={24} />
              </button>
              
              <div className="absolute bottom-10 left-0 right-0 flex items-center justify-center gap-12">
                <div className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center">
                  <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white text-xs font-bold">
                    {photos.length}
                  </div>
                </div>
                <button
                  onClick={takePhoto}
                  className="w-20 h-20 bg-white rounded-full border-4 border-white/30 flex items-center justify-center shadow-2xl active:scale-95 transition-all"
                >
                  <div className="w-16 h-16 rounded-full border-2 border-black/10" />
                </button>
                <button
                  onClick={stopCamera}
                  className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white"
                >
                  <Check size={24} />
                </button>
              </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Navigation Spacer */}
      <div className="h-20 lg:hidden" />
    </div>
  );
};

const Zap = ({ size }: { size: number }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);
