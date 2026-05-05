import React, { useState } from 'react';
import { BlogManager } from './BlogManager';
import { MarketingFAQ } from './MarketingFAQ';
import { FileText, MessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';

export const Marketing: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'blog' | 'faq'>('blog');

  return (
    <div className="flex flex-col h-full bg-warm-bg overflow-hidden">
      {/* Tab Header */}
      <div className="bg-white border-b border-black/10 px-8 flex items-center gap-8 shadow-sm z-10">
        <button
          onClick={() => setActiveTab('blog')}
          className={cn(
            "h-16 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative",
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
          onClick={() => setActiveTab('faq')}
          className={cn(
            "h-16 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative",
            activeTab === 'faq' ? "text-brand-orange" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
          )}
        >
          <MessageSquare size={16} />
          FAQ Management
          {activeTab === 'faq' && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-brand-orange" />
          )}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'blog' ? (
          <BlogManager />
        ) : (
          <MarketingFAQ />
        )}
      </div>
    </div>
  );
};
