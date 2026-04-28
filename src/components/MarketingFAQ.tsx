import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, addDoc, updateDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { Plus, Search, Edit2, Trash2, Save, X, ChevronDown, ChevronUp, GripVertical, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { translations } from '../translations';
import { cn } from '../lib/utils';
import { safeLocalStorage } from '../lib/storage';

interface FAQ {
  id: string;
  q: string;
  a: string;
  category: string;
  order: number;
}

export const MarketingFAQ: React.FC = () => {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ q: '', a: '', category: 'General', order: 0 });

  const [lastFetch, setLastFetch] = useState(() => {
    const cached = safeLocalStorage.getItem('prac_faq_last_fetch');
    return cached ? parseInt(cached) : 0;
  });

  useEffect(() => {
    const fetchFaqs = async () => {
      // Guard against running before auth is ready
      if (!auth.currentUser) return;
      
      // Cache for 30 minutes
      const CACHE_DURATION = 30 * 60 * 1000;
      const isCacheValid = Date.now() - lastFetch < CACHE_DURATION;

      if (faqs.length > 0 && isCacheValid) {
        setLoading(false);
        return;
      }

      if (faqs.length === 0 && isCacheValid) {
        const cached = safeLocalStorage.getItem('prac_cached_faqs');
        if (cached) {
          try {
            setFaqs(JSON.parse(cached));
            setLoading(false);
            return;
          } catch (e) {
            console.error('Error parsing cached FAQs:', e);
          }
        }
      }

      try {
        const q = query(collection(db, 'faqs'), orderBy('order', 'asc'));
        const snapshot = await getDocs(q);
        const faqData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FAQ));
        setFaqs(faqData);
        const now = Date.now();
        setLastFetch(now);
        safeLocalStorage.setItem('prac_faq_last_fetch', now.toString());
        safeLocalStorage.setItem('prac_cached_faqs', JSON.stringify(faqData));
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'faqs');
        setLoading(false);
      }
    };

    fetchFaqs();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const nextOrder = faqs.length > 0 ? Math.max(...faqs.map(f => f.order)) + 1 : 0;
      await addDoc(collection(db, 'faqs'), {
        ...formData,
        order: nextOrder
      });
      setIsAdding(false);
      setFormData({ q: '', a: '', category: 'General', order: 0 });
      toast.success('FAQ added successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'faqs');
    }
  };

  const handleUpdate = async (id: string, data: Partial<FAQ>) => {
    try {
      await updateDoc(doc(db, 'faqs', id), data);
      setEditingId(null);
      toast.success('FAQ updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `faqs/${id}`);
    }
  };

  const handleDelete = async (id: string) => {
    toast('Delete this FAQ?', {
      description: "This action cannot be undone.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteDoc(doc(db, 'faqs', id));
            toast.success('FAQ deleted successfully');
            setFaqs(prev => prev.filter(f => f.id !== id));
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `faqs/${id}`);
          }
        }
      }
    });
  };

  const seedFromTranslations = async () => {
    const doImport = async () => {
      try {
        const batch = writeBatch(db);
        const items = translations.en.faq.items;
        
        items.forEach((item, index) => {
          const newDocRef = doc(collection(db, 'faqs'));
          batch.set(newDocRef, {
            q: item.q,
            a: item.a,
            category: item.category || 'General',
            order: faqs.length + index
          });
        });
        
        await batch.commit();
        toast.success(`Imported ${items.length} FAQs from translations`);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'faqs');
      }
    };

    if (faqs.length > 0) {
      toast('Import FAQs?', {
        description: "This will add FAQs from translations.ts to your current list.",
        action: {
          label: "Import",
          onClick: doImport
        }
      });
    } else {
      doImport();
    }
  };

  const filteredFaqs = faqs.filter(faq => {
    const matchesSearch = 
      faq.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.a.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.category.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'All' || faq.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(faqs.map(f => f.category)));

  const getCategoryColor = (category: string) => {
    const colors: { [key: string]: string } = {
      'General': 'bg-blue-50 text-blue-600 border-blue-100',
      'Booking': 'bg-emerald-50 text-emerald-600 border-emerald-100',
      'Insurance': 'bg-purple-50 text-purple-600 border-purple-100',
      'Payment': 'bg-amber-50 text-amber-600 border-amber-100',
      'Requirements': 'bg-rose-50 text-rose-600 border-rose-100',
      'Delivery': 'bg-cyan-50 text-cyan-600 border-cyan-100',
      'Fleet': 'bg-indigo-50 text-indigo-600 border-indigo-100',
      'Support': 'bg-teal-50 text-teal-600 border-teal-100',
    };
    return colors[category] || 'bg-brand-orange/5 text-brand-orange border-brand-orange/10';
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-serif italic text-[#1A1A1A]">FAQ Management</h1>
          <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] font-bold mt-1">
            Marketing & Customer Support
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={seedFromTranslations}
            className="flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur-md border border-black/10 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-all shadow-sm"
          >
            <Download size={14} /> Import from Website
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-3 bg-brand-orange text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20"
          >
            <Plus size={16} /> Add FAQ
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/40" size={20} />
          <input
            type="text"
            placeholder="Search questions, answers, or categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-6 py-4 bg-white/60 backdrop-blur-md border border-black/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all shadow-sm"
          />
        </div>
        <div className="relative min-w-[200px]">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full appearance-none pl-6 pr-12 py-4 bg-white/60 backdrop-blur-md border border-black/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all shadow-sm text-sm font-medium text-[#1A1A1A]/70 cursor-pointer"
          >
            <option value="All">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/40 pointer-events-none" size={18} />
        </div>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mb-8 p-6 bg-white/80 backdrop-blur-xl border border-black/20 rounded-[32px] shadow-xl"
          >
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-2">Category</label>
                  <input
                    list="categories"
                    required
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-3 bg-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                    placeholder="e.g. Booking, Insurance..."
                  />
                  <datalist id="categories">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-2">Order</label>
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 bg-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-2">Question</label>
                <input
                  required
                  value={formData.q}
                  onChange={(e) => setFormData({ ...formData, q: e.target.value })}
                  className="w-full px-4 py-3 bg-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  placeholder="Enter the question..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-2">Answer</label>
                <textarea
                  required
                  rows={4}
                  value={formData.a}
                  onChange={(e) => setFormData({ ...formData, a: e.target.value })}
                  className="w-full px-4 py-3 bg-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-orange/20 resize-none"
                  placeholder="Enter the answer..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 hover:text-brand-orange transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-8 py-3 bg-[#1A1A1A] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange transition-all shadow-lg"
                >
                  Save FAQ
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-brand-orange border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredFaqs.length === 0 ? (
          <div className="text-center py-12 bg-white/40 backdrop-blur-md rounded-[32px] border border-white/40">
            <p className="text-[#1A1A1A]/40 italic">No FAQs found matching your search.</p>
          </div>
        ) : (
          filteredFaqs.map((faq) => (
            <motion.div
              key={faq.id}
              layout
              className="group bg-white/60 backdrop-blur-md border border-black/10 rounded-[24px] overflow-hidden hover:bg-white/80 transition-all shadow-sm hover:shadow-md"
            >
              {editingId === faq.id ? (
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <input
                      value={faq.category}
                      onChange={(e) => handleUpdate(faq.id, { category: e.target.value })}
                      className="px-4 py-2 bg-black/5 rounded-lg text-xs"
                      placeholder="Category"
                    />
                    <input
                      type="number"
                      value={faq.order}
                      onChange={(e) => handleUpdate(faq.id, { order: parseInt(e.target.value) })}
                      className="px-4 py-2 bg-black/5 rounded-lg text-xs"
                      placeholder="Order"
                    />
                  </div>
                  <input
                    value={faq.q}
                    onChange={(e) => handleUpdate(faq.id, { q: e.target.value })}
                    className="w-full px-4 py-2 bg-black/5 rounded-lg text-xs font-bold"
                    placeholder="Question"
                  />
                  <textarea
                    rows={3}
                    value={faq.a}
                    onChange={(e) => handleUpdate(faq.id, { a: e.target.value })}
                    className="w-full px-4 py-2 bg-black/5 rounded-lg text-xs resize-none"
                    placeholder="Answer"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X size={16} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-2 text-green-500 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      <Save size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border transition-colors",
                          getCategoryColor(faq.category)
                        )}>
                          {faq.category}
                        </span>
                        <span className="text-[9px] font-mono text-[#1A1A1A]/30">
                          Order: {faq.order}
                        </span>
                      </div>
                      <h3 className="font-bold text-[#1A1A1A] mb-2">{faq.q}</h3>
                      <p className="text-sm text-[#1A1A1A]/60 leading-relaxed">{faq.a}</p>
                    </div>
                    <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditingId(faq.id)}
                        className="p-2 text-[#1A1A1A]/40 hover:text-brand-orange hover:bg-brand-orange/5 rounded-lg transition-all"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(faq.id)}
                        className="p-2 text-[#1A1A1A]/40 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};
