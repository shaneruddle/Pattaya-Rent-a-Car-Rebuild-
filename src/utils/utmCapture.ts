// src/utils/utmCapture.ts
// Reads UTM params from the URL at session start and persists them in sessionStorage
// so they survive SPA route changes before the user submits an enquiry.
export interface UTMParams {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
}
const UTM_KEYS: (keyof UTMParams)[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];
const STORAGE_KEY = 'prac_utm';

export function captureUTMParams(): void {
  const searchParams = new URLSearchParams(window.location.search);
  const incoming: Partial<UTMParams> = {};
  let hasIncoming = false;
  UTM_KEYS.forEach((key) => {
    const val = searchParams.get(key);
    if (val) {
      incoming[key] = val;
      hasIncoming = true;
    }
  });
  if (hasIncoming) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(incoming));
  }
}

export function getStoredUTMParams(): UTMParams {
  const empty: UTMParams = {
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: '',
  };
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return empty;
    const parsed = JSON.parse(stored) as Partial<UTMParams>;
    return { ...empty, ...parsed };
  } catch {
    return empty;
  }
}
