import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { BlogPost } from '../types';
import { Search, Calendar, User, ChevronRight, Tag } from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';

interface BlogListProps {
  onPostClick: (slug: string) => void;
  isBikeMode?: boolean;
}

export const BlogList: React.FC<BlogListProps> = ({ onPostClick, isBikeMode }) => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const q = query(
          collection(db, 'blog_posts'),
          where('status', '==', 'Published'),
          orderBy('publishedAt', 'desc')
        );

        const snapshot = await getDocs(q);
        const postsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BlogPost));
        setPosts(postsData);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching blog posts:', error);
        setLoading(false);
      }
    };

    fetchPosts();
  }, []);

  const categories = ['All', ...Array.from(new Set(posts.map(p => p.category)))];

  const filteredPosts = posts.filter(post => {
    const matchesSearch = post.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         post.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         post.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'All' || post.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-orange"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="text-center mb-16">
        <h1 className="font-serif italic text-5xl md:text-6xl text-[#1A1A1A] mb-6">Our Blog</h1>
        <p className="text-[#1A1A1A]/60 max-w-2xl mx-auto text-lg leading-relaxed">
          Discover travel tips, local guides, and the latest news from Pattaya Rent a Car.
        </p>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col md:flex-row gap-6 mb-12 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-black/20" size={20} />
          <input 
            type="text"
            placeholder="Search articles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-white/40 border border-black/10 rounded-2xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all"
          />
        </div>
        
        <div className="flex items-center gap-2 overflow-x-auto pb-2 w-full md:w-auto no-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "px-6 py-3 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap",
                selectedCategory === cat 
                  ? (isBikeMode ? "bg-brand-blue text-white shadow-lg shadow-brand-blue/20" : "bg-brand-orange text-white shadow-lg shadow-brand-orange/20")
                  : "bg-white/40 text-black/40 hover:bg-white/60"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Blog Grid */}
      {filteredPosts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredPosts.map((post, index) => (
            <motion.article
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onPostClick(post.slug)}
              className="group cursor-pointer bg-white/40 backdrop-blur-sm border border-black/5 rounded-[40px] overflow-hidden hover:shadow-2xl hover:shadow-black/5 transition-all flex flex-col h-full"
            >
              <div className="aspect-[16/10] overflow-hidden relative">
                {post.coverImage ? (
                  <img 
                    src={post.coverImage} 
                    alt={post.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-black/5 flex items-center justify-center">
                    <Tag className="text-black/10" size={48} />
                  </div>
                )}
                <div className="absolute top-6 left-6">
                  <span className={cn(
                    "px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest text-white shadow-lg",
                    isBikeMode ? "bg-brand-blue" : "bg-brand-orange"
                  )}>
                    {post.category}
                  </span>
                </div>
              </div>
              
              <div className="p-8 flex flex-col flex-1">
                <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-black/40 mb-4">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={12} />
                    {post.publishedAt ? format(new Date(post.publishedAt), 'MMM dd, yyyy') : 'Recently'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User size={12} />
                    {post.author}
                  </div>
                </div>
                
                <h3 className="font-serif italic text-2xl text-[#1A1A1A] mb-4 group-hover:text-brand-orange transition-colors line-clamp-2">
                  {post.title}
                </h3>
                
                <p className="text-black/60 text-sm leading-relaxed mb-8 line-clamp-3">
                  {post.excerpt}
                </p>
                
                <div className="mt-auto pt-6 border-t border-black/5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]">Read Article</span>
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform group-hover:translate-x-1",
                    isBikeMode ? "bg-brand-blue" : "bg-brand-orange"
                  )}>
                    <ChevronRight size={16} />
                  </div>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-white/20 rounded-[40px] border border-dashed border-black/10">
          <p className="text-black/40 font-medium">No articles found matching your search.</p>
        </div>
      )}
    </div>
  );
};
