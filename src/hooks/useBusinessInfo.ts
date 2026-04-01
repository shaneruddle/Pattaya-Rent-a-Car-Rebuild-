import { useState, useEffect } from 'react';

export interface BusinessInfo {
  formatted_address?: string;
  international_phone_number?: string;
  rating?: number;
  user_ratings_total?: number;
  reviews?: any[];
  opening_hours?: {
    open_now: boolean;
    weekday_text: string[];
  };
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
}

let cachedInfo: BusinessInfo | null = null;

export const useBusinessInfo = () => {
  const [info, setInfo] = useState<BusinessInfo | null>(cachedInfo);
  const [loading, setLoading] = useState(!cachedInfo);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedInfo) return;

    const fetchInfo = async () => {
      try {
        const response = await fetch('/api/reviews');
        if (response.ok) {
          const data = await response.json();
          cachedInfo = data;
          setInfo(data);
        } else {
          setError('Failed to fetch business info');
        }
      } catch (err) {
        setError('Error connecting to business info API');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, []);

  return { info, loading, error };
};
