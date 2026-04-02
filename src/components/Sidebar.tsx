import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, LogOut, Car as CarIcon, CalendarPlus, Calendar, DollarSign, Database, ExternalLink, Users, Globe, Activity, Mail, Bot, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Car } from '../types';
import { logOut } from '../firebase';
import { cn } from '../lib/utils';

interface SidebarProps {
  user: any;
  onNewBooking?: () => void;
  currentView: 'timeline' | 'finance' | 'booking' | 'pricing' | 'fleet' | 'crm' | 'website_fleet' | 'bookings' | 'logs' | 'enquiries' | 'ai_training' | 'traffic_insights';
  onViewChange: (view: 'timeline' | 'finance' | 'booking' | 'pricing' | 'fleet' | 'crm' | 'website_fleet' | 'bookings' | 'logs' | 'enquiries' | 'ai_training' | 'traffic_insights') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, onNewBooking, currentView, onViewChange }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);

  const isSettingsView = ['pricing', 'website_fleet', 'ai_training'].includes(currentView);

  // Auto-expand settings if one of its views is active
  React.useEffect(() => {
    if (isSettingsView) {
      setIsSettingsExpanded(true);
    }
  }, [isSettingsView]);

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

        <div className="mb-8 px-2">
          <button
            onClick={onNewBooking}
            className={cn(
              "w-full h-12 rounded-2xl bg-[#1A1A1A] text-white font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all hover:bg-brand-orange shadow-lg shadow-black/10",
              isCollapsed && "px-0 justify-center"
            )}
          >
            <CalendarPlus size={18} />
            {!isCollapsed && "New Booking"}
          </button>
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
                onClick={() => onViewChange('traffic_insights')}
                className={cn(
                  "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                  currentView === 'traffic_insights' 
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                    : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
              >
                <TrendingUp size={18} /> Traffic Insights
              </button>

              {/* System Settings Group */}
              <div className="space-y-1">
                <button
                  onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                  className={cn(
                    "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-between px-6 transition-all",
                    isSettingsView
                      ? "bg-brand-orange/10 text-brand-orange border border-brand-orange/20"
                      : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Database size={18} />
                    System Settings
                  </div>
                  {isSettingsExpanded ? <ChevronLeft size={14} className="-rotate-90" /> : <ChevronRight size={14} className="rotate-90" />}
                </button>

                <AnimatePresence>
                  {isSettingsExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden pl-4 space-y-1"
                    >
                      <button
                        onClick={() => onViewChange('pricing')}
                        className={cn(
                          "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                          currentView === 'pricing' 
                            ? "bg-brand-orange text-white shadow-md" 
                            : "text-[#1A1A1A]/50 hover:bg-white/40"
                        )}
                      >
                        <Database size={14} /> Pricing
                      </button>
                      <button
                        onClick={() => onViewChange('website_fleet')}
                        className={cn(
                          "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                          currentView === 'website_fleet' 
                            ? "bg-brand-orange text-white shadow-md" 
                            : "text-[#1A1A1A]/50 hover:bg-white/40"
                        )}
                      >
                        <Globe size={14} /> Website Fleet
                      </button>
                      <button
                        onClick={() => onViewChange('ai_training')}
                        className={cn(
                          "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                          currentView === 'ai_training' 
                            ? "bg-brand-orange text-white shadow-md" 
                            : "text-[#1A1A1A]/50 hover:bg-white/40"
                        )}
                      >
                        <Bot size={14} /> AI Training
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

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
          <div className="flex-1 flex flex-col items-center gap-4 pt-4 overflow-y-auto custom-scrollbar no-scrollbar">
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
            <button 
              onClick={() => onViewChange('traffic_insights')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'traffic_insights' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Traffic Insights"
            >
              <TrendingUp size={20} />
            </button>

            {/* Collapsed System Settings */}
            <div className="flex flex-col items-center gap-2">
              <button 
                onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                  isSettingsView ? "bg-brand-orange/10 text-brand-orange border border-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
                )}
                title="System Settings"
              >
                <Database size={20} />
              </button>
              
              <AnimatePresence>
                {isSettingsExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="flex flex-col items-center gap-2 overflow-hidden"
                  >
                    <button 
                      onClick={() => onViewChange('pricing')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'pricing' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="Pricing"
                    >
                      <Database size={16} />
                    </button>
                    <button 
                      onClick={() => onViewChange('website_fleet')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'website_fleet' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="Website Fleet"
                    >
                      <Globe size={16} />
                    </button>
                    <button 
                      onClick={() => onViewChange('ai_training')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'ai_training' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="AI Training"
                    >
                      <Bot size={16} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={() => onViewChange('booking')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'booking' ? "bg-[#1A1A1A] text-white shadow-lg" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-white/60"
              )}
              title="Booking Engine"
            >
              <ExternalLink size={20} />
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
