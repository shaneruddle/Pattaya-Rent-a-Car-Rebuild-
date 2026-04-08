import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import { fetchWithRetry } from '../lib/api';

import { collection, onSnapshot, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { PricingGrid } from '../types';

interface PricingContextType {
  sheetPricing: any | null;
  dbPricing: { [carType: string]: PricingGrid } | null;
  settings: { useSheetDirectly: boolean } | null;
  loading: boolean;
  error: string | null;
  refreshPricing: () => Promise<void>;
}

const PricingContext = createContext<PricingContextType | undefined>(undefined);

export const PricingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sheetPricing, setSheetPricing] = useState<any | null>(null);
  const [dbPricing, setDbPricing] = useState<{ [carType: string]: PricingGrid } | null>(null);
  const [settings, setSettings] = useState<{ useSheetDirectly: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState(0);

  useEffect(() => {
    // Listen to DB Pricing Grid
    const unsubscribeGrids = onSnapshot(collection(db, 'pricing_grid'), (snapshot) => {
      const pricingMap: { [carType: string]: PricingGrid } = {};
      snapshot.docs.forEach(doc => {
        pricingMap[doc.id.toLowerCase()] = { id: doc.id, ...doc.data() } as PricingGrid;
      });
      setDbPricing(pricingMap);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'pricing_grid');
    });

    // Listen to Settings
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'pricing'), (snapshot) => {
      if (snapshot.exists()) {
        setSettings(snapshot.data() as any);
      } else {
        setSettings({ useSheetDirectly: false });
      }
    });

    return () => {
      unsubscribeGrids();
      unsubscribeSettings();
    };
  }, []);

  const fetchPricing = useCallback(async (force = false) => {
    // Avoid fetching sheet too often if not needed
    if (!force && sheetPricing && Date.now() - lastFetch < 5 * 60 * 1000) {
      return;
    }

    // Only fetch sheet if explicitly requested or if we are in sheet mode
    // Actually, we fetch it anyway for the PricingManager to show sync status
    
    setError(null);

    const performFetch = async (retries = 3, delay = 2000): Promise<void> => {
      try {
        const response = await fetchWithRetry('/api/pricing/sheet');
        
        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            setSheetPricing(data);
            setLastFetch(Date.now());
          } else {
            throw new Error('Invalid response format from server');
          }
        }
      } catch (err: any) {
        console.error('Sheet fetch error:', err);
      }
    };

    await performFetch();
    setLoading(false);
  }, [sheetPricing, lastFetch]);

  useEffect(() => {
    fetchPricing();
  }, []);

  return (
    <PricingContext.Provider value={{ 
      sheetPricing, 
      dbPricing,
      settings,
      loading, 
      error, 
      refreshPricing: () => fetchPricing(true) 
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
