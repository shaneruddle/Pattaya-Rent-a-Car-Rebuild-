import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, LogOut, Car as CarIcon, CalendarPlus, Calendar, DollarSign, Database, ExternalLink, Users, Globe, Activity, Mail } from 'lucide-react';
import { motion } from 'motion/react';
import { Car } from '../types';
import { logOut } from '../firebase';
import { cn } from '../lib/utils';

interface SidebarProps {
  user: any;
  onNewBooking?: () => void;
  currentView: 'timeline' | 'finance' | 'booking' | 'pricing' | 'fleet' | 'crm' | 'website_fleet' | 'bookings' | 'logs' | 'enquiries';
  onViewChange: (view: 'timeline' | 'finance' | 'booking' | 'pricing' | 'fleet' | 'crm' | 'website_fleet' | 'bookings' | 'logs' | 'enquiries') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, onNewBooking, currentView, onViewChange }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 80 : 300 }}
      className="h-screen bg-white/40 backdrop-blur-xl text-[#1A1A1A] border-r border-white/40 flex flex-col relative z-20 shadow-xl"
    >
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-10 bg-white/80 border border-white/40 rounded-full p-1 hover:bg-brand-orange hover:text-white transition-all shadow-md backdrop-blur-md"
      >
        {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      <div className="p-6 flex flex-col h-full">
        <div className="mb-10 flex items-center justify-center">
          <img
            src="https://7f8bfb441a72f33e442dece0180dba1f.cdn.bubble.io/cdn-cgi/image/w=192,h=70,f=auto,dpr=2,fit=contain/f1630376828262x344914557261106300/PRAC-Logo-1.png"
            alt="PRAC Logo"
            className={cn("transition-all duration-300", isCollapsed ? "w-10" : "w-32")}
            referrerPolicy="no-referrer"
          />
        </div>

        {!isCollapsed && (
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
            <div className="space-y-2 mb-8">
              <button
                onClick={() => onViewChange('timeline')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'timeline' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <Calendar size={18} /> Timeline
              </button>
              <button
                onClick={() => onViewChange('enquiries')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'enquiries' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <Mail size={18} /> Live Enquiries
              </button>
              <button
                onClick={() => onViewChange('bookings')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'bookings' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <Calendar size={18} /> Bookings
              </button>
              <button
                onClick={() => onViewChange('finance')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'finance' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <DollarSign size={18} /> Finance
              </button>
              <button
                onClick={() => onViewChange('pricing')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'pricing' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <Database size={18} /> Pricing
              </button>
              <button
                onClick={() => onViewChange('fleet')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'fleet' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <CarIcon size={18} /> Fleet Manager
              </button>
              <button
                onClick={() => onViewChange('website_fleet')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'website_fleet' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <Globe size={18} /> Website Fleet
              </button>
              <button
                onClick={() => onViewChange('crm')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'crm' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <Users size={18} /> CRM
              </button>
              <button
                onClick={() => onViewChange('logs')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'logs' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <Activity size={18} /> System Logs
              </button>
              <button
                onClick={() => onViewChange('booking')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'booking' 
                    ? "bg-[#1A1A1A] text-white shadow-lg" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <ExternalLink size={18} /> Booking Engine
              </button>
            </div>

            <div className="mb-8">
            </div>
          </div>
        )}

        {isCollapsed && (
          <div className="flex-1 flex flex-col items-center gap-4 pt-4">
            <button 
              onClick={() => onViewChange('timeline')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'timeline' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Timeline"
            >
              <Calendar size={20} />
            </button>
            <button 
              onClick={() => onViewChange('enquiries')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'enquiries' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Live Enquiries"
            >
              <Mail size={20} />
            </button>
            <button 
              onClick={() => onViewChange('bookings')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'bookings' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Bookings"
            >
              <Calendar size={20} />
            </button>
            <button 
              onClick={() => onViewChange('finance')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'finance' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Finance"
            >
              <DollarSign size={20} />
            </button>
            <button 
              onClick={() => onViewChange('pricing')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'pricing' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Pricing"
            >
              <Database size={20} />
            </button>
            <button 
              onClick={() => onViewChange('fleet')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'fleet' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Fleet Manager"
            >
              <CarIcon size={20} />
            </button>
            <button 
              onClick={() => onViewChange('website_fleet')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'website_fleet' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Website Fleet"
            >
              <Globe size={20} />
            </button>
            <button 
              onClick={() => onViewChange('crm')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'crm' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="CRM"
            >
              <Users size={20} />
            </button>
            <button 
              onClick={() => onViewChange('logs')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'logs' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="System Logs"
            >
              <Activity size={20} />
            </button>
          </div>
        )}

        <div className="mt-auto pt-6 border-t border-white/40">
          <div className={cn("flex items-center gap-3", isCollapsed ? "justify-center" : "")}>
            <img
              src={user?.photoURL || "https://picsum.photos/seed/user/40/40"}
              alt="User"
              className="w-10 h-10 rounded-full border border-white/40 shadow-sm"
              referrerPolicy="no-referrer"
            />
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-[#1A1A1A]">{user?.displayName || 'PRAC Admin'}</p>
                <button
                  onClick={logOut}
                  className="flex items-center gap-1 text-[10px] text-[#1A1A1A]/50 hover:text-brand-orange transition-colors"
                >
                  <LogOut size={10} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.aside>
  );
};
