import React, { createContext, useContext, useState, useCallback } from 'react';

import { fetchWithRetry } from '../lib/api';

import { WebsiteCar } from '../types';

interface PricingContextType {
  classPrices: Record<string, any>;
  classPricesLoading: boolean;
  fetchClassPrices: (classes: string[], fromISO: string, toISO: string) => Promise<void>;
  getQuoteForCar: (car: WebsiteCar) => any | null;
}

const PricingContext = createContext<PricingContextType | undefined>(undefined);

export const PricingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [classPrices, setClassPrices] = useState<Record<string, any>>({});  // class -> quote result object
  const [classPricesLoading, setClassPricesLoading] = useState(true);

  // Fetch quotes from the pricing engine, one call per distinct class. Populates classPrices.
  const fetchClassPrices = useCallback(async (classes: string[], fromISO: string, toISO: string) => {
    if (!classes || classes.length === 0 || !fromISO || !toISO) return;
    const distinct = Array.from(new Set(classes.filter(Boolean)));
    setClassPricesLoading(true);
    try {
      const results: Record<string, any> = {};
      await Promise.all(distinct.map(async (cls) => {
        try {
          const resp = await fetchWithRetry(`/api/pricing/quote?class=${encodeURIComponent(cls)}&from=${fromISO}&to=${toISO}`);
          if (resp.ok) {
            results[cls] = await resp.json();
          } else {
            results[cls] = { quotable: false, reason: 'fetch_failed', status: resp.status };
          }
        } catch (e: any) {
          results[cls] = { quotable: false, reason: 'fetch_error', message: e?.message };
        }
      }));
      setClassPrices(results);
    } finally {
      setClassPricesLoading(false);
    }
  }, []);

  // Read a quote for a car from the already-fetched classPrices map (synchronous, used during render).
  // Returns: { quotable: true, totalPrice, perDay } | { quotable: false, reason } | null (not yet loaded)
  const getQuoteForCar = useCallback((car: WebsiteCar): any | null => {
    if (!car || !car.type) return null;
    const q = classPrices[car.type];
    if (q === undefined) return null; // not fetched yet
    return q;
  }, [classPrices]);

  return (
    <PricingContext.Provider value={{
      classPrices,
      classPricesLoading,
      fetchClassPrices,
      getQuoteForCar
    }}>
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
