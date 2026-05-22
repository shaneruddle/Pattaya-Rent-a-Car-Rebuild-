import React, { useState, useEffect } from 'react';
import { 
  Calendar as CalendarIcon, 
  Layout, 
  Plus, 
  Search, 
  TrendingUp, 
  BarChart3, 
  ChevronLeft, 
  ChevronRight, 
  MoreHorizontal,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Link as LinkIcon,
  MessageSquare,
  ArrowUpRight,
  Monitor,
  Database
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  getDocs, 
  updateDoc, 
  doc, 
  query, 
  orderBy, 
  Timestamp,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isToday } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';
import { toast } from 'sonner';

interface ContentItem {
  id: string;
  title: string;
  targetKeyword: string;
  targetUrl: string;
  publishDate: string;
  status: 'Idea' | 'In Progress' | 'Scheduled' | 'Published';
  notes: string;
  createdAt: string;
  seoData?: {
    clicks: number;
    impressions: number;
    position: number;
    ctr: number;
  };
  analyticsData?: {
    pageViews: number;
    sessions: number;
  };
}

interface SEOQuery {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}


const ContentCalendar: React.FC = () => {
  const [view, setView] = useState<'calendar' | 'pipeline'>('calendar');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [seoData, setSeoData] = useState<SEOQuery[]>([]);
  const [seoStats, setSeoStats] = useState({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  
  const [formData, setFormData] = useState({
    title: '',
    targetKeyword: '',
    targetUrl: '',
    publishDate: format(new Date(), 'yyyy-MM-dd'),
    status: 'Idea' as ContentItem['status'],
    notes: ''
  });

  const [connectionStatus, setConnectionStatus] = useState({
    searchConsole: false,
    analytics: false
  });

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'contentCalendar'), orderBy('publishDate', 'desc')), (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        publishDate: doc.data().publishDate instanceof Timestamp ? doc.data().publishDate.toDate().toISOString() : doc.data().publishDate,
        createdAt: doc.data().createdAt instanceof Timestamp ? doc.data().createdAt.toDate().toISOString() : doc.data().createdAt
      } as ContentItem));
      setContentItems(items);
      setLoading(false);
    });

    fetchSEOPerformance();
    return () => unsub();
  }, []);

  const fetchSEOPerformance = async () => {
    try {
      const endDate = format(new Date(), 'yyyy-MM-dd');
      const startDate = format(subMonths(new Date(), 1), 'yyyy-MM-dd');
      
      const response = await axios.post('/api/searchconsole/performance', {
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: 50
      });

      if (response.data) {
        setSeoData(response.data);
        setConnectionStatus(prev => ({ ...prev, searchConsole: true }));
        
        // Calculate totals
        const totals = response.data.reduce((acc: any, curr: any) => ({
          clicks: acc.clicks + curr.clicks,
          impressions: acc.impressions + curr.impressions,
          ctr: acc.ctr + curr.ctr,
          position: acc.position + curr.position
        }), { clicks: 0, impressions: 0, ctr: 0, position: 0 });
        
        if (response.data.length > 0) {
          setSeoStats({
            clicks: totals.clicks,
            impressions: totals.impressions,
            ctr: totals.ctr / response.data.length,
            position: totals.position / response.data.length
          });
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch SEO performance:', err);
      setConnectionStatus(prev => ({ ...prev, searchConsole: false }));
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'contentCalendar'), {
        ...formData,
        publishDate: Timestamp.fromDate(new Date(formData.publishDate)),
        createdAt: Timestamp.now(),
        seoData: {},
        analyticsData: {}
      });
      setIsModalOpen(false);
      toast.success('Content item added to calendar');
    } catch (err) {
      toast.error('Failed to add content item');
    }
  };


  const updateStatus = async (id: string, newStatus: ContentItem['status']) => {
    try {
      await updateDoc(doc(db, 'contentCalendar', id), { status: newStatus });
      toast.success(`Status updated to ${newStatus}`);
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  const renderCalendar = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

    return (
      <div className="grid grid-cols-7 gap-px bg-black/5 rounded-2xl overflow-hidden border border-black/5">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="bg-white/50 p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">
            {day}
          </div>
        ))}
        {days.map((day, idx) => {
          const dayItems = contentItems.filter(item => isSameDay(new Date(item.publishDate), day));
          return (
            <div 
              key={idx} 
              className={`bg-white min-h-[140px] p-2 transition-colors hover:bg-black/[0.01] ${!isSameMonth(day, monthStart) ? 'opacity-30' : ''}`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className={`text-xs font-bold leading-none w-6 h-6 flex items-center justify-center rounded-full ${isToday(day) ? 'bg-brand-orange text-white' : 'text-black/60'}`}>
                  {format(day, 'd')}
                </span>
                {dayItems.length > 0 && (
                  <span className="text-[10px] font-bold text-brand-orange bg-brand-orange/10 px-1.5 py-0.5 rounded-full">
                    {dayItems.length}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {dayItems.slice(0, 3).map(item => (
                  <div 
                    key={item.id}
                    className={`text-[10px] p-1.5 rounded-lg border flex items-center gap-1.5 truncate ${
                      item.status === 'Published' ? 'bg-green-50 border-green-100 text-green-700' :
                      item.status === 'Scheduled' ? 'bg-blue-50 border-blue-100 text-blue-700' :
                      item.status === 'In Progress' ? 'bg-orange-50 border-orange-100 text-orange-700' :
                      'bg-gray-50 border-gray-100 text-gray-700'
                    }`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      item.status === 'Published' ? 'bg-green-500' :
                      item.status === 'Scheduled' ? 'bg-blue-500' :
                      item.status === 'In Progress' ? 'bg-brand-orange' :
                      'bg-gray-400'
                    }`} />
                    <span className="font-bold truncate">{item.title}</span>
                  </div>
                ))}
                {dayItems.length > 3 && (
                  <div className="text-[9px] text-center text-black/30 font-bold uppercase py-1">
                    + {dayItems.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderPipeline = () => {
    const columns: ContentItem['status'][] = ['Idea', 'In Progress', 'Scheduled', 'Published'];
    
    return (
      <div className="flex gap-6 overflow-x-auto pb-4">
        {columns.map(status => (
          <div key={status} className="flex-shrink-0 w-80">
            <div className="flex items-center justify-between mb-4 px-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  status === 'Published' ? 'bg-green-500' :
                  status === 'Scheduled' ? 'bg-blue-500' :
                  status === 'In Progress' ? 'bg-brand-orange' :
                  'bg-gray-400'
                }`} />
                <h3 className="text-sm font-bold tracking-tight uppercase">{status}</h3>
                <span className="text-xs text-black/30 font-medium">({contentItems.filter(i => i.status === status).length})</span>
              </div>
            </div>
            
            <div className="space-y-4 min-h-[500px] bg-black/[0.02] p-4 rounded-2xl border border-dashed border-black/10">
              {contentItems.filter(item => item.status === status).map(item => (
                <motion.div 
                  layoutId={item.id}
                  key={item.id} 
                  className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm hover:shadow-md transition-shadow group"
                >
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-[10px] font-bold tracking-wider uppercase text-black/30">
                      {item.targetKeyword}
                    </span>
                    <button className="text-black/20 hover:text-black/60 transition-colors">
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                  <h4 className="font-bold text-black group-hover:text-brand-orange transition-colors mb-2">{item.title}</h4>
                  
                  <div className="flex flex-wrap gap-3 mb-4">
                    <div className="flex items-center gap-1 text-[10px] text-black/40 font-medium">
                      <Clock size={12} /> {format(new Date(item.publishDate), 'MMM d, yyyy')}
                    </div>
                    {item.targetUrl && (
                      <div className="flex items-center gap-1 text-[10px] text-black/40 font-medium">
                        <LinkIcon size={12} /> {item.targetUrl.substring(0, 20)}...
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-black/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-bold text-black/30 uppercase">Views</span>
                        <span className="text-xs font-bold">{item.analyticsData?.pageViews || 0}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[9px] font-bold text-black/30 uppercase">Clicks</span>
                        <span className="text-xs font-bold">{item.seoData?.clicks || 0}</span>
                      </div>
                    </div>
                    <select 
                      className="text-[10px] font-bold uppercase bg-black/5 border-none rounded-lg p-1"
                      value={item.status}
                      onChange={(e) => updateStatus(item.id, e.target.value as any)}
                    >
                      <option value="Idea">Idea</option>
                      <option value="In Progress">Working</option>
                      <option value="Scheduled">Scheduled</option>
                      <option value="Published">Published</option>
                    </select>
                  </div>
                </motion.div>
              ))}
              {contentItems.filter(item => item.status === status).length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-black/20">
                  <FileText size={24} strokeWidth={1} className="mb-2" />
                  <span className="text-xs font-bold uppercase tracking-widest">No Items</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Search Console / Analytics Overview Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-black/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Total Clicks</span>
            <div className={`w-2 h-2 rounded-full ${connectionStatus.searchConsole ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-300'}`} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tighter">{seoStats.clicks.toLocaleString()}</span>
            <span className="text-xs font-bold text-green-500">+12%</span>
          </div>
          <div className="mt-2 text-[10px] font-medium text-black/30 uppercase">Last 30 Days</div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-black/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Impressions</span>
            <div className={`w-2 h-2 rounded-full ${connectionStatus.searchConsole ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-300'}`} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tighter">{seoStats.impressions.toLocaleString()}</span>
            <span className="text-xs font-bold text-green-500">+5%</span>
          </div>
          <div className="mt-2 text-[10px] font-medium text-black/30 uppercase">Visibility Gauge</div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-black/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Avg. Position</span>
            <div className={`w-2 h-2 rounded-full ${connectionStatus.searchConsole ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-300'}`} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tighter">{seoStats.position.toFixed(1)}</span>
            <div className="flex items-center text-xs font-bold text-orange-500">
              <TrendingUp size={12} className="mr-1" /> Top 20
            </div>
          </div>
          <div className="mt-2 text-[10px] font-medium text-black/30 uppercase">Search Authority</div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-black/5 shadow-sm flex flex-col justify-between">
        </div>
      </div>

      {!connectionStatus.searchConsole && !connectionStatus.analytics && (
        <div className="bg-orange-50 border border-orange-100 p-6 rounded-3xl flex items-start gap-4">
          <div className="p-3 bg-orange-100 text-orange-600 rounded-2xl">
            <AlertCircle size={24} />
          </div>
          <div>
            <h3 className="font-bold text-orange-900 mb-1 leading-none">Connections Needed</h3>
            <p className="text-sm text-orange-800/70 mb-4">Please configure GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN in your env to see live SEO and Analytics data.</p>
            <div className="flex gap-4">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-orange-900/40">
                <Monitor size={12} /> Search Console: <span className="text-orange-600">Disconnected</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-orange-900/40">
                <BarChart3 size={12} /> Analytics: <span className="text-orange-600">Disconnected</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div className="flex items-center gap-2">
            <div className="p-3 bg-black/5 rounded-2xl text-black/60">
              {view === 'calendar' ? <CalendarIcon size={24} /> : <Layout size={24} />}
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight leading-none mb-1">Content Pipeline</h2>
              <p className="text-sm text-black/40 font-medium">Coordinate your publishing strategy across all channels</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-black/5 rounded-2xl flex gap-1">
              <button 
                onClick={() => setView('calendar')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${view === 'calendar' ? 'bg-white shadow-sm text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                <CalendarIcon size={14} /> Calendar
              </button>
              <button 
                onClick={() => setView('pipeline')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${view === 'pipeline' ? 'bg-white shadow-sm text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                <Layout size={14} /> Pipeline
              </button>
            </div>
            
            <button 
              onClick={() => setIsModalOpen(true)}
              className="bg-brand-orange text-white px-6 py-3 rounded-2xl text-xs font-bold shadow-lg shadow-brand-orange/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2"
            >
              <Plus size={18} /> New Entry
            </button>
          </div>
        </div>

        {view === 'calendar' ? (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="p-3 bg-black/5 rounded-xl hover:bg-black/10 transition-colors"
                >
                  <ChevronLeft size={20} />
                </button>
                <h3 className="text-lg font-bold min-w-[150px] text-center">
                  {format(currentMonth, 'MMMM yyyy')}
                </h3>
                <button 
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="p-3 bg-black/5 rounded-xl hover:bg-black/10 transition-colors"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <div className="flex gap-6">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/30">
                  <div className="w-2 h-2 rounded-full bg-brand-orange" /> Idea
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/30">
                  <div className="w-2 h-2 rounded-full bg-blue-500" /> Scheduled
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/30">
                  <div className="w-2 h-2 rounded-full bg-green-500" /> Published
                </div>
              </div>
            </div>
            {renderCalendar()}
          </div>
        ) : (
          renderPipeline()
        )}
      </div>

      {/* Content Performance Table */}
      <div className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-black/5 rounded-2xl text-black/60">
            <BarChart3 size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight leading-none mb-1">SEO Impact</h2>
            <p className="text-sm text-black/40 font-medium">Real-time performance from Search Console</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-black/5">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-black/5">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40">Page / Source</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40">Clicks</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40">Impressions</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40">CTR</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40">Avg Position</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-black/40 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {seoData.slice(0, 5).map((row, idx) => (
                <tr key={idx} className="hover:bg-black/[0.01] transition-colors group">
                  <td className="px-6 py-4 font-bold text-sm">
                    <div className="max-w-xs truncate text-black/60 font-medium">{row.keys[0]}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-black">{row.clicks.toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-black/40">{row.impressions.toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{(row.ctr * 100).toFixed(1)}%</span>
                      <div className="w-12 h-1.5 bg-black/5 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-orange" style={{ width: `${Math.min(row.ctr * 100 * 10, 100)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className={`px-2.5 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 ${
                      row.position <= 3 ? 'bg-green-100 text-green-700' :
                      row.position <= 10 ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      <TrendingUp size={10} /> {row.position.toFixed(1)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 bg-black/5 rounded-xl text-black/40 hover:bg-brand-orange hover:text-white transition-all">
                      <ArrowUpRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {seoData.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-black/30 font-bold uppercase tracking-widest text-xs">
                    No Search Performance Data Available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Content Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)} 
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="w-full max-w-xl bg-white rounded-[40px] shadow-2xl relative z-10 overflow-hidden outline-none"
            >
              <div className="p-8 border-b border-black/5">
                <h2 className="text-2xl font-bold tracking-tight leading-none mb-1">New Content Entry</h2>
                <p className="text-sm text-black/40 font-medium">Schedule your next masterpiece</p>
              </div>
              
              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-1">Title</label>
                  <input 
                    required
                    type="text" 
                    placeholder="e.g., Ultimate Guide to Driving in Pattaya"
                    className="w-full bg-black/5 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-brand-orange/20"
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-1">Target Keyword</label>
                    <input 
                      type="text" 
                      placeholder="e.g., car rental pattaya"
                      className="w-full bg-black/5 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-brand-orange/20"
                      value={formData.targetKeyword}
                      onChange={(e) => setFormData({...formData, targetKeyword: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-1">Status</label>
                    <select 
                      className="w-full bg-black/5 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-brand-orange/20"
                      value={formData.status}
                      onChange={(e) => setFormData({...formData, status: e.target.value as any})}
                    >
                      <option value="Idea">Idea</option>
                      <option value="In Progress">Working</option>
                      <option value="Scheduled">Scheduled</option>
                      <option value="Published">Published</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-1">Target URL</label>
                    <input 
                      type="text" 
                      placeholder="e.g., /blog/guide-pattaya"
                      className="w-full bg-black/5 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-brand-orange/20"
                      value={formData.targetUrl}
                      onChange={(e) => setFormData({...formData, targetUrl: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-1">Publish Date</label>
                    <input 
                      required
                      type="date"
                      className="w-full bg-black/5 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-brand-orange/20"
                      value={formData.publishDate}
                      onChange={(e) => setFormData({...formData, publishDate: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-1">Notes</label>
                  <textarea 
                    placeholder="Briefly describe the objective..."
                    rows={3}
                    className="w-full bg-black/5 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-brand-orange/20 resize-none"
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  />
                </div>

                <div className="pt-4 flex gap-4">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 bg-black/5 text-black px-6 py-4 rounded-2xl text-xs font-bold hover:bg-black/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-brand-orange text-white px-6 py-4 rounded-2xl text-xs font-bold shadow-lg shadow-brand-orange/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Create Entry
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI Ideas Panel */}
      <AnimatePresence>
      </AnimatePresence>
    </div>
  );
};

export default ContentCalendar;
