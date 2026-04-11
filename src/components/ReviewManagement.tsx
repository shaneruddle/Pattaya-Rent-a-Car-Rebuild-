import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star, MessageSquare, Settings, Save, RefreshCw, CheckCircle2, AlertCircle, Trash2, Reply, Globe, Lock, Loader2, Copy } from 'lucide-react';
import { db } from '../firebase';
import { collection, getDocs, query, orderBy, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Review, ReviewSettings } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { fetchWithRetry } from '../lib/api';

export const ReviewManagement: React.FC = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'reviews' | 'settings'>('reviews');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [publicReviews, setPublicReviews] = useState<any[]>([]);
  const [isFetchingPublic, setIsFetchingPublic] = useState(false);
  const [redirectUri, setRedirectUri] = useState<string>('');

  const [isAddingReview, setIsAddingReview] = useState(false);
  const [newReview, setNewReview] = useState({ customerName: '', rating: 5, comment: '' });

  const [syncStatus, setSyncStatus] = useState<{ lastSync: string | null, status: 'success' | 'error' | null }>({ lastSync: null, status: null });

  const handleAddManualReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const reviewData = {
        ...newReview,
        date: new Date().toISOString(),
        source: 'Manual',
        isAutomated: false,
        updatedAt: serverTimestamp()
      };
      await addDoc(collection(db, 'reviews'), reviewData);
      toast.success('Review added successfully');
      setIsAddingReview(false);
      setNewReview({ customerName: '', rating: 5, comment: '' });
    } catch (error) {
      console.error('Error adding manual review:', error);
      toast.error('Failed to add review');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    checkAuthStatus();
    fetch('/api/debug/oauth').then(r => r.json()).then(d => setRedirectUri(d.redirectUri)).catch(() => {});

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsAuthenticated(true);
        toast.success("Successfully connected to Google Business");
        checkAuthStatus();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        toast.error(event.data.error || "Failed to connect to Google Business");
      }
    };

    window.addEventListener('message', handleMessage);

    const fetchData = async () => {
      try {
        const reviewsQuery = query(collection(db, 'reviews'), orderBy('date', 'desc'));
        const snapshot = await getDocs(reviewsQuery);
        const reviewsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Review));
        setReviews(reviewsData);

        const settingsRef = doc(db, 'review_settings', 'default');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          setSettings({ id: settingsSnap.id, ...settingsSnap.data() } as ReviewSettings);
        } else {
          const defaultSettings: Omit<ReviewSettings, 'id'> = {
            autoReplyEnabled: false,
            autoReplyTemplate: "Thank you for your review, {customerName}! We appreciate your feedback.",
            minRatingForAutoReply: 4
          };
          await setDoc(settingsRef, defaultSettings);
          setSettings({ id: 'default', ...defaultSettings } as ReviewSettings);
        }
        setIsLoading(false);
      } catch (error) {
        console.error("Error fetching review data:", error);
        setIsLoading(false);
      }
    };

    fetchData();

    // Fetch public reviews as a fallback/initial view
    const fetchPublicReviews = async () => {
      setIsFetchingPublic(true);
      try {
        const res = await fetchWithRetry('/api/reviews');
        if (res.ok) {
          const data = await res.json();
          if (data.reviews) {
            setPublicReviews(data.reviews);
          }
        }
      } catch (error) {
        console.error("Error fetching public reviews:", error);
      } finally {
        setIsFetchingPublic(false);
      }
    };

    fetchPublicReviews();

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetchWithRetry('/api/auth/google/status');
      if (res.ok) {
        const data = await res.json();
        setIsAuthenticated(data.authenticated);
      }
    } catch (error) {
      console.error("Error checking auth status:", error);
      setIsAuthenticated(false);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetchWithRetry('/api/auth/google/url');
      const data = await res.json();
      
      if (res.ok) {
        const { url } = data;
        
        // Open in a popup as required for iframe environments
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const popup = window.open(
          url,
          'google_auth_popup',
          `width=${width},height=${height},left=${left},top=${top},toolbar=0,scrollbars=1,status=0,resizable=1,location=1,menuBar=0`
        );

        if (!popup) {
          toast.error("Popup blocked! Please allow popups for this site.");
        }
      } else {
        toast.error(data.error || "Failed to get authentication URL");
      }
    } catch (error) {
      console.error("Error getting auth URL:", error);
      toast.error("Failed to connect to Google");
    }
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetchWithRetry('/api/auth/google/logout', { method: 'POST' });
      if (res.ok) {
        setIsAuthenticated(false);
        toast.success("Disconnected from Google Business");
      } else {
        toast.error("Failed to disconnect");
      }
    } catch (error) {
      console.error("Error disconnecting:", error);
      toast.error("An error occurred while disconnecting");
    }
  };

  const handleUseDemoData = async () => {
    setIsSyncing(true);
    try {
      const demoReviews = [
        {
          id: 'demo_1',
          customerName: 'Somsak P.',
          rating: 5,
          comment: 'Excellent service! The car was clean and the staff was very helpful. Highly recommended for anyone visiting Pattaya.',
          date: new Date().toISOString(),
          source: 'Google',
          locationName: 'Pattaya Main Office'
        },
        {
          id: 'demo_2',
          customerName: 'Sarah Miller',
          rating: 4,
          comment: 'Good experience overall. Easy booking process and fair prices. Will use again.',
          date: new Date(Date.now() - 86400000).toISOString(),
          source: 'Google',
          locationName: 'Pattaya Main Office'
        },
        {
          id: 'demo_3',
          customerName: 'Hans Schmidt',
          rating: 5,
          comment: 'Best car rental in Pattaya. Very professional and reliable.',
          date: new Date(Date.now() - 172800000).toISOString(),
          source: 'Google',
          locationName: 'Pattaya Main Office'
        }
      ];

      const batch = writeBatch(db);
      demoReviews.forEach((review) => {
        const reviewRef = doc(db, 'reviews', `google_${review.id}`);
        batch.set(reviewRef, {
          ...review,
          isAutomated: false,
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
      
      await batch.commit();
      setSyncStatus({ lastSync: new Date().toISOString(), status: 'success' });
      toast.success('Demo reviews loaded successfully');
    } catch (error) {
      console.error('Error loading demo data:', error);
      toast.error('Failed to load demo data');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncGoogleReviews = async () => {
    setIsSyncing(true);
    try {
      const res = await fetchWithRetry('/api/reviews/google-business');
      const data = await res.json();
      
      if (res.ok) {
        toast.success('Reviews synced successfully');
        setSyncStatus({ lastSync: new Date().toISOString(), status: 'success' });
      } else {
        toast.error(data.error || 'Failed to sync reviews');
        setSyncStatus({ lastSync: new Date().toISOString(), status: 'error' });
      }
    } catch (error) {
      console.error('Error syncing reviews:', error);
      toast.error('Failed to sync reviews');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'review_settings', 'default'), {
        autoReplyEnabled: settings.autoReplyEnabled,
        autoReplyTemplate: settings.autoReplyTemplate,
        minRatingForAutoReply: settings.minRatingForAutoReply
      });
      toast.success('Settings saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendReply = async (reviewId: string) => {
    if (!replyText.trim()) return;

    try {
      await updateDoc(doc(db, 'reviews', reviewId), {
        reply: replyText,
        repliedAt: new Date().toISOString(),
        isAutomated: false
      });
      toast.success('Reply sent successfully');
      setReplyingTo(null);
      setReplyText('');
    } catch (error) {
      console.error('Error sending reply:', error);
      toast.error('Failed to send reply');
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    toast('Delete this review?', {
      description: "This action cannot be undone.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteDoc(doc(db, 'reviews', reviewId));
            toast.success('Review deleted');
            setReviews(prev => prev.filter(r => r.id !== reviewId));
          } catch (error) {
            console.error('Error deleting review:', error);
            toast.error('Failed to delete review');
          }
        }
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-brand-orange animate-spin" />
      </div>
    );
  }

  if (isAuthenticated === false && publicReviews.length > 0) {
    return (
      <div className="flex-1 overflow-y-auto p-8 bg-warm-bg">
        <div className="max-w-6xl mx-auto">
          <div className="bg-brand-orange/10 border border-brand-orange/20 rounded-[32px] p-8 mb-12 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Globe className="text-brand-orange" size={20} />
                <h2 className="font-bold text-xl text-[#1A1A1A]">Public Review View</h2>
              </div>
              <p className="text-sm text-[#1A1A1A]/60 leading-relaxed">
                You are currently viewing public reviews from Google Maps. To <strong>reply</strong> to reviews and manage your business profile directly from this dashboard, please connect your Google Business account.
              </p>
              {redirectUri && (
                <div className="mt-4 p-3 bg-white/50 rounded-xl border border-brand-orange/10 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-brand-orange mb-1">OAuth Redirect URI</p>
                    <p className="text-xs font-mono truncate text-gray-600">{redirectUri}</p>
                  </div>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(redirectUri);
                      toast.success("Redirect URI copied to clipboard");
                    }}
                    className="p-2 hover:bg-brand-orange/10 rounded-lg text-brand-orange transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy size={16} />
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleConnect}
              className="whitespace-nowrap bg-brand-orange text-white px-8 py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 hover:bg-brand-orange/90 transition-all shadow-xl shadow-brand-orange/20"
            >
              <Lock size={16} /> Connect to Reply
            </button>
          </div>

          <header className="mb-12">
            <h1 className="font-serif italic text-5xl text-gray-900 mb-4">Latest Google Reviews</h1>
            <p className="text-gray-500 font-medium">Showing the most recent public reviews from your Google Maps profile.</p>
          </header>

          <div className="space-y-6">
            {publicReviews.map((review, idx) => (
              <div 
                key={idx}
                className="bg-white/60 backdrop-blur-xl border border-black/5 rounded-[32px] p-8 shadow-sm"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center gap-4">
                    <img 
                      src={review.profile_photo_url} 
                      alt={review.author_name}
                      className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm"
                      referrerPolicy="no-referrer"
                    />
                    <div>
                      <h3 className="font-bold text-gray-900">{review.author_name}</h3>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{review.relative_time_description}</span>
                        <span>•</span>
                        <span className="uppercase tracking-widest font-bold text-[8px] bg-gray-100 px-2 py-0.5 rounded">
                          Google Maps
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {[...Array(5)].map((_, i) => (
                      <Star 
                        key={i} 
                        size={16} 
                        className={cn(
                          i < review.rating ? "text-yellow-400 fill-yellow-400" : "text-gray-200"
                        )} 
                      />
                    ))}
                  </div>
                </div>
                <p className="text-gray-700 leading-relaxed italic">"{review.text}"</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-warm-bg p-8 text-center">
        <div className="w-24 h-24 bg-brand-orange/10 rounded-[40px] flex items-center justify-center mb-8">
          <Lock className="text-brand-orange" size={40} />
        </div>
        <h1 className="font-serif italic text-4xl text-[#1A1A1A] mb-4">Connect Google Business</h1>
        <p className="text-[#1A1A1A]/60 max-w-md mb-10 leading-relaxed">
          To pull in your latest Google reviews and manage replies, we need to securely connect to your Google Business Profile.
        </p>
        <button
          onClick={handleConnect}
          className="bg-brand-orange text-white px-12 py-5 rounded-3xl font-bold uppercase tracking-widest flex items-center gap-3 hover:bg-brand-orange/90 transition-all shadow-xl shadow-brand-orange/20"
        >
          <Globe size={20} /> Connect Google Business
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-warm-bg">
      <div className="max-w-6xl mx-auto">
        <header className="mb-12 flex justify-between items-start">
          <div>
            <h1 className="font-serif italic text-5xl text-gray-900 mb-4">Review Management</h1>
            <div className="flex items-center gap-4">
              <p className="text-gray-500 font-medium max-w-2xl">
                Monitor customer feedback and manage automated responses to maintain high engagement.
              </p>
              {syncStatus.lastSync && (
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  syncStatus.status === 'success' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                )}>
                  <div className={cn("w-1.5 h-1.5 rounded-full", syncStatus.status === 'success' ? "bg-green-500" : "bg-red-500")} />
                  Last Sync: {format(new Date(syncStatus.lastSync), 'HH:mm')}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setIsAddingReview(true)}
              className="px-6 py-4 bg-white text-gray-900 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 hover:bg-gray-50 transition-all border border-black/5 shadow-sm"
            >
              <Star size={18} /> Add Review
            </button>
            <button
              onClick={handleSyncGoogleReviews}
              disabled={isSyncing}
              className={cn(
                "px-8 py-4 bg-[#1A1A1A] text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 hover:bg-brand-orange transition-all shadow-xl shadow-black/10 disabled:opacity-50",
                isSyncing && "animate-pulse"
              )}
            >
              {isSyncing ? <RefreshCw className="animate-spin" size={18} /> : <Globe size={18} />}
              {isSyncing ? "Syncing..." : "Sync Google Reviews"}
            </button>
            <button
              onClick={handleDisconnect}
              className="px-6 py-4 bg-white/40 text-gray-500 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:text-red-500 hover:bg-red-50 transition-all border border-black/5"
              title="Disconnect Google Account"
            >
              <Lock size={14} />
              Disconnect
            </button>
          </div>
        </header>

        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setActiveTab('reviews')}
            className={cn(
              "px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all flex items-center gap-2",
              activeTab === 'reviews' 
                ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                : "bg-white/40 text-gray-500 hover:bg-white/60"
            )}
          >
            <MessageSquare size={16} />
            Latest Reviews ({reviews.length})
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={cn(
              "px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all flex items-center gap-2",
              activeTab === 'settings' 
                ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                : "bg-white/40 text-gray-500 hover:bg-white/60"
            )}
          >
            <Settings size={16} />
            Auto-Reply Settings
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'reviews' ? (
            <motion.div
              key="reviews"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {reviews.length === 0 ? (
                <div className="bg-white/40 backdrop-blur-xl border border-black/5 rounded-[32px] p-12 text-center">
                  <div className="w-16 h-16 bg-brand-orange/10 rounded-full flex items-center justify-center mx-auto mb-4 text-brand-orange">
                    <MessageSquare size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">No reviews yet</h3>
                  <p className="text-gray-500">Click "Sync Google Reviews" to pull in your latest feedback.</p>
                </div>
              ) : (
                reviews.map((review) => (
                  <div 
                    key={review.id}
                    className="bg-white/60 backdrop-blur-xl border border-black/5 rounded-[32px] p-8 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-brand-orange/10 rounded-full flex items-center justify-center text-brand-orange font-bold text-xl">
                          {review.customerName.charAt(0)}
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-900">{review.customerName}</h3>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>{format(new Date(review.date), 'MMM d, yyyy • h:mm a')}</span>
                            <span>•</span>
                            <span className="uppercase tracking-widest font-bold text-[8px] bg-gray-100 px-2 py-0.5 rounded">
                              {review.source}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {[...Array(5)].map((_, i) => (
                          <Star 
                            key={i} 
                            size={16} 
                            className={cn(
                              i < review.rating ? "text-yellow-400 fill-yellow-400" : "text-gray-200"
                            )} 
                          />
                        ))}
                      </div>
                    </div>

                    <p className="text-gray-700 mb-6 leading-relaxed italic">
                      "{review.comment}"
                    </p>

                    {review.reply ? (
                      <div className="bg-brand-orange/5 border border-brand-orange/10 rounded-2xl p-6 relative">
                        <div className="flex items-center gap-2 mb-2">
                          <Reply size={14} className="text-brand-orange" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-brand-orange">
                            Your Reply {review.isAutomated && "(Automated)"}
                          </span>
                          <span className="text-[10px] text-gray-400 ml-auto">
                            {format(new Date(review.repliedAt!), 'MMM d, yyyy')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 italic">"{review.reply}"</p>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => handleDeleteReview(review.id)}
                          className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          title="Delete Review"
                        >
                          <Trash2 size={18} />
                        </button>
                        <button
                          onClick={() => setReplyingTo(replyingTo === review.id ? null : review.id)}
                          className="px-6 py-2 bg-[#1A1A1A] text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-brand-orange transition-all flex items-center gap-2"
                        >
                          <Reply size={14} />
                          Reply
                        </button>
                      </div>
                    )}

                    <AnimatePresence>
                      {replyingTo === review.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="mt-6 pt-6 border-t border-black/5"
                        >
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Type your response..."
                            className="w-full bg-white/40 border-2 border-black/5 rounded-2xl p-4 text-sm focus:border-brand-orange outline-none transition-all min-h-[100px] mb-4"
                          />
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => setReplyingTo(null)}
                              className="px-6 py-2 text-gray-500 font-bold text-[10px] uppercase tracking-widest"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSendReply(review.id)}
                              disabled={!replyText.trim()}
                              className="px-8 py-2 bg-brand-orange text-white rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-brand-orange/20 disabled:opacity-50"
                            >
                              Send Reply
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))
              )}
            </motion.div>
          ) : (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl"
            >
              <form onSubmit={handleSaveSettings} className="bg-white/60 backdrop-blur-xl border border-black/5 rounded-[32px] p-8 shadow-sm">
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-gray-900">Automated Replies</h3>
                      <p className="text-xs text-gray-500">Automatically respond to new reviews based on rating.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSettings(s => s ? { ...s, autoReplyEnabled: !s.autoReplyEnabled } : null)}
                      className={cn(
                        "w-14 h-8 rounded-full relative transition-all",
                        settings?.autoReplyEnabled ? "bg-brand-orange" : "bg-gray-200"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-6 h-6 bg-white rounded-full shadow-sm transition-all",
                        settings?.autoReplyEnabled ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">
                      Minimum Rating for Auto-Reply
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={rating}
                          type="button"
                          onClick={() => setSettings(s => s ? { ...s, minRatingForAutoReply: rating } : null)}
                          className={cn(
                            "flex-1 py-3 rounded-xl font-bold text-sm transition-all",
                            settings?.minRatingForAutoReply === rating
                              ? "bg-[#1A1A1A] text-white shadow-md"
                              : "bg-white/40 text-gray-400 hover:bg-white/60"
                          )}
                        >
                          {rating}+ Stars
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-end ml-4">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Reply Template
                      </label>
                      <span className="text-[8px] text-gray-400 font-mono">
                        Use {"{customerName}"} as a placeholder
                      </span>
                    </div>
                    <textarea
                      value={settings?.autoReplyTemplate || ''}
                      onChange={(e) => setSettings(s => s ? { ...s, autoReplyTemplate: e.target.value } : null)}
                      placeholder="Enter your automated response template..."
                      className="w-full bg-white/40 border-2 border-black/5 rounded-2xl p-6 text-sm focus:border-brand-orange outline-none transition-all min-h-[150px]"
                    />
                  </div>

                  <div className="pt-4">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="w-full py-4 bg-brand-orange text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] shadow-xl shadow-brand-orange/20 hover:bg-[#1A1A1A] transition-all flex items-center justify-center gap-3"
                    >
                      {isSaving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
                      {isSaving ? "Saving..." : "Save Settings"}
                    </button>
                  </div>
                </div>
              </form>

              <div className="mt-8 bg-white/40 border border-black/5 rounded-[32px] p-8 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-600">
                    <Globe size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Connected to Google Business</h4>
                    <p className="text-sm text-gray-500">Your account is linked and ready to sync reviews.</p>
                  </div>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="px-6 py-3 bg-red-50 text-red-600 rounded-2xl font-bold text-[10px] uppercase tracking-widest hover:bg-red-100 transition-all border border-red-100"
                >
                  Disconnect Account
                </button>
              </div>

              <div className="mt-8 bg-brand-orange/5 border border-brand-orange/10 rounded-[32px] p-8">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-brand-orange/10 rounded-2xl text-brand-orange">
                    <AlertCircle size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 mb-2">How it works</h4>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      When a new review is received, the system will check the rating. If it meets your minimum requirement and auto-replies are enabled, it will immediately post your template response, replacing {"{customerName}"} with the reviewer's name.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Manual Review Modal */}
        <AnimatePresence>
          {isAddingReview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsAddingReview(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-lg bg-white rounded-[40px] shadow-2xl overflow-hidden"
              >
                <div className="p-8 border-b border-black/5 flex justify-between items-center">
                  <h3 className="font-serif italic text-2xl text-gray-900">Add Manual Review</h3>
                  <button onClick={() => setIsAddingReview(false)} className="text-gray-400 hover:text-gray-600">
                    <Trash2 size={20} />
                  </button>
                </div>
                <form onSubmit={handleAddManualReview} className="p-8 space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Customer Name</label>
                    <input
                      required
                      type="text"
                      value={newReview.customerName}
                      onChange={e => setNewReview(prev => ({ ...prev, customerName: e.target.value }))}
                      className="w-full bg-warm-bg border-2 border-transparent rounded-2xl px-6 py-4 text-sm focus:border-brand-orange outline-none transition-all"
                      placeholder="e.g. John Doe"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Rating</label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setNewReview(prev => ({ ...prev, rating: r }))}
                          className={cn(
                            "flex-1 py-3 rounded-xl font-bold text-sm transition-all",
                            newReview.rating === r ? "bg-brand-orange text-white" : "bg-warm-bg text-gray-400"
                          )}
                        >
                          {r} ★
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Comment</label>
                    <textarea
                      required
                      value={newReview.comment}
                      onChange={e => setNewReview(prev => ({ ...prev, comment: e.target.value }))}
                      className="w-full bg-warm-bg border-2 border-transparent rounded-2xl px-6 py-4 text-sm focus:border-brand-orange outline-none transition-all min-h-[120px]"
                      placeholder="What did the customer say?"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="w-full py-5 bg-[#1A1A1A] text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] shadow-xl hover:bg-brand-orange transition-all flex items-center justify-center gap-3"
                  >
                    {isSaving ? <RefreshCw className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                    {isSaving ? "Adding..." : "Save Review"}
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
