import React, { useState, useEffect } from 'react';
import { 
  Star, 
  User, 
  Calendar, 
  AlertCircle, 
  RefreshCw, 
  MessageSquare, 
  Copy, 
  CheckCheck,
  Sparkles, 
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import axios from 'axios';
import { useCompanyConfig } from '../hooks/useCompanyConfig';
import { GoogleGenAI } from "@google/genai";

interface PlaceReview {
  id: string; // Internal mapping
  authorName: string;
  rating: number;
  text: string;
  publishTime: string;
  relativePublishTime: string;
  photoUri?: string;
}

interface PlaceDetails {
  id: string;
  displayName: string;
  rating: number;
  userRatingCount: number;
  reviews: PlaceReview[];
}

export const ReviewManager: React.FC = () => {
  const { config } = useCompanyConfig();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeDetails, setPlaceDetails] = useState<PlaceDetails | null>(null);
  
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [aiReplies, setAiReplies] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const HARDCODED_PLACE_ID = 'ChIJz64hZEKWAjER5Tj4QtUkkDU';

  const loadReviews = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post('/api/places/details', { 
        place_id: HARDCODED_PLACE_ID
      });

      if (response.data) {
        const data = response.data;
        // The Places API (New) typically returns 5 reviews. 
        // If it ever returns more, we limit to the latest 10 as requested.
        const allReviews = data.reviews || [];
        const sortedReviews = [...allReviews].sort((a: any, b: any) => 
          new Date(b.publishTime).getTime() - new Date(a.publishTime).getTime()
        );
        const limitedReviews = sortedReviews.slice(0, 10);

        setPlaceDetails({
          id: HARDCODED_PLACE_ID,
          displayName: data.displayName?.text || 'Pattaya Rent a Car',
          rating: data.rating || 0,
          userRatingCount: data.userRatingCount || 0,
          reviews: limitedReviews.map((r: any, idx: number) => ({
            id: r.name || `${HARDCODED_PLACE_ID}_${idx}`, 
            authorName: r.authorAttribution?.displayName || 'Anonymous',
            rating: r.rating || 0,
            text: r.text?.text || '',
            publishTime: r.publishTime || new Date().toISOString(),
            relativePublishTime: r.relativePublishTimeDescription || 'Recently',
            photoUri: r.authorAttribution?.photoUri
          }))
        });
      } else if (response.data?.error_message) {
        throw new Error(response.data.error_message);
      }
    } catch (err: any) {
      console.error("Fetch Places Detail Error:", err.response?.data || err.message);
      
      let detailedError = "Failed to load reviews";
      if (err.response?.status === 403) {
        detailedError = "403 Forbidden: The server's Google Maps API key is restricted or invalid. Please ensure the 'Places API (New)' is enabled and restrictions are correctly configured for server-side access.";
      } else if (err.response?.data?.error) {
        detailedError = err.response.data.error;
      } else if (err.message) {
        detailedError = err.message;
      }
      
      setError(detailedError);
    } finally {
      setLoading(false);
    }
  };

  const generateAIReply = async (review: PlaceReview) => {
    setGeneratingFor(review.id);
    try {
      const geminiKey = process.env.GEMINI_API_KEY || '';
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      const prompt = `
        You are the manager of 'Pattaya Rent a Car', a professional car rental business in Pattaya, Thailand.
        Write a professional, friendly, and warm response to the following customer review.
        
        Customer Name: ${review.authorName}
        Rating: ${review.rating}/5
        Review Text: "${review.text}"
        
        Guidelines:
        - Thank the customer by name.
        - Address specific points mentioned in their review.
        - Be professional yet welcoming.
        - Mention the business name 'Pattaya Rent a Car' (always).
        - If it's a negative review (3 stars or less), apologize sincerely and offer them to contact us directly to make it right.
        - The response should be in English.
        - Keep it concise (3-5 sentences).
        - Do not include placeholders like [Your Name].
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });

      const text = response.text || '';
      setAiReplies(prev => ({ ...prev, [review.id]: text.trim() }));
    } catch (err: any) {
      console.error("AI Generation Error:", err);
      alert(`Failed to generate AI reply: ${err.message}`);
    } finally {
      setGeneratingFor(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    loadReviews();
  }, []);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 text-[#1A1A1A]">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-black/5 pb-8 gap-4">
        <div>
          <h1 className="font-serif italic text-4xl">Reputation Management</h1>
          <div className="flex items-center gap-3 mt-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-orange">{config?.companyName || 'Pattaya Rent a Car'}</p>
            {placeDetails && (
              <div className="flex items-center gap-2 bg-black/5 px-3 py-1 rounded-full">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={10} fill={i < Math.floor(placeDetails.rating) ? "#facd49" : "none"} className={i < Math.floor(placeDetails.rating) ? "text-[#facd49]" : "text-gray-300"} />
                  ))}
                </div>
                <span className="text-[10px] font-bold">{placeDetails.rating} ({placeDetails.userRatingCount} reviews)</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => loadReviews()}
            disabled={loading}
            className="px-6 py-3 rounded-2xl bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? 'Refreshing...' : 'Refresh Reviews'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border-2 border-red-100 rounded-3xl p-6 flex items-start gap-4">
          <AlertCircle className="text-red-600 shrink-0" size={20} />
          <div>
            <div className="text-red-600 font-bold text-xs uppercase mb-1">Sync Error</div>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}


      <div className="grid gap-6">
        {loading && !placeDetails ? (
          <div className="py-20 text-center space-y-4">
            <RefreshCw className="mx-auto animate-spin text-brand-orange" size={32} />
            <div className="font-serif italic text-xl text-black/40">Syncing live reviews from Google Places...</div>
          </div>
        ) : !placeDetails ? (
          <div className="py-20 text-center bg-white border border-black/5 rounded-[32px] space-y-6 shadow-sm p-12">
            <div className="bg-brand-orange/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-brand-orange">
              <Search size={24} />
            </div>
            <div className="space-y-2">
              <p className="italic text-[#1A1A1A]/40 font-serif text-xl">No reviews syncable.</p>
              <p className="text-xs text-black/40 max-w-xs mx-auto uppercase tracking-widest font-bold">Please ensure the Google Maps API Key is correctly configured in the project settings.</p>
            </div>
            <button 
              onClick={() => loadReviews()}
              className="bg-black text-white px-8 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest"
            >
              Retry Sync
            </button>
          </div>
        ) : (
          placeDetails.reviews.map((review) => (
            <motion.div key={review.id} layout className="bg-white border border-black/5 rounded-[32px] p-8 shadow-sm hover:shadow-md transition-all">
              <div className="flex flex-col md:flex-row justify-between mb-6 gap-4">
                <div className="flex items-center gap-4">
                  {review.photoUri ? (
                    <img src={review.photoUri} alt={review.authorName} className="w-12 h-12 rounded-2xl object-cover border border-black/5" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-12 h-12 bg-brand-orange/10 rounded-2xl flex items-center justify-center text-brand-orange shadow-inner"><User size={20} /></div>
                  )}
                  <div>
                    <div className="font-bold text-lg leading-none mb-1">{review.authorName}</div>
                    <div className="text-[10px] text-black/40 font-bold uppercase tracking-tight flex items-center gap-2">
                      <Calendar size={10} /> {review.relativePublishTime}
                    </div>
                  </div>
                </div>
                <div className="flex gap-0.5 bg-black/[0.03] p-2 rounded-xl">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={16} fill={i < review.rating ? "#facd49" : "none"} className={i < review.rating ? "text-[#facd49]" : "text-gray-200"} />
                  ))}
                </div>
              </div>
              
              <p className="italic text-black/80 leading-relaxed font-medium mb-8 text-lg">"{review.text}"</p>

              <div className="border-t border-black/5 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                  <MessageSquare size={14} /> Google Maps Review
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                  {!aiReplies[review.id] ? (
                    <button 
                      onClick={() => generateAIReply(review)}
                      disabled={generatingFor === review.id}
                      className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-white bg-black hover:bg-brand-orange disabled:bg-gray-400 transition-all shadow-lg"
                    >
                      {generatingFor === review.id ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Sparkles size={14} />
                          Generate AI Reply
                        </>
                      )}
                    </button>
                  ) : (
                    <button 
                      onClick={() => generateAIReply(review)}
                      disabled={generatingFor === review.id}
                      className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-black bg-black/5 hover:bg-black/10 transition-all border border-black/5"
                    >
                      {generatingFor === review.id ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      Regenerate
                    </button>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {aiReplies[review.id] && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }} 
                    animate={{ height: 'auto', opacity: 1 }} 
                    exit={{ height: 0, opacity: 0 }} 
                    className="overflow-hidden mt-6"
                  >
                    <div className="bg-emerald-50/50 border border-emerald-100 rounded-[28px] p-6 relative group">
                      <div className="flex justify-between items-center mb-4">
                        <span className="font-bold uppercase text-[9px] text-emerald-600 flex items-center gap-2">
                          <Sparkles size={10} /> Suggested Response
                        </span>
                        <button 
                          onClick={() => copyToClipboard(aiReplies[review.id], review.id)}
                          className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all",
                            copiedId === review.id ? "bg-emerald-500 text-white" : "bg-white text-emerald-600 shadow-sm hover:shadow-md"
                          )}
                        >
                          {copiedId === review.id ? (
                            <><CheckCheck size={12} /> Copied</>
                          ) : (
                            <><Copy size={12} /> Copy to Clipboard</>
                          )}
                        </button>
                      </div>
                      <p className="text-sm italic text-emerald-900 leading-relaxed">
                        "{aiReplies[review.id]}"
                      </p>
                      <div className="mt-4 text-[9px] font-bold text-emerald-600/60 uppercase text-center">
                        Copy this reply to paste it into your Google Business Profile manager
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};
