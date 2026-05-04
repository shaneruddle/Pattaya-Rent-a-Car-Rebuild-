import React, { useState, useEffect } from 'react';
import { Star, RefreshCw, AlertCircle, ExternalLink, MessageSquare, CheckCircle, Search, Calendar, User, ArrowUpRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Review {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  date: string;
  reply: string | null;
  repliedAt: string | null;
  source: string;
}

export const ReviewManagement: React.FC = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(() => {
    return localStorage.getItem('prac_google_connected') === 'true';
  });
  const [checkingAuth, setCheckingAuth] = useState(true);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/google/status');
      const data = await response.json();
      setIsConnected(data.connected);
      localStorage.setItem('prac_google_connected', data.connected ? 'true' : 'false');
      if (data.connected) {
        fetchReviews();
      }
    } catch (err) {
      console.error('Error checking auth status:', err);
    } finally {
      setCheckingAuth(false);
    }
  };

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/reviews/google-business');
      const data = await response.json();
      if (response.ok) {
        setReviews(data.reviews || []);
      } else {
        setError(data.error || 'Failed to fetch reviews');
      }
    } catch (err) {
      setError('Connection failed. Please check your network.');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const origin = window.location.origin;
      const res = await fetch(`/api/auth/google/url?origin=${encodeURIComponent(origin)}`);
      const { url } = await res.json();
      
      // Redirect current window instead of popup to handle code in App.tsx
      window.location.href = url;
    } catch (err) {
      toast.error('Failed to initiate login');
    }
  };

  useEffect(() => {
    checkAuthStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsConnected(true);
        fetchReviews();
        toast.success('Google Business Profile connected!');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#F9F7F2]">
      {/* Header */}
      <div className="bg-white/40 backdrop-blur-xl border-b border-black/10 p-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-4xl font-serif italic text-[#1A1A1A] mb-2">Review Management</h1>
            <p className="text-black/60">Monitor and respond to your Google Business Profile reviews.</p>
          </div>
          
          <div className="flex items-center gap-3">
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={checkingAuth}
                className="bg-[#1A1A1A] hover:bg-brand-orange text-white px-6 py-3 rounded-2xl flex items-center gap-2 font-bold uppercase tracking-widest text-xs transition-all shadow-lg active:scale-95"
              >
                {checkingAuth ? <Loader2 className="w-4 h-4 animate-spin" /> : <div className="w-4 h-4 bg-white rounded-full flex items-center justify-center text-[10px] text-black font-bold">G</div>}
                Connect Google Business
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold flex items-center gap-2">
                  <CheckCircle size={14} /> Connected
                </div>
                <button
                  onClick={fetchReviews}
                  disabled={loading}
                  className="p-3 bg-white hover:bg-black/5 text-black/60 rounded-2xl transition-all border border-black/10"
                  title="Refresh Reviews"
                >
                  <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-7xl mx-auto">
          {!isConnected ? (
            <div className="bg-white rounded-[2rem] border border-black/10 p-12 text-center shadow-xl shadow-black/5">
              <div className="w-20 h-20 bg-brand-orange/10 rounded-3xl flex items-center justify-center mx-auto mb-6 text-brand-orange">
                <MessageSquare size={40} />
              </div>
              <h2 className="text-2xl font-bold text-[#1A1A1A] mb-4">Connect your Google account</h2>
              <p className="text-black/60 max-w-md mx-auto mb-8">
                Link your Google Business Profile to view, monitor, and reply to client reviews directly from your dashboard.
              </p>
              <button
                onClick={handleConnect}
                className="bg-brand-orange hover:bg-[#1A1A1A] text-white px-10 py-4 rounded-2xl font-bold uppercase tracking-widest text-sm transition-all shadow-xl active:scale-95"
              >
                Sign in with Google
              </button>
            </div>
          ) : loading && reviews.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-white rounded-[2rem] border border-black/10 p-6 h-64 animate-pulse">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-black/5 rounded-full" />
                    <div className="flex-1">
                      <div className="h-4 bg-black/5 rounded w-24 mb-2" />
                      <div className="h-3 bg-black/5 rounded w-16" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-4 bg-black/5 rounded w-full" />
                    <div className="h-4 bg-black/5 rounded w-full" />
                    <div className="h-4 bg-black/5 rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-100 rounded-[2rem] p-12 text-center">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-xl font-bold text-red-900 mb-2">Something went wrong</h3>
              <p className="text-red-700/70 mb-6">{error}</p>
              <button
                onClick={fetchReviews}
                className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95"
              >
                Try Again
              </button>
            </div>
          ) : reviews.length === 0 ? (
            <div className="bg-white rounded-[2rem] border border-black/10 p-12 text-center shadow-xl shadow-black/5">
              <div className="w-16 h-16 bg-black/5 rounded-2xl flex items-center justify-center mx-auto mb-4 text-black/20">
                <Search size={32} />
              </div>
              <h3 className="text-xl font-bold text-[#1A1A1A] mb-2">No reviews found</h3>
              <p className="text-black/60">We couldn't find any reviews for this business location yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ReviewCard: React.FC<{ review: Review }> = ({ review }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-[2rem] border border-black/10 p-6 flex flex-col shadow-xl shadow-black/5 hover:shadow-black/10 hover:-translate-y-1 transition-all group"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-orange/10 text-brand-orange rounded-full flex items-center justify-center font-bold text-sm">
            {(review.authorName || '?').charAt(0)}
          </div>
          <div>
            <h4 className="font-bold text-[#1A1A1A] leading-tight flex items-center gap-2">
              {review.authorName || 'Google User'}
            </h4>
            <div className="flex items-center gap-1 text-[#FFD700]">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={10}
                  fill={i < review.rating ? "currentColor" : "none"}
                  className={i < review.rating ? "" : "text-black/10"}
                />
              ))}
            </div>
          </div>
        </div>
        <span className="text-[10px] text-black/30 font-medium whitespace-nowrap">
          {format(new Date(review.date), 'MMM d, yyyy')}
        </span>
      </div>

      <div className="flex-1">
        <p className="text-sm text-black/70 leading-relaxed italic line-clamp-4 group-hover:line-clamp-none transition-all">
          "{review.comment}"
        </p>
      </div>

      {review.reply && (
        <div className="mt-4 pt-4 border-t border-black/5 bg-[#F9F7F2]/50 p-3 rounded-2xl relative">
          <div className="absolute -top-2 left-6 px-2 bg-[#F9F7F2] text-[8px] font-bold uppercase tracking-widest text-brand-orange">
            Our Reply
          </div>
          <p className="text-[11px] text-black/60 italic leading-relaxed">
            {review.reply}
          </p>
        </div>
      )}

      {!review.reply && (
        <div className="mt-4 flex justify-end">
          <button className="text-[10px] font-bold uppercase tracking-widest text-brand-orange flex items-center gap-1 hover:gap-2 transition-all">
            Reply on Google <ArrowUpRight size={10} />
          </button>
        </div>
      )}
    </motion.div>
  );
};
