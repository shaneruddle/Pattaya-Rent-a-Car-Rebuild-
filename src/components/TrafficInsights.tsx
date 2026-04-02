import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Search, 
  Target, 
  MousePointer2, 
  BarChart3, 
  Lightbulb,
  ArrowUpRight,
  Globe,
  Users,
  Clock,
  Sparkles,
  ChevronRight,
  Lock,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Suggestion {
  title: string;
  description: string;
  impact: 'High' | 'Medium' | 'Low';
  category: string;
}

export const TrafficInsights: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'keywords' | 'suggestions'>('overview');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResults, setAuditResults] = useState<Suggestion[]>([]);
  const [searchData, setSearchData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/google/status');
      const data = await res.json();
      setIsAuthenticated(data.authenticated);
      if (data.authenticated) {
        fetchSearchData();
      }
    } catch (error) {
      console.error("Error checking auth status:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSearchData = async () => {
    try {
      const res = await fetch('/api/seo/search-data');
      const data = await res.json();
      if (data.data) {
        setSearchData(data.data);
      }
    } catch (error) {
      console.error("Error fetching search data:", error);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      const { url } = await res.json();
      window.location.href = url;
    } catch (error) {
      console.error("Error getting auth URL:", error);
    }
  };

  const runAudit = async () => {
    if (!searchData.length) return;
    setIsAuditing(true);
    
    try {
      const prompt = `Analyze these Google Search Console keywords for a car rental business in Pattaya, Thailand:
      ${JSON.stringify(searchData)}
      
      Provide 3 actionable growth suggestions in JSON format.
      Each suggestion should have: title, description, impact (High/Medium/Low), and category (SEO/Content/Technical).`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                impact: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                category: { type: Type.STRING }
              },
              required: ["title", "description", "impact", "category"]
            }
          }
        }
      });

      const results = JSON.parse(response.text || "[]");
      setAuditResults(results);
    } catch (error) {
      console.error("Error running AI audit:", error);
    } finally {
      setIsAuditing(false);
    }
  };

  const suggestions = auditResults.length > 0 ? auditResults : [
    {
      title: "Target 'Long-term Car Rental Pattaya'",
      description: "Search volume for long-term rentals is up 25% this month. Create a dedicated landing page for monthly rates.",
      impact: "High" as const,
      category: "SEO"
    },
    {
      title: "Optimize for 'Russian' Keywords",
      description: "We're seeing a spike in traffic from Russian-speaking users. Consider adding a Russian translation to the fleet page.",
      impact: "Medium" as const,
      category: "Content"
    },
    {
      title: "Improve Mobile Page Speed",
      description: "Analytics shows a 45% bounce rate on mobile. Optimizing image sizes could improve conversion by 10%.",
      impact: "High" as const,
      category: "Technical"
    }
  ];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-warm-bg">
        <Loader2 className="animate-spin text-brand-orange" size={48} />
      </div>
    );
  }

  if (isAuthenticated === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-warm-bg p-8 text-center">
        <div className="w-24 h-24 bg-brand-orange/10 rounded-[40px] flex items-center justify-center mb-8">
          <Lock className="text-brand-orange" size={40} />
        </div>
        <h1 className="font-serif italic text-4xl text-[#1A1A1A] mb-4">Connect Google Account</h1>
        <p className="text-[#1A1A1A]/60 max-w-md mb-10 leading-relaxed">
          To provide real-time SEO insights and AI audits, we need to securely connect to your Google Search Console and Analytics data.
        </p>
        <button
          onClick={handleConnect}
          className="bg-brand-orange text-white px-12 py-5 rounded-3xl font-bold uppercase tracking-widest flex items-center gap-3 hover:bg-brand-orange/90 transition-all shadow-xl shadow-brand-orange/20"
        >
          <Globe size={20} /> Connect Google Console
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-warm-bg overflow-hidden">
      {/* Header */}
      <div className="p-8 md:p-12">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-brand-orange/10 rounded-xl flex items-center justify-center">
                <TrendingUp className="text-brand-orange" size={20} />
              </div>
              <h1 className="font-serif italic text-4xl text-[#1A1A1A]">Traffic & SEO Insights</h1>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-1">
              AI-driven growth suggestions based on your Analytics and Search Console data
            </p>
          </div>
          <button 
            onClick={() => setIsAuthenticated(false)}
            className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/20 hover:text-red-500 transition-colors"
          >
            Disconnect Account
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 md:px-12 pb-12 custom-scrollbar">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          {[
            { label: 'Total Clicks', value: searchData.reduce((acc, row) => acc + (row.clicks || 0), 0).toLocaleString(), change: '+12%', icon: MousePointer2 },
            { label: 'Avg. Position', value: (searchData.reduce((acc, row) => acc + (row.position || 0), 0) / (searchData.length || 1)).toFixed(1), change: '-2.1', icon: Target },
            { label: 'Impressions', value: (searchData.reduce((acc, row) => acc + (row.impressions || 0), 0) / 1000).toFixed(1) + 'K', change: '+8%', icon: Search },
            { label: 'CTR', value: ((searchData.reduce((acc, row) => acc + (row.ctr || 0), 0) / (searchData.length || 1)) * 100).toFixed(1) + '%', change: '+0.5%', icon: BarChart3 },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-white/40 backdrop-blur-md border border-white/60 rounded-[32px] p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 bg-brand-orange/5 rounded-xl flex items-center justify-center text-brand-orange">
                  <stat.icon size={20} />
                </div>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-1 rounded-full",
                  stat.change.startsWith('+') ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"
                )}>
                  {stat.change}
                </span>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">{stat.label}</p>
              <h3 className="text-2xl font-bold text-[#1A1A1A]">{stat.value}</h3>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Suggestions List */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <Lightbulb className="text-brand-orange" size={20} />
                <h2 className="font-serif italic text-2xl text-[#1A1A1A]">Growth Suggestions</h2>
              </div>
              <button 
                onClick={runAudit}
                disabled={isAuditing || !searchData.length}
                className={cn(
                  "text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 transition-all",
                  isAuditing ? "text-[#1A1A1A]/20" : "text-brand-orange hover:gap-2"
                )}
              >
                {isAuditing ? (
                  <>Analyzing Data <RefreshCw size={12} className="animate-spin" /></>
                ) : (
                  <>Run AI Audit <Sparkles size={12} /></>
                )}
              </button>
            </div>

            <AnimatePresence mode="wait">
              <div className="space-y-6">
                {suggestions.map((suggestion, i) => (
                  <motion.div
                    key={suggestion.title}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: (i * 0.1) }}
                    className="bg-white/60 backdrop-blur-md border border-white/80 rounded-[32px] p-8 group hover:border-brand-orange/30 transition-all cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-6">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="px-3 py-1 bg-brand-orange/10 text-brand-orange text-[9px] font-bold uppercase tracking-widest rounded-full">
                            {suggestion.category}
                          </span>
                          <span className={cn(
                            "text-[9px] font-bold uppercase tracking-widest",
                            suggestion.impact === 'High' ? "text-emerald-500" : "text-blue-500"
                          )}>
                            {suggestion.impact} Impact
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-[#1A1A1A] mb-2 group-hover:text-brand-orange transition-colors">
                          {suggestion.title}
                        </h3>
                        <p className="text-sm text-[#1A1A1A]/60 leading-relaxed">
                          {suggestion.description}
                        </p>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-black/5 flex items-center justify-center text-[#1A1A1A]/20 group-hover:bg-brand-orange group-hover:text-white transition-all">
                        <ChevronRight size={20} />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          </div>

          {/* Side Info */}
          <div className="space-y-8">
            <div className="bg-[#1A1A1A] rounded-[40px] p-8 text-white relative overflow-hidden">
              <div className="relative z-10">
                <h3 className="font-serif italic text-2xl mb-4">SEO Health Score</h3>
                <div className="flex items-end gap-2 mb-6">
                  <span className="text-6xl font-bold">84</span>
                  <span className="text-white/40 font-bold mb-2">/100</span>
                </div>
                <p className="text-sm text-white/60 mb-8 leading-relaxed">
                  Your site is performing better than 72% of local car rentals in Pattaya.
                </p>
                <button className="w-full h-14 bg-brand-orange text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange/90 transition-all">
                  View Full Report
                </button>
              </div>
              <div className="absolute -right-8 -bottom-8 w-48 h-48 bg-brand-orange/20 rounded-full blur-3xl" />
            </div>

            <div className="bg-white/40 backdrop-blur-md border border-white/60 rounded-[40px] p-8">
              <h3 className="font-serif italic text-xl text-[#1A1A1A] mb-6">Top Keywords</h3>
              <div className="space-y-4">
                {searchData.slice(0, 5).map((row, i) => (
                  <div key={i} className="flex justify-between items-center text-xs">
                    <span className="text-[#1A1A1A]/60 truncate max-w-[150px]">{row.keys[0]}</span>
                    <span className="font-bold text-[#1A1A1A]">{row.clicks} clicks</span>
                  </div>
                ))}
                {!searchData.length && <p className="text-xs text-[#1A1A1A]/40 italic">No data available yet</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
