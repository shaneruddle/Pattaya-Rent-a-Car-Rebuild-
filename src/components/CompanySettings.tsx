import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Building2, Phone, Mail, Clock, MapPin, Globe, Save, Loader2, MessageCircle, Smartphone } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';

interface CompanyConfig {
  companyName: string;
  phone: string;
  whatsapp: string;
  lineId: string;
  email: string;
  address: string;
  googlePlaceId: string;
  mapEmbedUrl: string;
  openingHours: {
    [key: string]: string;
  };
}

export const CompanySettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<CompanyConfig>({
    companyName: 'Your Company Name',
    phone: '+66 00 000 0000',
    whatsapp: '+66 00 000 0000',
    lineId: 'company_line_id',
    email: 'info@example.com',
    address: 'Your Physical Address',
    googlePlaceId: '',
    mapEmbedUrl: '',
    openingHours: {
      'Monday': '09:00 - 18:00',
      'Tuesday': '09:00 - 18:00',
      'Wednesday': '09:00 - 18:00',
      'Thursday': '09:00 - 18:00',
      'Friday': '09:00 - 18:00',
      'Saturday': '09:00 - 18:00',
      'Sunday': '09:00 - 18:00'
    }
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const docRef = doc(db, 'app_settings', 'company');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setConfig(docSnap.data() as CompanyConfig);
        }
      } catch (error) {
        console.error('Error fetching company config:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'app_settings', 'company'), config);
      toast.success('Company settings updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'app_settings/company');
      toast.error('Failed to update company settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-brand-orange" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-[#1A1A1A]">Company Profile</h2>
          <p className="text-black/40 text-sm mt-1">Centralized information used across the entire application.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#1A1A1A] text-white px-8 py-4 rounded-full font-bold uppercase tracking-[0.2em] text-[10px] hover:bg-brand-orange transition-all shadow-xl shadow-black/10 flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Profile
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Basic Information */}
        <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[32px] p-8 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="text-brand-orange" size={20} />
            <h3 className="text-lg font-bold tracking-tight">Basic Information</h3>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 ml-4">Company Name</label>
              <input
                type="text"
                value={config.companyName}
                onChange={e => setConfig({ ...config, companyName: e.target.value })}
                className="w-full bg-white border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 ml-4">Physical Address</label>
              <textarea
                value={config.address}
                onChange={e => setConfig({ ...config, address: e.target.value })}
                rows={2}
                className="w-full bg-white border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm resize-none"
              />
            </div>
          </div>
        </section>

        {/* Contact Details */}
        <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[32px] p-8 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <Globe className="text-brand-orange" size={20} />
            <h3 className="text-lg font-bold tracking-tight">Contact Details</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 ml-4 flex items-center gap-1">
                <Phone size={10} /> Phone
              </label>
              <input
                type="text"
                value={config.phone}
                onChange={e => setConfig({ ...config, phone: e.target.value })}
                className="w-full bg-white border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 ml-4 flex items-center gap-1">
                <MessageCircle size={10} /> WhatsApp
              </label>
              <input
                type="text"
                value={config.whatsapp}
                onChange={e => setConfig({ ...config, whatsapp: e.target.value })}
                className="w-full bg-white border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 ml-4 flex items-center gap-1">
                <Smartphone size={10} /> LINE ID
              </label>
              <input
                type="text"
                value={config.lineId}
                onChange={e => setConfig({ ...config, lineId: e.target.value })}
                className="w-full bg-white border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 ml-4 flex items-center gap-1">
                <Mail size={10} /> Email
              </label>
              <input
                type="email"
                value={config.email}
                onChange={e => setConfig({ ...config, email: e.target.value })}
                className="w-full bg-white border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm"
              />
            </div>
          </div>
        </section>

        {/* Location & Map */}
        <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[32px] p-8 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <MapPin className="text-brand-orange" size={20} />
            <h3 className="text-lg font-bold tracking-tight">Location & Map</h3>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 ml-4">Google Place ID</label>
              <input
                type="text"
                value={config.googlePlaceId}
                onChange={e => setConfig({ ...config, googlePlaceId: e.target.value })}
                className="w-full bg-white border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-black/30 ml-4">HTML Map Embed Code (src URL only)</label>
              <textarea
                value={config.mapEmbedUrl}
                onChange={e => setConfig({ ...config, mapEmbedUrl: e.target.value })}
                rows={3}
                placeholder="https://www.google.com/maps/embed?pb=..."
                className="w-full bg-white border-0 p-4 rounded-2xl text-xs font-mono focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm resize-none"
              />
            </div>
          </div>
        </section>

        {/* Opening Hours */}
        <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[32px] p-8 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="text-brand-orange" size={20} />
            <h3 className="text-lg font-bold tracking-tight">Opening Hours</h3>
          </div>
          
          <div className="space-y-2">
            {Object.keys(config.openingHours).map(day => (
              <div key={day} className="flex items-center gap-4">
                <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-black/30">{day}</span>
                <input
                  type="text"
                  value={config.openingHours[day]}
                  onChange={e => setConfig({
                    ...config,
                    openingHours: { ...config.openingHours, [day]: e.target.value }
                  })}
                  className="flex-1 bg-white border-0 p-3 rounded-xl text-xs font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm"
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
