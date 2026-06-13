import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter } from 'react-router-dom';
import ReactGA from 'react-ga4';
import App from './App.tsx';
import './index.css';

// Initialize GA4  pageview tracking is handled in App.tsx via useLocation
const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || 'G-8FHJNX2F1T';
if (GA_ID) {
  ReactGA.initialize(GA_ID);
}

console.log('main.tsx: Starting application');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
);
