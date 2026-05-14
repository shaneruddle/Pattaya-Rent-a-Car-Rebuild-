import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Loader2, Globe, Calendar, User, Clock, ShieldCheck, Car as CarIcon, MapPin, Phone, Mail } from 'lucide-react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { MarketingPage } from '../types';
import { useLanguage } from '../LanguageContext';
import { useCompanyConfig } from '../hooks/useCompanyConfig';
import { cn } from '../lib/utils';
import { Helmet } from 'react-helmet-async';

interface MarketingPageViewProps {
  fullPath: string;
  isBikeMode?: boolean;
}

const MarketingPageView: React.FC<MarketingPageViewProps> = ({ fullPath, isBikeMode }) => {
  const [page, setPage] = useState<MarketingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { language } = useLanguage();
  const { config } = useCompanyConfig();

  useEffect(() => {
    const fetchPage = async () => {
      setLoading(true);
      setError(null);
      try {
        // Normalize the path (ensure leading slash, no trailing slash)
        const normalizedPath = '/' + fullPath.split('/').filter(Boolean).join('/');
        
        // Try querying by fullUrl (handles both leading and non-leading slash versions)
        const q = query(
          collection(db, 'marketing_pages'),
          where('fullUrl', 'in', [normalizedPath, normalizedPath.substring(1)]),
          where('status', '==', 'Published'),
          limit(1)
        );
        
        let snapshot = await getDocs(q);
        
        // Fallback: If not found by fullUrl, try matching by slug as a secondary lookup
        if (snapshot.empty) {
          const segments = normalizedPath.split('/').filter(Boolean);
          const potentialSlug = segments[segments.length - 1];
          
          if (potentialSlug) {
            const qSlug = query(
              collection(db, 'marketing_pages'),
              where('slug', '==', potentialSlug),
              where('status', '==', 'Published'),
              limit(1)
            );
            snapshot = await getDocs(qSlug);
          }
        }
        
        if (!snapshot.empty) {
          const pageData = snapshot.docs[0].data();
          setPage({ id: snapshot.docs[0].id, ...pageData } as MarketingPage);
        } else {
          setError('Page not found');
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'marketing_pages');
        setError('Failed to load page');
      } finally {
        setLoading(false);
      }
    };

    fetchPage();
  }, [fullPath]);

  if (loading) {
    return (
      <div className="min-h-screen bg-warm-bg flex items-center justify-center p-20">
        <Loader2 className="animate-spin text-brand-orange" size={48} />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-screen bg-warm-bg flex items-center justify-center p-20 text-center">
        <div className="max-w-md space-y-6">
          <h2 className="text-4xl font-black tracking-tight text-gray-900">404</h2>
          <p className="text-gray-500 font-medium">Sorry, we couldn't find the page you're looking for.</p>
          <a href="/" className="inline-block bg-black text-white px-8 py-4 rounded-full font-bold uppercase tracking-widest text-[10px] shadow-xl hover:bg-brand-orange transition-all">
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-warm-bg min-h-screen">
      <Helmet>
        <title>{page.title} | {config.companyName}</title>
        <meta name="description" content={page.metaDescription} />
        {page.keywords && <meta name="keywords" content={page.keywords} />}
        {page.canonicalUrl && <link rel="canonical" href={page.canonicalUrl} />}
        {page.schemaMarkup && (
          <script type="application/ld+json">
            {page.schemaMarkup}
          </script>
        )}
      </Helmet>

      <div className="max-w-7xl mx-auto px-6 pt-32 pb-20">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <div className="flex items-center gap-4 text-[10px] font-bold text-brand-orange uppercase tracking-[0.4em] mb-6">
            <span>{page.layoutType}</span>
            <span className="text-black/10">•</span>
            <span>{config.companyName}</span>
          </div>
          <h1 className="text-5xl md:text-8xl font-black tracking-tighter text-black leading-[0.9] mb-12">
            {page.title}
          </h1>
          
          {page.excerpt && (
            <p className="text-xl md:text-2xl text-black/60 leading-relaxed font-medium max-w-4xl border-l-4 border-brand-orange pl-8 py-2">
              {page.excerpt}
            </p>
          )}
        </motion.div>

        {page.featuredImageUrl && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="mb-20 relative group"
          >
            <div className="absolute -inset-4 bg-brand-orange/5 blur-3xl rounded-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
            <div className="relative aspect-[21/9] rounded-[40px] overflow-hidden shadow-2xl shadow-black/10">
              <img 
                src={page.featuredImageUrl} 
                alt={page.featuredImageAlt || page.title} 
                className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-8"
          >
            <div 
              className="prose prose-xl prose-brand max-w-none text-black/70 leading-relaxed
                prose-headings:text-black prose-headings:font-black prose-headings:tracking-tight
                prose-a:text-brand-orange prose-a:no-underline hover:prose-a:underline
                prose-strong:text-black prose-strong:font-black
                prose-img:rounded-[32px] prose-img:shadow-2xl
                prose-blockquote:border-brand-orange prose-blockquote:bg-brand-orange/5 prose-blockquote:py-2 prose-blockquote:rounded-r-2xl prose-blockquote:font-medium text-lg md:text-xl"
              dangerouslySetInnerHTML={{ __html: page.content }}
            />
          </motion.div>

          {/* Sidebar */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-4 space-y-8"
          >
            <div className="bg-white/40 backdrop-blur-xl border border-white/60 p-8 rounded-[32px] shadow-2xl shadow-black/5 sticky top-32">
              <h3 className="text-xl font-black tracking-tight mb-6">Need a Rental?</h3>
              <p className="text-sm text-black/50 mb-8 font-medium">Ready to explore Pattaya with the most trusted rental service? Book your vehicle now.</p>
              
              <div className="space-y-4">
                <a 
                  href="/rent-a-car" 
                  className={cn(
                    "flex items-center justify-between p-5 rounded-2xl bg-black text-white hover:bg-brand-orange transition-all group group-hover:shadow-xl group-hover:shadow-brand-orange/20",
                    isBikeMode && "hover:bg-brand-blue group-hover:shadow-brand-blue/20"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <CarIcon className="text-brand-orange group-hover:text-white transition-colors" size={20} />
                    <span className="font-bold uppercase tracking-widest text-[10px]">Rent a Car</span>
                  </div>
                  <Globe size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
                
                <a 
                  href="/rent-a-bike" 
                  className="flex items-center justify-between p-5 rounded-2xl bg-white/60 border border-black/5 text-black hover:border-brand-orange transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <ShieldCheck className="text-black/20 group-hover:text-brand-orange transition-colors" size={20} />
                    <span className="font-bold uppercase tracking-widest text-[10px]">Rent a Bike</span>
                  </div>
                  <Globe size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              </div>

              <div className="mt-12 pt-8 border-t border-black/5 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center text-brand-orange">
                    <Phone size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest">Call Us</p>
                    <p className="text-sm font-bold">{config.phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center text-brand-orange">
                    <Mail size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest">Email</p>
                    <p className="text-sm font-bold truncate max-w-[180px]">{config.email}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default MarketingPageView;
