import React, { useState, useEffect } from 'react';
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { BlogPost } from '../types';
import { Calendar, User, ChevronLeft, Tag, Share2, Facebook, Twitter, Link as LinkIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { cn } from '../lib/utils';
import { Helmet } from 'react-helmet-async';
import { toast } from 'sonner';

interface BlogPostViewProps {
  slug: string;
  onBack: () => void;
  isBikeMode?: boolean;
}

export const BlogPostView: React.FC<BlogPostViewProps> = ({ slug, onBack, isBikeMode }) => {
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'blog_posts'),
      where('slug', '==', slug),
      where('status', '==', 'Published'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setPost({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as BlogPost);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [slug]);

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: post?.title,
        text: post?.excerpt,
        url: window.location.href,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied to clipboard!');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-orange"></div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h2 className="font-serif italic text-4xl text-[#1A1A1A] mb-6">Article Not Found</h2>
        <p className="text-black/60 mb-10">The article you're looking for might have been moved or deleted.</p>
        <button 
          onClick={onBack}
          className={cn(
            "px-8 py-4 text-white rounded-full font-bold uppercase tracking-widest text-xs shadow-lg",
            isBikeMode ? "bg-brand-blue" : "bg-brand-orange"
          )}
        >
          Back to Blog
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <Helmet>
        <title>{post.title} | Pattaya Rent a Car Blog</title>
        <meta name="description" content={post.excerpt} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.excerpt} />
        {post.coverImage && <meta property="og:image" content={post.coverImage} />}
        <meta property="og:type" content="article" />
      </Helmet>

      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/40 hover:text-black transition-colors mb-12 group"
      >
        <div className="w-8 h-8 rounded-full bg-white/40 flex items-center justify-center group-hover:bg-white/60 transition-colors">
          <ChevronLeft size={16} />
        </div>
        Back to Blog
      </button>

      <article>
        <header className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <span className={cn(
              "px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest text-white shadow-lg",
              isBikeMode ? "bg-brand-blue" : "bg-brand-orange"
            )}>
              {post.category}
            </span>
            <div className="h-px flex-1 bg-black/5" />
          </div>
          
          <h1 className="font-serif italic text-4xl md:text-6xl text-[#1A1A1A] mb-8 leading-tight">
            {post.title}
          </h1>
          
          <div className="flex flex-wrap items-center gap-6 text-[10px] font-bold uppercase tracking-widest text-black/40">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center">
                <User size={14} />
              </div>
              {post.author}
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={14} />
              {post.publishedAt ? format(new Date(post.publishedAt), 'MMMM dd, yyyy') : 'Recently'}
            </div>
            <button 
              onClick={handleShare}
              className="flex items-center gap-2 hover:text-black transition-colors ml-auto"
            >
              <Share2 size={14} />
              Share Article
            </button>
          </div>
        </header>

        {post.coverImage && (
          <div className="aspect-[21/9] rounded-[40px] overflow-hidden mb-16 shadow-2xl">
            <img 
              src={post.coverImage} 
              alt={post.title}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        <div className="prose prose-lg max-w-none prose-headings:font-serif prose-headings:italic prose-headings:text-[#1A1A1A] prose-p:text-black/70 prose-p:leading-relaxed prose-a:text-brand-orange prose-strong:text-[#1A1A1A] prose-img:rounded-[32px] prose-img:shadow-xl">
          <ReactMarkdown>{post.content}</ReactMarkdown>
        </div>

        <footer className="mt-20 pt-12 border-t border-black/5">
          <div className="flex flex-wrap gap-3 mb-12">
            {post.tags.map(tag => (
              <span key={tag} className="flex items-center gap-1.5 px-4 py-2 bg-black/5 rounded-full text-[10px] font-bold uppercase tracking-widest text-black/60">
                <Tag size={12} />
                {tag}
              </span>
            ))}
          </div>

          <div className="bg-white/40 backdrop-blur-xl rounded-[40px] p-12 border border-black/5 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="text-center md:text-left">
              <h3 className="font-serif italic text-2xl text-[#1A1A1A] mb-2">Enjoyed this article?</h3>
              <p className="text-black/60 text-sm">Share it with your friends and fellow travelers.</p>
            </div>
            <div className="flex items-center gap-4">
              <button className="w-12 h-12 rounded-full bg-[#1877F2] text-white flex items-center justify-center hover:scale-110 transition-transform">
                <Facebook size={20} />
              </button>
              <button className="w-12 h-12 rounded-full bg-[#1DA1F2] text-white flex items-center justify-center hover:scale-110 transition-transform">
                <Twitter size={20} />
              </button>
              <button 
                onClick={handleShare}
                className="w-12 h-12 rounded-full bg-black text-white flex items-center justify-center hover:scale-110 transition-transform"
              >
                <LinkIcon size={20} />
              </button>
            </div>
          </div>
        </footer>
      </article>
    </div>
  );
};
