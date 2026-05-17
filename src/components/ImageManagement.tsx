import React, { useState, useEffect, useRef } from 'react';
import { storage, logSystemActivity, auth } from '../firebase';
import { ref, listAll, getDownloadURL, uploadBytesResumable, deleteObject, StorageReference, getBlob, uploadBytes } from 'firebase/storage';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Trash2, Copy, Check, Loader2, Image as ImageIcon, Search, X, Filter, RefreshCw, ExternalLink, Edit2, Save } from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

interface StorageFile {
  name: string;
  fullPath: string;
  url: string;
  ref: StorageReference;
  size?: number;
  updated?: string;
}

export const ImageManagement: React.FC = () => {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async () => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }
    if (!storage) {
      setLoading(false);
      return;
    }

    try {
      setIsRefreshing(true);
      const storageRef = ref(storage, ''); // Root directory
      const result = await listAll(storageRef);
      
      const filePromises = result.items.map(async (item) => {
        const url = await getDownloadURL(item);
        return {
          name: item.name,
          fullPath: item.fullPath,
          url,
          ref: item
        };
      });

      const fileList = await Promise.all(filePromises);
      setFiles(fileList);
    } catch (error: any) {
      console.error('Error fetching storage files:', error);
      toast.error('Failed to load images from storage');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !storage) return;

    const performUpload = async () => {
      setUploading(true);
      setUploadProgress(0);

      const storageRef = ref(storage, file.name);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        }, 
        (error) => {
          console.error('Upload failed:', error);
          toast.error(`Upload failed: ${error.message}`);
          setUploading(false);
        }, 
        async () => {
          toast.success(`"${file.name}" uploaded successfully`);
          setUploading(false);
          setUploadProgress(0);
          if (fileInputRef.current) fileInputRef.current.value = '';
          
          await logSystemActivity(
            'Image Upload',
            `Uploaded image "${file.name}" to storage`,
            'System',
            { fileName: file.name }
          );
          
          fetchFiles();
        }
      );
    };

    // Check if file already exists
    if (files.some(f => f.name === file.name)) {
      toast(`A file named "${file.name}" already exists.`, {
        description: "Do you want to overwrite it?",
        action: {
          label: "Overwrite",
          onClick: performUpload
        }
      });
      return;
    }

    performUpload();
  };

  const handleDelete = async (file: StorageFile) => {
    toast(`Delete "${file.name}"?`, {
      description: "This action cannot be undone.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteObject(file.ref);
            toast.success(`"${file.name}" deleted successfully`);
            
            await logSystemActivity(
              'Image Deletion',
              `Deleted image "${file.name}" from storage`,
              'System',
              { fileName: file.name }
            );
            
            fetchFiles();
          } catch (error: any) {
            console.error('Delete failed:', error);
            toast.error(`Delete failed: ${error.message}`);
          }
        }
      }
    });
  };

  const handleRename = async (file: StorageFile) => {
    if (!storage) {
      toast.error("Storage is not initialized.");
      return;
    }

    let finalNewName = newName.trim();
    if (!finalNewName || finalNewName === file.name) {
      setRenamingFile(null);
      return;
    }

    // Ensure extension is preserved if missing
    const originalExt = file.name.split('.').pop();
    const newExt = finalNewName.split('.').pop();
    
    if (originalExt && originalExt !== file.name && (!newExt || newExt !== originalExt)) {
      // If the original had an extension and the new one doesn't match it
      // we check if the user explicitly removed it or just forgot it.
      // For safety, if the new name doesn't have a dot at all, we append the original extension.
      if (!finalNewName.includes('.')) {
        finalNewName = `${finalNewName}.${originalExt}`;
      }
    }

    // Check if new name already exists
    if (files.some(f => f.name === finalNewName)) {
      toast.error(`A file named "${finalNewName}" already exists.`);
      return;
    }

    setIsRenaming(true);
    try {
      console.log(`Renaming "${file.name}" to "${finalNewName}" via Hybrid Proxy...`);
      
      // 1. Download the file data through our server proxy to bypass CORS
      console.log("Step 1: Downloading via proxy...");
      const proxyUrl = `/api/storage/proxy-download?url=${encodeURIComponent(file.url)}`;
      const downloadResponse = await fetch(proxyUrl);
      
      if (!downloadResponse.ok) {
        const errorData = await downloadResponse.json();
        throw new Error(`Proxy download failed: ${errorData.details || errorData.error}`);
      }
      
      const blob = await downloadResponse.blob();
      console.log(`Step 1 Complete: Downloaded ${blob.size} bytes`);

      // 2. Upload to the new path using client-side SDK (uses user's auth)
      console.log("Step 2: Uploading to new path...");
      const newRef = ref(storage, finalNewName);
      await uploadBytes(newRef, blob);
      console.log("Step 2 Complete: Uploaded successfully");

      // 3. Delete the old file using client-side SDK (uses user's auth)
      console.log("Step 3: Deleting old file...");
      await deleteObject(file.ref);
      console.log("Step 3 Complete: Deleted original");
      
      toast.success(`"${file.name}" renamed to "${finalNewName}"`);
      
      await logSystemActivity(
        'Image Rename',
        `Renamed image from "${file.name}" to "${finalNewName}"`,
        'System',
        { oldName: file.name, newName: finalNewName }
      );
      
      setRenamingFile(null);
      setNewName('');
      fetchFiles();
    } catch (error: any) {
      console.error('Rename failed:', error);
      toast.error(`Rename failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsRenaming(false);
    }
  };

  const copyToClipboard = (text: string, type: 'path' | 'url') => {
    window.focus();
    navigator.clipboard.writeText(text);
    setCopiedPath(text);
    toast.success(`${type === 'path' ? 'Path' : 'URL'} copied to clipboard`);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const filteredFiles = files.filter(file => 
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-warm-bg overflow-hidden">
      {/* Header */}
      <header className="bg-white/40 backdrop-blur-xl border-b border-white/40 p-8 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="font-serif italic text-4xl text-[#1A1A1A] mb-1">Image Management</h1>
          <p className="text-[#1A1A1A]/40 uppercase tracking-[0.2em] text-[10px] font-bold">Google Cloud Storage Bridge</p>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={fetchFiles}
            disabled={isRefreshing}
            className="p-3 rounded-2xl bg-white/60 border border-white/40 text-[#1A1A1A]/60 hover:text-brand-orange hover:border-brand-orange/20 transition-all shadow-sm"
            title="Refresh"
          >
            <RefreshCw size={20} className={cn(isRefreshing && "animate-spin")} />
          </button>
          
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUpload}
            className="hidden"
            accept="image/*"
          />
          
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="h-12 px-8 bg-brand-orange text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {uploading ? `Uploading ${Math.round(uploadProgress)}%` : 'Upload Image'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {/* Search and Stats */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-10">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/20" size={18} />
            <input
              type="text"
              placeholder="Search images by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-12 pl-12 pr-4 bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/20 hover:text-brand-orange"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-8">
            <div className="text-right">
              <p className="text-[10px] font-bold text-black/20 uppercase tracking-widest mb-1">Total Images</p>
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono">{files.length}</p>
            </div>
            <div className="w-px h-10 bg-black/5" />
            <div className="text-right">
              <p className="text-[10px] font-bold text-black/20 uppercase tracking-widest mb-1">Filtered</p>
              <p className="text-2xl font-bold text-brand-orange font-mono">{filteredFiles.length}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <Loader2 className="animate-spin text-brand-orange mb-4" size={48} />
            <p className="text-black/40 font-bold uppercase tracking-widest text-[10px]">Connecting to Storage...</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="bg-white/40 backdrop-blur-md border border-white/60 rounded-[40px] p-20 text-center">
            <div className="w-24 h-24 bg-black/5 text-black/20 rounded-full flex items-center justify-center mx-auto mb-8">
              <ImageIcon size={48} />
            </div>
            <h3 className="text-2xl font-bold mb-4 tracking-tight">
              {searchQuery ? 'No matching images found' : 'No images in storage'}
            </h3>
            <p className="text-black/40 mb-10 max-w-md mx-auto leading-relaxed">
              {searchQuery 
                ? `We couldn't find any images matching "${searchQuery}". Try a different search term.`
                : 'Your Google Cloud Storage bucket is currently empty. Start by uploading your first image.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-10 py-4 bg-brand-orange text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20"
              >
                Upload First Image
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            <AnimatePresence mode="popLayout">
              {filteredFiles.map((file) => (
                <motion.div
                  key={file.fullPath}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="group bg-white/40 backdrop-blur-md border border-white/60 rounded-[32px] overflow-hidden hover:shadow-2xl hover:shadow-black/5 transition-all flex flex-col"
                >
                  {/* Image Preview */}
                  <div className="aspect-video relative bg-black/5 overflow-hidden">
                    <img
                      src={file.url}
                      alt={file.name}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-3 bg-white text-black rounded-full hover:bg-brand-orange hover:text-white transition-all shadow-lg"
                        title="View Full Size"
                      >
                        <ExternalLink size={18} />
                      </a>
                      <button
                        onClick={() => handleDelete(file)}
                        className="p-3 bg-white text-red-500 rounded-full hover:bg-red-500 hover:text-white transition-all shadow-lg"
                        title="Delete Image"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="mb-4 flex-1">
                      {renamingFile === file.fullPath ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="flex-1 h-8 px-2 bg-white border border-brand-orange/40 rounded-lg text-xs focus:outline-none"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(file);
                              if (e.key === 'Escape') setRenamingFile(null);
                            }}
                          />
                          <button
                            onClick={() => handleRename(file)}
                            disabled={isRenaming}
                            className="p-1.5 bg-brand-orange text-white rounded-lg hover:bg-brand-orange/90 disabled:opacity-50"
                          >
                            {isRenaming ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          </button>
                          <button
                            onClick={() => setRenamingFile(null)}
                            disabled={isRenaming}
                            className="p-1.5 bg-black/5 text-black/40 rounded-lg hover:bg-black/10"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between group/name">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-sm text-[#1A1A1A] truncate mb-1" title={file.name}>
                              {file.name}
                            </h4>
                            <p className="text-[10px] text-black/40 font-mono truncate">
                              {file.fullPath}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setRenamingFile(file.fullPath);
                              setNewName(file.name);
                            }}
                            className="p-2 text-black/20 hover:text-brand-orange opacity-0 group-hover/name:opacity-100 transition-all"
                            title="Rename Image"
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => copyToClipboard(file.name, 'path')}
                        className="flex items-center justify-center gap-2 py-2.5 bg-black/5 hover:bg-black/10 rounded-xl text-[9px] font-bold uppercase tracking-widest text-black/60 transition-all"
                      >
                        {copiedPath === file.name ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                        Copy Path
                      </button>
                      <button
                        onClick={() => copyToClipboard(file.url, 'url')}
                        className="flex items-center justify-center gap-2 py-2.5 bg-black/5 hover:bg-black/10 rounded-xl text-[9px] font-bold uppercase tracking-widest text-black/60 transition-all"
                      >
                        {copiedPath === file.url ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                        Copy URL
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <footer className="bg-white/40 backdrop-blur-xl border-t border-white/40 p-6 text-center">
        <p className="text-[10px] text-black/30 font-bold uppercase tracking-widest">
          Tip: Use the <span className="text-brand-orange">Path</span> when setting images for cars or bikes in the Fleet Manager.
        </p>
      </footer>
    </div>
  );
};
