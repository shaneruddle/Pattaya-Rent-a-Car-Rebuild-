import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { safeLocalStorage } from '../lib/storage';

import { fetchWithRetry } from '../lib/api';

import { WebsiteCar } from '../types';

interface PricingContextType {
  sheetPricing: any | null;
  loading: boolean;
  error: string | null;
  spreadsheetId: string;
  updateSpreadsheetId: (id: string) => Promise<void>;
  refreshPricing: () => Promise<void>;
  calculatePrice: (car: WebsiteCar | { priceGridVehicle?: string, name?: string }, dateKey: string, durationDays: number | null) => number | null;
}

const PricingContext = createContext<PricingContextType | undefined>(undefined);

const DEFAULT_SPREADSHEET_ID = '1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo';

export const PricingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sheetPricing, setSheetPricing] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState(() => {
    return safeLocalStorage.getItem('prac_pricing_id') || DEFAULT_SPREADSHEET_ID;
  });
  const [lastFetch, setLastFetch] = useState(() => {
    const cached = safeLocalStorage.getItem('prac_pricing_last_fetch');
    return cached ? parseInt(cached) : 0;
  });

  const fetchPricing = useCallback(async (force = false, currentId?: string) => {
    const idToUse = currentId || spreadsheetId;
    
    // Check for rate limit from previous attempt
    const last429 = Number(safeLocalStorage.getItem('pricing_last_429') || 0);
    if (Date.now() - last429 < 60000) { // Wait 1 minute after a 429
      console.warn('PricingContext: Skipping fetch due to recent rate limit');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log(`PricingContext: Fetching pricing from sheet API... ID: ${idToUse}`);
      const response = await fetchWithRetry(`/api/pricing/sheet?spreadsheetId=${idToUse}`);
      
      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const data = await response.json();
          setSheetPricing(data);
          const now = Date.now();
          setLastFetch(now);
          safeLocalStorage.setItem('prac_pricing_last_fetch', now.toString());
          safeLocalStorage.setItem('prac_cached_pricing_sheet', JSON.stringify(data));
        } else {
          throw new Error('Invalid response format from server (not JSON)');
        }
      } else {
        if (response.status === 429) {
          safeLocalStorage.setItem('pricing_last_429', Date.now().toString());
          setError('Pricing server busy. Using cache.');
        } else {
          const text = await response.text();
          throw new Error(`Server returned ${response.status}: ${text.substring(0, 100)}`);
        }
      }
    } catch (err: any) {
      console.error('PricingContext: Sheet fetch error:', err);
      setError(`Pricing server error: ${err.message}`);
      
      // Fallback to cache on error
      const cached = safeLocalStorage.getItem('prac_cached_pricing_sheet');
      if (cached && !sheetPricing) {
        try {
          setSheetPricing(JSON.parse(cached));
        } catch (e) {}
      }
    } finally {
      setLoading(false);
    }
  }, [spreadsheetId]);

  const updateSpreadsheetId = async (id: string) => {
    if (!id) return;
    try {
      const { doc, setDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      await setDoc(doc(db, 'app_settings', 'pricing'), { spreadsheetId: id }, { merge: true });
      setSpreadsheetId(id);
      safeLocalStorage.setItem('prac_pricing_id', id);
      toast.success('Pricing spreadsheet connection updated');
      fetchPricing(true, id);
    } catch (err) {
      console.error('Failed to update spreadsheet ID:', err);
      toast.error('Failed to update spreadsheet connection');
    }
  };

  const calculatePrice = useCallback((car: WebsiteCar | { priceGridVehicle?: string, name?: string }, dateString: string, durationDays: number | null): number | null => {
    if (!dateString || durationDays === null || durationDays <= 0) return null;
    
    // Round up duration to nearest 0.5 days
    const roundedDuration = Math.max(0.5, Math.ceil(durationDays * 2) / 2);

    const carNameLower = (car.name || '').toLowerCase();
    let searchName = (car.priceGridVehicle?.toLowerCase() || carNameLower);

    if (!car.priceGridVehicle) {
      if (carNameLower.includes('vios')) searchName = 'vios';
      else if (carNameLower.includes('ativ')) searchName = 'ativ';
      else if (carNameLower.includes('city')) searchName = 'city';
      else if (carNameLower.includes('fortuner')) searchName = carNameLower.includes('old') ? 'old fortuner' : 'new fortuner';
      else if (carNameLower.includes('yaris')) searchName = 'yaris';
      else if (carNameLower.includes('veloz')) searchName = 'veloz';
      else if (carNameLower.includes('everest')) searchName = 'everest';
      else if (carNameLower.includes('benz')) searchName = 'benz';
      else if (carNameLower.includes('revo')) searchName = 'revo';
      else if (carNameLower.includes('extender')) searchName = 'extender';
    }

    const getPriceFromData = (pricingData: any, targetDate: string) => {
      if (!pricingData || !targetDate) return null;
      
      const tabName = Object.keys(pricingData).find(tab => {
        const t = (tab || '').toLowerCase();
        return searchName === t || t.includes(searchName) || searchName.includes(t);
      });

      if (tabName) {
        const pricing = pricingData[tabName];
        
        // Handle DD/MM/YYYY vs YYYY-MM-DD
        const dateParts = targetDate.split('-');
        let df1 = targetDate; // YYYY-MM-DD
        let df2 = '';
        if (dateParts.length === 3) {
          df2 = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`; // DD/MM/YYYY
        }
        
        const dataObj = pricing.data || pricing.rates;
        if (!dataObj) return null;

        let rates: number[] | null = null;
        if (dataObj[df1]) rates = dataObj[df1];
        else if (df2 && dataObj[df2]) rates = dataObj[df2];
        
        // Fuzzy search for dates if strictly DD/MM/YYYY failed (e.g. D/M/YYYY)
        if (!rates && dateParts.length === 3) {
          const m = parseInt(dateParts[1]).toString();
          const d = parseInt(dateParts[2]).toString();
          const y = dateParts[0];
          const alt1 = `${m}/${d}/${y}`; // M/D/YYYY
          const alt2 = `${d}/${m}/${y}`; // D/M/YYYY
          if (dataObj[alt1]) rates = dataObj[alt1];
          else if (dataObj[alt2]) rates = dataObj[alt2];
        }

        if (rates && Array.isArray(rates)) {
          let total = 0;
          let lastRate = 0;
          
          const cellsToSum = Math.max(1, Math.round(durationDays * 2) - 1);

          for (let i = 0; i < cellsToSum; i++) {
            if (i < rates.length) {
              total += rates[i] || 0;
              lastRate = rates[i] || 0;
            } else {
              total += lastRate;
            }
          }

          return total;
        }
      }
      return null;
    };

    return getPriceFromData(sheetPricing, dateString);
  }, [sheetPricing]);

  // Initial Data Load
  useEffect(() => {
    const init = async () => {
      // 1. Load from cache immediately
      try {
        const cachedSheet = safeLocalStorage.getItem('prac_cached_pricing_sheet');
        if (cachedSheet) {
          setSheetPricing(JSON.parse(cachedSheet));
        }
      } catch (e) {}

      // 2. Load latest ID from Firestore
      try {
        const { getDoc, doc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        const docSnap = await getDoc(doc(db, 'app_settings', 'pricing'));
        
        let finalId = spreadsheetId;
        if (docSnap.exists()) {
          const latestId = docSnap.data().spreadsheetId;
          if (latestId && latestId !== spreadsheetId) {
            setSpreadsheetId(latestId);
            safeLocalStorage.setItem('prac_pricing_id', latestId);
            finalId = latestId;
          }
        }
        
        // 3. Fetch data if cache is old or missing
        const lastFetchTime = Number(safeLocalStorage.getItem('prac_pricing_last_fetch') || 0);
        if (!sheetPricing || Date.now() - lastFetchTime > 5 * 60 * 1000) {
          fetchPricing(false, finalId);
        } else {
          setLoading(false);
        }
      } catch (e) {
        fetchPricing(); // Fallback to local ID
      }
    };

    init();
  }, []); // Only run once on mount

  return (
    <PricingContext.Provider value={{ 
      sheetPricing, 
      loading, 
      error, 
      spreadsheetId,
      updateSpreadsheetId,
      refreshPricing: () => fetchPricing(true),
      calculatePrice
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

