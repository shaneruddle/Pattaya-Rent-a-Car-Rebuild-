import React, { useState } from 'react';
import { useLanguage } from '../LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, HelpCircle } from 'lucide-react';

const FAQItem = ({ question, answer, isOpen, onClick }: { 
  question: string; 
  answer: string; 
  isOpen: boolean; 
  onClick: () => void;
}) => {
  return (
    <div className="border-b border-black/5 last:border-none">
      <button
        onClick={onClick}
        className="w-full py-6 flex items-center justify-between text-left group transition-all"
      >
        <span className={`text-sm font-bold uppercase tracking-widest transition-colors ${isOpen ? 'text-brand-orange' : 'text-black/60 group-hover:text-black'}`}>
          {question}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className={`p-2 rounded-full transition-colors ${isOpen ? 'bg-brand-orange/10 text-brand-orange' : 'bg-black/5 text-black/20'}`}
        >
          <ChevronDown size={16} />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-8 text-black/60 text-sm leading-relaxed font-medium">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const FAQ = () => {
  const { t } = useLanguage();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  // Get FAQ items from translations
  const faqItems = t('faq.items') as Array<{ q: string; a: string }>;

  if (!faqItems || !Array.isArray(faqItems)) return null;

  return (
    <section className="max-w-4xl mx-auto px-4 py-24" id="faq">
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-brand-orange/10 rounded-full text-brand-orange font-bold uppercase tracking-widest text-[10px] mb-6">
          <HelpCircle size={14} />
          {t('faq.title')}
        </div>
        <h2 className="text-4xl font-bold tracking-tight text-black mb-4">
          {t('faq.title')}
        </h2>
        <p className="text-black/40 font-medium max-w-lg mx-auto">
          {t('faq.subtitle')}
        </p>
      </div>

      <div className="glass-card rounded-[2.5rem] p-8 md:p-12">
        <div className="divide-y divide-black/5">
          {faqItems.map((item, index) => (
            <FAQItem
              key={index}
              question={item.q}
              answer={item.a}
              isOpen={openIndex === index}
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
            />
          ))}
        </div>
      </div>

      {/* Structured Data for SEO */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": faqItems.map(item => ({
            "@type": "Question",
            "name": item.q,
            "acceptedAnswer": {
              "@type": "Answer",
              "text": item.a
            }
          }))
        })}
      </script>
    </section>
  );
};
