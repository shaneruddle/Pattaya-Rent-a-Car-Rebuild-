
/**
 * Safe wrapper for localStorage to handle QuotaExceededError and other potential issues.
 */
export const safeLocalStorage = {
  setItem: (key: string, value: string, silent = false) => {
    try {
      localStorage.setItem(key, value);
    } catch (e: any) {
      // Check for quota exceeded error
      if (
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        e.code === 22 ||
        e.code === 1014
      ) {
        if (!silent) {
          console.warn('LocalStorage quota exceeded. Clearing old cache items to make room.');
        }
        
        // Strategy: Clear all items starting with 'prac_cached_' to free up space
        try {
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('prac_cached_')) {
              keysToRemove.push(k);
            }
          }
          
          keysToRemove.forEach(k => localStorage.removeItem(k));
          
          // Try setting the item again after clearing
          localStorage.setItem(key, value);
        } catch (retryError) {
          if (!silent) {
            console.warn('Failed to set localStorage item even after clearing cache. Item might be too large.', key);
          }
        }
      } else {
        if (!silent) {
          console.error('Error saving to localStorage:', e);
        }
      }
    }
  },
  
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error('Error reading from localStorage:', e);
      return null;
    }
  },
  
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error('Error removing from localStorage:', e);
    }
  },

  clearCache: () => {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('prac_cached_')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {
      console.error('Error clearing localStorage cache:', e);
    }
  }
};
