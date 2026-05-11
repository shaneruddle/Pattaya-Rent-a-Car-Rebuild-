import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, LogOut, Car as CarIcon, CalendarPlus, Calendar, DollarSign, Database, ExternalLink, Users, Globe, Activity, Mail, Shield, Zap, ShieldCheck, Image as ImageIcon, X, RefreshCw, Megaphone, FileText, HelpCircle, Star, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Car } from '../types';
import { logOut, storage, db, auth } from '../firebase';
import { collection, getCountFromServer } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { cn } from '../lib/utils';
import { StorageImage } from './StorageImage';

interface SidebarProps {
  user: any;
  isAdmin?: boolean;
  isMobile?: boolean;
  onNewBooking?: () => void;
  currentView: 'company_settings' | 'timeline_cars' | 'timeline_bikes' | 'finance' | 'booking' | 'pricing' | 'fleet' | 'crm' | 'website_fleet' | 'bookings' | 'rentals' | 'logs' | 'enquiries' | 'user_management' | 'new_rental' | 'marketing_blog' | 'marketing_faq' | 'marketing_reviews' | 'image_management' | 'email_templates';
  onViewChange: (view: 'company_settings' | 'timeline_cars' | 'timeline_bikes' | 'finance' | 'booking' | 'pricing' | 'fleet' | 'crm' | 'website_fleet' | 'bookings' | 'rentals' | 'logs' | 'enquiries' | 'user_management' | 'new_rental' | 'marketing_blog' | 'marketing_faq' | 'marketing_reviews' | 'image_management' | 'email_templates') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, isAdmin, isMobile, onNewBooking, currentView, onViewChange }) => {
  const [isCollapsed, setIsCollapsed] = useState(isMobile);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
  const [isMarketingExpanded, setIsMarketingExpanded] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [counts, setCounts] = useState({
    bookings: 0,
    rentals: 0,
    crm: 0
  });

  useEffect(() => {
    if (isMobile) {
      setIsCollapsed(true);
    }
  }, [isMobile]);

  // Fetch counts for badges
  useEffect(() => {
    if (!auth.currentUser) return;

    const fetchCounts = async () => {
      try {
        const [bookingsSnap, rentalsSnap, crmSnap] = await Promise.all([
          getCountFromServer(collection(db, 'bookings')),
          getCountFromServer(collection(db, 'rentals')),
          getCountFromServer(collection(db, 'customers'))
        ]);

        setCounts({
          bookings: bookingsSnap.data().count,
          rentals: rentalsSnap.data().count,
          crm: crmSnap.data().count
        });
      } catch (error) {
        console.error('Sidebar: Error fetching counts:', error);
      }
    };

    fetchCounts();
    // Refresh every 5 minutes
    const interval = setInterval(fetchCounts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [auth.currentUser]);

  const isSettingsView = ['company_settings', 'pricing', 'website_fleet', 'user_management', 'image_management', 'email_templates'].includes(currentView);
  const isMarketingView = ['marketing_blog', 'marketing_faq', 'marketing_reviews'].includes(currentView);

  // Auto-expand settings if one of its views is active
  useEffect(() => {
    if (isSettingsView) {
      setIsSettingsExpanded(true);
    }
    if (isMarketingView) {
      setIsMarketingExpanded(true);
    }
  }, [isSettingsView, isMarketingView]);

  return (
    <>
      {isMobile && (
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="fixed top-4 left-4 z-[100] w-12 h-12 bg-white/80 backdrop-blur-md border border-black/10 rounded-2xl flex items-center justify-center shadow-lg text-brand-orange"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Zap size={24} />}
        </button>
      )}

      <motion.aside
        initial={false}
        animate={{ 
          width: isMobile ? (isMobileMenuOpen ? '100%' : 0) : (isCollapsed ? 80 : 300),
          x: isMobile && !isMobileMenuOpen ? -300 : 0
        }}
        className={cn(
          "h-screen bg-white/40 backdrop-blur-xl text-[#1A1A1A] border-r border-black/10 flex flex-col sticky top-0 left-0 z-40 shadow-xl",
          isMobile && "fixed inset-0 z-[110]"
        )}
      >
        {!isMobile && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="absolute -right-3 top-10 bg-white/80 border border-black/10 rounded-full p-1 hover:bg-brand-orange hover:text-white transition-all shadow-md backdrop-blur-md"
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}

        <div className="p-6 flex flex-col h-full">
          <div className="mb-10 flex items-center justify-center">
            {currentView === 'timeline_bikes' ? (
              <StorageImage 
                path="PRAB-Logo-1.png"
                alt="PRAB Logo"
                className={cn("transition-all duration-300", (isCollapsed && !isMobile) ? "w-10" : "w-32")}
                fallback="https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0665145746.firebasestorage.app/o/PRAB-Logo-1.png?alt=media"
              />
            ) : (
              <img
                src="https://firebasestorage.googleapis.com/v0/b/pattaya-rent-a-car-rebuild.firebasestorage.app/o/PRAC-Logo-1.png?alt=media"
                alt="PRAC Logo"
                className={cn("transition-all duration-300", (isCollapsed && !isMobile) ? "w-10" : "w-32")}
                referrerPolicy="no-referrer"
              />
            )}
            {isMobile && (
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="absolute top-6 right-6 p-2 text-[#1A1A1A]/40 hover:text-brand-orange"
              >
                <X size={24} />
              </button>
            )}
          </div>

          <div className="mb-8 px-2 space-y-2">
            <button
              onClick={() => {
                onViewChange('new_rental');
                if (isMobile) setIsMobileMenuOpen(false);
              }}
              className={cn(
                "w-full h-12 rounded-2xl bg-brand-orange text-white font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all hover:bg-[#1A1A1A] shadow-lg shadow-brand-orange/20",
                (isCollapsed && !isMobile) && "px-0 justify-center",
                currentView === 'new_rental' && "ring-2 ring-brand-orange ring-offset-2"
              )}
            >
              <Zap size={18} />
              {(!isCollapsed || isMobile) && "New Rental"}
            </button>
            {(!isMobile || isAdmin) && (
              <button
                onClick={onNewBooking}
                className={cn(
                  "w-full h-12 rounded-2xl bg-[#1A1A1A] text-white font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all hover:bg-brand-orange shadow-lg shadow-black/10",
                  (isCollapsed && !isMobile) && "px-0 justify-center"
                )}
              >
                <CalendarPlus size={18} />
                {(!isCollapsed || isMobile) && "New Booking"}
              </button>
            )}
          </div>

          {(!isCollapsed || isMobile) && (
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
              <div className="space-y-2 mb-8">
                {(!isMobile || isAdmin) && (
                  <>
                    <button
                      onClick={() => {
                        onViewChange('timeline_cars');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'timeline_cars' 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                      )}
                    >
                      <Calendar size={18} /> Car Timeline
                    </button>
                    <button
                      onClick={() => {
                        onViewChange('timeline_bikes');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'timeline_bikes' 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                      )}
                    >
                      <Calendar size={18} /> Bike Timeline
                    </button>
                    <button
                      onClick={() => {
                        onViewChange('finance');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'finance' 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                      )}
                    >
                      <DollarSign size={18} /> Finance
                    </button>
                    {/* Marketing Group */}
                    <div className="space-y-1">
                      <button
                        onClick={() => setIsMarketingExpanded(!isMarketingExpanded)}
                        className={cn(
                          "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-between px-6 transition-all",
                          isMarketingView
                            ? "bg-brand-orange/10 text-brand-orange border border-brand-orange/20"
                            : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Megaphone size={18} />
                          Marketing
                        </div>
                        {isMarketingExpanded ? <ChevronLeft size={14} className="-rotate-90" /> : <ChevronRight size={14} className="rotate-90" />}
                      </button>

                      <AnimatePresence>
                        {isMarketingExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden pl-4 space-y-1"
                          >
                            <button
                              onClick={() => {
                                onViewChange('marketing_blog');
                                if (isMobile) setIsMobileMenuOpen(false);
                              }}
                              className={cn(
                                "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                                currentView === 'marketing_blog' 
                                  ? "bg-brand-orange text-white shadow-md" 
                                  : "text-[#1A1A1A]/50 hover:bg-white/40"
                              )}
                            >
                              <FileText size={14} /> Blog Management
                            </button>
                            <button
                              onClick={() => {
                                onViewChange('marketing_faq');
                                if (isMobile) setIsMobileMenuOpen(false);
                              }}
                              className={cn(
                                "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                                currentView === 'marketing_faq' 
                                  ? "bg-brand-orange text-white shadow-md" 
                                  : "text-[#1A1A1A]/50 hover:bg-white/40"
                              )}
                            >
                              <HelpCircle size={14} /> FAQ Management
                            </button>
                            <button
                              onClick={() => {
                                onViewChange('marketing_reviews');
                                if (isMobile) setIsMobileMenuOpen(false);
                              }}
                              className={cn(
                                "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                                currentView === 'marketing_reviews' 
                                  ? "bg-brand-orange text-white shadow-md" 
                                  : "text-[#1A1A1A]/50 hover:bg-white/40"
                              )}
                            >
                              <Star size={14} /> Review Management
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <button
                      onClick={() => {
                        onViewChange('fleet');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'fleet' 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                      )}
                    >
                      <CarIcon size={18} /> Fleet Manager
                    </button>
                    <button
                      onClick={() => {
                        onViewChange('enquiries');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'enquiries' 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                      )}
                    >
                      <Mail size={18} /> Live Enquiries
                    </button>
                    <button
                      onClick={() => {
                        onViewChange('bookings');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'bookings' 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                      )}
                    >
                      <Calendar size={18} /> Bookings
                      {counts.bookings > 0 && !isCollapsed && (
                        <span className="ml-auto bg-white/20 text-white px-2 py-0.5 rounded-full text-[8px] font-bold">
                          {counts.bookings}
                        </span>
                      )}
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    onViewChange(isMobile ? 'enquiries' : 'rentals');
                    if (isMobile) setIsMobileMenuOpen(false);
                  }}
                  className={cn(
                    "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                    (isMobile ? currentView === 'enquiries' : currentView === 'rentals') 
                      ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                      : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                  )}
                >
                  <ShieldCheck size={18} /> {isMobile ? "Live Enquiries" : "Rentals"}
                  {counts.rentals > 0 && !isCollapsed && (
                    <span className={cn(
                      "ml-auto px-2 py-0.5 rounded-full text-[8px] font-bold",
                      (isMobile ? currentView === 'enquiries' : currentView === 'rentals') 
                        ? "bg-white/20 text-white" 
                        : "bg-brand-orange/10 text-brand-orange"
                    )}>
                      {counts.rentals}
                    </span>
                  )}
                </button>
                {(!isMobile || isAdmin) && (
                  <>
                    <button
                      onClick={() => {
                        onViewChange('crm');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'crm' 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                      )}
                    >
                      <Users size={18} /> CRM
                      {counts.crm > 0 && !isCollapsed && (
                        <span className={cn(
                          "ml-auto px-2 py-0.5 rounded-full text-[8px] font-bold",
                          currentView === 'crm' 
                            ? "bg-white/20 text-white" 
                            : "bg-brand-orange/10 text-brand-orange"
                        )}>
                          {counts.crm}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        onViewChange('logs');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'logs' 
                          ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
                      )}
                    >
                      <Activity size={18} /> System Logs
                    </button>

                    {/* System Settings Group */}
                    <div className="space-y-1">
                      <button
                        onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                        className={cn(
                          "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-between px-6 transition-all",
                          isSettingsView
                            ? "bg-brand-orange/10 text-brand-orange border border-brand-orange/20"
                            : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-black/20"
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
                              onClick={() => {
                                onViewChange('company_settings');
                                if (isMobile) setIsMobileMenuOpen(false);
                              }}
                              className={cn(
                                "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                                currentView === 'company_settings' 
                                  ? "bg-brand-orange text-white shadow-md" 
                                  : "text-[#1A1A1A]/50 hover:bg-white/40"
                              )}
                            >
                              <Building2 size={14} /> Company Profile
                            </button>
                            <button
                              onClick={() => {
                                onViewChange('pricing');
                                if (isMobile) setIsMobileMenuOpen(false);
                              }}
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
                              onClick={() => {
                                onViewChange('website_fleet');
                                if (isMobile) setIsMobileMenuOpen(false);
                              }}
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
                              onClick={() => {
                                onViewChange('image_management');
                                if (isMobile) setIsMobileMenuOpen(false);
                              }}
                              className={cn(
                                "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                                currentView === 'image_management' 
                                  ? "bg-brand-orange text-white shadow-md" 
                                  : "text-[#1A1A1A]/50 hover:bg-white/40"
                              )}
                            >
                              <ImageIcon size={14} /> Image Management
                            </button>
                            <button
                              onClick={() => {
                                onViewChange('email_templates');
                                if (isMobile) setIsMobileMenuOpen(false);
                              }}
                              className={cn(
                                "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                                currentView === 'email_templates' 
                                  ? "bg-brand-orange text-white shadow-md" 
                                  : "text-[#1A1A1A]/50 hover:bg-white/40"
                              )}
                            >
                              <Mail size={14} /> Email Templates
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => {
                                  onViewChange('user_management');
                                  if (isMobile) setIsMobileMenuOpen(false);
                                }}
                                className={cn(
                                  "w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[9px] flex items-center gap-3 px-6 transition-all",
                                  currentView === 'user_management' 
                                    ? "bg-brand-orange text-white shadow-md" 
                                    : "text-[#1A1A1A]/50 hover:bg-white/40"
                                )}
                              >
                                <Shield size={14} /> User Management
                              </button>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <button
                      onClick={() => {
                        onViewChange('booking');
                        if (isMobile) setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 px-6 transition-all",
                        currentView === 'booking' 
                          ? "bg-[#1A1A1A] text-white shadow-lg" 
                          : "text-[#1A1A1A]/60 hover:bg-white/40 border border-transparent hover:border-white/60"
                      )}
                    >
                      <ExternalLink size={18} /> Booking Engine
                    </button>
                  </>
                )}
              </div>

              <div className="mb-8">
              </div>
            </div>
          )}

          {(isCollapsed && !isMobile) && (
          <div className="flex-1 flex flex-col items-center gap-4 pt-4 overflow-y-auto custom-scrollbar no-scrollbar">
            <button 
              onClick={() => onViewChange('new_rental')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'new_rental' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="New Rental"
            >
              <Zap size={20} />
            </button>
            <button 
              onClick={() => onViewChange('timeline_cars')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'timeline_cars' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="Car Timeline"
            >
              <Calendar size={20} />
            </button>
            <button 
              onClick={() => onViewChange('timeline_bikes')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'timeline_bikes' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="Bike Timeline"
            >
              <Calendar size={20} />
            </button>
            <button 
              onClick={() => onViewChange('enquiries')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'enquiries' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="Live Enquiries"
            >
              <Mail size={20} />
            </button>
            <button 
              onClick={() => onViewChange('bookings')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'bookings' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="Bookings"
            >
              <Calendar size={20} />
            </button>
            <button 
              onClick={() => onViewChange('rentals')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'rentals' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="Rentals"
            >
              <ShieldCheck size={20} />
            </button>
            <button 
              onClick={() => onViewChange('finance')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'finance' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="Finance"
            >
              <DollarSign size={20} />
            </button>
            {/* Collapsed Marketing */}
            <div className="flex flex-col items-center gap-2">
              <button 
                onClick={() => setIsMarketingExpanded(!isMarketingExpanded)}
                className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                  isMarketingView ? "bg-brand-orange/10 text-brand-orange border border-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
                )}
                title="Marketing"
              >
                <Megaphone size={20} />
              </button>
              
              <AnimatePresence>
                {isMarketingExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="flex flex-col items-center gap-2 overflow-hidden"
                  >
                    <button 
                      onClick={() => onViewChange('marketing_blog')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'marketing_blog' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="Blog Management"
                    >
                      <FileText size={16} />
                    </button>
                    <button 
                      onClick={() => onViewChange('marketing_faq')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'marketing_faq' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="FAQ Management"
                    >
                      <HelpCircle size={16} />
                    </button>
                    <button 
                      onClick={() => onViewChange('marketing_reviews')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'marketing_reviews' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="Review Management"
                    >
                      <Star size={16} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button 
              onClick={() => onViewChange('fleet')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'fleet' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="Fleet Manager"
            >
              <CarIcon size={20} />
            </button>
            <button 
              onClick={() => onViewChange('crm')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'crm' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="CRM"
            >
              <Users size={20} />
            </button>
            <button 
              onClick={() => onViewChange('logs')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'logs' ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="System Logs"
            >
              <Activity size={20} />
            </button>

            {/* Collapsed System Settings */}
            <div className="flex flex-col items-center gap-2">
              <button 
                onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                  isSettingsView ? "bg-brand-orange/10 text-brand-orange border border-brand-orange/20" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
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
                      onClick={() => onViewChange('company_settings')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'company_settings' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="Company Profile"
                    >
                      <Building2 size={16} />
                    </button>
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
                      onClick={() => onViewChange('image_management')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'image_management' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="Image Management"
                    >
                      <ImageIcon size={16} />
                    </button>
                    <button 
                      onClick={() => onViewChange('email_templates')}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        currentView === 'email_templates' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                      )}
                      title="Email Templates"
                    >
                      <Mail size={16} />
                    </button>
                    {isAdmin && (
                      <button 
                        onClick={() => onViewChange('user_management')}
                        className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                          currentView === 'user_management' ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/30 hover:bg-white/40"
                        )}
                        title="User Management"
                      >
                        <Shield size={16} />
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={() => onViewChange('booking')}
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                currentView === 'booking' ? "bg-[#1A1A1A] text-white shadow-lg" : "text-[#1A1A1A]/40 hover:bg-white/40 border border-transparent hover:border-black/20"
              )}
              title="Booking Engine"
            >
              <ExternalLink size={20} />
            </button>
          </div>
        )}

        <div className="mt-auto pt-6 border-t border-black/10">
          <div className={cn("flex items-center gap-3", isCollapsed ? "justify-center" : "")}>
            <img
              src={user?.photoURL || "https://picsum.photos/seed/user/40/40"}
              alt="User"
              className="w-10 h-10 rounded-full border border-black/10 shadow-sm"
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
  </>
);
};
