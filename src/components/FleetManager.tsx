import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth, storage, logSystemActivity } from '../firebase';
import { Car, VehicleLog } from '../types';
import { format, parseISO, addMonths, differenceInDays, startOfDay } from 'date-fns';
import { 
  Search, 
  Filter, 
  Plus, 
  Trash2, 
  Edit2, 
  History, 
  Wrench, 
  FileText, 
  Calendar, 
  User, 
  Gauge, 
  Droplets, 
  Shield, 
  Fuel,
  Zap,
  Music,
  Power,
  Image as ImageIcon,
  Car as CarIcon,
  Loader2,
  ChevronRight,
  ChevronDown,
  Save,
  X,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { cn } from '../lib/utils';

export const FleetManager: React.FC = () => {
  const [cars, setCars] = useState<Car[]>([]);
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [logs, setLogs] = useState<VehicleLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logType, setLogType] = useState<'Activity' | 'Maintenance' | 'Note'>('Note');
  const [logDescription, setLogDescription] = useState('');
  const [editLogData, setEditLogData] = useState<{ type: 'Activity' | 'Maintenance' | 'Note', description: string, date: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const safeFormatDate = (dateStr: string | undefined, formatStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      return format(parseISO(dateStr), formatStr);
    } catch (e) {
      return 'Invalid Date';
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'cars'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const carsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Car));
      setCars(carsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'cars');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedCar) {
      setLogs([]);
      return;
    }

    const q = query(
      collection(db, 'vehicle_logs'), 
      where('carId', '==', selectedCar.id),
      orderBy('date', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VehicleLog));
      setLogs(logsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `vehicle_logs (carId: ${selectedCar.id})`);
    });
    
    return () => unsubscribe();
  }, [selectedCar]);

  const handleUpdateCar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedCar) return;

    const formData = new FormData(e.currentTarget);
    const updatedData: Partial<Car> = {
      name: formData.get('name') as string,
      plateNumber: formData.get('plateNumber') as string,
      type: formData.get('type') as string,
      category: formData.get('category') as 'Car' | 'Motorbike' | 'Other',
      make: formData.get('make') as string,
      model: formData.get('model') as string,
      yearOfManufacture: parseInt(formData.get('yearOfManufacture') as string),
      insuranceExpiry: formData.get('insuranceExpiry') as string,
      taxExpiry: formData.get('taxExpiry') as string,
      owner: formData.get('owner') as string,
      currentKms: parseInt(formData.get('currentKms') as string),
      lastOilChangeKms: parseInt(formData.get('lastOilChangeKms') as string),
      lastOilChangeDate: formData.get('lastOilChangeDate') as string,
      fuel: formData.get('fuel') as string,
      engine: formData.get('engine') as string,
      transmission: formData.get('transmission') as string,
      audio: formData.get('audio') as string,
      isActive: formData.get('isActive') === 'true',
    };

    try {
      // Track changes for activity log
      const changes: string[] = [];
      Object.keys(updatedData).forEach(key => {
        const k = key as keyof Car;
        if (updatedData[k] !== selectedCar[k]) {
          changes.push(`${key} changed from "${selectedCar[k]}" to "${updatedData[k]}"`);
        }
      });

      await updateDoc(doc(db, 'cars', selectedCar.id), updatedData);
      
      if (changes.length > 0) {
        await logSystemActivity(
          'Update Vehicle',
          `Updated vehicle ${selectedCar.name} (${selectedCar.plateNumber})`,
          'Fleet',
          { carId: selectedCar.id, changes }
        );

        await addDoc(collection(db, 'vehicle_logs'), {
          carId: selectedCar.id,
          type: 'Activity',
          date: new Date().toISOString(),
          user: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
          description: `Updated vehicle details: ${changes.join(', ')}`,
          details: { changes }
        });
      }

      setIsEditing(false);
      toast.success('Vehicle updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `cars/${selectedCar.id}`);
    }
  };

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCar || !logDescription) return;

    try {
      await addDoc(collection(db, 'vehicle_logs'), {
        carId: selectedCar.id,
        type: logType,
        date: new Date().toISOString(),
        user: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
        description: logDescription
      });
      
      setLogDescription('');
      setIsAddingLog(false);
      toast.success('Log entry added');
    } catch (error) {
      toast.error('Failed to add log entry');
    }
  };

  const handleUpdateLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLogId || !editLogData) return;

    try {
      await updateDoc(doc(db, 'vehicle_logs', editingLogId), {
        type: editLogData.type,
        description: editLogData.description,
        date: editLogData.date
      });
      
      setEditingLogId(null);
      setEditLogData(null);
      toast.success('Log entry updated');
    } catch (error) {
      toast.error('Failed to update log entry');
    }
  };

  const handleDeleteLog = async (logId: string) => {
    try {
      await deleteDoc(doc(db, 'vehicle_logs', logId));
      toast.success('Log entry deleted');
    } catch (error) {
      toast.error('Failed to delete log entry');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCar) return;

    setUploadingImage(true);
    try {
      const storageRef = ref(storage, `cars/${selectedCar.id}_${Date.now()}`);
      const snapshot = await uploadBytes(storageRef, file);
      const imageUrl = await getDownloadURL(snapshot.ref);
      
      await updateDoc(doc(db, 'cars', selectedCar.id), { imageUrl });
      setSelectedCar({ ...selectedCar, imageUrl });
      
      await logSystemActivity(
        'Update Vehicle Image',
        `Updated image for vehicle ${selectedCar.name} (${selectedCar.plateNumber})`,
        'Fleet',
        { carId: selectedCar.id }
      );

      await addDoc(collection(db, 'vehicle_logs'), {
        carId: selectedCar.id,
        type: 'Activity',
        date: new Date().toISOString(),
        user: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
        description: 'Updated vehicle image'
      });

      toast.success('Image uploaded successfully');
    } catch (error) {
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const getExpiryStatus = (dateStr: string | undefined) => {
    if (!dateStr) return null;
    try {
      const expiryDate = parseISO(dateStr);
      const today = startOfDay(new Date());
      const diff = differenceInDays(expiryDate, today);
      
      if (diff < 0) return 'expired';
      if (diff <= 30) return 'soon';
      return null;
    } catch (e) {
      return null;
    }
  };

  const handleQuickLog = async (type: string, expiryDate: string) => {
    if (!selectedCar) return;
    try {
      await addDoc(collection(db, 'vehicle_logs'), {
        carId: selectedCar.id,
        type: 'Maintenance',
        date: new Date().toISOString(),
        user: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
        description: `${type} processed for expiry date: ${safeFormatDate(expiryDate, 'dd MMM yyyy')}`
      });
      toast.success(`${type} logged successfully`);
    } catch (error) {
      toast.error('Failed to log renewal');
    }
  };

  const filteredCars = cars.filter(car => 
    car.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    car.plateNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    car.owner.toLowerCase().includes(searchQuery.toLowerCase())
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
      <div className="p-8 border-b border-white/20 bg-white/40 backdrop-blur-xl flex items-center justify-between">
        <div>
          <h1 className="font-serif italic text-4xl text-[#1A1A1A]">Fleet Manager</h1>
          <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] mt-1 font-medium">Detailed Vehicle Records & Maintenance Logs</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/40" size={18} />
            <input 
              type="text" 
              placeholder="Search fleet..." 
              className="pl-10 pr-4 py-2 bg-white/50 backdrop-blur-sm border border-white/40 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange/40 transition-all w-64"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Vehicle List */}
        <div className="w-80 border-r border-white/20 bg-white/20 backdrop-blur-md overflow-y-auto custom-scrollbar">
          {filteredCars.map(car => (
            <button
              key={car.id}
              onClick={() => {
                setSelectedCar(car);
                setIsEditing(false);
              }}
              className={cn(
                "w-full p-4 text-left border-b border-white/10 transition-all hover:bg-white/40",
                selectedCar?.id === car.id ? "bg-white/60 shadow-sm border-l-4 border-l-brand-orange" : ""
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/40 flex items-center justify-center overflow-hidden border border-white/60 shadow-sm">
                  {car.imageUrl ? (
                    <img src={car.imageUrl} alt={car.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <ImageIcon size={20} className="text-[#1A1A1A]/20" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm truncate text-[#1A1A1A]">{car.name}</p>
                    {car.isActive === false && (
                      <span className="bg-red-100/80 backdrop-blur-sm text-red-600 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0">Sold/Inactive</span>
                    )}
                  </div>
                  <p className="text-[10px] text-[#1A1A1A]/50 uppercase tracking-widest font-medium">{car.plateNumber}</p>
                </div>
                <ChevronRight size={16} className={cn("text-[#1A1A1A]/20 transition-transform", selectedCar?.id === car.id ? "rotate-90 text-brand-orange" : "")} />
              </div>
            </button>
          ))}
        </div>

        {/* Details View */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          <AnimatePresence mode="wait">
            {selectedCar ? (
              <motion.div
                key={selectedCar.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto space-y-8"
              >
                {/* Header Card */}
                <div className="bg-white/60 backdrop-blur-xl border border-white/40 p-8 rounded-3xl shadow-xl">
                  <div className="flex flex-col md:flex-row gap-8">
                    <div className="w-full md:w-64 aspect-video md:aspect-square bg-white/40 rounded-2xl border border-white/60 relative group overflow-hidden shadow-inner">
                      {selectedCar.imageUrl ? (
                        <img src={selectedCar.imageUrl} alt={selectedCar.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#1A1A1A]/20">
                          <ImageIcon size={48} />
                        </div>
                      )}
                      <label className="absolute inset-0 bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center cursor-pointer text-white text-[10px] font-bold uppercase tracking-widest">
                        <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} />
                        {uploadingImage ? <Loader2 className="animate-spin" /> : "Change Image"}
                      </label>
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h2 className="text-3xl font-bold text-[#1A1A1A] tracking-tight">{selectedCar.name}</h2>
                          <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] font-bold mt-1">{selectedCar.plateNumber} • {selectedCar.category}</p>
                        </div>
                        <button 
                          onClick={() => setIsEditing(!isEditing)}
                          className={cn(
                            "p-3 rounded-2xl border transition-all duration-300 shadow-sm",
                            isEditing 
                              ? "bg-brand-orange text-white border-brand-orange shadow-brand-orange/20" 
                              : "bg-white/60 text-[#1A1A1A] border-white/40 hover:bg-white hover:border-brand-orange/40"
                          )}
                        >
                          {isEditing ? <X size={20} /> : <Edit2 size={20} />}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mt-8">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Owner</p>
                          <p className="font-bold flex items-center gap-2 text-sm text-[#1A1A1A]"><User size={14} className="text-brand-orange/60" /> {selectedCar.owner}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Mileage</p>
                          <p className="font-bold flex items-center gap-2 text-sm text-[#1A1A1A]"><Gauge size={14} className="text-brand-orange/60" /> {(selectedCar.currentKms || 0).toLocaleString()} km</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Last Oil Change</p>
                          <p className="font-bold flex items-center gap-2 text-sm text-[#1A1A1A]"><Droplets size={14} className="text-brand-orange/60" /> {(selectedCar.lastOilChangeKms || 0).toLocaleString()} km</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Insurance Exp.</p>
                          <p className={cn("font-bold flex items-center gap-2 text-sm", (selectedCar.insuranceExpiry && new Date(selectedCar.insuranceExpiry) < new Date()) ? "text-red-600" : "text-[#1A1A1A]")}>
                            <Shield size={14} className="text-brand-orange/60" /> {safeFormatDate(selectedCar.insuranceExpiry, 'dd MMM yyyy')}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Tax Exp.</p>
                          <p className={cn("font-bold flex items-center gap-2 text-sm", (selectedCar.taxExpiry && new Date(selectedCar.taxExpiry) < new Date()) ? "text-red-600" : "text-[#1A1A1A]")}>
                            <FileText size={14} className="text-brand-orange/60" /> {safeFormatDate(selectedCar.taxExpiry, 'dd MMM yyyy')}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Status</p>
                          <p className={cn("font-bold flex items-center gap-2 text-sm", selectedCar.isActive === false ? "text-red-600" : "text-green-600")}>
                            <Power size={14} /> {selectedCar.isActive === false ? "Inactive/Sold" : "Active Fleet"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Fuel Type</p>
                          <p className="font-bold flex items-center gap-2 text-sm text-[#1A1A1A]"><Fuel size={14} className="text-brand-orange/60" /> {selectedCar.fuel || 'N/A'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Engine</p>
                          <p className="font-bold flex items-center gap-2 text-sm text-[#1A1A1A]"><Zap size={14} className="text-brand-orange/60" /> {selectedCar.engine || 'N/A'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Transmission</p>
                          <p className="font-bold flex items-center gap-2 text-sm text-[#1A1A1A]"><Wrench size={14} className="text-brand-orange/60" /> {selectedCar.transmission || 'N/A'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">Audio</p>
                          <p className="font-bold flex items-center gap-2 text-sm text-[#1A1A1A]"><Music size={14} className="text-brand-orange/60" /> {selectedCar.audio || 'N/A'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Upcoming Expiries Alerts */}
                {(getExpiryStatus(selectedCar.insuranceExpiry) || getExpiryStatus(selectedCar.taxExpiry)) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {getExpiryStatus(selectedCar.insuranceExpiry) && (
                      <div className={cn(
                        "p-4 rounded-2xl flex items-center justify-between border",
                        getExpiryStatus(selectedCar.insuranceExpiry) === 'expired' 
                          ? "bg-red-50 border-red-200" 
                          : "bg-orange-50 border-orange-200"
                      )}>
                        <div className="flex items-center gap-3">
                          <AlertCircle className={getExpiryStatus(selectedCar.insuranceExpiry) === 'expired' ? "text-red-500" : "text-orange-500"} size={20} />
                          <div>
                            <p className={cn(
                              "text-xs font-bold uppercase tracking-wider",
                              getExpiryStatus(selectedCar.insuranceExpiry) === 'expired' ? "text-red-700" : "text-orange-700"
                            )}>
                              Insurance {getExpiryStatus(selectedCar.insuranceExpiry) === 'expired' ? 'Expired' : 'Expiring Soon'}
                            </p>
                            <p className={cn(
                              "text-[10px] font-medium",
                              getExpiryStatus(selectedCar.insuranceExpiry) === 'expired' ? "text-red-600" : "text-orange-600"
                            )}>
                              {getExpiryStatus(selectedCar.insuranceExpiry) === 'expired' ? 'Expired on' : 'Expires on'} {safeFormatDate(selectedCar.insuranceExpiry, 'dd MMM yyyy')}
                            </p>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleQuickLog('Insurance Renewal', selectedCar.insuranceExpiry!)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors",
                            getExpiryStatus(selectedCar.insuranceExpiry) === 'expired'
                              ? "bg-red-100 hover:bg-red-200 text-red-700"
                              : "bg-orange-100 hover:bg-orange-200 text-orange-700"
                          )}
                        >
                          Log Renewal
                        </button>
                      </div>
                    )}
                    {getExpiryStatus(selectedCar.taxExpiry) && (
                      <div className={cn(
                        "p-4 rounded-2xl flex items-center justify-between border",
                        getExpiryStatus(selectedCar.taxExpiry) === 'expired' 
                          ? "bg-red-50 border-red-200" 
                          : "bg-orange-50 border-orange-200"
                      )}>
                        <div className="flex items-center gap-3">
                          <AlertCircle className={getExpiryStatus(selectedCar.taxExpiry) === 'expired' ? "text-red-500" : "text-orange-500"} size={20} />
                          <div>
                            <p className={cn(
                              "text-xs font-bold uppercase tracking-wider",
                              getExpiryStatus(selectedCar.taxExpiry) === 'expired' ? "text-red-700" : "text-orange-700"
                            )}>
                              Tax {getExpiryStatus(selectedCar.taxExpiry) === 'expired' ? 'Expired' : 'Expiring Soon'}
                            </p>
                            <p className={cn(
                              "text-[10px] font-medium",
                              getExpiryStatus(selectedCar.taxExpiry) === 'expired' ? "text-red-600" : "text-orange-600"
                            )}>
                              {getExpiryStatus(selectedCar.taxExpiry) === 'expired' ? 'Expired on' : 'Expires on'} {safeFormatDate(selectedCar.taxExpiry, 'dd MMM yyyy')}
                            </p>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleQuickLog('Tax Renewal', selectedCar.taxExpiry!)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors",
                            getExpiryStatus(selectedCar.taxExpiry) === 'expired'
                              ? "bg-red-100 hover:bg-red-200 text-red-700"
                              : "bg-orange-100 hover:bg-orange-200 text-orange-700"
                          )}
                        >
                          Log Renewal
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Edit Form / Logs Tabs */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    {isEditing ? (
                      <div className="bg-white/60 backdrop-blur-xl border border-white/40 p-8 rounded-3xl shadow-xl">
                        <h3 className="font-serif italic text-2xl mb-6 text-[#1A1A1A]">Edit Vehicle Details</h3>
                        <form onSubmit={handleUpdateCar} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Display Name</label>
                            <input name="name" defaultValue={selectedCar.name} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Plate Number</label>
                            <input name="plateNumber" defaultValue={selectedCar.plateNumber} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Category</label>
                            <select name="category" defaultValue={selectedCar.category} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors">
                              <option value="Car">Car</option>
                              <option value="Motorbike">Motorbike</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Type</label>
                            <select name="type" defaultValue={selectedCar.type} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors">
                              <option value="Economy">Economy</option>
                              <option value="Sedan">Sedan</option>
                              <option value="SUV">SUV</option>
                              <option value="Truck">Truck</option>
                              <option value="Van">Van</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Make</label>
                            <input name="make" defaultValue={selectedCar.make} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Model</label>
                            <input name="model" defaultValue={selectedCar.model} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Year of Manufacture</label>
                            <input name="yearOfManufacture" type="number" defaultValue={selectedCar.yearOfManufacture} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Owner</label>
                            <input name="owner" defaultValue={selectedCar.owner} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Current Kms</label>
                            <input name="currentKms" type="number" defaultValue={selectedCar.currentKms} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Last Oil Change (Kms)</label>
                            <input name="lastOilChangeKms" type="number" defaultValue={selectedCar.lastOilChangeKms} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Last Oil Change (Date)</label>
                            <input name="lastOilChangeDate" type="date" defaultValue={selectedCar.lastOilChangeDate} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Insurance Expiry</label>
                            <input name="insuranceExpiry" type="date" defaultValue={selectedCar.insuranceExpiry} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Tax Expiry</label>
                            <input name="taxExpiry" type="date" defaultValue={selectedCar.taxExpiry} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" required />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Fuel Type</label>
                            <input name="fuel" defaultValue={selectedCar.fuel} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" placeholder="e.g. Gasoline 95" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Engine Size</label>
                            <input name="engine" defaultValue={selectedCar.engine} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" placeholder="e.g. 1.5L" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Transmission</label>
                            <select name="transmission" defaultValue={selectedCar.transmission} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors">
                              <option value="Automatic">Automatic</option>
                              <option value="Manual">Manual</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Audio System</label>
                            <input name="audio" defaultValue={selectedCar.audio} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors" placeholder="e.g. Bluetooth, USB" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Fleet Status</label>
                            <select name="isActive" defaultValue={selectedCar.isActive === false ? 'false' : 'true'} className="w-full bg-white/40 border-b-2 border-white/60 py-2 focus:border-brand-orange outline-none font-bold text-[#1A1A1A] transition-colors">
                              <option value="true">Active Fleet</option>
                              <option value="false">Inactive / Sold</option>
                            </select>
                          </div>
                          <div className="md:col-span-2 pt-4">
                            <button type="submit" className="w-full bg-brand-orange text-white py-4 rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20">
                              <Save size={20} /> Save Changes
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="font-serif italic text-2xl text-[#1A1A1A]">Activity & Maintenance Log</h3>
                          <button 
                            onClick={() => setIsAddingLog(true)}
                            className="bg-brand-orange text-white px-6 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                          >
                            <Plus size={14} /> Add Entry
                          </button>
                        </div>

                        <AnimatePresence>
                          {isAddingLog && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="bg-white/60 backdrop-blur-xl border border-white/40 p-6 rounded-3xl shadow-xl overflow-hidden"
                            >
                              <form onSubmit={handleAddLog} className="space-y-4">
                                <div className="flex gap-4">
                                  {(['Note', 'Maintenance', 'Activity'] as const).map(type => (
                                    <button
                                      key={type}
                                      type="button"
                                      onClick={() => setLogType(type)}
                                      className={cn(
                                        "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all",
                                        logType === type 
                                          ? "bg-brand-orange text-white border-brand-orange shadow-md shadow-brand-orange/20" 
                                          : "bg-white/40 border-white/60 text-[#1A1A1A]/40 hover:border-brand-orange/40"
                                      )}
                                    >
                                      {type}
                                    </button>
                                  ))}
                                </div>
                                <textarea 
                                  placeholder="Describe the activity or maintenance..."
                                  className="w-full bg-white/40 border border-white/60 p-4 rounded-2xl text-sm focus:outline-none focus:border-brand-orange/40 min-h-[100px] text-[#1A1A1A]"
                                  value={logDescription}
                                  onChange={(e) => setLogDescription(e.target.value)}
                                  required
                                />
                                <div className="flex gap-3">
                                  <button type="submit" className="flex-1 bg-brand-orange text-white py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] shadow-md shadow-brand-orange/20">Save Entry</button>
                                  <button type="button" onClick={() => setIsAddingLog(false)} className="flex-1 bg-white/40 border border-white/60 py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] text-[#1A1A1A]/60 hover:bg-white/60 transition-all">Cancel</button>
                                </div>
                              </form>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="space-y-4">
                          {logs.length > 0 ? (
                            logs.map(log => (
                              <div key={log.id} className="bg-white/40 backdrop-blur-md border border-white/60 p-6 rounded-3xl relative group hover:bg-white/60 transition-all duration-300 shadow-sm">
                                {editingLogId === log.id && editLogData ? (
                                  <form onSubmit={handleUpdateLog} className="space-y-4">
                                    <div className="flex gap-4">
                                      {(['Note', 'Maintenance', 'Activity'] as const).map(type => (
                                        <button
                                          key={type}
                                          type="button"
                                          onClick={() => setEditLogData({ ...editLogData, type })}
                                          className={cn(
                                            "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all",
                                            editLogData.type === type 
                                              ? "bg-brand-orange text-white border-brand-orange shadow-md shadow-brand-orange/20" 
                                              : "bg-white/40 border-white/60 text-[#1A1A1A]/40 hover:border-brand-orange/40"
                                          )}
                                        >
                                          {type}
                                        </button>
                                      ))}
                                    </div>
                                    <input 
                                      type="datetime-local"
                                      className="w-full bg-white/40 border border-white/60 p-2 rounded-xl text-sm focus:outline-none focus:border-brand-orange/40 text-[#1A1A1A]"
                                      value={editLogData.date.slice(0, 16)}
                                      onChange={(e) => setEditLogData({ ...editLogData, date: new Date(e.target.value).toISOString() })}
                                      required
                                    />
                                    <textarea 
                                      className="w-full bg-white/40 border border-white/60 p-4 rounded-xl text-sm focus:outline-none focus:border-brand-orange/40 min-h-[80px] text-[#1A1A1A]"
                                      value={editLogData.description}
                                      onChange={(e) => setEditLogData({ ...editLogData, description: e.target.value })}
                                      required
                                    />
                                    <div className="flex gap-3">
                                      <button type="submit" className="flex-1 bg-brand-orange text-white py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] shadow-md shadow-brand-orange/20">Update</button>
                                      <button type="button" onClick={() => setEditingLogId(null)} className="flex-1 bg-white/40 border border-white/60 py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] text-[#1A1A1A]/60 hover:bg-white/60 transition-all">Cancel</button>
                                    </div>
                                  </form>
                                ) : (
                                  <div className="flex items-start gap-4">
                                    <div className={cn(
                                      "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm",
                                      log.type === 'Maintenance' ? "bg-orange-100/80 text-orange-600" : 
                                      log.type === 'Activity' ? "bg-blue-100/80 text-blue-600" : "bg-gray-100/80 text-gray-600"
                                    )}>
                                      {log.type === 'Maintenance' ? <Wrench size={20} /> : 
                                       log.type === 'Activity' ? <History size={20} /> : <FileText size={20} />}
                                    </div>
                                    <div className="flex-1">
                                      <div className="flex justify-between items-start mb-2">
                                        <div>
                                          <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">{log.type}</span>
                                          <p className="text-sm font-medium text-[#1A1A1A]/60 mt-0.5">{format(parseISO(log.date), 'dd MMM yyyy • HH:mm')}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] font-bold uppercase tracking-widest bg-white/60 border border-white/80 px-2.5 py-1 rounded-full text-[#1A1A1A]/60 shadow-sm">By {log.user}</span>
                                          <div className="opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-1">
                                            <button 
                                              onClick={() => {
                                                setEditingLogId(log.id);
                                                setEditLogData({ type: log.type, description: log.description, date: log.date });
                                              }}
                                              className="p-2 hover:text-brand-orange hover:bg-white/80 rounded-xl transition-all"
                                            >
                                              <Edit2 size={14} />
                                            </button>
                                            <button 
                                              onClick={() => handleDeleteLog(log.id)}
                                              className="p-2 hover:text-red-600 hover:bg-white/80 rounded-xl transition-all"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                      <p className="text-[#1A1A1A] leading-relaxed text-sm font-medium">{log.description}</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-16 bg-white/20 border-2 border-dashed border-white/40 rounded-[32px]">
                              <History className="mx-auto text-[#1A1A1A]/10 mb-4" size={48} />
                              <p className="text-[#1A1A1A]/40 font-bold uppercase tracking-widest text-[10px]">No logs found for this vehicle</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick Stats / Reminders */}
                  <div className="space-y-8">
                    <div className="bg-brand-orange text-white p-8 rounded-[32px] shadow-2xl shadow-brand-orange/20 relative overflow-hidden group">
                      <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                      <h4 className="font-serif italic text-2xl mb-6 relative z-10">Quick Stats</h4>
                      <div className="space-y-5 relative z-10">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Total Logs</span>
                          <span className="font-bold text-lg">{logs.length}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Maintenance</span>
                          <span className="font-bold text-lg">{logs.filter(l => l.type === 'Maintenance').length}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Kms Since Oil</span>
                          <span className={cn("font-bold text-lg", ((selectedCar.currentKms || 0) - (selectedCar.lastOilChangeKms || 0)) > 10000 ? "text-white underline decoration-white/40 underline-offset-4" : "")}>
                            {((selectedCar.currentKms || 0) - (selectedCar.lastOilChangeKms || 0)).toLocaleString()} km
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/60 backdrop-blur-xl border border-white/40 p-8 rounded-[32px] shadow-xl">
                      <h4 className="font-serif italic text-2xl mb-6 text-[#1A1A1A]">Reminders</h4>
                      <div className="space-y-5">
                        {selectedCar.insuranceExpiry && new Date(selectedCar.insuranceExpiry) < addMonths(new Date(), 1) && (
                          <div className="flex items-start gap-4 p-4 rounded-2xl bg-red-50/50 border border-red-100/50 text-red-600">
                            <Shield size={20} className="shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest">Insurance Expiring</p>
                              <p className="text-xs font-bold mt-0.5">{safeFormatDate(selectedCar.insuranceExpiry, 'dd MMM yyyy')}</p>
                            </div>
                          </div>
                        )}
                        {selectedCar.taxExpiry && new Date(selectedCar.taxExpiry) < addMonths(new Date(), 1) && (
                          <div className="flex items-start gap-4 p-4 rounded-2xl bg-red-50/50 border border-red-100/50 text-red-600">
                            <FileText size={20} className="shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest">Tax Expiring</p>
                              <p className="text-xs font-bold mt-0.5">{safeFormatDate(selectedCar.taxExpiry, 'dd MMM yyyy')}</p>
                            </div>
                          </div>
                        )}
                        {((selectedCar.currentKms || 0) - (selectedCar.lastOilChangeKms || 0)) > 8000 && (
                          <div className="flex items-start gap-4 p-4 rounded-2xl bg-orange-50/50 border border-orange-100/50 text-orange-600">
                            <Droplets size={20} className="shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest">Oil Change Due</p>
                              <p className="text-xs font-bold mt-0.5">Last change at {(selectedCar.lastOilChangeKms || 0).toLocaleString()} km</p>
                            </div>
                          </div>
                        )}
                        {!selectedCar.insuranceExpiry && !selectedCar.taxExpiry && ((selectedCar.currentKms || 0) - (selectedCar.lastOilChangeKms || 0)) <= 8000 && (
                          <div className="text-center py-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">All clear for now</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-24 h-24 bg-white/40 backdrop-blur-xl border border-white/60 rounded-full flex items-center justify-center mb-6 shadow-xl">
                  <CarIcon size={48} className="text-[#1A1A1A]/20" />
                </div>
                <h2 className="font-serif italic text-3xl mb-2 text-[#1A1A1A]">Select a Vehicle</h2>
                <p className="text-[#1A1A1A]/40 uppercase tracking-widest text-xs">Choose a vehicle from the fleet to view detailed records</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
