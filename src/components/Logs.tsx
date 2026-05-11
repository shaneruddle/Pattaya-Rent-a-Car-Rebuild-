import React, { useMemo, useState, useEffect, useRef } from 'react';
import { SystemLog } from '../types';
import { format, parseISO, isToday, isValid } from 'date-fns';
import { Search, Filter, Activity, Clock, User, Tag, ChevronRight, RefreshCw, ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface LogsProps {
  logs: SystemLog[];
}

export const Logs: React.FC<LogsProps> = ({ logs: initialLogs = [] }) => {
  const [logs, setLogs] = useState<SystemLog[]>(initialLogs);
  const [loading, setLoading] = useState(initialLogs.length === 0);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'system_logs'), orderBy('timestamp', 'desc'), limit(200));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SystemLog));
      setLogs(data);
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!auth.currentUser) return;
    if (initialLogs.length === 0) {
      fetchLogs();
    }
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    logs.forEach(l => cats.add(l.category));
    return Array.from(cats).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const searchLower = (searchTerm || '').toLowerCase();
      const matchesSearch = 
        (log.action?.toLowerCase() || '').includes(searchLower) ||
        (log.description?.toLowerCase() || '').includes(searchLower) ||
        (log.user?.toLowerCase() || '').includes(searchLower);

      const matchesCategory = categoryFilter === 'all' || log.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [logs, searchTerm, categoryFilter]);

  const sortedLogs = useMemo(() => {
    return [...filteredLogs].sort((a, b) => {
      const dateA = parseISO(a.timestamp);
      const dateB = parseISO(b.timestamp);
      if (!isValid(dateA) || !isValid(dateB)) return 0;
      return dateB.getTime() - dateA.getTime();
    });
  }, [filteredLogs]);

  const totalPages = Math.ceil(sortedLogs.length / ITEMS_PER_PAGE);
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedLogs.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedLogs, currentPage]);

  const goToPage = (page: number) => {
    const targetPage = Math.min(Math.max(1, page), totalPages);
    setCurrentPage(targetPage);
    if (logContainerRef.current) {
      logContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter]);

  return (
    <div className="flex-1 flex flex-col h-full bg-warm-bg overflow-hidden">
      <div className="p-8 border-b border-white/20 bg-white/40 backdrop-blur-xl flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif italic text-4xl text-[#1A1A1A]">System Logs</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] mt-1 font-medium">Activity Tracking & Audit Trail</p>
          </div>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white/60 hover:bg-white border border-white/40 rounded-xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-brand-orange transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30" size={16} />
            <input
              type="text"
              placeholder="Search logs by action, description, or user..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-12 pl-12 pr-4 bg-white/60 border border-white/40 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all"
            />
          </div>

          <div className="relative min-w-[180px]">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30" size={16} />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full h-12 pl-12 pr-10 bg-white/60 border border-white/40 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all appearance-none cursor-pointer"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div ref={logContainerRef} className="flex-1 overflow-y-auto custom-scrollbar p-8">
        <div className="max-w-6xl mx-auto space-y-2">
          {paginatedLogs.map((log, index) => {
            const date = parseISO(log.timestamp);
            const isDayToday = isValid(date) && isToday(date);

            return (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.05, 1) }}
                className="group bg-white/40 backdrop-blur-sm border border-white/60 p-4 rounded-2xl hover:bg-white/80 transition-all flex items-center gap-6"
              >
                {/* Category Icon */}
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  log.category === 'Bookings' ? "bg-blue-500/10 text-blue-500" :
                  log.category === 'Fleet' ? "bg-orange-500/10 text-orange-500" :
                  log.category === 'CRM' ? "bg-purple-500/10 text-purple-500" :
                  log.category === 'Finance' ? "bg-green-500/10 text-green-500" :
                  log.category === 'Pricing' ? "bg-yellow-500/10 text-yellow-500" :
                  "bg-gray-500/10 text-gray-500"
                )}>
                  <Activity size={20} />
                </div>

                {/* Main Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-sm text-[#1A1A1A]">{log.action}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider",
                      log.category === 'Bookings' ? "bg-blue-100 text-blue-600" :
                      log.category === 'Fleet' ? "bg-orange-100 text-orange-600" :
                      log.category === 'CRM' ? "bg-purple-100 text-purple-600" :
                      log.category === 'Finance' ? "bg-green-100 text-green-600" :
                      log.category === 'Pricing' ? "bg-yellow-100 text-yellow-600" :
                      "bg-gray-100 text-gray-600"
                    )}>
                      {log.category}
                    </span>
                  </div>
                  <p className="text-xs text-[#1A1A1A]/60 line-clamp-1">{log.description}</p>
                </div>

                {/* User & Time */}
                <div className="flex items-center gap-8 shrink-0">
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-[#1A1A1A]/40 uppercase tracking-widest">
                      <User size={12} />
                      {log.user}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-medium text-[#1A1A1A]/60 mt-1">
                      <Clock size={12} />
                      {isValid(date) ? format(date, 'MMM d, HH:mm:ss') : 'Invalid Date'}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-[#1A1A1A]/10 group-hover:text-brand-orange transition-colors" />
                </div>
              </motion.div>
            );
          })}

          {sortedLogs.length > 0 && (
            <div className="pt-8 flex items-center justify-between border-t border-white/20 mt-8">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">
                Page {currentPage} of {totalPages || 1}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="w-10 h-10 rounded-xl bg-white/60 border border-white/40 flex items-center justify-center text-[#1A1A1A]/60 hover:text-brand-orange hover:bg-white transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="w-10 h-10 rounded-xl bg-white/60 border border-white/40 flex items-center justify-center text-[#1A1A1A]/60 hover:text-brand-orange hover:bg-white transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
          )}

          {sortedLogs.length === 0 && (
            <div className="h-[50vh] flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 bg-white/40 backdrop-blur-xl border border-white/60 rounded-full flex items-center justify-center mb-6 shadow-xl">
                <Activity className="text-[#1A1A1A]/10" size={40} />
              </div>
              <h2 className="font-serif italic text-2xl mb-2 text-[#1A1A1A]">No Logs Found</h2>
              <p className="text-[#1A1A1A]/40 uppercase tracking-widest text-[10px] font-bold">
                {searchTerm || categoryFilter !== 'all' ? 'Try adjusting your filters' : 'System activity will appear here'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
