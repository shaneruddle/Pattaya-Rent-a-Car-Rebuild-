import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '../LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, HelpCircle, Search, X, MessageCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

interface FAQData {
  q: string;
  a: string;
  category?: string;
  order?: number;
}

const FAQItem = ({ question, answer, isOpen, onClick, isBikeMode, searchTerm }: { 
  question: string; 
  answer: string; 
  isOpen: boolean; 
  onClick: () => void;
  isBikeMode?: boolean;
  searchTerm?: string;
}) => {
  const highlightText = (text: string, highlight: string) => {
    if (!highlight.trim()) return text;
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return (
      <span>
        {parts.map((part, i) => 
          part.toLowerCase() === highlight.toLowerCase() ? (
            <mark key={i} className="bg-brand-orange/20 text-brand-orange rounded-sm px-0.5">{part}</mark>
          ) : part
        )}
      </span>
    );
  };

  return (
    <div className="border-b border-black/5 last:border-none">
      <button
        onClick={onClick}
        className="w-full py-6 flex items-center justify-between text-left group transition-all"
      >
        <span className={cn(
          "text-sm font-bold uppercase tracking-widest transition-colors flex-1 pr-4",
          isOpen 
            ? (isBikeMode ? 'text-brand-blue' : 'text-brand-orange') 
            : 'text-black/60 group-hover:text-black'
        )}>
          {searchTerm ? highlightText(question, searchTerm) : question}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className={cn(
            "p-2 rounded-full transition-colors shrink-0",
            isOpen 
              ? (isBikeMode ? 'bg-brand-blue/10 text-brand-blue' : 'bg-brand-orange/10 text-brand-orange') 
              : 'bg-black/5 text-black/20'
          )}
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
              {searchTerm ? highlightText(answer, searchTerm) : answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const FAQ: React.FC<{ isBikeMode?: boolean }> = ({ isBikeMode }) => {
  const { t } = useLanguage();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Booking');
  const [dbFaqs, setDbFaqs] = useState<FAQData[]>([]);

  useEffect(() => {
    const fetchFaqs = async () => {
      try {
        const q = query(collection(db, 'faqs'), orderBy('order', 'asc'));
        const snapshot = await getDocs(q);
        const faqData = snapshot.docs.map(doc => doc.data() as FAQData);
        if (faqData.length > 0) {
          setDbFaqs(faqData);
        }
      } catch (error: any) {
        if (error.code === 'permission-denied') {
          console.warn('FAQ: Public read access not confirmed via rules, using local translations fallback.');
        } else {
          console.error('Error fetching FAQs:', error);
        }
      }
    };

    fetchFaqs();
  }, []);

  // Get FAQ items from translations
  const translationFaqs = t('faq.items') as FAQData[];
  const faqItems = dbFaqs.length > 0 ? dbFaqs : translationFaqs;

  const categories = useMemo(() => {
    if (!faqItems) return ['All'];
    const cats = new Set(faqItems.map(item => item.category || 'General'));
    return ['All', ...Array.from(cats)];
  }, [faqItems]);

  const filteredItems = useMemo(() => {
    if (!faqItems) return [];
    return faqItems.filter(item => {
      const q = (item.q || '').toLowerCase();
      const a = (item.a || '').toLowerCase();
      const st = (searchTerm || '').toLowerCase();
      
      const matchesSearch = q.includes(st) || a.includes(st);
      
      const matchesCategory = activeCategory === 'All' || (item.category || 'General') === activeCategory;
      
      return matchesSearch && matchesCategory;
    });
  }, [faqItems, searchTerm, activeCategory]);

  if (!faqItems || !Array.isArray(faqItems)) return null;

  return (
    <section className="max-w-4xl mx-auto px-4 py-24" id="faq">
      <div className="text-center mb-16">
        <div className={cn(
          "inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold uppercase tracking-widest text-[10px] mb-6",
          isBikeMode ? "bg-brand-blue/10 text-brand-blue" : "bg-brand-orange/10 text-brand-orange"
        )}>
          <HelpCircle size={14} />
          {t('faq.title')}
        </div>
        <h2 className="text-4xl font-bold tracking-tight text-black mb-4">
          {t('faq.title')}
        </h2>
        <p className="text-black/40 font-medium max-w-lg mx-auto mb-12">
          {t('faq.subtitle')}
        </p>

        {/* Search Bar */}
        <div className="relative max-w-xl mx-auto mb-12">
          <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
            <Search className="text-black/20" size={20} />
          </div>
          <input
            type="text"
            placeholder="Search for answers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-black/5 border-none rounded-full py-5 pl-14 pr-14 text-sm font-bold placeholder:text-black/20 focus:ring-2 focus:ring-brand-orange/20 transition-all"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-6 flex items-center text-black/20 hover:text-black transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Categories */}
        {categories.length > 2 && (
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-6 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all",
                  activeCategory === cat
                    ? (isBikeMode ? "bg-brand-blue text-white shadow-lg shadow-brand-blue/20" : "bg-brand-orange text-white shadow-lg shadow-brand-orange/20")
                    : "bg-black/5 text-black/40 hover:bg-black/10"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="glass-card rounded-[2.5rem] p-8 md:p-12 min-h-[400px] flex flex-col">
        {filteredItems.length > 0 ? (
          <div className="divide-y divide-black/5">
            {filteredItems.map((item, index) => (
              <FAQItem
                key={index}
                question={item.q}
                answer={item.a}
                isOpen={openIndex === index}
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                isBikeMode={isBikeMode}
                searchTerm={searchTerm}
              />
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
            <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mb-6">
              <Search className="text-black/20" size={32} />
            </div>
            <h3 className="text-xl font-bold text-black mb-2">No results found</h3>
            <p className="text-black/40 font-medium max-w-xs">
              We couldn't find any answers matching "{searchTerm}". Try different keywords or contact us.
            </p>
            <button 
              onClick={() => setSearchTerm('')}
              className="mt-8 text-brand-orange font-bold uppercase tracking-widest text-[10px] hover:underline"
            >
              Clear Search
            </button>
          </div>
        )}
      </div>

      {/* Contact CTA */}
      <div className="mt-16 text-center">
        <p className="text-black/40 font-medium mb-6">Still have questions?</p>
        <a 
          href="#contact"
          className={cn(
            "inline-flex items-center gap-3 px-8 py-4 rounded-full font-bold uppercase tracking-widest text-xs text-white transition-all hover:scale-105 active:scale-95",
            isBikeMode ? "bg-brand-blue shadow-xl shadow-brand-blue/20" : "bg-brand-orange shadow-xl shadow-brand-orange/20"
          )}
        >
          <MessageCircle size={18} />
          Contact Our Team
        </a>
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
