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
      console.warn('PricingContext: Failed to fetch DB pricing, using cache if available:', error);
      // Don't throw here to avoid breaking context
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
    // Auth guard - only staff should trigger sheet fetches to save quota
    if (!auth.currentUser) return;

    // Avoid fetching sheet too often if not needed
    if (!force && sheetPricing && Date.now() - lastFetch < 5 * 60 * 1000) {
      return;
    }

    // Check for rate limit from previous attempt
    const last429 = Number(safeLocalStorage.getItem('pricing_last_429') || 0);
    if (Date.now() - last429 < 60000) { // Wait 1 minute after a 429
      console.warn('PricingContext: Skipping fetch due to recent rate limit');
      setLoading(false);
      return;
    }

    setError(null);

    const performFetch = async (): Promise<void> => {
      try {
        console.log('PricingContext: Fetching pricing from sheet API...');
        const response = await fetchWithRetry('/api/pricing/sheet');
        
        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            console.log('PricingContext: Received sheet pricing data');
            setSheetPricing(data);
            setLastFetch(Date.now());
          } else {
            throw new Error('Invalid response format from server (not JSON)');
          }
        } else {
          if (response.status === 429) {
            console.warn('PricingContext: Rate limit hit (429)');
            safeLocalStorage.setItem('pricing_last_429', Date.now().toString());
            setError('Pricing server too busy (rate limited). Using existing data.');
            setLoading(false);
            return;
          }
          const text = await response.text();
          throw new Error(`Server returned ${response.status}: ${text.substring(0, 100)}`);
        }
      } catch (err: any) {
        if (err.message?.includes('429')) {
          console.warn('PricingContext: Rate limit hit (429 in catch)');
          safeLocalStorage.setItem('pricing_last_429', Date.now().toString());
          setError('Pricing server too busy. Using existing data.');
        } else {
          console.error('PricingContext: Sheet fetch error:', err);
          setError(`Pricing server error: ${err.message}`);
        }
      } finally {
        setLoading(false);
      }
    };

    await performFetch();
  }, [sheetPricing, lastFetch]);

  useEffect(() => {
    // Auth guard for initial fetches
    if (!auth.currentUser) {
      console.log('PricingContext: No user authenticated yet, waiting for auth state change');
      setLoading(false); // Stop loading if no user, onAuthStateChanged will handle it later
    } else {
      fetchDbPricing();
      fetchSettings();
      fetchPricing();
    }

    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        // Re-fetch on login to ensure staff-only bits or fresh data
        fetchDbPricing();
        fetchSettings();
        fetchPricing();
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
