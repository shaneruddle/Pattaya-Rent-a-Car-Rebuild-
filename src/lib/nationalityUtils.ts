// Single source of truth for the nationality dropdown across the app (Inbox
// customer profile, Live Enquiries card + edit form) - previously three
// separate hardcoded lists that had drifted out of sync with each other.
export const NATIONALITY_OPTIONS = [
  'Thai', 'British', 'American', 'Canadian', 'Australian', 'New Zealander',
  'German', 'French', 'Dutch', 'Belgian', 'Swiss', 'Italian', 'Spanish',
  'Scandinavian', 'Irish', 'Russian', 'Ukrainian', 'Polish',
  'Chinese', 'Japanese', 'Korean', 'Indian', 'Israeli', 'Filipino',
  'Singaporean', 'Malaysian', 'South African', 'Other',
];

// Country calling code -> nationality label, for suggesting a nationality
// from a customer's mobile number. Not exhaustive - covers the list above
// plus a couple of common near-misses. +1 (US/Canada) and +7
// (Russia/Kazakhstan) are inherently ambiguous by calling code alone; we
// default to the more common case for this business (American, Russian) and
// leave it to staff to correct if wrong.
const CALLING_CODE_TO_NATIONALITY: Record<string, string> = {
  '66': 'Thai',
  '44': 'British',
  '1': 'American',
  '61': 'Australian',
  '64': 'New Zealander',
  '49': 'German',
  '33': 'French',
  '31': 'Dutch',
  '32': 'Belgian',
  '41': 'Swiss',
  '39': 'Italian',
  '34': 'Spanish',
  '46': 'Scandinavian', // Sweden
  '47': 'Scandinavian', // Norway
  '45': 'Scandinavian', // Denmark
  '358': 'Scandinavian', // Finland
  '353': 'Irish',
  '7': 'Russian',
  '380': 'Ukrainian',
  '48': 'Polish',
  '86': 'Chinese',
  '81': 'Japanese',
  '82': 'Korean',
  '91': 'Indian',
  '972': 'Israeli',
  '63': 'Filipino',
  '65': 'Singaporean',
  '60': 'Malaysian',
  '27': 'South African',
};

// Longest codes first, so a 3-digit code like "358" (Finland) is checked
// before any shorter prefix could wrongly claim a match.
const CODES_BY_LENGTH_DESC = Object.keys(CALLING_CODE_TO_NATIONALITY).sort((a, b) => b.length - a.length);

/**
 * Best-effort guess at a customer's nationality from their mobile number's
 * country calling code. Returns null if the number is missing, unrecognised,
 * or doesn't map onto one of our dropdown options. This is only ever a
 * suggestion for staff to confirm - never written automatically.
 */
export function suggestNationalityFromPhone(mobileNumber?: string | null): string | null {
  if (!mobileNumber) return null;
  const trimmed = mobileNumber.trim();
  if (!trimmed) return null;

  let digits: string;
  if (trimmed.startsWith('+')) {
    digits = trimmed.slice(1).replace(/\D/g, '');
  } else if (trimmed.startsWith('00')) {
    digits = trimmed.slice(2).replace(/\D/g, '');
  } else {
    const raw = trimmed.replace(/\D/g, '');
    // A bare local-format number (leading 0, no country code) is most likely
    // a Thai mobile, given this is a Thailand-based rental business.
    if (raw.startsWith('0')) return 'Thai';
    digits = raw;
  }

  for (const code of CODES_BY_LENGTH_DESC) {
    if (digits.startsWith(code)) return CALLING_CODE_TO_NATIONALITY[code];
  }
  return null;
}
