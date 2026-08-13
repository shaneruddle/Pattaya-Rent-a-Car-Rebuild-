import React from 'react';
import { MarketingFAQ } from './MarketingFAQ';

// Blog Management, Pages Manager, Content Calendar, and Growth Agent tabs were
// removed from this nav (2026-08) - FAQ Management is the only tab left, so the
// tab header itself is gone too. `defaultTab` is kept on the prop signature so
// existing callers in App.tsx don't need to change, but it's no longer used.
export const Marketing: React.FC<{ defaultTab?: 'blog' | 'pages' | 'faq' | 'calendar' | 'growth' }> = () => {
  return (
    <div className="flex flex-col h-full bg-warm-bg overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8">
        <MarketingFAQ />
      </div>
    </div>
  );
};
