import React, { useState } from 'react';
import { BlogManager } from './BlogManager';
import { PagesManager } from './PagesManager';
import { MarketingFAQ } from './MarketingFAQ';
import ContentCalendar from './ContentCalendar';
import GrowthDashboard from './GrowthDashboard';
import { FileText, MessageSquare, Calendar, Layout, TrendingUp } from 'lucide-react';
import { cn } from '../lib/utils';

export const Marketing: React.FC<{ defaultTab?: 'blog' | 'pages' | 'faq' | 'calendar' | 'growth' }> = ({ defaultTab = 'blog' }) => {
  const [activeTab, setActiveTab] = useState<'blog' | 'pages' | 'faq' | 'calendar' | 'growth'>(defaultTab);

  // Sync state if prop changes from sidebar navigation
  React.useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  return (
    <div className="flex flex-col h-full bg-warm-bg overflow-hidden">
      {/* Tab Header */}
      <div className="bg-white border-b border-black/10 px-8 flex items-center gap-8 shadow-sm z-10 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('blog')}
          className={cn(
            "h-16 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative shrink-0",
            activeTab === 'blog' ? "text-brand-orange" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
          )}
        >
          <FileText size={16} />
          Blog Management
          {activeTab === 'blog' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-brand-orange" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('pages')}
          className={cn(
            "h-16 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative shrink-0",
            activeTab === 'pages' ? "text-brand-orange" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
          )}
        >
          <Layout size={16} />
          Pages Manager
          {activeTab === 'pages' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-brand-orange" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('faq')}
          className={cn(
            "h-16 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative shrink-0",
            activeTab === 'faq' ? "text-brand-orange" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
          )}
        >
          <MessageSquare size={16} />
          FAQ Management
          {activeTab === 'faq' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-brand-orange" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('calendar')}
          className={cn(
            "h-16 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative shrink-0",
            activeTab === 'calendar' ? "text-brand-orange" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
          )}
        >
          <Calendar size={16} />
          Content Calendar
          {activeTab === 'calendar' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-brand-orange" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('growth')}
          className={cn(
            "h-16 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative shrink-0",
            activeTab === 'growth' ? "text-brand-orange" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
          )}
        >
          <TrendingUp size={16} />
          Growth Agent
          {activeTab === 'growth' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-brand-orange" />
          )}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-8">
        {activeTab === 'blog' ? (
          <BlogManager />
        ) : activeTab === 'pages' ? (
          <PagesManager />
        ) : activeTab === 'calendar' ? (
          <ContentCalendar />
) : activeTab === 'growth' ? (
          <GrowthDashboard />
        ) : (
          <MarketingFAQ />
        )}
      </div>
    </div>
  );
};
