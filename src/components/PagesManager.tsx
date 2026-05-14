import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, Search, Filter, MoreVertical, Edit2, Trash2, Eye, 
  Save, X, Globe, Settings, Image as ImageIcon, Layout,
  ChevronRight, Link as LinkIcon, Loader2, FileText, CheckCircle2,
  AlertCircle, Upload, ArrowLeft, Monitor, Smartphone, Tablet,
  ExternalLink
} from 'lucide-react';
import { 
  collection, query, orderBy, onSnapshot, doc, 
  setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage, handleFirestoreError, OperationType } from '../firebase';
import { MarketingPage } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

export const PagesManager: React.FC = () => {
  const [pages, setPages] = useState<MarketingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'All' | 'Draft' | 'Published'>('All');
  const [isEditing, setIsEditing] = useState(false);
  const [editingPage, setEditingPage] = useState<Partial<MarketingPage> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState<'edit' | 'preview'>('edit');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'marketing_pages'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const p = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MarketingPage));
      setPages(p);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'marketing_pages');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredPages = useMemo(() => {
    return pages.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           p.slug.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'All' || p.status === filterStatus;
    return matchesSearch && matchesStatus;
  });
}, [pages, searchTerm, filterStatus]);

const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setIsUploading(true);
  try {
    const storageRef = ref(storage, `marketing-pages/${Date.now()}-${file.name}`);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    setEditingPage(prev => ({ ...prev!, featuredImageUrl: url }));
    toast.success('Image uploaded');
  } catch (error) {
    console.error('Upload error:', error);
    toast.error('Failed to upload image');
  } finally {
    setIsUploading(false);
  }
};

