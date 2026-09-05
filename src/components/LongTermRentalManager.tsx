import React, { useEffect, useState } from 'react';
import { collection, getDocs, getDoc, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType, logSystemActivity } from '../firebase';
import { Car, LongTermListing } from '../types';
import { Save, RefreshCw, Plus, Trash2, Info, X, Globe, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

// Same repository_dispatch pattern the CMS admin panel uses to rebuild the
// marketing site after a content change (reads the shared GitHub PAT from
// app_settings/deploy  one Firebase project, so the same doc both apps use).
async function triggerMarketingDeploy(): Promise<void> {
  try {
    const snap = await getDoc(doc(db, 'app_settings', 'deploy'));
    const pat = snap.data()?.githubPat as string | undefined;
    if (!pat) return;
    await fetch('https://api.github.com/repos/shaneruddle/PRAC-Marketing-Site/dispatches', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'cms_publish' }),
    });
  } catch {
    // silent  deploy failure never blocks a save
  }
}

const DEFAULTS: Partial<LongTermListing> = {
  carId: '', carName: '', carType: '', plateNumber: '',
  monthlyPrice: 0, minMonths: 1, notes: '', published: false, displayOrder: 0,
};

const thb = (n: number) => `${(n || 0).toLocaleString()}`;

export const LongTermRentalManager: React.FC = () => {
  const [listings, setListings] = useState<LongTermListing[]>([]);
  const [fleetCars, setFleetCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<LongTermListing>>(DEFAULTS);
  const [reference, setReference] = useState<{ perDay: number } | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);

  useEffect(() => {
    async function fetchData() {
      if (!auth.currentUser) return;
      try {
        // Cars and listings are both filtered/sorted client-side rather than
        // with a compound where+orderBy query, so neither needs a Firestore
        // composite index.
        const carsSnap = await getDocs(collection(db, 'cars'));
        const cars = carsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }) as Car)
          .filter(c => c.category === 'Car' && c.isActive !== false)
          .sort((a, b) => a.name.localeCompare(b.name));
        setFleetCars(cars);

        const listingsSnap = await getDocs(collection(db, 'long_term_listings'));
        const data = listingsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }) as LongTermListing)
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
        setListings(data);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'long_term_listings');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Live reference: what a 7-day short-term booking of this class earns per
  // day right now (same season-adjusted pricing engine the booking site
  // itself uses), 14 days out. Purely informational  never written back 
  // so a long-term rate never gets set below what short-term would earn.
  useEffect(() => {
    if (!showModal || !formData.carType) { setReference(null); return; }
    setReferenceLoading(true);
    const from = new Date();
    from.setDate(from.getDate() + 14);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const iso = (d: Date) => d.toISOString().split('T')[0];
    fetch(`/api/pricing/quote?class=${encodeURIComponent(formData.carType)}&from=${iso(from)}&to=${iso(to)}`)
      .then(r => r.json())
      .then(data => setReference(data?.quotable ? { perDay: data.perDay } : null))
      .catch(() => setReference(null))
      .finally(() => setReferenceLoading(false));
  }, [showModal, formData.carType]);

  const openNew = () => {
    setEditingId(null);
    setFormData(DEFAULTS);
    setShowModal(true);
  };

  const openEdit = (listing: LongTermListing) => {
    setEditingId(listing.id!);
    setFormData(listing);
    setShowModal(true);
  };

  const handleCarChange = (carId: string) => {
    const car = fleetCars.find(c => c.id === carId);
    if (!car) return;
    setFormData(prev => ({ ...prev, carId: car.id, carName: car.name, carType: car.type, plateNumber: car.plateNumber }));
  };

  const set = (field: keyof LongTermListing, value: any) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const saveListing = async () => {
    if (!formData.carId) return toast.error('Pick a vehicle from the fleet');
    if (!formData.monthlyPrice || formData.monthlyPrice <= 0) return toast.error('Enter a monthly price');
    setSaving(true);
    const isNew = !editingId;
    const id = editingId || doc(collection(db, 'long_term_listings')).id;
    try {
      const data = {
        ...formData,
        monthlyPrice: Number(formData.monthlyPrice) || 0,
        minMonths: Number(formData.minMonths) || 1,
        displayOrder: Number(formData.displayOrder) || 0,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || null,
        createdAt: isNew ? serverTimestamp() : formData.createdAt,
      };
      await setDoc(doc(db, 'long_term_listings', id), data);
      await logSystemActivity(
        isNew ? 'Add Long-Term Listing' : 'Update Long-Term Listing',
        `${formData.carName}  ${thb(data.monthlyPrice)}/month`,
        'Long Term Rentals',
        { listingId: id }
      );
      if (formData.published) await triggerMarketingDeploy();
      setListings(prev => {
        const merged = { id, ...data } as LongTermListing;
        const next = isNew ? [...prev, merged] : prev.map(l => (l.id === id ? merged : l));
        return next.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      });
      toast.success(formData.published ? 'Listing published  site rebuild triggered' : 'Listing saved (not published)');
      setShowModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'long_term_listings');
    } finally {
      setSaving(false);
    }
  };

  const deleteListing = async (listing: LongTermListing) => {
    if (!window.confirm(`Remove ${listing.carName} from long-term listings?`)) return;
    try {
      await deleteDoc(doc(db, 'long_term_listings', listing.id!));
      await logSystemActivity('Delete Long-Term Listing', `Removed ${listing.carName}`, 'Long Term Rentals', { listingId: listing.id });
      if (listing.published) await triggerMarketingDeploy();
      setListings(prev => prev.filter(l => l.id !== listing.id));
      toast.success('Listing removed');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `long_term_listings/${listing.id}`);
    }
  };

  const togglePublished = async (listing: LongTermListing) => {
    const nextPublished = !listing.published;
    try {
      await setDoc(doc(db, 'long_term_listings', listing.id!), { published: nextPublished, updatedAt: serverTimestamp() }, { merge: true });
      await triggerMarketingDeploy();
      setListings(prev => prev.map(l => (l.id === listing.id ? { ...l, published: nextPublished } : l)));
      toast.success(nextPublished ? 'Live on site  rebuild triggered' : 'Taken off the site  rebuild triggered');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `long_term_listings/${listing.id}`);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-warm-bg">
        <RefreshCw className="animate-spin text-brand-orange" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 bg-warm-bg overflow-y-auto custom-scrollbar">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
          <div>
            <h1 className="font-serif italic text-5xl mb-4 text-[#1A1A1A]">Long Term Rentals</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-xs font-medium">
              Vehicles currently available for long-term rent  published listings show live on /long-term-rental/
            </p>
          </div>
          <button
            onClick={openNew}
            className="bg-brand-orange text-white px-8 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20 active:translate-y-[2px]"
          >
            <Plus size={14} /> New Listing
          </button>
        </div>

        {listings.length === 0 ? (
          <div className="bg-white/40 backdrop-blur-md border-2 border-dashed border-black/10 rounded-[32px] py-16 flex flex-col items-center justify-center gap-2 text-[#1A1A1A]/30">
            <Globe size={32} strokeWidth={1} />
            <p className="text-[11px] font-bold uppercase tracking-widest">No long-term listings yet</p>
            <p className="text-[11px]">Nothing is currently advertised on the public site.</p>
          </div>
        ) : (
          <div className="bg-white/60 backdrop-blur-md rounded-[32px] border border-white/60 shadow-sm overflow-hidden divide-y divide-black/5">
            {listings.map(listing => (
              <div key={listing.id} className="flex items-center justify-between p-6 gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    listing.published ? "bg-emerald-500" : "bg-black/20"
                  )} />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#1A1A1A] truncate">{listing.carName}</span>
                      <span className="text-[10px] font-mono text-[#1A1A1A]/40 shrink-0">{listing.plateNumber}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] uppercase font-bold tracking-widest text-[#1A1A1A]/40">{listing.carType}</span>
                      {listing.minMonths > 1 && (
                        <span className="text-[10px] text-[#1A1A1A]/30 font-medium">min {listing.minMonths} months</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-bold text-sm text-[#1A1A1A]">{thb(listing.monthlyPrice)}<span className="text-[#1A1A1A]/40 font-medium text-xs">/mo</span></span>
                  <button
                    onClick={() => togglePublished(listing)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-colors",
                      listing.published ? "bg-emerald-50 text-emerald-600" : "bg-black/5 text-[#1A1A1A]/40 hover:bg-black/10"
                    )}
                  >
                    {listing.published ? "Live" : "Publish"}
                  </button>
                  <button onClick={() => openEdit(listing)} className="p-2 text-[#1A1A1A]/40 hover:text-brand-orange hover:bg-brand-orange/10 rounded-xl transition-all">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => deleteListing(listing)} className="p-2 text-[#1A1A1A]/40 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[32px] p-8 shadow-2xl border border-white/20 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-serif italic text-3xl text-[#1A1A1A]">
                {editingId ? 'Edit Listing' : 'New Listing'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-2 text-[#1A1A1A]/40 hover:bg-black/5 rounded-xl transition-all">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Vehicle</label>
                <select
                  value={formData.carId}
                  onChange={(e) => handleCarChange(e.target.value)}
                  className="w-full bg-warm-bg border-b-2 border-[#1A1A1A]/5 py-3 px-1 font-bold text-sm focus:border-brand-orange outline-none transition-colors appearance-none"
                >
                  <option value="">Select a vehicle...</option>
                  {fleetCars.map(car => (
                    <option key={car.id} value={car.id}>{car.name}  {car.plateNumber} ({car.type})</option>
                  ))}
                </select>
                <p className="text-[10px] text-[#1A1A1A]/30">Only active cars (not motorbikes). Pulls the real name, class and plate from the fleet.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Monthly price (THB)</label>
                  <input
                    type="number"
                    value={formData.monthlyPrice}
                    onChange={(e) => set('monthlyPrice', parseInt(e.target.value) || 0)}
                    className="w-full bg-warm-bg border-b-2 border-[#1A1A1A]/5 py-3 px-1 font-bold text-sm focus:border-brand-orange outline-none transition-colors"
                    placeholder="e.g. 45000"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Minimum months</label>
                  <input
                    type="number"
                    min={1}
                    value={formData.minMonths}
                    onChange={(e) => set('minMonths', parseInt(e.target.value) || 1)}
                    className="w-full bg-warm-bg border-b-2 border-[#1A1A1A]/5 py-3 px-1 font-bold text-sm focus:border-brand-orange outline-none transition-colors"
                  />
                </div>
              </div>

              {formData.carType && (
                <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-amber-50 border border-amber-100">
                  <Info size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-amber-800 leading-relaxed">
                    {referenceLoading ? (
                      "Checking current short-term rate for this class..."
                    ) : reference ? (
                      <>
                        <strong>{formData.carType}</strong> is currently earning ~{reference.perDay.toLocaleString()}/day short-term
                        (live season rate)  that's <strong>~{(reference.perDay * 30).toLocaleString()}</strong> if this car did
                        short-term bookings for 30 days instead. Price the long-term rate against that, not below it.
                      </>
                    ) : (
                      "No live short-term rate available for this class right now  price manually."
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Notes (shown publicly)</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  rows={3}
                  className="w-full bg-warm-bg rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/30 resize-none"
                  placeholder="e.g. Available immediately. Free delivery and full insurance included."
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.published || false}
                    onChange={(e) => set('published', e.target.checked)}
                    className="w-4 h-4 accent-brand-orange"
                  />
                  <span className={cn("text-[11px] font-bold uppercase tracking-widest", formData.published ? "text-emerald-600" : "text-[#1A1A1A]/40")}>
                    {formData.published ? "Live on site" : "Not published"}
                  </span>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 bg-[#1A1A1A]/5 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-[#1A1A1A]/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={saveListing}
                  disabled={saving}
                  className="flex-1 bg-brand-orange text-white px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="animate-spin" size={14} /> : <Save size={14} />}
                  Save Listing
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
