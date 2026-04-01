import React, { useState } from 'react';
import { motion } from 'motion/react';
import { MapPin, Phone, Mail, Clock, CheckCircle2, ShieldCheck, Car as CarIcon, MessageSquare, Send, Loader2, ChevronDown } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { useBusinessInfo } from '../hooks/useBusinessInfo';
import { useLanguage } from '../LanguageContext';

export const AboutUs: React.FC = () => {
  const { t } = useLanguage();
  return (
    <div className="bg-warm-bg min-h-screen pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-24"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-black/30 mb-6 block">{t('about.established')}</span>
          <h1 className="text-6xl md:text-8xl font-bold tracking-tighter text-black leading-[0.9] mb-12">
            {t('about.title').split(' ').map((word, i) => i === 3 ? <React.Fragment key={i}><br />{word} </React.Fragment> : word + ' ')}
          </h1>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-start">
            <p className="text-xl text-black/60 leading-relaxed font-medium">
              {t('about.p1')}
            </p>
            <p className="text-xl text-black/60 leading-relaxed font-medium">
              {t('about.p2')}
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-32">
          {[
            {
              title: t('about.qualityFleet'),
              description: t('about.qualityFleetDesc'),
              icon: <CarIcon className="w-8 h-8" />
            },
            {
              title: t('about.fullInsurance'),
              description: t('about.fullInsuranceDesc'),
              icon: <ShieldCheck className="w-8 h-8" />
            },
            {
              title: t('about.support247'),
              description: t('about.support247Desc'),
              icon: <Clock className="w-8 h-8" />
            }
          ].map((item, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-10 bg-white/40 backdrop-blur-xl border border-white/40 shadow-2xl shadow-black/5 rounded-3xl"
            >
              <div className="mb-8 text-brand-orange">{item.icon}</div>
              <h3 className="text-2xl font-bold tracking-tight mb-4">{item.title}</h3>
              <p className="text-black/50 leading-relaxed font-medium">{item.description}</p>
            </motion.div>
          ))}
        </div>

        <div className="relative h-[700px] rounded-[40px] overflow-hidden group shadow-2xl shadow-black/10">
          <img 
            src="https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&q=80&w=2000" 
            alt="Pattaya Landscape" 
            className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-end p-16">
            <div className="max-w-2xl">
              <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-6">{t('about.experienceTitle')}</h2>
              <p className="text-white/70 text-xl leading-relaxed font-medium">{t('about.experienceDesc')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ContactUs: React.FC = () => {
  const { info } = useBusinessInfo();
  const { t } = useLanguage();
  return (
    <div className="bg-warm-bg min-h-screen pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-24"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-black/30 mb-6 block">{t('contact.subtitle')}</span>
          <h1 className="text-6xl md:text-8xl font-bold tracking-tighter text-black leading-[0.9]">
            {t('contact.title')}
          </h1>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-24">
          <div className="space-y-12">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-3xl shadow-xl shadow-black/5">
                <div className="w-12 h-12 bg-brand-orange/10 text-brand-orange rounded-2xl flex items-center justify-center mb-6">
                  <MapPin size={24} />
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-3">{t('contact.location')}</h3>
                <p className="text-black/50 leading-relaxed font-medium text-sm">
                  {info?.formatted_address || 'Pattaya Second Road, Pattaya City, Chonburi 20150, Thailand'}
                </p>
              </div>

              <div className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-3xl shadow-xl shadow-black/5">
                <div className="w-12 h-12 bg-brand-orange/10 text-brand-orange rounded-2xl flex items-center justify-center mb-6">
                  <Phone size={24} />
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-3">{t('contact.phone')}</h3>
                <p className="text-black/50 leading-relaxed font-medium text-sm">
                  {info?.international_phone_number || '+66 (0) 81 123 4567'}
                </p>
              </div>

              <div className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-3xl shadow-xl shadow-black/5 min-w-0">
                <div className="w-12 h-12 bg-brand-orange/10 text-brand-orange rounded-2xl flex items-center justify-center mb-6">
                  <Mail size={24} />
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-3">{t('contact.email')}</h3>
                <p className="text-black/50 leading-relaxed font-medium text-sm break-all">
                  info@pattayarentacar.com
                </p>
              </div>

              <div className="p-8 bg-white/40 backdrop-blur-xl border border-white/40 rounded-3xl shadow-xl shadow-black/5">
                <div className="w-12 h-12 bg-brand-orange/10 text-brand-orange rounded-2xl flex items-center justify-center mb-6">
                  <Clock size={24} />
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-3">{t('contact.openingHours')}</h3>
                <div className="text-black/50 leading-relaxed font-medium text-xs space-y-1">
                  {info?.opening_hours?.weekday_text.slice(0, 3).map((day, idx) => (
                    <p key={idx}>{day}</p>
                  ))}
                  <p>...</p>
                </div>
              </div>
            </div>

            <div className="h-[450px] bg-white/40 backdrop-blur-xl border border-white/40 rounded-[40px] shadow-2xl shadow-black/5 overflow-hidden">
              <iframe 
                src={`https://www.google.com/maps?q=${encodeURIComponent(info?.formatted_address || 'Pattaya Rent a Car')}&output=embed`}
                width="100%" 
                height="100%" 
                style={{ border: 0 }} 
                allowFullScreen 
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              ></iframe>
            </div>
          </div>

          <div className="bg-white/60 backdrop-blur-2xl p-12 rounded-[40px] border border-white/60 shadow-2xl shadow-black/5">
            <h3 className="text-3xl font-bold tracking-tight mb-10">{t('contact.sendMessage')}</h3>
            <form className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/30 font-bold">{t('contact.firstName')}</label>
                  <input type="text" className="w-full bg-black/5 border-none rounded-2xl p-5 outline-none focus:bg-black/10 transition-all font-medium" />
                </div>
                <div className="space-y-3">
                  <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/30 font-bold">{t('contact.lastName')}</label>
                  <input type="text" className="w-full bg-black/5 border-none rounded-2xl p-5 outline-none focus:bg-black/10 transition-all font-medium" />
                </div>
              </div>
              <div className="space-y-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/30 font-bold">{t('contact.emailAddress')}</label>
                <input type="email" className="w-full bg-black/5 border-none rounded-2xl p-5 outline-none focus:bg-black/10 transition-all font-medium" />
              </div>
              <div className="space-y-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/30 font-bold">{t('contact.message')}</label>
                <textarea rows={6} className="w-full bg-black/5 border-none rounded-2xl p-5 outline-none focus:bg-black/10 transition-all font-medium resize-none"></textarea>
              </div>
              <button className="w-full bg-brand-orange text-white py-6 rounded-2xl font-bold uppercase tracking-[0.3em] text-xs hover:opacity-90 transition-all flex items-center justify-center gap-4 shadow-xl shadow-brand-orange/20">
                {t('contact.sendButton')} <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export const LongTermHire: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    duration: '3-months',
    carType: 'any',
    message: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'enquiries'), {
        ...formData,
        type: 'long-term',
        createdAt: new Date().toISOString(),
        status: 'new'
      });
      setIsSuccess(true);
      toast.success(t('longTerm.successTitle'));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'enquiries');
      toast.error(t('enquiry.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-warm-bg min-h-screen pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center mb-32">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-black/30 mb-6 block">{t('longTerm.specialRates')}</span>
            <h1 className="text-6xl md:text-8xl font-bold tracking-tighter text-black leading-[0.9] mb-12">
              {t('longTerm.title').split(' ').map((word, i) => i === 2 ? <React.Fragment key={i}><br />{word} </React.Fragment> : word + ' ')}
            </h1>
            <p className="text-xl text-black/60 leading-relaxed font-medium mb-16">
              {t('longTerm.description')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                t('longTerm.benefit1'),
                t('longTerm.benefit2'),
                t('longTerm.benefit3'),
                t('longTerm.benefit4'),
                t('longTerm.benefit5'),
                t('longTerm.benefit6')
              ].map((benefit, i) => (
                <div key={i} className="flex items-center gap-4 p-4 bg-white/40 backdrop-blur-xl border border-white/40 rounded-2xl shadow-sm">
                  <CheckCircle2 className="text-brand-orange w-5 h-5 shrink-0" />
                  <span className="text-sm font-bold text-black/70 tracking-tight">{benefit}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <div className="relative">
            <div className="absolute -inset-6 bg-brand-orange/5 rounded-[50px] -z-10 blur-3xl"></div>
            <img 
              src="https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&q=80&w=1000" 
              alt="Luxury Car" 
              className="w-full h-[700px] object-cover rounded-[50px] shadow-2xl shadow-black/20"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>

        <div className="bg-black rounded-[60px] text-white p-12 md:p-24 overflow-hidden relative shadow-2xl shadow-black/40">
          <div className="absolute top-0 right-0 w-96 h-96 bg-brand-orange/20 blur-[120px] -mr-48 -mt-48"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-brand-orange/10 blur-[120px] -ml-48 -mb-48"></div>
          
          <div className="max-w-3xl mx-auto text-center mb-20 relative z-10">
            <h2 className="text-4xl md:text-6xl font-bold tracking-tighter mb-8 leading-none">{t('longTerm.quoteTitle')}</h2>
            <p className="text-white/50 text-xl font-medium">{t('longTerm.quoteSubtitle')}</p>
          </div>

          {isSuccess ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-xl mx-auto text-center py-20 relative z-10"
            >
              <div className="w-24 h-24 bg-brand-orange/20 text-brand-orange rounded-full flex items-center justify-center mx-auto mb-10">
                <CheckCircle2 size={48} />
              </div>
              <h3 className="text-4xl font-bold tracking-tight mb-6">{t('longTerm.successTitle')}</h3>
              <p className="text-white/50 text-lg font-medium mb-12">{t('longTerm.successDesc')}</p>
              <button 
                onClick={() => setIsSuccess(false)}
                className="bg-white text-black px-12 py-6 rounded-2xl font-bold uppercase tracking-[0.3em] text-xs hover:opacity-90 transition-all shadow-xl shadow-white/10"
              >
                {t('longTerm.sendAnother')}
              </button>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 relative z-10">
              <div className="space-y-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">{t('longTerm.fullName')}</label>
                <input 
                  required
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-white/5 border-none rounded-2xl p-6 outline-none focus:bg-white/10 transition-all font-medium text-white" 
                />
              </div>
              <div className="space-y-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">{t('longTerm.emailAddress')}</label>
                <input 
                  required
                  type="email" 
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="w-full bg-white/5 border-none rounded-2xl p-6 outline-none focus:bg-white/10 transition-all font-medium text-white" 
                />
              </div>
              <div className="space-y-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">{t('longTerm.phoneNumber')}</label>
                <input 
                  required
                  type="tel" 
                  value={formData.phone}
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                  className="w-full bg-white/5 border-none rounded-2xl p-6 outline-none focus:bg-white/10 transition-all font-medium text-white" 
                />
              </div>
              <div className="space-y-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">{t('longTerm.duration')}</label>
                <div className="relative">
                  <select 
                    value={formData.duration}
                    onChange={e => setFormData({...formData, duration: e.target.value})}
                    className="w-full bg-white/5 border-none rounded-2xl p-6 outline-none focus:bg-white/10 transition-all font-medium text-white appearance-none cursor-pointer"
                  >
                    <option value="1-month" className="bg-black">{t('longTerm.durations.m1')}</option>
                    <option value="3-months" className="bg-black">{t('longTerm.durations.m3')}</option>
                    <option value="6-months" className="bg-black">{t('longTerm.durations.m6')}</option>
                    <option value="1-year" className="bg-black">{t('longTerm.durations.y1')}</option>
                  </select>
                  <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none" size={20} />
                </div>
              </div>
              <div className="md:col-span-2 space-y-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">{t('longTerm.carType')}</label>
                <div className="relative">
                  <select 
                    value={formData.carType}
                    onChange={e => setFormData({...formData, carType: e.target.value})}
                    className="w-full bg-white/5 border-none rounded-2xl p-6 outline-none focus:bg-white/10 transition-all font-medium text-white appearance-none cursor-pointer"
                  >
                    <option value="any" className="bg-black">{t('longTerm.carTypes.any')}</option>
                    <option value="economy" className="bg-black">{t('longTerm.carTypes.economy')}</option>
                    <option value="saloon" className="bg-black">{t('longTerm.carTypes.saloon')}</option>
                    <option value="suv" className="bg-black">{t('longTerm.carTypes.suv')}</option>
                    <option value="luxury" className="bg-black">{t('longTerm.carTypes.luxury')}</option>
                  </select>
                  <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none" size={20} />
                </div>
              </div>
              <div className="md:col-span-2 space-y-3">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">{t('longTerm.requirements')}</label>
                <textarea 
                  rows={4} 
                  value={formData.message}
                  onChange={e => setFormData({...formData, message: e.target.value})}
                  className="w-full bg-white/5 border-none rounded-2xl p-6 outline-none focus:bg-white/10 transition-all font-medium text-white resize-none"
                ></textarea>
              </div>
              <div className="md:col-span-2 pt-6">
                <button 
                  disabled={isSubmitting}
                  className="w-full bg-brand-orange text-white py-8 rounded-2xl font-bold uppercase tracking-[0.3em] text-xs hover:opacity-90 transition-all flex items-center justify-center gap-4 disabled:opacity-50 shadow-2xl shadow-brand-orange/20"
                >
                  {isSubmitting ? <Loader2 className="animate-spin" /> : t('longTerm.requestQuote')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
