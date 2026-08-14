import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, query, orderBy, addDoc, updateDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { Plus, Search, Edit2, Trash2, Save, X, ChevronDown, ChevronUp, GripVertical, Download, Upload, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { safeLocalStorage } from '../lib/storage';

interface FAQ {
  id: string;
  q: string;
  a: string;
  category: string;
  order: number;
  published?: boolean;
}

// Docs with no `published` field are treated as published (existing FAQs default to public).
const isPublished = (faq: FAQ) => faq.published !== false;

export const MarketingFAQ: React.FC = () => {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ q: '', a: '', category: 'General', order: 0, published: true });

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
      setFormData({ q: '', a: '', category: 'General', order: 0, published: true });
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

  const handleTogglePublished = async (faq: FAQ) => {
    const nextPublished = !isPublished(faq);
    try {
      await updateDoc(doc(db, 'faqs', faq.id), { published: nextPublished });
      setFaqs(prev => prev.map(f => f.id === faq.id ? { ...f, published: nextPublished } : f));
      toast.success(nextPublished ? 'FAQ published to website' : 'FAQ unpublished from website');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `faqs/${faq.id}`);
    }
  };

  // --- CSV import / export -------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const CSV_HEADERS = ['category', 'order', 'question', 'answer', 'published'];

  const csvEscape = (value: unknown): string => {
    const str = String(value ?? '');
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const faqsToCsv = (list: FAQ[]): string => {
    const rows = list.map(f => [f.category, f.order, f.q, f.a, isPublished(f) ? 'yes' : 'no']);
    return [CSV_HEADERS, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
  };

  // Minimal RFC 4180 CSV parser - handles quoted fields with embedded
  // commas, newlines, and escaped ("") quotes.
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const char = text[i];
      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += char;
        i++;
        continue;
      }
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (char === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (char === '\r') {
        i++;
        continue;
      }
      if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      field += char;
      i++;
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(r => r.some(cell => cell.trim() !== ''));
  };

  const handleExportCsv = () => {
    if (faqs.length === 0) {
      toast.error('No FAQs to export');
      return;
    }
    const csv = faqsToCsv(faqs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `faqs-export-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${faqs.length} FAQs to CSV`);
  };

  const handleImportCsvClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast.error('CSV file is empty');
        return;
      }

      const header = rows[0].map(h => h.trim().toLowerCase());
      const qIdx = header.indexOf('question');
      const aIdx = header.indexOf('answer');
      if (qIdx === -1 || aIdx === -1) {
        toast.error('CSV must have "question" and "answer" columns');
        return;
      }
      const catIdx = header.indexOf('category');
      const orderIdx = header.indexOf('order');
      const publishedIdx = header.indexOf('published');

      const dataRows = rows.slice(1).filter(r => (r[qIdx] || '').trim() && (r[aIdx] || '').trim());
      if (dataRows.length === 0) {
        toast.error('No valid FAQ rows found in CSV');
        return;
      }

      const doImport = async () => {
        try {
          const batch = writeBatch(db);
          const newFaqs: FAQ[] = [];
          const nextOrder = faqs.length > 0 ? Math.max(...faqs.map(f => f.order)) + 1 : 0;

          dataRows.forEach((r, index) => {
            const published = publishedIdx === -1
              ? true
              : !['no', 'false', '0', ''].includes((r[publishedIdx] || '').trim().toLowerCase());
            const parsedOrder = orderIdx !== -1 ? parseInt(r[orderIdx]) : NaN;
            const orderVal = !isNaN(parsedOrder) ? parsedOrder : nextOrder + index;

            const data = {
              q: r[qIdx].trim(),
              a: r[aIdx].trim(),
              category: (catIdx !== -1 ? r[catIdx].trim() : '') || 'General',
              order: orderVal,
              published,
            };

            const newDocRef = doc(collection(db, 'faqs'));
            batch.set(newDocRef, data);
            newFaqs.push({ id: newDocRef.id, ...data });
          });

          await batch.commit();
          setFaqs(prev => [...prev, ...newFaqs]);
          toast.success(`Imported ${newFaqs.length} FAQs from CSV`);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'faqs');
        }
      };

      if (faqs.length > 0) {
        toast(`Import ${dataRows.length} FAQs from CSV?`, {
          description: 'These will be added to your current FAQ list.',
          action: {
            label: 'Import',
            onClick: doImport
          }
        });
      } else {
        await doImport();
      }
    } catch (error) {
      toast.error('Could not read CSV file');
      console.error(error);
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportCsvFile}
          />
          <button
            onClick={handleImportCsvClick}
            className="flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur-md border border-black/10 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-all shadow-sm"
          >
            <Upload size={14} /> Import CSV
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur-md border border-black/10 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-all shadow-sm"
          >
            <Download size={14} /> Export CSV
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
              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.published}
                    onChange={(e) => setFormData({ ...formData, published: e.target.checked })}
                    className="w-4 h-4 rounded accent-brand-orange"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/50">
                    Published on website
                  </span>
                </label>
              </div>
              <p className="text-[10px] text-[#1A1A1A]/40 ml-2 -mt-2">
                Unpublished FAQs are still used by AI-suggested email replies, but won't appear on the public FAQ page.
              </p>
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
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isPublished(faq)}
                        onChange={(e) => handleUpdate(faq.id, { published: e.target.checked })}
                        className="w-4 h-4 rounded accent-brand-orange"
                      />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/50">
                        Published on website
                      </span>
                    </label>
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
                        {isPublished(faq) ? (
                          <span className="flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border bg-green-50 text-green-600 border-green-100">
                            <Eye size={11} /> Published
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border bg-black/5 text-[#1A1A1A]/40 border-black/10">
                            <EyeOff size={11} /> Unpublished
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-[#1A1A1A] mb-2">{faq.q}</h3>
                      <p className="text-sm text-[#1A1A1A]/60 leading-relaxed">{faq.a}</p>
                    </div>
                    <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleTogglePublished(faq)}
                        title={isPublished(faq) ? 'Unpublish from website' : 'Publish to website'}
                        className="p-2 text-[#1A1A1A]/40 hover:text-brand-orange hover:bg-brand-orange/5 rounded-lg transition-all"
                      >
                        {isPublished(faq) ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
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
