import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export interface CompanyConfig {
  companyName: string;
  phone: string;
  whatsapp: string;
  lineId: string;
  email: string;
  address: string;
  googlePlaceId: string;
  mapEmbedUrl: string;
  openingHours: {
    [key: string]: string;
  };
}

const DEFAULT_CONFIG: CompanyConfig = {
  companyName: 'Your Company Name',
  phone: '+66 00 000 0000',
  whatsapp: '+66 00 000 0000',
  lineId: 'company_line_id',
  email: 'info@example.com',
  address: 'Your Physical Address',
  googlePlaceId: '',
  mapEmbedUrl: '',
  openingHours: {
    'Monday': '09:00 - 18:00',
    'Tuesday': '09:00 - 18:00',
    'Wednesday': '09:00 - 18:00',
    'Thursday': '09:00 - 18:00',
    'Friday': '09:00 - 18:00',
    'Saturday': '09:00 - 18:00',
    'Sunday': '09:00 - 18:00'
  }
};

let cachedConfig: CompanyConfig | null = null;

export const useCompanyConfig = () => {
  const [config, setConfig] = useState<CompanyConfig>(cachedConfig || DEFAULT_CONFIG);
  const [loading, setLoading] = useState(!cachedConfig);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', 'company'), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as CompanyConfig;
        cachedConfig = data;
        setConfig(data);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { config, loading };
};
