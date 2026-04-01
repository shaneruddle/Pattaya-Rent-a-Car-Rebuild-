import React, { useState, useEffect } from 'react';
import { ShieldCheck, Clock, MapPin, CheckCircle2, Star, Send, Phone, Mail, Facebook, Youtube, Linkedin, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { toast } from 'sonner';
import { useBusinessInfo } from '../hooks/useBusinessInfo';
import { useLanguage } from '../LanguageContext';

export const WhyChooseUs: React.FC = () => {
  const { t } = useLanguage();
  const features = [
    {
      icon: <ShieldCheck size={32} />,
      title: t('whyChoose.insurance'),
      description: t('whyChoose.insuranceDesc')
    },
    {
      icon: <MapPin size={32} />,
      title: t('whyChoose.delivery'),
      description: t('whyChoose.deliveryDesc')
    },
    {
      icon: <Clock size={32} />,
      title: t('whyChoose.support'),
      description: t('whyChoose.supportDesc')
    },
    {
      icon: <CheckCircle2 size={32} />,
      title: t('whyChoose.noFees'),
      description: t('whyChoose.noFeesDesc')
    }
  ];

  return (
    <section className="py-32 bg-warm-bg relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-orange/5 blur-[100px] -z-10"></div>
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-20">
          <h2 className="text-5xl md:text-6xl font-bold tracking-tighter mb-6">{t('whyChoose.title')}</h2>
          <p className="text-black/30 uppercase tracking-[0.3em] text-[10px] font-bold">{t('whyChoose.subtitle')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-10 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[32px] shadow-xl shadow-black/5 hover:translate-y-[-8px] transition-all duration-500 group"
            >
              <div className="mb-8 text-brand-orange group-hover:scale-110 transition-transform duration-500">{f.icon}</div>
              <h3 className="font-bold text-xl mb-4 tracking-tight">{f.title}</h3>
              <p className="text-black/50 text-sm leading-relaxed font-medium">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export const GoogleReviews: React.FC = () => {
  const { t } = useLanguage();
  const { info, loading } = useBusinessInfo();
  const rating = info?.rating || 4.9;
  const totalReviews = info?.user_ratings_total || 500;
  const reviews = info?.reviews || [
    {
      author_name: "James Wilson",
      relative_time_description: "2 weeks ago",
      text: "Excellent service from start to finish. The car was clean and in great condition. Delivery to my hotel was exactly on time. Highly recommend!",
      rating: 5
    },
    {
      author_name: "Sarah Chen",
      relative_time_description: "1 month ago",
      text: "Best car rental in Pattaya. Very professional staff and the prices are very competitive. The insurance coverage gave me peace of mind.",
      rating: 5
    },
    {
      author_name: "Michael Schmidt",
      relative_time_description: "3 months ago",
      text: "I've used Pattaya Rent a Car multiple times now. Always reliable, no hidden costs, and the cars are always well-maintained. 5 stars!",
      rating: 5
    }
  ];

  return (
    <section className="py-32 bg-warm-bg relative overflow-hidden">
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-brand-orange/5 blur-[100px] -z-10"></div>
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row justify-between items-end mb-20 gap-12">
          <div className="max-w-2xl">
            <h2 className="text-5xl md:text-6xl font-bold tracking-tighter mb-6">{t('reviews.title')}</h2>
            <p className="text-black/30 uppercase tracking-[0.3em] text-[10px] font-bold">{t('reviews.subtitle')}</p>
          </div>
          <div className="flex items-center gap-6 bg-white/60 backdrop-blur-2xl border border-white/60 p-8 rounded-[32px] shadow-2xl shadow-black/5">
            <div className="text-5xl font-bold tracking-tighter text-brand-orange">{rating}</div>
            <div>
              <div className="flex text-brand-orange mb-2">
                {[...Array(5)].map((_, i) => (
                  <Star 
                    key={i} 
                    size={20} 
                    fill={i < Math.round(rating) ? "currentColor" : "none"} 
                    className={i < Math.round(rating) ? "" : "text-black/10"}
                  />
                ))}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/30">{t('reviews.basedOn', { count: totalReviews })}</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {loading ? (
            <div className="col-span-3 flex justify-center py-20">
              <Loader2 className="animate-spin text-brand-orange" size={48} />
            </div>
          ) : (
            reviews.slice(0, 3).map((r, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                className="bg-white/40 backdrop-blur-xl p-10 border border-white/40 rounded-[40px] shadow-xl shadow-black/5 flex flex-col h-full hover:bg-white/60 transition-colors duration-500"
              >
                <div className="flex text-brand-orange mb-6">
                  {[...Array(5)].map((_, i) => (
                    <Star 
                      key={i} 
                      size={16} 
                      fill={i < r.rating ? "currentColor" : "none"} 
                      className={i < r.rating ? "" : "text-black/10"}
                    />
                  ))}
                </div>
                <p className="text-black/70 text-lg font-medium italic mb-10 leading-relaxed flex-grow">
                  "{r.text.length > 180 ? r.text.substring(0, 180) + '...' : r.text}"
                </p>
                <div className="flex justify-between items-center pt-8 border-t border-black/5">
                  <span className="font-bold text-[10px] uppercase tracking-[0.2em] text-black/40">{r.author_name}</span>
                  <span className="text-[10px] text-black/20 uppercase tracking-widest font-bold">{r.relative_time_description}</span>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};

export const EnquiryForm: React.FC = () => {
  const { info } = useBusinessInfo();
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'enquiries'), {
        ...formData,
        timestamp: new Date().toISOString(),
        to: 'info@pattayarentacar.com'
      });

      await addDoc(collection(db, 'mail'), {
        to: 'info@pattayarentacar.com',
        message: {
          subject: `New Website Enquiry from ${formData.name}`,
          html: `
            <h3>New Website Enquiry</h3>
            <p><strong>Name:</strong> ${formData.name}</p>
            <p><strong>Email:</strong> ${formData.email}</p>
            <p><strong>Phone:</strong> ${formData.phone}</p>
            <p><strong>Message:</strong></p>
            <p>${formData.message.replace(/\n/g, '<br>')}</p>
          `,
        },
      });

      toast.success(t('enquiry.success'));
      setFormData({ name: '', email: '', phone: '', message: '' });
    } catch (error) {
      console.error('Error sending enquiry:', error);
      toast.error(t('enquiry.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="enquiry" className="py-32 bg-warm-bg relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-orange/5 blur-[150px] -z-10"></div>
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
          <div>
            <h2 className="text-6xl md:text-7xl font-bold tracking-tighter mb-8 leading-[0.9]">{t('enquiry.title')}</h2>
            <p className="text-black/50 text-xl mb-12 leading-relaxed font-medium">
              {t('enquiry.subtitle')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              <div className="flex items-center gap-6 p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-3xl shadow-sm">
                <div className="w-14 h-14 bg-brand-orange/10 text-brand-orange rounded-2xl flex items-center justify-center shrink-0">
                  <Phone size={24} />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 mb-1">{t('enquiry.callUs')}</div>
                  <div className="font-bold tracking-tight">{info?.international_phone_number || '+66 (0) 81 123 4567'}</div>
                </div>
              </div>
              <div className="flex items-center gap-6 p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-3xl shadow-sm min-w-0">
                <div className="w-14 h-14 bg-brand-orange/10 text-brand-orange rounded-2xl flex items-center justify-center shrink-0">
                  <Mail size={24} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 mb-1">{t('enquiry.emailUs')}</div>
                  <div className="font-bold tracking-tight break-all">info@pattayarentacar.com</div>
                </div>
              </div>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="bg-white/60 backdrop-blur-2xl p-12 rounded-[40px] border border-white/60 shadow-2xl shadow-black/5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 font-bold">{t('enquiry.fullName')}</label>
                <input
                  required
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-black/5 border-none rounded-2xl p-5 outline-none focus:bg-black/10 transition-all font-medium"
                />
              </div>
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 font-bold">{t('enquiry.emailAddress')}</label>
                <input
                  required
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-black/5 border-none rounded-2xl p-5 outline-none focus:bg-black/10 transition-all font-medium"
                />
              </div>
            </div>
            <div className="mb-8 space-y-3">
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 font-bold">{t('enquiry.phoneNumber')}</label>
              <input
                required
                type="tel"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="w-full bg-black/5 border-none rounded-2xl p-5 outline-none focus:bg-black/10 transition-all font-medium"
              />
            </div>
            <div className="mb-10 space-y-3">
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 font-bold">{t('enquiry.message')}</label>
              <textarea
                required
                rows={4}
                value={formData.message}
                onChange={e => setFormData({ ...formData, message: e.target.value })}
                className="w-full bg-black/5 border-none rounded-2xl p-5 outline-none focus:bg-black/10 transition-all font-medium resize-none"
              />
            </div>
            <button
              disabled={isSubmitting}
              type="submit"
              className="w-full bg-brand-orange text-white py-6 rounded-2xl font-bold uppercase tracking-[0.3em] text-xs flex items-center justify-center gap-4 hover:opacity-90 transition-all disabled:opacity-50 shadow-xl shadow-brand-orange/20"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
              {t('enquiry.submit')}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
};

export const Footer: React.FC<{ onPageChange?: (view: string) => void }> = ({ onPageChange }) => {
  const { info } = useBusinessInfo();
  const { t } = useLanguage();
  return (
    <footer className="bg-black text-white pt-32 pb-16 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brand-orange/20 to-transparent"></div>
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-20 mb-32">
          <div className="space-y-10">
            <img
              src="https://7f8bfb441a72f33e442dece0180dba1f.cdn.bubble.io/cdn-cgi/image/w=192,h=70,f=auto,dpr=2,fit=contain/f1630376828262x344914557261106300/PRAC-Logo-1.png"
              alt="PRAC Logo"
              className="w-44 brightness-0 invert cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => onPageChange?.('landing')}
              referrerPolicy="no-referrer"
            />
            <p className="text-white/40 text-sm leading-relaxed font-medium">
              {t('footer.description')}
            </p>
            <div className="flex gap-4">
              {[
                { icon: <Facebook size={20} />, href: "https://www.facebook.com/PattayaRentaCar/" },
                { icon: <Youtube size={20} />, href: "https://www.youtube.com/@Pattayarentacar" },
                { icon: <Linkedin size={20} />, href: "https://linkedin.com/company/pattaya-rent-a-car/" },
                { icon: <MapPin size={20} />, href: "https://maps.app.goo.gl/MdmFFiF7u9FgbByj8" }
              ].map((social, i) => (
                <a 
                  key={i} 
                  href={social.href} 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center hover:bg-brand-orange hover:text-white transition-all duration-500"
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>
          
          <div>
            <h4 className="text-xs font-bold uppercase tracking-[0.3em] text-white/20 mb-10">{t('footer.quickLinks')}</h4>
            <ul className="space-y-5 text-sm font-bold tracking-tight text-white/40">
              <li><button onClick={() => onPageChange?.('landing')} className="hover:text-brand-orange transition-colors">{t('nav.fleet')}</button></li>
              <li><button onClick={() => onPageChange?.('long-term')} className="hover:text-brand-orange transition-colors">{t('nav.longTerm')}</button></li>
              <li><button onClick={() => {
                onPageChange?.('landing');
                setTimeout(() => {
                  document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' });
                }, 100);
              }} className="hover:text-brand-orange transition-colors">{t('nav.faq')}</button></li>
              <li><button onClick={() => onPageChange?.('about')} className="hover:text-brand-orange transition-colors">{t('nav.about')}</button></li>
              <li><button onClick={() => onPageChange?.('contact')} className="hover:text-brand-orange transition-colors">{t('nav.contact')}</button></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-[0.3em] text-white/20 mb-10">{t('footer.contactUs')}</h4>
            <ul className="space-y-8 text-sm font-medium text-white/40">
              <li className="flex gap-5">
                <MapPin size={20} className="shrink-0 text-brand-orange" />
                <span className="leading-relaxed">{info?.formatted_address || 'Pattaya Second Road, Pattaya City, Chonburi 20150, Thailand'}</span>
              </li>
              <li className="flex gap-5">
                <Phone size={20} className="shrink-0 text-brand-orange" />
                <span className="font-bold tracking-tight">{info?.international_phone_number || '+66 (0) 81 123 4567'}</span>
              </li>
              <li className="flex gap-5 min-w-0">
                <Mail size={20} className="shrink-0 text-brand-orange" />
                <span className="font-bold tracking-tight break-all">info@pattayarentacar.com</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-[0.3em] text-white/20 mb-10">{t('footer.newsletter')}</h4>
            <p className="text-white/40 text-sm mb-8 font-medium leading-relaxed">{t('footer.newsletterDesc')}</p>
            <div className="flex gap-3">
              <input
                type="email"
                placeholder={t('footer.emailPlaceholder')}
                className="bg-white/5 border-none rounded-2xl p-5 text-sm outline-none focus:bg-white/10 transition-all flex-1 font-medium"
              />
              <button className="bg-brand-orange text-white px-6 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20">
                {t('footer.join')}
              </button>
            </div>
          </div>
        </div>
        
        <div className="pt-16 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-8 text-[10px] font-bold uppercase tracking-[0.3em] text-white/20">
          <p>{t('footer.rights')}</p>
          <div className="flex gap-10">
            <a href="#" className="hover:text-white transition-colors">{t('footer.privacy')}</a>
            <a href="#" className="hover:text-white transition-colors">{t('footer.terms')}</a>
            <a href="#" className="hover:text-white transition-colors">{t('footer.cookies')}</a>
          </div>
        </div>
      </div>
    </footer>
  );
};
