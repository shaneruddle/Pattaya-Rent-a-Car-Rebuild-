import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  CheckCircle2, 
  AlertCircle, 
  CreditCard, 
  Car, 
  Flame, 
  Scale, 
  Banknote, 
  Smartphone,
  ShieldCheck,
  FileText
} from 'lucide-react';
import { cn } from '../lib/utils';

interface ImportantInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBikeMode?: boolean;
}

export const ImportantInfoModal: React.FC<ImportantInfoModalProps> = ({ isOpen, onClose, isBikeMode }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="p-8 border-b border-black/5 flex items-center justify-between bg-warm-bg/50">
              <h2 className="text-3xl font-bold tracking-tight">Important Info</h2>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-black/5 rounded-full transition-colors text-black/40 hover:text-black"
              >
                <X size={24} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
              
              {/* Driver & Licence */}
              <section className="space-y-4">
                <h3 className="text-xl font-bold border-b-2 border-black/5 pb-2">Driver & Licence requirements</h3>
                <p className="text-sm text-black/60">When you receive the vehicle, you'll need:</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <CheckCircle2 size={20} className="text-green-500" />
                    <span>Passport or national ID card</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <CheckCircle2 size={20} className="text-green-500" />
                    <span>Driving Licence</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-brand-blue cursor-pointer hover:underline text-xs font-bold uppercase tracking-wider">
                    <AlertCircle size={14} />
                    More information about driving licences
                  </div>
                </div>
              </section>

              {/* Security Deposit */}
              <section className="space-y-4">
                <h3 className="text-xl font-bold border-b-2 border-black/5 pb-2">Security Deposit - THB 5000</h3>
                <div className="flex gap-4">
                  <div className="mt-1">
                    <CreditCard size={24} className={cn(isBikeMode ? "text-brand-blue" : "text-brand-orange")} />
                  </div>
                  <p className="text-sm text-black/60 leading-relaxed">
                    When you receive the vehicle the main driver will need to leave a refundable security deposit of THB 5,000.00 . Cash, credit card or bank transfer is accepted 
                  </p>
                </div>
              </section>

              {/* Damage Excess */}
              <section className="space-y-4">
                <h3 className="text-xl font-bold border-b-2 border-black/5 pb-2">Damage Excess - THB 5000</h3>
                <div className="flex gap-4">
                  <div className="mt-1 text-green-500">
                    <Car size={24} />
                  </div>
                  <p className="text-sm text-black/60 leading-relaxed">
                    If the car's bodywork gets damaged, the most you'll pay towards repairs is THB 5000. This cover is only valid if you stick to the terms of the rental agreement. It doesn't cover other parts of the car (e.g. windows, wheels, interior or undercarriage), or charges (e.g. for towing or off-road time), or anything in the car (e.g. child seats, GPS devices or personal belongings).
                  </p>
                </div>
              </section>

              {/* Rates Exclude */}
              <section className="space-y-4">
                <h3 className="text-xl font-bold border-b-2 border-black/5 pb-2">Rates Exclude</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Flame size={20} className="text-orange-500" />
                    <span className="text-sm font-medium">Gasoline</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <FileText size={20} className="text-blue-500" />
                    <span className="text-sm font-medium">Speeding and Parking Fines</span>
                  </div>
                </div>
              </section>

              {/* First Class Insurance */}
              <section className="space-y-4">
                <h3 className="text-xl font-bold border-b-2 border-black/5 pb-2">First Class Insurance</h3>
                <div className="flex gap-4 mb-6">
                  <div className="mt-1 text-green-500">
                    <ShieldCheck size={24} />
                  </div>
                  <p className="text-sm text-black/60 leading-relaxed">
                    All rental rates include first class vehicle insurance and third party liability, including property cover, and vehicle theft. Please note that an excess applies to all rentals. If a customer is involved in an accident and expenses can not be be recovered from a third party they will need to pay a 5,000 baht excess per incident
                  </p>
                </div>
                <div className="p-4 bg-black/5 rounded-2xl text-xs text-black/60 italic leading-relaxed">
                  All our vehicles have fully comprehensive rental insurance with Thailand´s leading insurance company, Viriyah Insurance. Insurance is compulsory and included in our rental rates
                </div>
              </section>

              {/* Other Remarks */}
              <section className="space-y-6 pb-4">
                <h3 className="text-xl font-bold border-b-2 border-black/5 pb-2">Other Remarks</h3>
                <div className="space-y-5">
                  <div className="flex gap-4">
                    <Banknote size={20} className="text-green-500 shrink-0" />
                    <p className="text-sm text-black/60">Reservation deposit of THB 2000 maybe requested over busy holiday periods like Xmas and New Year (non-refundable)</p>
                  </div>
                  <div className="flex gap-4">
                    <Car size={20} className="text-gray-400 shrink-0" />
                    <p className="text-sm text-black/60">All vehicles are subject to availability (advance booking is strongly recommended)</p>
                  </div>
                  <div className="flex gap-4">
                    <Smartphone size={20} className="text-blue-400 shrink-0" />
                    <p className="text-sm text-black/60">Extension of rental period shall be approved by given 7 days notice in advance (subject to availability)</p>
                  </div>
                </div>
              </section>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-black/5 text-center">
              <button 
                onClick={onClose}
                className={cn(
                  "px-8 py-3 rounded-full text-white font-bold uppercase tracking-widest text-[10px] shadow-lg",
                  isBikeMode ? "bg-brand-blue" : "bg-brand-orange"
                )}
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