const handleCreateNew = () => {
    setEditingPage({
      title: '',
      slug: '',
      categoryPath: '/',
      content: '',
      excerpt: '',
      status: 'Draft',
      layoutType: 'Service',
      metaDescription: '',
      keywords: '',
      canonicalUrl: '',
      schemaMarkup: '',
      fullUrl: '/'
    });
    setIsEditing(true);
  };

  const handleEdit = (page: MarketingPage) => {
    setEditingPage(page);
    setIsEditing(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this page?')) return;
    try {
      await deleteDoc(doc(db, 'marketing_pages', id));
      toast.success('Page deleted successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `marketing_pages/${id}`);
      toast.error('Failed to delete page');
    }
  };

  const generateFullUrl = (category: string, slug: string) => {
    const cleanCategory = category.startsWith('/') ? category : `/${category}`;
    const cleanSlug = slug.startsWith('/') ? slug.substring(1) : slug;
    const combined = cleanCategory.endsWith('/') ? `${cleanCategory}${cleanSlug}` : `${cleanCategory}/${cleanSlug}`;
    return combined.replace(/\/+/g, '/');
  };

  const handleSave = async () => {
    if (!editingPage?.title || !editingPage?.slug) {
      toast.error('Title and Slug are required');
      return;
    }

    setIsSaving(true);
    try {
      const fullUrl = generateFullUrl(editingPage.categoryPath || '/', editingPage.slug);
      const now = new Date().toISOString();
      const pageData = {
        ...editingPage,
        fullUrl,
        updatedAt: now,
        createdAt: editingPage.createdAt || now,
        authorId: editingPage.authorId || auth.currentUser?.uid || 'anonymous'
      };

      if (editingPage.id) {
        await updateDoc(doc(db, 'marketing_pages', editingPage.id), pageData as any);
      } else {
        await addDoc(collection(db, 'marketing_pages'), pageData);
      }

      toast.success(editingPage.id ? 'Page updated' : 'Page created');
      setIsEditing(false);
      setEditingPage(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'marketing_pages');
      toast.error('Failed to save page');
    } finally {
      setIsSaving(false);
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
    <div className="space-y-6">
      {/* Header & Stats */}
      {!isEditing && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">Marketing Pages</h2>
            <p className="text-black/40 text-sm mt-1">Manage standalone landing pages and SEO-optimized local content.</p>
          </div>
          <button
            onClick={handleCreateNew}
            className="bg-[#1A1A1A] text-white px-6 py-3 rounded-full font-bold uppercase tracking-[0.2em] text-[10px] hover:bg-brand-orange transition-all shadow-lg flex items-center gap-2"
          >
            <Plus size={16} />
            Create Page
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {isEditing ? (
          <motion.div
            key="editor"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-3xl border border-black/10 overflow-hidden shadow-2xl"
          >
            // Editor Header
      <div className="bg-white border-b border-black/10 px-8 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsEditing(false)}
            className="p-2 hover:bg-black/5 rounded-full transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-4 border-l border-black/10 pl-4">
            <button
              onClick={() => setPreviewMode('edit')}
              className={cn(
                "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                previewMode === 'edit' ? "bg-brand-orange text-white" : "hover:bg-black/5 text-black/40"
              )}
            >
              Editor
            </button>
            <button
              onClick={() => setPreviewMode('preview')}
              className={cn(
                "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                previewMode === 'preview' ? "bg-brand-orange text-white" : "hover:bg-black/5 text-black/40"
              )}
            >
              <Eye size={12} />
              Live Preview
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {previewMode === 'preview' && (
            <div className="flex items-center gap-2 bg-black/5 p-1 rounded-xl mr-4">
              <button 
                onClick={() => setPreviewDevice('desktop')}
                className={cn("p-2 rounded-lg", previewDevice === 'desktop' ? "bg-white shadow-sm text-brand-orange" : "text-black/40")}
              >
                <Monitor size={16} />
              </button>
              <button 
                onClick={() => setPreviewDevice('tablet')}
                className={cn("p-2 rounded-lg", previewDevice === 'tablet' ? "bg-white shadow-sm text-brand-orange" : "text-black/40")}
              >
                <Tablet size={16} />
              </button>
              <button 
                onClick={() => setPreviewDevice('mobile')}
                className={cn("p-2 rounded-lg", previewDevice === 'mobile' ? "bg-white shadow-sm text-brand-orange" : "text-black/40")}
              >
                <Smartphone size={16} />
              </button>
            </div>
          )}
          <select
            value={editingPage?.status}
            onChange={e => setEditingPage({...editingPage!, status: e.target.value as any})}
            className="bg-black/5 border-none rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-widest outline-none focus:ring-2 ring-brand-orange"
          >
            <option value="Draft">Draft</option>
            <option value="Published">Published</option>
          </select>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-[#1A1A1A] text-white px-6 py-3 rounded-xl font-bold uppercase tracking-[0.2em] text-[10px] hover:bg-brand-orange transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Changes
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row h-[calc(100vh-250px)]">
        {previewMode === 'edit' ? (
          <>
            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-8 space-y-8 border-r border-black/5">
              {/* Title & Slug Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 ml-4">Page Title</label>
                  <input
                    type="text"
                    value={editingPage?.title}
                    onChange={e => setEditingPage({...editingPage!, title: e.target.value})}
                    placeholder="e.g. EV Car Rentals in Pattaya"
                    className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 ml-4">URL Slug</label>
                  <input
                    type="text"
                    value={editingPage?.slug}
                    onChange={e => setEditingPage({...editingPage!, slug: e.target.value.toLowerCase().replace(/\s+/g, '-')})}
                    placeholder="ev-rentals-pattaya"
                    className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all"
                  />
                </div>
              </div>

              {/* Category Path builder */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 ml-4 flex items-center gap-2">
                  <LinkIcon size={12} />
                  Nested Category Path
                </label>
                <div className="flex items-center gap-2 bg-black/5 p-2 rounded-2xl">
                  <span className="px-4 text-black/30 font-mono text-xs">/</span>
                  <input
                    type="text"
                    value={editingPage?.categoryPath}
                    onChange={e => setEditingPage({...editingPage!, categoryPath: e.target.value})}
                    placeholder="cars/ev-rentals"
                    className="flex-1 bg-transparent border-none p-2 text-sm font-mono focus:outline-none"
                  />
                </div>
                <p className="text-[9px] text-black/30 ml-4 mt-1 border-l-2 border-brand-orange pl-2 italic">
                  Live Preview Path: <span className="text-black/60 font-medium">{generateFullUrl(editingPage?.categoryPath || '/', editingPage?.slug || '')}</span>
                </p>
              </div>

              {/* Rich Text Editor */}
              <div className="space-y-2 min-h-[500px]">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 ml-4">Page Content</label>
                <div className="h-[450px]">
                  <ReactQuill 
                    theme="snow"
                    value={editingPage?.content || ''}
                    onChange={(content) => setEditingPage({...editingPage!, content})}
                    className="h-full rounded-2xl overflow-hidden border-none"
                    modules={{
                      toolbar: [
                        [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        [{ 'color': [] }, { 'background': [] }],
                        [{ 'align': [] }],
                        ['link', 'image', 'video'],
                        ['clean']
                      ],
                    }}
                  />
                </div>
              </div>

              {/* Excerpt */}
              <div className="space-y-2 pt-8">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/30 ml-4">Short Excerpt / Summary</label>
                <textarea
                  rows={3}
                  value={editingPage?.excerpt}
                  onChange={e => setEditingPage({...editingPage!, excerpt: e.target.value})}
                  placeholder="Provide a brief summary for card listing blocks..."
                  className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm font-medium focus:ring-2 ring-brand-orange outline-none transition-all resize-none"
                />
              </div>
            </div>

            {/* Sidebar Settings Area */}
            <div className="w-full lg:w-80 bg-gray-50/50 overflow-y-auto p-8 space-y-8">
              {/* Layout Section */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-brand-orange">
                  <Layout size={16} />
                  <h4 className="text-[10px] font-black uppercase tracking-widest">Layout Settings</h4>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-black/40 ml-2">Page Type / Layout</label>
                    <select
                      value={editingPage?.layoutType}
                      onChange={e => setEditingPage({...editingPage!, layoutType: e.target.value as any})}
                      className="w-full bg-white border border-black/5 rounded-xl p-3 text-xs font-bold outline-none focus:ring-2 ring-brand-orange shadow-sm"
                    >
                      <option value="Service">Service Page</option>
                      <option value="Location">Location Page</option>
                      <option value="Blog">Special Blog</option>
                      <option value="Home">Home Page</option>
                      <option value="Landing">Landing Page</option>
                      <option value="Contact">Contact Page</option>
                      <option value="About">About Us</option>
                      <option value="FAQ">FAQ Page</option>
                      <option value="Fleet">Fleet Page</option>
                      <option value="Custom">Custom Page</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* SEO Section */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-brand-orange">
                  <Settings size={16} />
                  <h4 className="text-[10px] font-black uppercase tracking-widest">SEO Metadata</h4>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-black/40 ml-2">Meta Description</label>
                    <textarea
                      rows={3}
                      value={editingPage?.metaDescription}
                      onChange={e => setEditingPage({...editingPage!, metaDescription: e.target.value})}
                      className="w-full bg-white border border-black/5 rounded-xl p-3 text-xs font-medium outline-none resize-none shadow-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-black/40 ml-2">Keywords (comma separated)</label>
                    <input
                      type="text"
                      value={editingPage?.keywords}
                      onChange={e => setEditingPage({...editingPage!, keywords: e.target.value})}
                      className="w-full bg-white border border-black/5 rounded-xl p-3 text-xs font-bold outline-none shadow-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-black/40 ml-2">Schema Markup (JSON-LD)</label>
                    <textarea
                      rows={4}
                      value={editingPage?.schemaMarkup}
                      onChange={e => setEditingPage({...editingPage!, schemaMarkup: e.target.value})}
                      className="w-full bg-white border border-black/5 rounded-xl p-3 text-xs font-mono outline-none resize-none shadow-sm"
                      placeholder='{ "@context": "https://schema.org", ... }'
                    />
                  </div>
                </div>
              </section>

              {/* Imagery Section */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-brand-orange">
                  <ImageIcon size={16} />
                  <h4 className="text-[10px] font-black uppercase tracking-widest">Featured Image</h4>
                </div>
                <div className="space-y-3">
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-video w-full bg-white rounded-2xl overflow-hidden border-2 border-dashed border-black/5 flex flex-col items-center justify-center cursor-pointer hover:border-brand-orange transition-all relative group shadow-sm"
                  >
                    {editingPage?.featuredImageUrl ? (
                      <>
                        <img 
                          src={editingPage.featuredImageUrl} 
                          alt="Preview" 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Upload className="text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-4">
                        {isUploading ? (
                          <Loader2 size={24} className="mx-auto text-brand-orange animate-spin mb-2" />
                        ) : (
                          <Upload size={24} className="mx-auto text-black/10 mb-2" />
                        )}
                        <span className="text-[9px] font-bold opacity-30 uppercase tracking-widest">
                          {isUploading ? 'Uploading...' : 'Click to Upload'}
                        </span>
                      </div>
                    )}
                  </div>
                  <input 
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                    className="hidden"
                    accept="image/*"
                  />
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-black/40 ml-2">Image Alt Text</label>
                    <input
                      type="text"
                      value={editingPage?.featuredImageAlt}
                      onChange={e => setEditingPage({...editingPage!, featuredImageAlt: e.target.value})}
                      placeholder="Alt text for SEO..."
                      className="w-full bg-white border border-black/5 rounded-xl p-3 text-xs font-medium outline-none shadow-sm"
                    />
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="flex-1 bg-gray-100 p-8 flex items-center justify-center overflow-auto no-scrollbar">
            <div className={cn(
              "bg-white shadow-2xl transition-all duration-300 mx-auto rounded-xl overflow-hidden flex flex-col",
              previewDevice === 'desktop' ? "w-full min-h-[800px]" : 
              previewDevice === 'tablet' ? "w-[768px] h-[1024px]" : "w-[375px] h-[667px]"
            )}>
              {/* Fake Browser Top Bar */}
              <div className="bg-gray-100 p-3 flex items-center gap-2 shrink-0">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 max-w-sm mx-auto bg-white rounded-md px-3 py-1 flex items-center gap-2 shadow-sm">
                  <Globe size={10} className="text-black/20" />
                  <span className="text-[9px] text-black/40 truncate">
                    {window.location.hostname}{generateFullUrl(editingPage?.categoryPath || '/', editingPage?.slug || '')}
                  </span>
                </div>
              </div>

              {/* Preview Content */}
              <div className="flex-1 overflow-y-auto no-scrollbar bg-white">
                {/* Simulated Header */}
                <header className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
                  <div className="font-black text-xl tracking-tighter">PATTAYA <span className="text-brand-orange">RENT A CAR</span></div>
                  <div className="hidden md:flex gap-6 text-[10px] font-bold uppercase tracking-widest text-black/40">
                    <span>Cars</span>
                    <span>Locations</span>
                    <span>Contact</span>
                  </div>
                </header>

                <div className="p-8 md:p-12 space-y-12 max-w-4xl mx-auto">
                  {/* Hero Preview */}
                  <div className="space-y-6">
                    <h1 className="text-4xl md:text-6xl font-black tracking-tight text-gray-900 leading-none">
                      {editingPage?.title || 'Page Title'}
                    </h1>
                    <div className="flex items-center gap-4 text-xs font-bold text-brand-orange uppercase tracking-widest">
                      <span>{editingPage?.layoutType} Page</span>
                      <span className="text-gray-300">•</span>
                      <span>{editingPage?.status || 'Draft'}</span>
                    </div>
                  </div>

                  {editingPage?.featuredImageUrl && (
                    <div className="aspect-[21/9] rounded-3xl overflow-hidden shadow-xl">
                      <img 
                        src={editingPage.featuredImageUrl} 
                        alt={editingPage.featuredImageAlt} 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  {editingPage?.excerpt && (
                    <p className="text-xl text-gray-600 leading-relaxed font-medium border-l-4 border-brand-orange pl-6 py-2">
                      {editingPage.excerpt}
                    </p>
                  )}

                  <div className="prose prose-brand max-w-none">
                    <div 
                      className="marketing-page-content"
                      dangerouslySetInnerHTML={{ __html: editingPage?.content || '<p class="text-gray-300 italic">No content written yet...</p>' }} 
                    />
                  </div>
                </div>

                {/* Simulated Footer */}
                <footer className="bg-gray-900 text-white p-12 mt-20 text-center space-y-4">
                  <div className="font-black text-2xl tracking-tighter">PATTAYA <span className="text-brand-orange">RENT A CAR</span></div>
                  <p className="text-white/40 text-xs">© 2026 Pattaya Rent A Car. All rights reserved.</p>
                </footer>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Filter Bar */}
            <div className="bg-white/60 backdrop-blur-xl border border-white/60 p-4 rounded-3xl flex flex-col md:flex-row gap-4 items-center shadow-sm">
              <div className="flex-1 w-full relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30" size={18} />
                <input
                  type="text"
                  placeholder="Search pages by title or slug..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-black/5 border-none pl-12 pr-4 py-3 rounded-2xl outline-none focus:ring-2 ring-brand-orange transition-all text-sm font-medium"
                />
              </div>
              <div className="flex items-center gap-2 bg-black/5 p-1.5 rounded-2xl">
                {(['All', 'Draft', 'Published'] as const).map(status => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={cn(
                      "px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                      filterStatus === status ? "bg-[#1A1A1A] text-white shadow-lg" : "text-black/40 hover:text-black"
                    )}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* Pages Table */}
            <div className="bg-white rounded-[32px] border border-black/5 overflow-hidden shadow-sm overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-black/5">
                    <th className="text-left p-6 text-[10px] font-black uppercase tracking-[0.2em] text-black/30">Page Details</th>
                    <th className="text-left p-6 text-[10px] font-black uppercase tracking-[0.2em] text-black/30">Layout</th>
                    <th className="text-left p-6 text-[10px] font-black uppercase tracking-[0.2em] text-black/30">Slug / URL</th>
                    <th className="text-center p-6 text-[10px] font-black uppercase tracking-[0.2em] text-black/30">Status</th>
                    <th className="text-right p-6 text-[10px] font-black uppercase tracking-[0.2em] text-black/30">Updated</th>
                    <th className="p-6"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 text-[12px] font-bold">
                    {filteredPages.map(page => (
                      <tr key={page.id} className="hover:bg-gray-50/50 transition-colors group">
                        <td className="p-6">
                          <div 
                            className="flex items-center gap-4 cursor-pointer hover:text-brand-orange transition-all font-bold"
                            onClick={() => handleEdit(page)}
                          >
                            <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center text-brand-orange shrink-0">
                              <FileText size={18} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm text-gray-900 truncate max-w-[200px]">
                                {page.title}
                              </div>
                              <div className="text-[10px] text-black/30 truncate max-w-[200px]">
                                {page.excerpt || 'No excerpt'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-6">
                          <span className="bg-black/5 text-black/60 px-3 py-1 rounded-full text-[9px] uppercase tracking-widest">
                            {page.layoutType}
                          </span>
                        </td>
                        <td className="p-6">
                          <div className="flex items-center gap-2 max-w-[250px]">
                            <div 
                              className="font-mono text-black/40 flex items-center gap-1.5 hover:text-brand-orange cursor-pointer transition-colors truncate group/link"
                              onClick={() => handleEdit(page)}
                            >
                              <Globe size={12} className="shrink-0" />
                              <span className="truncate">{page.fullUrl}</span>
                            </div>
                            {page.status === 'Published' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const url = `https://www.pattayarentacar.com${page.fullUrl}`;
                                  window.open(url, '_blank');
                                }}
                                className="p-1.5 bg-brand-orange/10 text-brand-orange rounded-lg hover:bg-brand-orange hover:text-white transition-all shadow-sm"
                                title="Open Live Page"
                              >
                                <ExternalLink size={12} />
                              </button>
                            )}
                          </div>
                          {page.nestedCategoryPath && (
                            <div className="text-[9px] text-black/20 font-mono mt-1">
                              Internal Path: {page.nestedCategoryPath}
                            </div>
                          )}
                        </td>
                        <td className="p-6 text-center">
                        <div className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest",
                          page.status === 'Published' ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                        )}>
                          {page.status === 'Published' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                          {page.status}
                        </div>
                      </td>
                      <td className="p-6 text-right text-black/40 font-mono">
                        {new Date(page.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="p-6">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => {
                              setEditingPage(page);
                              setPreviewMode('preview');
                              setIsEditing(true);
                            }}
                            className="p-2 hover:bg-black/5 text-brand-orange rounded-lg transition-colors"
                            title="Live Preview"
                          >
                            <Eye size={16} />
                          </button>
                          <button 
                            onClick={() => {
                              setEditingPage(page);
                              setPreviewMode('edit');
                              setIsEditing(true);
                            }}
                            className="p-2 hover:bg-black/5 text-[#1A1A1A] rounded-lg transition-colors"
                            title="Edit Page"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            onClick={() => handleDelete(page.id)}
                            className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                            title="Delete Page"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredPages.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-20 text-center">
                        <div className="flex flex-col items-center gap-4 text-black/20">
                          <FileText size={48} strokeWidth={1} />
                          <p className="text-sm font-medium">No marketing pages found</p>
                          <button
                            onClick={handleCreateNew}
                            className="text-brand-orange text-[10px] font-bold uppercase tracking-widest hover:underline"
                          >
                            Create your first page
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
