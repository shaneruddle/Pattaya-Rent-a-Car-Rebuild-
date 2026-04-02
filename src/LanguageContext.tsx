import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Language, translations } from './translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string, params?: Record<string, any>) => any;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  console.log('LanguageProvider: Rendering');
  const [language, setLanguage] = useState<Language>('en');

  const t = (path: string, params?: Record<string, any>): any => {
    const keys = path.split('.');
    let result: any = translations[language];

    for (const key of keys) {
      if (result && result[key] !== undefined) {
        result = result[key];
      } else {
        return path; // Fallback to path if not found
      }
    }

    if (typeof result === 'string' && params) {
      let formatted = result;
      for (const [key, value] of Object.entries(params)) {
        formatted = formatted.replace(`{${key}}`, String(value));
      }
      return formatted;
    }

    return result;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
