import React from 'react';
import { motion } from 'motion/react';
import { MessageCircle, Phone, Smartphone, CheckCircle2, ShieldCheck, MapPin, Loader2 } from 'lucide-react';
import { useCompanyConfig } from '../hooks/useCompanyConfig';

const BikeRentalLanding: React.FC = () => {
  const { config, loading } = useCompanyConfig();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 className="animate-spin text-brand-orange" size={32} />
      </div>
    );
  }

  const contactMethods = [
    {
      name: 'WhatsApp',
      icon: <MessageCircle size={24} />,
      link: `https://wa.me/${config.whatsapp.replace(/\D/g, '')}`,
      description: 'Instant response & easy photo sharing',
      color: 'bg-[#25D366]',
      hoverColor: 'hover:bg-[#128C7E]'
    },
    {
      name: 'LINE App',
      icon: <Smartphone size={24} />,
      link: `https://line.me/ti/p/~${config.lineId}`,
      description: 'Connect via LINE official account',
      color: 'bg-[#06C755]',
      hoverColor: 'hover:bg-[#05a346]'
    },
    {
      name: 'Direct Call',
      icon: <Phone size={24} />,
      link: `tel:${config.phone.replace(/\D/g, '')}`,
      description: `${config.phone} (Direct Line)`,
      color: 'bg-brand-blue',
      hoverColor: 'hover:bg-blue-700'
    }
  ];

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-12 md:py-20">
      <div className="text-center mb-12">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-block px-4 py-1 bg-brand-orange/10 rounded-full mb-4"
        >
          <span className="text-brand-orange text-[10px] font-bold uppercase tracking-[0.2em]">Service Notice</span>
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="font-serif italic text-4xl md:text-5xl text-[#1A1A1A] mb-4"
        >
          Premium Bike Rentals in Pattaya
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex items-center justify-center gap-2 mb-8 text-brand-orange font-bold text-lg"
        >
          <Phone size={20} />
          <a href={`tel:${config.phone.replace(/\D/g, '')}`} className="hover:underline">{config.phone}</a>
        </motion.div>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-gray-500 max-w-xl mx-auto leading-relaxed"
        >
          Our automated booking system is undergoing maintenance. For the best rates and immediate availability, please contact our team directly below.
        </motion.p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {contactMethods.map((method, index) => (
          <motion.a
            key={method.name}
            href={method.link}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 + index * 0.1 }}
            className={`${method.color} ${method.hoverColor} p-8 rounded-[32px] text-white transition-all transform hover:-translate-y-2 hover:shadow-2xl flex flex-col items-center text-center group`}
          >
            <div className="bg-white/20 p-4 rounded-2xl mb-4 group-hover:scale-110 transition-transform">
              {method.icon}
            </div>
            <h3 className="text-xl font-bold mb-2 uppercase tracking-wider">{method.name}</h3>
            <p className="text-sm opacity-90 font-medium">{method.description}</p>
          </motion.a>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.7 }}
          className="bg-white border border-black/5 rounded-[40px] p-8 md:p-10 shadow-sm flex flex-col justify-between"
        >
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center shrink-0">
                <CheckCircle2 className="text-emerald-500" size={24} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Availability</p>
                <p className="text-sm font-bold text-[#1A1A1A]">Available 24/7</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-brand-orange/10 rounded-2xl flex items-center justify-center shrink-0">
                <MapPin className="text-brand-orange" size={24} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Location</p>
                <p className="text-sm font-bold text-[#1A1A1A]">{config.address}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center shrink-0">
                <ShieldCheck className="text-blue-500" size={24} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Inclusions</p>
                <p className="text-sm font-bold text-[#1A1A1A]">Helmets Included</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.8 }}
          className="rounded-[40px] overflow-hidden border border-black/5 shadow-sm h-[300px] md:h-auto min-h-[450px]"
        >
          <iframe 
            src={config.mapEmbedUrl} 
            width="100%" 
            height="100%" 
            style={{ border: 0 }} 
            allowFullScreen 
            loading="lazy" 
            referrerPolicy="no-referrer-when-downgrade"
            title={`${config.companyName} Location`}
            className="rounded-[40px] shadow-lg"
          ></iframe>
        </motion.div>
      </div>

      <div className="mt-12 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/30">
          Trusted by 10,000+ travelers in Pattaya since 2012
        </p>
      </div>
    </div>
  );
};

export default BikeRentalLanding;
