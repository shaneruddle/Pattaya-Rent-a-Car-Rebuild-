import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface PricingContextType {
  sheetPricing: any | null;
  loading: boolean;
  error: string | null;
  refreshPricing: () => Promise<void>;
}

const PricingContext = createContext<PricingContextType | undefined>(undefined);

export const PricingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sheetPricing, setSheetPricing] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState(0);

  const fetchPricing = useCallback(async (force = false) => {
    // Avoid fetching too often (cache for 5 minutes in memory)
    if (!force && sheetPricing && Date.now() - lastFetch < 5 * 60 * 1000) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const performFetch = async (retries = 3, delay = 2000): Promise<void> => {
      try {
        const response = await fetch('/api/pricing/sheet');
        
        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            setSheetPricing(data);
            setLastFetch(Date.now());
            setLoading(false);
          } else {
            const text = await response.text();
            if (text.includes('Rate exceeded') && retries > 0) {
              console.warn(`Rate limit hit, retrying in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              return performFetch(retries - 1, delay * 2);
            }
            throw new Error('Invalid response format from server');
          }
        } else if (response.status === 429 || response.status === 503) {
          if (retries > 0) {
            console.warn(`Server busy or rate limited (${response.status}), retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return performFetch(retries - 1, delay * 2);
          }
          throw new Error('Server is currently busy. Please try again in a few minutes.');
        } else {
          const text = await response.text();
          throw new Error(text || `Error ${response.status}`);
        }
      } catch (err: any) {
        if (retries > 0 && (err.message.includes('Rate exceeded') || err.message.includes('Failed to fetch'))) {
          console.warn(`Fetch failed, retrying in ${delay}ms...`, err);
          await new Promise(r => setTimeout(r, delay));
          return performFetch(retries - 1, delay * 2);
        }
        
        const msg = err.message || 'Failed to load pricing data';
        setError(msg);
        setLoading(false);
        if (force) {
          toast.error('Pricing Sync Failed', { description: msg });
        }
      }
    };

    await performFetch();
  }, [sheetPricing, lastFetch]);

  useEffect(() => {
    fetchPricing();
  }, []);

  return (
    <PricingContext.Provider value={{ sheetPricing, loading, error, refreshPricing: () => fetchPricing(true) }}>
      {children}
    </PricingContext.Provider>
  );
};

export const usePricing = () => {
  const context = useContext(PricingContext);
  if (context === undefined) {
    throw new Error('usePricing must be used within a PricingProvider');
  }
  return context;
};
