import { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
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
  companyName: 'Pattaya Rent a Car',
  phone: '+66 81 234 5678',
  whatsapp: '+66 81 234 5678',
  lineId: 'prac-rental',
  email: 'info@pattayarentacar.com',
  address: '123 Beach Road, Pattaya, Chon Buri 20150, Thailand',
  googlePlaceId: '',
  mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3888.5!2d100.8!3d12.9!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMTLCsDU0JzAwLjAiTiAxMDDCsDQ4JzAwLjAiRQ!5e0!3m2!1sen!2sth!4v1600000000000!5m2!1sen!2sth',
  openingHours: {
    'Monday': '08:00 - 18:00',
    'Tuesday': '08:00 - 18:00',
    'Wednesday': '08:00 - 18:00',
    'Thursday': '08:00 - 18:00',
    'Friday': '08:00 - 18:00',
    'Saturday': '09:00 - 17:00',
    'Sunday': '09:00 - 17:00'
  }
};

let cachedConfig: CompanyConfig | null = null;

export const useCompanyConfig = () => {
  const [config, setConfig] = useState<CompanyConfig>(cachedConfig || DEFAULT_CONFIG);
  const [loading, setLoading] = useState(!cachedConfig);

  useEffect(() => {
    // Auth guard for real-time config updates if staff/admin
    // If no user, we stick with DEFAULT_CONFIG and stop loading
    if (!auth.currentUser) {
      console.log('useCompanyConfig: No user, skipping subscription');
      setLoading(false);
      return;
    }

    console.log('useCompanyConfig: Subscribing to company config...');
    const unsub = onSnapshot(doc(db, 'app_settings', 'company'), (snapshot) => {
      if (snapshot.exists()) {
        console.log('useCompanyConfig: Received config data');
        const data = snapshot.data() as CompanyConfig;
        cachedConfig = data;
        setConfig(data);
      } else {
        console.warn('useCompanyConfig: Document does not exist, using defaults');
      }
      setLoading(false);
    }, (error) => {
      console.error('useCompanyConfig: Error fetching config:', error);
      setLoading(false); // Stop loading even on error to show fallback UI
    });

    return () => unsub();
  }, [auth.currentUser]);

  return { config, loading };
};
