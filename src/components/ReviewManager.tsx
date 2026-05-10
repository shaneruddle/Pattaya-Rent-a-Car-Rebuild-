import React, { useState, useEffect } from 'react';
import { Star, User, Calendar, AlertCircle, RefreshCw, Globe, MessageSquare, Reply } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import axios from 'axios';
import { useCompanyConfig } from '../hooks/useCompanyConfig';

interface Review {
  id: string;
  customerName: string;
  rating: number;
  text: string;
  date: string;
  reply?: string;
}

export const ReviewManager: React.FC = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const { config } = useCompanyConfig();
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [apiErrorDetail, setApiErrorDetail] = useState<any>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // Fixed IDs based on your Advanced Settings screenshot
  const ACCOUNT_ID = "7192667108038735534"; 
  const LOCATION_ID = "3859625379026712805"; 

  const mapRatingToNumber = (rating: string | number): number => {
    const map: Record<string, number> = { 'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5 };
    return typeof rating === 'string' ? (map[rating] || 5) : rating;
  };

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true; script.defer = true;
    script.onload = () => {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/business.manage",
        callback: (response: any) => {
          if (response.access_token) {
            setToken(response.access_token);
            setApiErrorDetail(null);
          }
        },
      });
      setTokenClient(client);
    };
    document.head.appendChild(script);
    return () => { if (document.head.contains(script)) document.head.removeChild(script); };
  }, []);

  const handleSignIn = () => {
    if (tokenClient) tokenClient.requestAccessToken({ prompt: 'select_account consent' });
  };

  const loadReviews = async () => {
    if (!token) return;
    setLoading(true);
    setApiErrorDetail(null);

    // List of potential endpoints to try in order
    const endpoints = [
      `https://mybusiness.googleapis.com/v4/accounts/${ACCOUNT_ID}/locations/${LOCATION_ID}/reviews`,
      `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${ACCOUNT_ID}/locations/${LOCATION_ID}/reviews`
    ];

    let success = false;
    for (const url of endpoints) {
      if (success) break;
      try {
        const res = await axios.get(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.data.reviews) {
          setReviews(res.data.reviews.map((r: any) => ({
            id: r.reviewId,
            customerName: r.reviewer?.displayName || 'Customer',
            rating: mapRatingToNumber(r.starRating),
            text: r.comment || '',
            date: new Date(r.createTime).toLocaleDateString('en-GB'),
            reply: r.reviewReply?.comment
          })));
          success = true;
        }
      } catch (err: any) {
        console.warn(`Failed endpoint: ${url}`, err.response?.data);
        setApiErrorDetail(err.response?.data || { message: "Permission Denied" });
      }
    }
    setLoading(false);
  };

  const handlePostReply = async (reviewId: string) => {
    if (!token) return;
    try {
      const url = `https://mybusiness.googleapis.com/v4/accounts/${ACCOUNT_ID}/locations/${LOCATION_ID}/reviews/${reviewId}/reply`;
      await axios.put(url, { comment: replyText }, { headers: { 'Authorization': `Bearer ${token}` } });
      setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, reply: replyText } : r));
      setReplyingTo(null); setReplyText('');
    } catch (err: any) {
      alert("Failed to post reply.");
    }
  };

  useEffect(() => { if (token) loadReviews(); }, [token]);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 text-[#1A1A1A]">
      <header className="flex justify-between items-end border-b border-black/5 pb-8">
        <div>
          <h1 className="font-serif italic text-4xl">Reputation Management</h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-orange mt-2">{config.companyName} • 1,256 Reviews</p>
        </div>
        <button 
          onClick={handleSignIn}
          className={cn("px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all", 
            token ? "bg-green-50 text-green-600 border border-green-100" : "bg-black text-white hover:bg-brand-orange shadow-lg")}
        >
          <Globe className="inline-block mr-2" size={14} />
          {token ? 'Google Profile Connected ✅' : 'Connect Google Business'}
        </button>
      </header>

      {apiErrorDetail && (
        <div className="bg-red-50 border-2 border-red-100 rounded-3xl p-6">
          <div className="flex items-center gap-2 text-red-600 font-bold text-xs uppercase mb-2">
            <AlertCircle size={14} /> Connection Debug
          </div>
          <pre className="font-mono text-[10px] text-red-700 overflow-auto bg-white/50 p-4 rounded-xl max-h-40">
            {JSON.stringify(apiErrorDetail, null, 2)}
          </pre>
        </div>
      )}

      <div className="grid gap-6">
        {loading ? (
          <div className="py-20 text-center animate-pulse font-serif italic text-xl text-black/40">Syncing live reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="py-20 text-center bg-white border border-black/5 rounded-[32px] italic text-[#1A1A1A]/40 shadow-sm">
            {!token ? "Connect your account to load your reviews." : "No reviews found."}
          </div>
        ) : (
          reviews.map((review) => (
            <motion.div key={review.id} className="bg-white border border-black/5 rounded-[32px] p-8 shadow-sm">
              <div className="flex justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-brand-orange/10 rounded-2xl flex items-center justify-center text-brand-orange"><User size={20} /></div>
                  <div>
                    <div className="font-bold text-lg">{review.customerName}</div>
                    <div className="text-[10px] text-black/40 font-bold uppercase">{review.date}</div>
                  </div>
                </div>
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={16} fill={i < review.rating ? "#facd49" : "none"} className={i < review.rating ? "text-[#facd49]" : "text-gray-200"} />
                  ))}
                </div>
              </div>
              <p className="italic text-black/80 leading-relaxed font-medium mb-6">"{review.text}"</p>
              
              <div className="border-t border-black/5 pt-6 flex justify-between items-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                  <MessageSquare size={14} /> Google Business Profile
                </div>
                <button 
                  onClick={() => {
                    setReplyingTo(replyingTo === review.id ? null : review.id);
                    setReplyText(review.reply || '');
                  }}
                  className="flex items-center gap-2 px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-brand-orange bg-brand-orange/5 hover:bg-brand-orange/10"
                >
                  <Reply size={14} /> {review.reply ? 'Edit Reply' : 'Reply'}
                </button>
              </div>

              <AnimatePresence>
                {replyingTo === review.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-4">
                    <textarea 
                      className="w-full h-32 p-4 bg-[#F9F9F9] border border-black/5 rounded-2xl text-sm mb-2"
                      placeholder="Write your response..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <button onClick={() => handlePostReply(review.id)} className="bg-black text-white px-8 py-3 rounded-xl text-[10px] font-bold uppercase">Post Reply</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              {review.reply && !replyingTo && (
                <div className="mt-6 p-4 bg-green-50/50 rounded-2xl border border-green-100 text-sm italic text-green-800">
                  <span className="font-bold uppercase text-[9px] block mb-1 text-green-600">Your Response:</span>
                  "{review.reply}"
                </div>
              )}
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};