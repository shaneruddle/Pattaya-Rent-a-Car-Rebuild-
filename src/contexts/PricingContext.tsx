import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { safeLocalStorage } from '../lib/storage';

import { fetchWithRetry } from '../lib/api';

import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
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
  const [lastFetch, setLastFetch] = useState(() => {
    const cached = safeLocalStorage.getItem('prac_pricing_last_fetch');
    return cached ? parseInt(cached) : 0;
  });

  const fetchDbPricing = useCallback(async () => {
    if (!auth.currentUser) return;
    // Cache for 10 minutes
    const CACHE_DURATION = 10 * 60 * 1000;
    const isCacheValid = Date.now() - lastFetch < CACHE_DURATION;

    if (dbPricing && isCacheValid) return;

    if (!dbPricing && isCacheValid) {
      const cached = safeLocalStorage.getItem('prac_cached_pricing');
      if (cached) {
        try {
          setDbPricing(JSON.parse(cached));
          return;
        } catch (e) {
          console.error('Error parsing cached pricing:', e);
        }
      }
    }

    try {
      const snapshot = await getDocs(collection(db, 'pricing_grid'));
      const pricingMap: { [carType: string]: PricingGrid } = {};
      snapshot.docs.forEach(doc => {
        pricingMap[doc.id.toLowerCase()] = { id: doc.id, ...doc.data() } as PricingGrid;
      });
      setDbPricing(pricingMap);
      const now = Date.now();
      setLastFetch(now);
      safeLocalStorage.setItem('prac_pricing_last_fetch', now.toString());
      safeLocalStorage.setItem('prac_cached_pricing', JSON.stringify(pricingMap));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'pricing_grid');
    }
  }, [dbPricing, lastFetch]);

  const fetchSettings = useCallback(async () => {
    if (!auth.currentUser) return;
    // Cache for 10 minutes
    const CACHE_DURATION = 10 * 60 * 1000;
    const isCacheValid = Date.now() - lastFetch < CACHE_DURATION;

    if (settings && isCacheValid) return;

    if (!settings && isCacheValid) {
      const cached = safeLocalStorage.getItem('prac_cached_pricing_settings');
      if (cached) {
        try {
          setSettings(JSON.parse(cached));
          return;
        } catch (e) {
          console.error('Error parsing cached settings:', e);
        }
      }
    }

    try {
      const snapshot = await getDoc(doc(db, 'settings', 'pricing'));
      let settingsData: { useSheetDirectly: boolean };
      if (snapshot.exists()) {
        settingsData = snapshot.data() as any;
      } else {
        settingsData = { useSheetDirectly: false };
      }
      setSettings(settingsData);
      safeLocalStorage.setItem('prac_cached_pricing_settings', JSON.stringify(settingsData));
    } catch (error) {
      console.error('Error fetching pricing settings:', error);
    }
  }, [settings, lastFetch]);

  const fetchPricing = useCallback(async (force = false) => {
    // Avoid fetching sheet too often if not needed
    if (!force && sheetPricing && Date.now() - lastFetch < 5 * 60 * 1000) {
      return;
    }

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
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        fetchDbPricing();
        fetchSettings();
        fetchPricing();
      } else {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [fetchDbPricing, fetchSettings, fetchPricing]);

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
