import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { AIKnowledgeBase } from '../types';
import { 
  Bot, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Save, 
  X, 
  MessageSquare, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  FileUp,
  Sparkles,
  Mail
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { fetchWithRetry } from '../lib/api';
import Papa from 'papaparse';

export const AITraining: React.FC = () => {
  const [knowledgeBase, setKnowledgeBase] = useState<AIKnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    question: '',
    answer: '',
    isActive: true
  });

  const [isImporting, setIsImporting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'ai_knowledge_base'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AIKnowledgeBase));
      setKnowledgeBase(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'ai_knowledge_base');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const data = results.data as any[];
          // Validate data structure
          const validData = data.filter(item => item.question && item.answer);
          
          if (validData.length === 0) {
            toast.error('No valid question/answer pairs found in CSV. Ensure headers are "question" and "answer".');
            setIsImporting(false);
            return;
          }

          const response = await fetchWithRetry('/api/knowledge-base/import-csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: validData })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to import CSV');
          }

          toast.success(`Successfully imported ${validData.length} entries!`);
        } catch (error: any) {
          console.error('Import error:', error);
          toast.error(error.message || 'Failed to import CSV');
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      },
      error: (error) => {
        console.error('Parse error:', error);
        toast.error('Failed to parse CSV file');
        setIsImporting(false);
      }
    });
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        toast.success('Successfully authenticated with Google!');
        handleSyncGmail();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        toast.error('Failed to authenticate with Google');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSyncGmail = async () => {
    setIsSyncing(true);
    try {
      const response = await fetchWithRetry('/api/knowledge-base/sync-gmail', {
        method: 'POST'
      });

      if (response.ok) {
        try {
          const data = await response.json();
          toast.success(`Successfully synced ${data.count} entries from Gmail!`);
        } catch (jsonError) {
          console.error('Failed to parse JSON response:', jsonError);
          throw new Error('Server returned an invalid response format. Please check console for details.');
        }
      } else {
        if (response.status === 401) {
          // Open auth URL in popup
          const authRes = await fetchWithRetry('/api/auth/google/url');
          const authData = await authRes.json();
          const authWindow = window.open(authData.url, 'google_auth_popup', 'width=600,height=700');
          if (!authWindow) {
            toast.error('Please allow popups for this site to connect your account.');
          }
          return;
        }
        
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to sync Gmail');
        } else {
          const text = await response.text();
          console.error('Non-JSON error response:', text);
          if (response.status === 503) {
            throw new Error('Service is still initializing. Please wait a few minutes.');
          }
          throw new Error(`Server error (${response.status}). Please try again later.`);
        }
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      toast.error(error.message || 'Failed to sync Gmail');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSave = async () => {
    if (!formData.question.trim() || !formData.answer.trim()) {
      toast.error('Please fill in both question and answer');
      return;
    }

    try {
      if (editingId) {
        const docRef = doc(db, 'ai_knowledge_base', editingId);
        await updateDoc(docRef, {
          ...formData,
          updatedAt: serverTimestamp()
        });
        toast.success('Knowledge base entry updated');
      } else {
        await addDoc(collection(db, 'ai_knowledge_base'), {
          ...formData,
          updatedAt: serverTimestamp()
        });
        toast.success('New knowledge base entry added');
      }
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'ai_knowledge_base');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this entry?')) return;
    try {
      await deleteDoc(doc(db, 'ai_knowledge_base', id));
      toast.success('Entry deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'ai_knowledge_base');
    }
  };

  const resetForm = () => {
    setFormData({ question: '', answer: '', isActive: true });
    setIsAdding(false);
    setEditingId(null);
  };

  const startEdit = (entry: AIKnowledgeBase) => {
    setFormData({
      question: entry.question,
      answer: entry.answer,
      isActive: entry.isActive
    });
    setEditingId(entry.id);
    setIsAdding(true);
  };

  const filteredData = knowledgeBase.filter(entry => 
    entry.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-warm-bg overflow-hidden">
      {/* Header */}
      <div className="p-8 md:p-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-brand-orange/10 rounded-xl flex items-center justify-center">
              <Bot className="text-brand-orange" size={20} />
            </div>
            <h1 className="font-serif italic text-4xl text-[#1A1A1A]">AI Assistant Training</h1>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">
            Train your AI assistant with custom question and answer pairs
          </p>
        </div>

        <div className="flex items-center gap-4">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportCSV}
            accept=".csv"
            className="hidden"
          />
          <button
            onClick={handleSyncGmail}
            disabled={isSyncing}
            className="h-12 px-6 bg-white/40 backdrop-blur-md border border-white/60 text-[#1A1A1A] rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all disabled:opacity-50"
          >
            {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} className="text-brand-orange" />}
            {isSyncing ? 'Syncing...' : 'Sync Gmail'}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="h-12 px-6 bg-white/40 backdrop-blur-md border border-white/60 text-[#1A1A1A] rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all disabled:opacity-50"
          >
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} className="text-brand-orange" />}
            {isImporting ? 'Importing...' : 'Import CSV'}
          </button>

          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/20 group-focus-within:text-brand-orange transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search knowledge base..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-12 pl-12 pr-6 bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 w-64 transition-all"
            />
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="h-12 px-6 bg-brand-orange text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20"
          >
            <Plus size={16} /> Add Entry
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 md:px-12 pb-12 custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-brand-orange" size={32} />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white/40 backdrop-blur-md rounded-[40px] border border-white/60 p-12 text-center">
            <div className="w-16 h-16 bg-brand-orange/10 rounded-full flex items-center justify-center text-brand-orange mb-6">
              <MessageSquare size={32} />
            </div>
            <h3 className="text-xl font-bold text-[#1A1A1A] mb-2">No entries found</h3>
            <p className="text-[#1A1A1A]/40 max-w-sm mx-auto">
              {searchQuery ? "No entries match your search query." : "Start training your AI by adding your first question and answer pair or importing a CSV file."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredData.map((entry) => (
              <motion.div
                layout
                key={entry.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "bg-white/40 backdrop-blur-md rounded-[32px] border p-8 transition-all group",
                  entry.isActive ? "border-white/60" : "border-red-500/20 bg-red-500/5"
                )}
              >
                <div className="flex justify-between items-start gap-6">
                  <div className="flex-1 space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-brand-orange/10 rounded-lg flex items-center justify-center text-brand-orange shrink-0 mt-1">
                        <span className="font-bold text-xs">Q</span>
                      </div>
                      <h3 className="text-lg font-bold text-[#1A1A1A] leading-tight">
                        {entry.question}
                      </h3>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-600 shrink-0 mt-1">
                        <span className="font-bold text-xs">A</span>
                      </div>
                      <p className="text-[#1A1A1A]/60 leading-relaxed font-medium">
                        {entry.answer}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(entry)}
                      className="w-10 h-10 bg-white/80 rounded-full flex items-center justify-center text-[#1A1A1A]/40 hover:text-brand-orange hover:bg-brand-orange/10 transition-all shadow-sm"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="w-10 h-10 bg-white/80 rounded-full flex items-center justify-center text-[#1A1A1A]/40 hover:text-red-500 hover:bg-red-500/10 transition-all shadow-sm"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-6 pt-6 border-t border-black/5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                      entry.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"
                    )}>
                      {entry.isActive ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                      {entry.isActive ? 'Active' : 'Inactive'}
                    </div>
                    <span className="text-[10px] text-[#1A1A1A]/30 font-mono">
                      ID: {entry.id}
                    </span>
                  </div>
                  {entry.updatedAt && (
                    <span className="text-[10px] text-[#1A1A1A]/30 uppercase tracking-widest font-bold">
                      Last Updated: {entry.updatedAt.toDate().toLocaleDateString()}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resetForm}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white/80 backdrop-blur-2xl rounded-[40px] shadow-2xl border border-white/60 overflow-hidden"
            >
              <div className="p-12">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h2 className="font-serif italic text-4xl text-[#1A1A1A]">
                      {editingId ? 'Edit Entry' : 'Add Training Entry'}
                    </h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-2">
                      Define how the AI should respond to specific questions
                    </p>
                  </div>
                  <button
                    onClick={resetForm}
                    className="w-12 h-12 bg-black/5 rounded-full flex items-center justify-center text-[#1A1A1A]/40 hover:bg-black/10 hover:text-black transition-all"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="space-y-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Question / Trigger Phrase</label>
                    <input
                      type="text"
                      className="w-full bg-black/5 border-none p-6 rounded-3xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                      placeholder="e.g., What is your late return policy?"
                      value={formData.question}
                      onChange={e => setFormData({ ...formData, question: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">AI Response</label>
                    <textarea
                      className="w-full bg-black/5 border-none p-6 rounded-3xl text-sm focus:bg-black/10 outline-none transition-all h-48 resize-none font-medium leading-relaxed"
                      placeholder="Provide the detailed answer the AI should give..."
                      value={formData.answer}
                      onChange={e => setFormData({ ...formData, answer: e.target.value })}
                    />
                  </div>

                  <div className="flex items-center gap-3 ml-4">
                    <button
                      onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        formData.isActive ? "bg-emerald-500" : "bg-[#1A1A1A]/10"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        formData.isActive ? "left-7" : "left-1"
                      )} />
                    </button>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60">
                      Entry is {formData.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>

                <div className="mt-12 flex gap-4">
                  <button
                    onClick={resetForm}
                    className="flex-1 h-16 bg-black/5 text-black font-bold uppercase tracking-widest text-[10px] rounded-2xl hover:bg-black/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="flex-1 h-16 bg-brand-orange text-white font-bold uppercase tracking-widest text-[10px] rounded-2xl hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 flex items-center justify-center gap-2"
                  >
                    <Save size={16} />
                    {editingId ? 'Save Changes' : 'Add Entry'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
