import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, handleFirestoreError, OperationType, auth, storage, writeBatch, logSystemActivity } from '../firebase';
import { WebsiteCar } from '../types';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Save, 
  X, 
  Image as ImageIcon, 
  Loader2, 
  Globe,
  Check,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Car as CarIcon,
  Users,
  Wind,
  Music,
  Settings,
  Calendar,
  Download,
  Zap
} from 'lucide-react';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { SEED_WEBSITE_CARS } from '../seedData';
import { safeLocalStorage } from '../lib/storage';

export const WebsiteFleetManager: React.FC = () => {
  const [cars, setCars] = useState<WebsiteCar[]>([]);
  const [selectedCar, setSelectedCar] = useState<WebsiteCar | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  const [lastFetch, setLastFetch] = useState(() => {
    const cached = safeLocalStorage.getItem('prac_website_fleet_last_fetch');
    return cached ? parseInt(cached) : 0;
  });

  useEffect(() => {
    const fetchCars = async () => {
      // Cache for 15 minutes
      const CACHE_DURATION = 15 * 60 * 1000;
      const isCacheValid = Date.now() - lastFetch < CACHE_DURATION;

      if (cars.length > 0 && isCacheValid) {
        setLoading(false);
        return;
      }

      if (cars.length === 0 && isCacheValid) {
        const cached = safeLocalStorage.getItem('prac_cached_website_fleet');
        if (cached) {
          try {
            setCars(JSON.parse(cached));
            setLoading(false);
            return;
          } catch (e) {
            console.error('Error parsing cached website fleet:', e);
          }
        }
      }

      try {
        const q = query(collection(db, 'website_cars'), orderBy('displayOrder', 'asc'));
        const snapshot = await getDocs(q);
        const carsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WebsiteCar));
        setCars(carsData);
        const now = Date.now();
        setLastFetch(now);
        safeLocalStorage.setItem('prac_website_fleet_last_fetch', now.toString(), true);
        safeLocalStorage.setItem('prac_cached_website_fleet', JSON.stringify(carsData), true);
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'website_cars');
        setLoading(false);
      }
    };
    fetchCars();
  }, []);

  const handleSeedData = async () => {
    setIsSeeding(true);
    try {
      console.log('Starting website fleet seed...');
      const batch = writeBatch(db);
      const websiteCarsCollection = collection(db, 'website_cars');
      let addedCount = 0;

      for (const carData of SEED_WEBSITE_CARS) {
        const exists = cars.some(c => c.name === carData.name);
        if (!exists) {
          const docRef = doc(websiteCarsCollection);
          batch.set(docRef, carData);
          addedCount++;
        }
      }

      if (addedCount > 0) {
        await batch.commit();
        console.log('Website fleet seeded.');
        toast.success(`Website fleet seeded successfully. Added ${addedCount} vehicles.`);
      } else {
        console.log('No new website vehicles to add.');
        toast.info('No new vehicles added. All already exist.');
      }
    } catch (error) {
      console.error('Seeding error:', error);
      toast.error('Failed to seed website fleet');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleClearFleet = async () => {
    setIsSeeding(true);
    try {
      console.log('Clearing website fleet...');
      const snapshot = await getDocs(collection(db, 'website_cars'));
      const batch = writeBatch(db);
      
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log('Website fleet cleared.');
      toast.success('Website fleet cleared');
    } catch (error) {
      console.error('Clear website fleet error:', error);
      toast.error('Failed to clear website fleet');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleExportCSV = () => {
    if (cars.length === 0) {
      toast.error('No vehicles to export');
      return;
    }

    const exportData = cars.map(car => ({
      name: car.name,
      year_range: car.yearRange,
      price_per_day: car.pricePerDay,
      price_monthly: car.priceMonthly,
      engine_size: car.engineSize,
      fuel_type: car.fuelType,
      transmission: car.transmission,
      passengers: car.passengers,
      air_con: car.airCon,
      audio: car.audio,
      display_order: car.displayOrder,
      is_active: car.isActive,
      main_image: car.mainImage,
      price_grid_vehicle: car.priceGridVehicle || '',
      category: car.category || 'Car'
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `prac_website_fleet_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success('Website fleet exported successfully');
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.toLowerCase().trim().replace(/\s+/g, '_'),
      complete: async (results) => {
        const data = results.data as any[];
        
        const validData = data.map(item => {
          if (!item.name) return null;

          return {
            name: item.name,
            yearRange: item.year_range || '2024',
            pricePerDay: Number(item.price_per_day) || 0,
            priceMonthly: Number(item.price_monthly) || 0,
            engineSize: item.engine_size || '1.5',
            fuelType: item.fuel_type || 'Petrol',
            transmission: item.transmission || 'Auto',
            passengers: Number(item.passengers) || 5,
            airCon: item.air_con === 'true' || item.air_con === true,
            audio: item.audio || 'Bluetooth',
            displayOrder: Number(item.display_order) || cars.length,
            isActive: item.is_active === 'true' || item.is_active === true,
            mainImage: item.main_image || '',
            realImages: [],
            priceGridVehicle: item.price_grid_vehicle || '',
            category: item.category || 'Car'
          };
        }).filter(item => item !== null);

        if (validData.length === 0) {
          toast.error('No valid vehicles found in CSV.');
          return;
        }

        toast.promise(async () => {
          const batch = writeBatch(db);
          const websiteCarsCollection = collection(db, 'website_cars');
          
          for (const car of validData) {
            const docRef = doc(websiteCarsCollection);
            batch.set(docRef, car);
          }
          
          await batch.commit();
          
          await logSystemActivity(
            'Website CSV Import',
            `Imported ${validData.length} website vehicles via CSV`,
            'Fleet',
            { count: validData.length }
          );

          return validData.length;
        }, {
          loading: 'Importing website vehicles...',
          success: (count) => `Successfully imported ${count} vehicles!`,
          error: 'Failed to import vehicles'
        });

        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      error: (error) => {
        console.error('PapaParse error:', error);
        toast.error('Failed to parse CSV file');
      }
    });
  };

  const handleUpdateCar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCar) return;

    try {
      const carRef = doc(db, 'website_cars', selectedCar.id);
      const { id, ...updateData } = selectedCar;
      await updateDoc(carRef, updateData);
      
      await logSystemActivity(
        'Update Website Vehicle',
        `Updated website vehicle ${selectedCar.name}`,
        'Fleet',
        { carId: selectedCar.id }
      );

      setIsEditing(false);
      toast.success('Vehicle updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `website_cars/${selectedCar.id}`);
    }
  };

  const handleDeleteCar = async (id: string) => {
    const car = cars.find(c => c.id === id);
    try {
      await deleteDoc(doc(db, 'website_cars', id));
      
      if (car) {
        await logSystemActivity(
          'Delete Website Vehicle',
          `Deleted website vehicle ${car.name}`,
          'Fleet',
          { carId: id }
        );
      }

      if (selectedCar?.id === id) setSelectedCar(null);
      toast.success('Vehicle deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `website_cars/${id}`);
    }
  };

  const handleAddNew = async () => {
    const newCar: Omit<WebsiteCar, 'id'> = {
      name: 'New Vehicle',
      yearRange: '2024',
      pricePerDay: 0,
      priceMonthly: 0,
      engineSize: '1.5',
      fuelType: 'Petrol',
      transmission: 'Auto',
      passengers: 5,
      airCon: true,
      audio: 'Bluetooth',
      displayOrder: cars.length + 1,
      isActive: true,
      mainImage: '',
      realImages: [],
    };

    try {
      const docRef = await addDoc(collection(db, 'website_cars'), newCar);
      
      await logSystemActivity(
        'Add Website Vehicle',
        `Added new website vehicle ${newCar.name}`,
        'Fleet',
        { carId: docRef.id }
      );

      setSelectedCar({ id: docRef.id, ...newCar });
      setIsEditing(true);
      toast.success('New vehicle added');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'website_cars');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'main' | 'real') => {
    const file = e.target.files?.[0];
    if (!file || !selectedCar) return;

    setUploadingImage(true);
    try {
      const storageRef = ref(storage, `website_cars/${selectedCar.id}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      if (type === 'main') {
        const updatedCar = { ...selectedCar, mainImage: url };
        setSelectedCar(updatedCar);
        await updateDoc(doc(db, 'website_cars', selectedCar.id), { mainImage: url });
      } else {
        const updatedImages = [...(selectedCar.realImages || []), url];
        const updatedCar = { ...selectedCar, realImages: updatedImages };
        setSelectedCar(updatedCar);
        await updateDoc(doc(db, 'website_cars', selectedCar.id), { realImages: updatedImages });
      }
      toast.success('Image uploaded successfully');
    } catch (error) {
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const filteredCars = cars.filter(car => 
    car.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-warm-bg">
      {/* Header */}
      <div className="p-8 bg-white/60 backdrop-blur-xl border-b border-white/40 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif italic text-[#1A1A1A] flex items-center gap-3">
            <Globe className="text-brand-orange" size={28} />
            Website Fleet Manager
          </h1>
          <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] mt-1 font-medium">Manage vehicles displayed on the public website</p>
        </div>
        <div className="flex items-center gap-4">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleImportCSV}
            accept=".csv"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-6 py-2.5 bg-white/60 text-[#1A1A1A] border border-white/40 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange hover:text-white transition-all shadow-lg shadow-black/5"
          >
            <Zap size={14} />
            Import CSV
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-6 py-2.5 bg-white/60 text-[#1A1A1A] border border-white/40 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange hover:text-white transition-all shadow-lg shadow-black/5"
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            onClick={handleSeedData}
            disabled={isSeeding}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-orange/10 text-brand-orange border border-brand-orange/20 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange hover:text-white transition-all shadow-lg shadow-brand-orange/5 disabled:opacity-50"
          >
            {isSeeding ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
            Import Dataset
          </button>
          <button
            onClick={handleAddNew}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-orange text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
          >
            <Plus size={14} />
            Add New Vehicle
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/40" size={18} />
            <input 
              type="text"
              placeholder="SEARCH WEBSITE FLEET..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-white/40 border border-white/60 rounded-full text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-orange/20 w-64"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar List */}
        <div className="w-80 border-r border-white/40 bg-white/20 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="animate-spin text-brand-orange" size={32} />
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {filteredCars.map(car => (
                <button
                  key={car.id}
                  onClick={() => {
                    setSelectedCar(car);
                    setIsEditing(false);
                  }}
                  className={cn(
                    "w-full p-4 rounded-2xl transition-all text-left group flex items-center gap-4",
                    selectedCar?.id === car.id 
                      ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                      : "bg-white/40 hover:bg-white/60 text-[#1A1A1A]"
                  )}
                >
                  <div className="w-16 h-12 rounded-lg bg-white/20 overflow-hidden flex-shrink-0">
                    {car.mainImage ? (
                      <img src={car.mainImage} alt={car.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <CarIcon size={20} className="opacity-40" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-xs uppercase tracking-wider truncate">{car.name}</div>
                    <div className={cn(
                      "text-[10px] uppercase tracking-widest font-medium",
                      selectedCar?.id === car.id ? "text-white/60" : "text-[#1A1A1A]/40"
                    )}>
                      {car.yearRange}
                    </div>
                  </div>
                  {!car.isActive && (
                    <div className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 text-[8px] font-bold uppercase tracking-tighter">
                      Hidden
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            {selectedCar ? (
              <motion.div
                key={selectedCar.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto space-y-8"
              >
                {/* Vehicle Header Card */}
                <div className="bg-white/60 backdrop-blur-xl rounded-[32px] p-8 border border-white/40 shadow-xl overflow-hidden relative">
                  <div className="absolute top-0 right-0 p-8 flex gap-2">
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className="p-3 bg-white/80 hover:bg-white rounded-full text-[#1A1A1A] transition-all shadow-md"
                    >
                      {isEditing ? <X size={20} /> : <Edit2 size={20} />}
                    </button>
                    <button
                      onClick={() => handleDeleteCar(selectedCar.id)}
                      className="p-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-full transition-all shadow-md"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>

                  <div className="flex gap-12 items-start">
                    <div className="w-1/2 space-y-4">
                      <div className="relative group">
                        <div className="aspect-[4/3] rounded-3xl bg-white/40 overflow-hidden border border-white/60 shadow-inner">
                          {selectedCar.mainImage ? (
                            <img src={selectedCar.mainImage} alt={selectedCar.name} className="w-full h-full object-contain p-4" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-[#1A1A1A]/20">
                              <ImageIcon size={48} />
                              <p className="text-[10px] font-bold uppercase tracking-widest mt-2">No Image</p>
                            </div>
                          )}
                        </div>
                        {isEditing && (
                          <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-3xl">
                            <input type="file" className="hidden" onChange={(e) => handleImageUpload(e, 'main')} accept="image/*" />
                            <div className="text-white flex flex-col items-center gap-2">
                              {uploadingImage ? <Loader2 className="animate-spin" /> : <ImageIcon />}
                              <span className="text-[10px] font-bold uppercase tracking-widest">Change Image</span>
                            </div>
                          </label>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 pt-4">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                          selectedCar.isActive ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                        )}>
                          {selectedCar.isActive ? 'Visible on Website' : 'Hidden from Website'}
                        </span>
                        <span className="text-[#1A1A1A]/40 text-[10px] font-bold uppercase tracking-widest">Order: {selectedCar.displayOrder}</span>
                      </div>
                      <h2 className="text-4xl font-serif italic text-[#1A1A1A] mb-2">{selectedCar.name}</h2>
                      <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-xs font-medium mb-6">{selectedCar.yearRange}</p>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-white/40 rounded-2xl border border-white/60">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Daily Price</div>
                          <div className="text-2xl font-serif italic text-brand-orange">฿{selectedCar.pricePerDay.toLocaleString()}</div>
                        </div>
                        <div className="p-4 bg-white/40 rounded-2xl border border-white/60">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Monthly Price</div>
                          <div className="text-2xl font-serif italic text-brand-orange">฿{selectedCar.priceMonthly.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {isEditing ? (
                  <form onSubmit={handleUpdateCar} className="bg-white/60 backdrop-blur-xl rounded-[32px] p-8 border border-white/40 shadow-xl space-y-8">
                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/40 border-b border-[#1A1A1A]/10 pb-2">Basic Info</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Vehicle Name</label>
                            <input 
                              type="text"
                              value={selectedCar.name}
                              onChange={(e) => setSelectedCar({...selectedCar, name: e.target.value})}
                              className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Year Range</label>
                            <input 
                              type="text"
                              value={selectedCar.yearRange}
                              onChange={(e) => setSelectedCar({...selectedCar, yearRange: e.target.value})}
                              className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Daily Price (฿)</label>
                              <input 
                                type="number"
                                value={selectedCar.pricePerDay}
                                onChange={(e) => setSelectedCar({...selectedCar, pricePerDay: Number(e.target.value)})}
                                className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Monthly Price (฿)</label>
                              <input 
                                type="number"
                                value={selectedCar.priceMonthly}
                                onChange={(e) => setSelectedCar({...selectedCar, priceMonthly: Number(e.target.value)})}
                                className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/40 border-b border-[#1A1A1A]/10 pb-2">Technical Specs</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Engine Size</label>
                            <input 
                              type="text"
                              value={selectedCar.engineSize}
                              onChange={(e) => setSelectedCar({...selectedCar, engineSize: e.target.value})}
                              className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Fuel Type</label>
                            <select 
                              value={selectedCar.fuelType}
                              onChange={(e) => setSelectedCar({...selectedCar, fuelType: e.target.value})}
                              className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                            >
                              <option value="Petrol">Petrol</option>
                              <option value="Diesel">Diesel</option>
                              <option value="Electric">Electric</option>
                              <option value="Hybrid">Hybrid</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Transmission</label>
                            <select 
                              value={selectedCar.transmission}
                              onChange={(e) => setSelectedCar({...selectedCar, transmission: e.target.value})}
                              className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                            >
                              <option value="Auto">Auto</option>
                              <option value="Manual">Manual</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Passengers</label>
                            <input 
                              type="number"
                              value={selectedCar.passengers}
                              onChange={(e) => setSelectedCar({...selectedCar, passengers: Number(e.target.value)})}
                              className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-6 pt-2">
                          <label className="flex items-center gap-3 cursor-pointer group">
                            <div className={cn(
                              "w-10 h-6 rounded-full transition-all relative",
                              selectedCar.airCon ? "bg-brand-orange" : "bg-[#1A1A1A]/10"
                            )}>
                              <div className={cn(
                                "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                                selectedCar.airCon ? "left-5" : "left-1"
                              )} />
                            </div>
                            <input 
                              type="checkbox"
                              className="hidden"
                              checked={selectedCar.airCon}
                              onChange={(e) => setSelectedCar({...selectedCar, airCon: e.target.checked})}
                            />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60">Air Con</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer group">
                            <div className={cn(
                              "w-10 h-6 rounded-full transition-all relative",
                              selectedCar.isActive ? "bg-green-500" : "bg-[#1A1A1A]/10"
                            )}>
                              <div className={cn(
                                "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                                selectedCar.isActive ? "left-5" : "left-1"
                              )} />
                            </div>
                            <input 
                              type="checkbox"
                              className="hidden"
                              checked={selectedCar.isActive}
                              onChange={(e) => setSelectedCar({...selectedCar, isActive: e.target.checked})}
                            />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60">Active</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Display Order</label>
                        <input 
                          type="number"
                          value={selectedCar.displayOrder}
                          onChange={(e) => setSelectedCar({...selectedCar, displayOrder: Number(e.target.value)})}
                          className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                        />
                      </div>
                      <div className="space-y-4">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Price Grid Link</label>
                        <input 
                          type="text"
                          value={selectedCar.priceGridVehicle || ''}
                          onChange={(e) => setSelectedCar({...selectedCar, priceGridVehicle: e.target.value})}
                          placeholder="e.g. Vios, Ativ, SUV..."
                          className="w-full px-4 py-3 bg-white/40 border border-white/60 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-4 pt-4">
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="px-8 py-3 bg-white/40 text-[#1A1A1A] rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-white/60 transition-all border border-white/60"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="flex items-center gap-2 px-8 py-3 bg-brand-orange text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                      >
                        <Save size={14} />
                        Save Changes
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-8">
                    {/* Specs Grid */}
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 flex flex-col items-center text-center">
                        <Users className="text-brand-orange mb-2" size={24} />
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Passengers</div>
                        <div className="text-lg font-bold text-[#1A1A1A]">{selectedCar.passengers} Seats</div>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 flex flex-col items-center text-center">
                        <Settings className="text-brand-orange mb-2" size={24} />
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Transmission</div>
                        <div className="text-lg font-bold text-[#1A1A1A]">{selectedCar.transmission}</div>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 flex flex-col items-center text-center">
                        <Wind className="text-brand-orange mb-2" size={24} />
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Air Con</div>
                        <div className="text-lg font-bold text-[#1A1A1A]">{selectedCar.airCon ? 'Yes' : 'No'}</div>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-white/60 flex flex-col items-center text-center">
                        <Music className="text-brand-orange mb-2" size={24} />
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Audio</div>
                        <div className="text-lg font-bold text-[#1A1A1A] truncate w-full px-2">{selectedCar.audio}</div>
                      </div>
                    </div>

                    {/* Real Images Gallery */}
                    <div className="bg-white/60 backdrop-blur-xl rounded-[32px] p-8 border border-white/40 shadow-xl">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/40">Real Vehicle Images</h3>
                        <label className="flex items-center gap-2 px-4 py-2 bg-brand-orange/10 text-brand-orange rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange hover:text-white transition-all cursor-pointer">
                          <input type="file" className="hidden" onChange={(e) => handleImageUpload(e, 'real')} accept="image/*" />
                          <Plus size={14} />
                          Add Real Photo
                        </label>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        {selectedCar.realImages?.map((img, idx) => (
                          <div key={idx} className="aspect-video rounded-2xl overflow-hidden border border-white/60 group relative">
                            <img src={img} alt={`Real ${idx}`} className="w-full h-full object-cover" />
                            <button 
                              onClick={async () => {
                                const updated = selectedCar.realImages.filter((_, i) => i !== idx);
                                await updateDoc(doc(db, 'website_cars', selectedCar.id), { realImages: updated });
                                setSelectedCar({...selectedCar, realImages: updated});
                              }}
                              className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        {(!selectedCar.realImages || selectedCar.realImages.length === 0) && (
                          <div className="col-span-3 py-12 flex flex-col items-center justify-center text-[#1A1A1A]/20 border-2 border-dashed border-white/40 rounded-2xl">
                            <ImageIcon size={32} />
                            <p className="text-[10px] font-bold uppercase tracking-widest mt-2">No real photos added yet</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-[#1A1A1A]/20">
                <div className="w-24 h-24 rounded-full bg-white/40 flex items-center justify-center mb-4 border border-white/60">
                  <Globe size={48} />
                </div>
                <h3 className="text-xl font-serif italic text-[#1A1A1A]/40">Select a vehicle to manage</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest mt-2">Choose from the list on the left</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
