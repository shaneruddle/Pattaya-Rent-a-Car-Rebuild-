import React, { useState, useEffect } from 'react';
import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  where,
  Timestamp 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth, storage, logSystemActivity } from '../firebase';
import { BlogPost } from '../types';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Save, 
  X, 
  Image as ImageIcon, 
  Loader2, 
  FileText,
  Eye,
  CheckCircle,
  Clock,
  ChevronRight,
  Globe,
  Tag,
  User,
  Calendar,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import ReactMarkdown from 'react-markdown';
import { parse, unparse } from 'papaparse';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

export const BlogManager: React.FC = () => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);

  useEffect(() => {
    const fetchPosts = async () => {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'blog_posts'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const postsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BlogPost));
        setPosts(postsData);
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'blog_posts');
        setLoading(false);
      }
    };
    fetchPosts();
  }, []);

  const handleExportCSV = () => {
    const exportData = posts.map(post => ({
      Title: post.title,
      Slug: post.slug,
      Category: post.category,
      Tags: post.tags.join(', '),
      Status: post.status,
      Author: post.author,
      Excerpt: post.excerpt,
      Content: post.content,
      CoverImage: post.coverImage || '',
      CreatedAt: post.createdAt,
      UpdatedAt: post.updatedAt,
      PublishedAt: post.publishedAt || ''
    }));

    const csv = unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `prac_blogs_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Blogs exported successfully');
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data as any[];
        let importedCount = 0;
        let skippedCount = 0;

        toast.loading(`Importing ${data.length} blog posts...`);

        for (const item of data) {
          try {
            const title = item.Title || item.title || 'Untitled Post';
            const rawSlug = item.Slug || item.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const slug = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            
            // Check if slug already exists to avoid duplicates
            if (posts.some(p => p.slug === slug)) {
              skippedCount++;
              continue;
            }

            // Construct content from multiple body/subheading fields if they exist
            let content = item.Content || item.content || "";
            if (!content) {
              if (item.Introduction) content += item.Introduction + "\n\n";
              for (let i = 1; i <= 10; i++) {
                const sub = item[`Subheading${i}`];
                const body = item[`Body${i}`];
                const img = item[`Blog_image${i}`] || item[`Blog_Image${i}`];
                if (sub) content += `## ${sub}\n\n`;
                if (img) content += `![Image](${img})\n\n`;
                if (body) content += body + "\n\n";
              }
              if (item.Conclusion) content += `## Conclusion\n\n` + item.Conclusion;
            }

            // Convert [url=...] BBCode to Markdown if present
            content = content.replace(/\[url=(.*?)\](.*?)\[\/url\]/g, '[$2]($1)');
            content = content.replace(/\[ml\]\[ul\]\[li.*?\](.*?)\[\/li\]\[\/ul\]\[\/ml\]/g, '* $1');
            content = content.replace(/\[b\](.*?)\[\/b\]/g, '**$1**');
            content = content.replace(/\[i\](.*?)\[\/i\]/g, '*$1*');
            content = content.replace(/\[h(\d)\](.*?)\[\/h\d\]/g, (match: string, level: string, text: string) => {
              return '#'.repeat(parseInt(level)) + ' ' + text;
            });

            const createdAt = item['Creation Date'] || item.CreatedAt || new Date().toISOString();
            const updatedAt = item['Modified Date'] || item.UpdatedAt || new Date().toISOString();
            
            const postData: Partial<BlogPost> = {
              title,
              slug,
              content,
              excerpt: item['Meta Description'] || item.Excerpt || item.excerpt || "",
              category: item.Category || item.category || "General",
              tags: (item.Tags || item.tags || "").split(',').map((t: string) => t.trim()).filter(Boolean),
              status: (item.published === 'yes' || item.Status === 'Published') ? 'Published' : 'Draft',
              author: item.Creator || item.Author || item.author || auth.currentUser?.displayName || 'Admin',
              authorId: auth.currentUser?.uid || '',
              coverImage: item['Thumbnail Image'] || item.Banner || item.CoverImage || item.coverImage || "",
              createdAt: new Date(createdAt).toISOString(),
              updatedAt: new Date(updatedAt).toISOString()
            };

            if (postData.status === 'Published') {
              postData.publishedAt = postData.updatedAt;
            }

            await addDoc(collection(db, 'blog_posts'), postData);
            importedCount++;
          } catch (error) {
            console.error('Error importing post:', error);
          }
        }

        toast.dismiss();
        toast.success(`Import complete: ${importedCount} imported, ${skippedCount} skipped`);
        
        await logSystemActivity(
          'Import Blog Posts',
          `Imported ${importedCount} blog posts from CSV`,
          'Website',
          { count: importedCount }
        );
      }
    });
    
    // Reset input
    e.target.value = '';
  };

  const handleAddNew = () => {
    const newPost: Partial<BlogPost> = {
      title: 'New Blog Post',
      slug: 'new-blog-post',
      content: '# Welcome to your new post\n\nStart writing here...',
      excerpt: 'A brief summary of your post...',
      category: 'General',
      tags: [],
      status: 'Draft',
      author: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
      authorId: auth.currentUser?.uid || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    setSelectedPost(newPost as BlogPost);
    setIsEditing(true);
    setPreviewMode(false);
    setIsSlugManuallyEdited(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPost) return;

    // Final slug cleanup
    const finalSlug = selectedPost.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    if (!finalSlug) {
      toast.error('Slug is required');
      return;
    }

    // Check for duplicate slug (excluding current post)
    if (posts.some(p => p.slug === finalSlug && p.id !== selectedPost.id)) {
      toast.error('This slug is already in use by another post');
      return;
    }

    try {
      const postData = {
        ...selectedPost,
        slug: finalSlug,
        updatedAt: new Date().toISOString()
      };

      if (selectedPost.id) {
        const { id, ...updateData } = postData;
        await updateDoc(doc(db, 'blog_posts', id), updateData);
        toast.success('Blog post updated');
        
        setPosts(prev => prev.map(p => p.id === id ? { ...p, ...updateData } : p));
        
        await logSystemActivity(
          'Update Blog Post',
          `Updated blog post: ${postData.title}`,
          'Website',
          { postId: id }
        );
      } else {
        const docRef = await addDoc(collection(db, 'blog_posts'), postData);
        const newPostWithId = { ...postData, id: docRef.id };
        toast.success('Blog post created');
        setSelectedPost(newPostWithId);
        setPosts(prev => [newPostWithId, ...prev]);
        
        await logSystemActivity(
          'Create Blog Post',
          `Created new blog post: ${postData.title}`,
          'Website',
          { postId: docRef.id }
        );
      }
      setIsEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'blog_posts');
    }
  };

  const handleDelete = async (id: string) => {
    toast('Delete this post?', {
      description: "This action cannot be undone.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteDoc(doc(db, 'blog_posts', id));
            toast.success('Blog post deleted');
            setPosts(prev => prev.filter(p => p.id !== id));
            if (selectedPost?.id === id) setSelectedPost(null);
            
            await logSystemActivity(
              'Delete Blog Post',
              `Deleted blog post ID: ${id}`,
              'Website',
              { postId: id }
            );
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `blog_posts/${id}`);
          }
        }
      }
    });
  };

  const handlePublish = async (post: BlogPost) => {
    try {
      const newStatus = post.status === 'Published' ? 'Draft' : 'Published';
      const updateData: any = { 
        status: newStatus,
        updatedAt: new Date().toISOString()
      };
      
      if (newStatus === 'Published') {
        updateData.publishedAt = new Date().toISOString();
      }

      await updateDoc(doc(db, 'blog_posts', post.id), updateData);
      
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, ...updateData } : p));
      if (selectedPost?.id === post.id) {
        setSelectedPost(prev => prev ? { ...prev, ...updateData } : null);
      }
      
      toast.success(newStatus === 'Published' ? 'Post published!' : 'Post moved to drafts');
      
      await logSystemActivity(
        'Publish Blog Post',
        `${newStatus === 'Published' ? 'Published' : 'Unpublished'} blog post: ${post.title}`,
        'Website',
        { postId: post.id, status: newStatus }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `blog_posts/${post.id}`);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPost) return;

    setUploadingImage(true);
    try {
      const storageRef = ref(storage, `blog/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      
      setSelectedPost({ ...selectedPost, coverImage: url });
      toast.success('Image uploaded');
    } catch (error) {
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const filteredPosts = posts.filter(post => 
    post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    post.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const publishedCount = posts.filter(p => p.status === 'Published').length;
  const draftCount = posts.filter(p => p.status === 'Draft').length;

  return (
    <div className="flex flex-col h-full bg-warm-bg">
      {/* Header */}
      <div className="p-8 bg-white/60 backdrop-blur-xl border-b border-black/10 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div>
            <h1 className="text-3xl font-serif italic text-[#1A1A1A] flex items-center gap-3">
              <FileText className="text-brand-orange" size={28} />
              Blog Manager
            </h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] mt-1 font-medium">Create and manage your website content</p>
          </div>
          
          <div className="flex items-center gap-4 border-l border-black/10 pl-8">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Published</span>
              <span className="text-xl font-serif italic text-green-600">{publishedCount}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Drafts</span>
              <span className="text-xl font-serif italic text-gray-400">{draftCount}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Total</span>
              <span className="text-xl font-serif italic text-[#1A1A1A]">{posts.length}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/40 border border-black/10 text-[#1A1A1A] rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-white/60 transition-all"
          >
            <FileText size={14} />
            Export CSV
          </button>
          <label className="flex items-center gap-2 px-4 py-2.5 bg-white/40 border border-black/10 text-[#1A1A1A] rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-white/60 transition-all cursor-pointer">
            <Plus size={14} />
            Import CSV
            <input type="file" accept=".csv" onChange={handleImportCSV} className="hidden" />
          </label>
          <button
            onClick={handleAddNew}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-orange text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
          >
            <Plus size={14} />
            New Post
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/40" size={18} />
            <input 
              type="text"
              placeholder="SEARCH POSTS..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-white/40 border border-black/10 rounded-full text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-orange/20 w-64"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar List */}
        <div className="w-80 border-r border-black/10 bg-white/20 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="animate-spin text-brand-orange" size={32} />
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {filteredPosts.map(post => (
                <button
                  key={post.id}
                  onClick={() => {
                    setSelectedPost(post);
                    setIsEditing(false);
                    setPreviewMode(false);
                    setIsSlugManuallyEdited(false);
                  }}
                  className={cn(
                    "w-full p-4 rounded-2xl transition-all text-left group flex flex-col gap-2",
                    selectedPost?.id === post.id 
                      ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                      : "bg-white/40 hover:bg-white/60 text-[#1A1A1A]"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest",
                      post.status === 'Published' 
                        ? (selectedPost?.id === post.id ? "bg-white/20 text-white" : "bg-green-100 text-green-600")
                        : (selectedPost?.id === post.id ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500")
                    )}>
                      {post.status}
                    </span>
                    <span className={cn(
                      "text-[8px] font-bold uppercase tracking-widest",
                      selectedPost?.id === post.id ? "text-white/60" : "text-[#1A1A1A]/40"
                    )}>
                      {new Date(post.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="font-bold text-xs uppercase tracking-wider line-clamp-2">{post.title}</div>
                  <div className={cn(
                    "text-[9px] uppercase tracking-widest font-medium",
                    selectedPost?.id === post.id ? "text-white/60" : "text-[#1A1A1A]/40"
                  )}>
                    {post.category}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            {selectedPost ? (
              <motion.div
                key={selectedPost.id || 'new'}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto space-y-8"
              >
                {/* Actions Bar */}
                <div className="flex items-center justify-between bg-white/60 backdrop-blur-xl p-4 rounded-2xl border border-black/10 shadow-sm">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setIsEditing(!isEditing);
                        setPreviewMode(false);
                      }}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                        isEditing 
                          ? "bg-brand-orange text-white" 
                          : "bg-white/80 text-[#1A1A1A] hover:bg-white"
                      )}
                    >
                      {isEditing ? <X size={14} /> : <Edit2 size={14} />}
                      {isEditing ? 'Cancel' : 'Edit Post'}
                    </button>
                    {!isEditing && (
                      <>
                        <button
                          onClick={() => setPreviewMode(!previewMode)}
                          className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                            previewMode 
                              ? "bg-[#1A1A1A] text-white" 
                              : "bg-white/80 text-[#1A1A1A] hover:bg-white"
                          )}
                        >
                          <Eye size={14} />
                          {previewMode ? 'Close Preview' : 'Preview'}
                        </button>
                        {selectedPost.status === 'Published' && (
                          <a
                            href={`/blog/${selectedPost.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2 bg-white/80 text-[#1A1A1A] hover:bg-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-black/5"
                          >
                            <ExternalLink size={14} />
                            View Live
                          </a>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedPost.id && (
                      <>
                        <button
                          onClick={() => handlePublish(selectedPost)}
                          className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                            selectedPost.status === 'Published'
                              ? "bg-gray-100 text-gray-500 hover:bg-gray-200"
                              : "bg-green-500 text-white hover:bg-green-600"
                          )}
                        >
                          {selectedPost.status === 'Published' ? <Clock size={14} /> : <CheckCircle size={14} />}
                          {selectedPost.status === 'Published' ? 'Move to Draft' : 'Publish Now'}
                        </button>
                        <button
                          onClick={() => handleDelete(selectedPost.id)}
                          className="p-2 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <form onSubmit={handleSave} className="space-y-6">
                    <div className="bg-white/60 backdrop-blur-xl rounded-[32px] p-8 border border-black/10 shadow-xl space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Post Title</label>
                            <input 
                              type="text"
                              required
                              value={selectedPost.title}
                              onChange={(e) => {
                                const newTitle = e.target.value;
                                const updates: any = { title: newTitle };
                                if (!isSlugManuallyEdited) {
                                  updates.slug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                                }
                                setSelectedPost({...selectedPost, ...updates});
                              }}
                              className="w-full px-4 py-3 bg-white/40 border border-black/10 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                              placeholder="Enter title..."
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">URL Slug (SEO)</label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] text-[#1A1A1A]/30 font-mono">/blog/</span>
                              <input 
                                type="text"
                                required
                                value={selectedPost.slug}
                                onChange={(e) => {
                                  setIsSlugManuallyEdited(true);
                                  setSelectedPost({...selectedPost, slug: e.target.value.toLowerCase().replace(/\s+/g, '-')});
                                }}
                                className="w-full pl-14 pr-4 py-3 bg-white/40 border border-black/10 rounded-2xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                                placeholder="url-slug..."
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Category</label>
                            <input 
                              type="text"
                              value={selectedPost.category}
                              onChange={(e) => setSelectedPost({...selectedPost, category: e.target.value})}
                              className="w-full px-4 py-3 bg-white/40 border border-black/10 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                              placeholder="e.g. Travel, News, Maintenance..."
                            />
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Cover Image</label>
                            <div className="flex gap-2">
                              <input 
                                type="text"
                                value={selectedPost.coverImage || ''}
                                onChange={(e) => setSelectedPost({...selectedPost, coverImage: e.target.value})}
                                className="flex-1 px-4 py-3 bg-white/40 border border-black/10 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                                placeholder="Image URL..."
                              />
                              <label className="p-3 bg-white/60 border border-black/10 rounded-2xl hover:bg-white cursor-pointer transition-all">
                                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} />
                                {uploadingImage ? <Loader2 className="animate-spin" size={18} /> : <ImageIcon size={18} />}
                              </label>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Excerpt (Summary)</label>
                            <textarea 
                              value={selectedPost.excerpt}
                              onChange={(e) => setSelectedPost({...selectedPost, excerpt: e.target.value})}
                              className="w-full px-4 py-3 bg-white/40 border border-black/10 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20 h-20 resize-none"
                              placeholder="Short summary for list views..."
                            />
                          </div>
                        </div>
                      </div>

                      <div className="quill-editor-container">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1.5 ml-1">Content</label>
                        <ReactQuill 
                          theme="snow"
                          value={selectedPost.content}
                          onChange={(content) => setSelectedPost({...selectedPost, content})}
                          placeholder="Write your post content here..."
                          modules={{
                            toolbar: [
                              [{ 'header': [1, 2, 3, false] }],
                              ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                              [{'list': 'ordered'}, {'list': 'bullet'}, {'indent': '-1'}, {'indent': '+1'}],
                              ['link', 'image'],
                              ['clean']
                            ],
                          }}
                        />
                      </div>

                      <div className="flex justify-end gap-4">
                        <button
                          type="button"
                          onClick={() => setIsEditing(false)}
                          className="px-8 py-3 bg-white/40 text-[#1A1A1A] rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-white/60 transition-all border border-black/10"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="flex items-center gap-2 px-8 py-3 bg-brand-orange text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                        >
                          <Save size={14} />
                          Save Post
                        </button>
                      </div>
                    </div>
                  </form>
                ) : previewMode ? (
                  <div className="bg-white rounded-[32px] p-12 border border-black/10 shadow-xl prose prose-orange max-w-none">
                    {selectedPost.coverImage && (
                      <img src={selectedPost.coverImage} alt={selectedPost.title} className="w-full h-64 object-cover rounded-2xl mb-8" />
                    )}
                    <h1 className="font-serif italic text-4xl mb-4">{selectedPost.title}</h1>
                    <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-8 border-b border-black/5 pb-4">
                      <span className="flex items-center gap-2"><User size={14} /> {selectedPost.author}</span>
                      <span className="flex items-center gap-2"><Calendar size={14} /> {new Date(selectedPost.createdAt).toLocaleDateString()}</span>
                      <span className="flex items-center gap-2"><Tag size={14} /> {selectedPost.category}</span>
                    </div>
                    <div 
                      className="blog-content"
                      dangerouslySetInnerHTML={{ __html: selectedPost.content }}
                    />
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* Post Detail View */}
                    <div className="bg-white/60 backdrop-blur-xl rounded-[32px] p-8 border border-black/10 shadow-xl">
                      <div className="flex gap-8">
                        {selectedPost.coverImage && (
                          <div className="w-1/3 aspect-video rounded-2xl overflow-hidden border border-black/10">
                            <img src={selectedPost.coverImage} alt={selectedPost.title} className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest",
                              selectedPost.status === 'Published' ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-500"
                            )}>
                              {selectedPost.status}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">{selectedPost.category}</span>
                          </div>
                          <h2 className="text-3xl font-serif italic text-[#1A1A1A] mb-4">{selectedPost.title}</h2>
                          <p className="text-sm text-[#1A1A1A]/60 leading-relaxed mb-6">{selectedPost.excerpt}</p>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-white/40 rounded-2xl border border-black/10">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Author</div>
                              <div className="text-sm font-bold text-[#1A1A1A]">{selectedPost.author}</div>
                            </div>
                            <div className="p-4 bg-white/40 rounded-2xl border border-black/10">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Created</div>
                              <div className="text-sm font-bold text-[#1A1A1A]">{new Date(selectedPost.createdAt).toLocaleString()}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Quick Stats or Info */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-black/10 flex flex-col items-center text-center">
                        <Globe className="text-brand-orange mb-2" size={24} />
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Slug</div>
                        <div className="text-[10px] font-mono text-[#1A1A1A] break-all">{selectedPost.slug}</div>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-black/10 flex flex-col items-center text-center">
                        <Clock className="text-brand-orange mb-2" size={24} />
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Last Updated</div>
                        <div className="text-xs font-bold text-[#1A1A1A]">{new Date(selectedPost.updatedAt).toLocaleDateString()}</div>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md p-6 rounded-3xl border border-black/10 flex flex-col items-center text-center">
                        <CheckCircle className="text-brand-orange mb-2" size={24} />
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Status</div>
                        <div className="text-xs font-bold text-[#1A1A1A]">{selectedPost.status}</div>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-[#1A1A1A]/20">
                <div className="w-24 h-24 rounded-full bg-white/40 flex items-center justify-center mb-4 border border-black/10">
                  <FileText size={48} />
                </div>
                <h3 className="text-xl font-serif italic text-[#1A1A1A]/40">Select a post to manage</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest mt-2">Choose from the list on the left or create a new one</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
