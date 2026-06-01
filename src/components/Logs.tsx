import React, { useMemo, useState, useEffect, useRef } from 'react';
import { SystemLog } from '../types';
import { format, parseISO, isToday, isValid } from 'date-fns';
import { Search, Activity, Clock, User, ChevronRight, RefreshCw, ChevronLeft } from 'lucide-react';
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
  const [staffFilter, setStaffFilter] = useState<string>('all');
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
    if (initialLogs.length === 0) fetchLogs();
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    logs.forEach(l => cats.add(l.category));
    return Array.from(cats).sort();
  }, [logs]);

  const staffMembers = useMemo(() => {
    const staff = new Set<string>();
    logs.forEach(l => { if (l.user) staff.add(l.user); });
    return Array.from(staff).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const searchLower = (searchTerm || '').toLowerCase();
      const matchesSearch =
        (log.action?.toLowerCase() || '').includes(searchLower) ||
        (log.description?.toLowerCase() || '').includes(searchLower) ||
        (log.user?.toLowerCase() || '').includes(searchLower);
      const matchesCategory = categoryFilter === 'all' || log.category === categoryFilter;
      const matchesStaff = staffFilter === 'all' || log.user === staffFilter;
      return matchesSearch && matchesCategory && matchesStaff;
    });
  }, [logs, searchTerm, categoryFilter, staffFilter]);

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

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter, staffFilter]);

  const getCategoryColor = (category: string) => {
    switch (category?.toLowerCase()) {
      case 'bookings': return 'bg-blue-100 text-blue-700';
      case 'finance': return 'bg-green-100 text-green-700';
      case 'crm': return 'bg-purple-100 text-purple-700';
      case 'fleet': return 'bg-orange-100 text-orange-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = parseISO(timestamp);
      if (!isValid(date)) return timestamp;
      if (isToday(date)) return format(date, 'HH:mm:ss');
      return format(date, 'MMM d, HH:mm');
    } catch {
      return timestamp;
    }
  };

  const formatUser = (user: string) => {
    if (!user) return '—';
    return user.split('@')[0];
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-warm-bg overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-8 border-b border-white/20 bg-white/40 backdrop-blur-xl flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-serif italic text-2xl sm:text-4xl text-[#1A1A1A]">System Logs</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-[10px] mt-1 font-medium">Activity Tracking & Audit Trail</p>
          </div>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-white/60 hover:bg-white border border-white/40 rounded-xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-brand-orange transition-all disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            <span className="hidden sm:inline">{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>

        {/* Filters — stack vertically on mobile */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30" size={15} />
            <input
              type="text"
              placeholder="Search action, description, user..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-10 sm:h-12 pl-10 pr-4 bg-white/60 border border-white/40 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all"
            />
          </div>
          <div className="flex gap-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="flex-1 sm:flex-none h-10 sm:h-12 px-3 sm:px-4 bg-white/60 border border-white/40 rounded-2xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all appearance-none cursor-pointer"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="flex-1 sm:flex-none h-10 sm:h-12 px-3 sm:px-4 bg-white/60 border border-white/40 rounded-2xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all appearance-none cursor-pointer"
            >
              <option value="all">All Staff</option>
              {staffMembers.map(s => (
                <option key={s} value={s}>{s.split('@')[0]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Log list */}
      <div ref={logContainerRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <RefreshCw size={24} className="animate-spin text-[#1A1A1A]/30" />
          </div>
        ) : paginatedLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-[#1A1A1A]/40">
            <Activity size={32} />
            <p className="text-sm font-medium uppercase tracking-widest">No logs found</p>
          </div>
        ) : (
          <div className="divide-y divide-black/5">
            {paginatedLogs.map((log, i) => (
              <motion.div
                key={log.id || i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="px-4 sm:px-8 py-3 sm:py-4 hover:bg-white/40 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  {/* Action + category badge */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={cn('shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest', getCategoryColor(log.category))}>
                      {log.category}
                    </span>
                    <span className="font-semibold text-sm text-[#1A1A1A] truncate">{log.action}</span>
                  </div>
                  {/* Description — wraps on mobile, truncates on desktop */}
                  <p className="text-xs text-[#1A1A1A]/60 sm:flex-1 sm:min-w-0 sm:truncate leading-relaxed">
                    {log.description}
                  </p>
                  {/* User + timestamp row */}
                  <div className="flex items-center gap-3 text-[10px] text-[#1A1A1A]/40 font-medium uppercase tracking-widest">
                    <span className="flex items-center gap-1">
                      <User size={10} />
                      {formatUser(log.user)}
                    </span>
                    <span className="flex items-center gap-1 ml-auto sm:ml-0">
                      <Clock size={10} />
                      {formatTimestamp(log.timestamp)}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-4 sm:p-6 border-t border-white/20 bg-white/40 backdrop-blur-xl flex items-center justify-between gap-4">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-3 py-2 bg-white/60 hover:bg-white border border-white/40 rounded-xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-brand-orange transition-all disabled:opacity-30"
          >
            <ChevronLeft size={14} />
            <span className="hidden sm:inline">Prev</span>
          </button>
          <span className="text-xs font-medium text-[#1A1A1A]/60 uppercase tracking-widest">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1 px-3 py-2 bg-white/60 hover:bg-white border border-white/40 rounded-xl text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 hover:text-brand-orange transition-all disabled:opacity-30"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
