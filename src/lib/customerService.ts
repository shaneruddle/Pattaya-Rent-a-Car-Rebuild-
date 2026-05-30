// src/lib/customerService.ts
//
// Shared helper for all customer creation/update paths.
// Consolidates: CRM manual add, CRM CSV import, Timeline NEW BOOKING,
// Timeline "Add to CRM" button, NewRental.tsx, LiveEnquiries.tsx.
//
// The bookingEngine.js Cloud Function is the canonical reference for schema;
// this client-side helper matches its behavior.
//
// Customer location model:
//   - address = text description of home address (free text)
//   - addressHotel = text description of current Pattaya accommodation
//   - homeLocation = lat/lng coordinates of home (new field)
//   - Delivery location for each rental lives on the BOOKING, not the customer
//     (booking.deliveryAddress + booking.deliveryLocation)
//
// Legacy location field on customer docs is deprecated. Existing data is
// preserved (we do not delete it) but the helper does NOT write to it.
// Callers that previously wrote location should write homeLocation instead
// if it is truly the customer home, or write delivery data to the booking doc.
//
// Key invariants:
//   - email is normalized to lowercase + trim before any operation
//   - phone is normalized to E.164 (+66 for Thai numbers, handles double-phone)
//   - new customers with email get email-as-doc-ID; without email get random ID
//   - upsert NEVER overwrites existing non-empty fields (only enriches blanks)
//   - createdAt is always serverTimestamp on new docs
//   - marketingConsent defaults to true (caller can override)
//   - source field is required from caller (no default -- be explicit)

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  DocumentReference,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Customer } from '../types';

// ---- Source values (kept in sync with bookingEngine.js Cloud Function) ----

export type CustomerSource =
  | 'enquiry'            // Cloud Function: public form enquiry
  | 'crm_manual'         // CRM.tsx manual add or Timeline 'Add to CRM' button
  | 'csv_import'         // CRM.tsx CSV import
  | 'staff_booking'      // Timeline NEW BOOKING with new email
  | 'staff_rental'       // NewRental.tsx with no existing customer selected
  | 'enquiry_converted'; // LiveEnquiries.tsx converting enquiry to booking

// ---- Input shape for upsertCustomer ----

export interface CustomerInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  mobileNumber?: string;

  // Address fields -- customer's home & Pattaya accommodation
  address?: string;        // text: home address (e.g. "123 High St, London, UK")
  addressHotel?: string;   // text: typical Pattaya accommodation (e.g. "Centara Grand Pattaya")
  homeLocation?: {         // coordinates: home address lat/lng (rarely used but available)
    lat: number;
    lng: number;
    address?: string;      // optional human-readable label for the coordinates
  };

  // Other personal/document fields
  dob?: string;
  drivingLicence?: string;
  bikeLicenceExpiry?: string;
  carLicenceExpiry?: string;
  notes?: string;
  uniqueId?: string;       // legacy Bubble.io ID, preserved if caller passes

  // Required metadata
  source: CustomerSource;
  marketingConsent?: boolean;  // defaults to true if not specified
}

export interface UpsertResult {
  customerId: string;
  created: boolean;
  docRef: DocumentReference;
  data: Customer;
}

// ---- Validation / Normalization Helpers ----

/**
 * Lowercase + trim email. Returns null if empty/missing.
 */
export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.toString().toLowerCase().trim();
  return trimmed || null;
}

/**
 * Normalize phone to E.164 format. Handles:
 *  - Multiple space-separated numbers (takes first)
 *  - Common formatting chars (-, ., (, ))
 *  - Thai local format (0... to +66...)
 *  - International format (+... unchanged)
 *  - 66 prefix without + (66... to +66...)
 *
 * Returns null if not normalizable.
 *
 * Logic mirrors bookingEngine.js normalizePhone()
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const first = raw.toString().trim().split(/\s+/)[0];
  if (!first) return null;
  const p = first.replace(/[\-().]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("66") && p.length >= 11) return "+" + p;
  if (p.startsWith("0") && p.length >= 9) return "+66" + p.slice(1);
  return null;
}

/**
 * Basic email format check. Not exhaustive -- catches obvious typos.
 */
export function isValidEmailFormat(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Check if a string is valid as a Firestore doc ID.
 * Firestore rules: not empty, not . or .., no /, no __.*__, max 1500 bytes.
 */
function isValidDocId(s: string): boolean {
  if (!s || s === "." || s === "..") return false;
  if (s.includes("/")) return false;
  if (/^__.*__$/.test(s)) return false;
  if (new TextEncoder().encode(s).length > 1500) return false;
  return true;
}

// ---- Find existing customer by email (3-pass case-insensitive) ----

/**
 * Find an existing customer doc by email, trying multiple case variants.
 * Returns the first match, or null.
 *
 * Mirrors the Cloud Function findCustomerByEmail logic.
 */
export async function findExistingByEmail(rawEmail: string): Promise<{ id: string; data: Customer } | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  const customersRef = collection(db, 'customers');

  // Pass 1: lowercase
  const snap1 = await getDocs(query(customersRef, where("email", "==", email), limit(1)));
  if (!snap1.empty) {
    const d = snap1.docs[0];
    return { id: d.id, data: { id: d.id, ...d.data() } as Customer };
  }

  // Pass 2: uppercase (legacy records)
  const snap2 = await getDocs(query(customersRef, where("email", "==", email.toUpperCase()), limit(1)));
  if (!snap2.empty) {
    const d = snap2.docs[0];
    return { id: d.id, data: { id: d.id, ...d.data() } as Customer };
  }

  // Pass 3: original case (as user typed)
  const original = rawEmail.toString().trim();
  if (original !== email && original !== email.toUpperCase()) {
    const snap3 = await getDocs(query(customersRef, where("email", "==", original), limit(1)));
    if (!snap3.empty) {
      const d = snap3.docs[0];
      return { id: d.id, data: { id: d.id, ...d.data() } as Customer };
    }
  }

  return null;
}

// ---- Main upsert function ----

/**
 * Create or enrich a customer document.
 *
 * - If email provided and existing customer found: enriches blank fields only,
 *   never overwrites filled fields. Returns existing customer ID.
 * - If email provided and no existing customer: creates new doc with
 *   lowercased email as doc ID (matching the Cloud Function convention).
 * - If no email: creates new doc with random ID, no dedup possible.
 *
 * Always sets: marketingConsent (default true), source (caller-provided),
 * totalSpent: 0, lastRentalDate: null, createdAt: serverTimestamp,
 * updatedAt: serverTimestamp.
 *
 * Never touches: totalSpent or lastRentalDate on existing docs (owned by
 * the Cloud Function stamp logic).
 *
 * NOTE: result.data will contain serverTimestamp() sentinel objects for
 * createdAt/updatedAt -- do not render these directly. Re-read the doc if
 * you need the resolved timestamp.
 */
export async function upsertCustomer(input: CustomerInput): Promise<UpsertResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedPhone = normalizePhone(input.mobileNumber);

  // Build base payload from caller input
  const baseData: Record<string, any> = {
    firstName: (input.firstName || "").trim(),
    lastName: (input.lastName || "").trim(),
    email: normalizedEmail || "",
    mobileNumber: normalizedPhone || "",
  };

  if (input.address) baseData.address = input.address.trim();
  if (input.addressHotel) baseData.addressHotel = input.addressHotel.trim();
  if (input.dob) baseData.dob = input.dob;
  if (input.drivingLicence) baseData.drivingLicence = input.drivingLicence.trim();
  if (input.bikeLicenceExpiry) baseData.bikeLicenceExpiry = input.bikeLicenceExpiry;
  if (input.carLicenceExpiry) baseData.carLicenceExpiry = input.carLicenceExpiry;
  if (input.notes) baseData.notes = input.notes;
  if (input.uniqueId) baseData.uniqueId = input.uniqueId;

  // homeLocation: only include if non-zero coordinates (filter out placeholder {0,0})
  if (input.homeLocation && (input.homeLocation.lat !== 0 || input.homeLocation.lng !== 0)) {
    baseData.homeLocation = {
      lat: input.homeLocation.lat,
      lng: input.homeLocation.lng,
      ...(input.homeLocation.address && { address: input.homeLocation.address.trim() }),
    };
  }

  const customersRef = collection(db, 'customers');

  if (normalizedEmail) {
    const existing = await findExistingByEmail(normalizedEmail);

    if (existing) {
      // Enrich: only fill empty fields, never overwrite filled data
      const enrichData: Record<string, any> = { updatedAt: serverTimestamp() };

      for (const [key, value] of Object.entries(baseData)) {
        const existingValue = (existing.data as any)[key];

        let isEmpty: boolean;
        if (key === "homeLocation") {
          // homeLocation is empty if missing OR both coordinates are 0
          isEmpty = !existingValue || (existingValue.lat === 0 && existingValue.lng === 0);
        } else {
          isEmpty = !existingValue || existingValue === "";
        }

        if (isEmpty && value) {
          enrichData[key] = value;
        }
      }

      const existingRef = doc(db, 'customers', existing.id);

      if (Object.keys(enrichData).length > 1) {
        await updateDoc(existingRef, enrichData);
      }

      return {
        customerId: existing.id,
        created: false,
        docRef: existingRef,
        data: { ...existing.data, ...enrichData } as Customer,
      };
    }

    const useEmailAsId = isValidDocId(normalizedEmail);

    const fullData = {
      ...baseData,
      marketingConsent: input.marketingConsent ?? true,
      source: input.source,
      totalSpent: 0,
      lastRentalDate: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (useEmailAsId) {
      const newDocRef = doc(customersRef, normalizedEmail);

      const raceCheck = await getDoc(newDocRef);
      if (raceCheck.exists()) {
        const existingData = raceCheck.data();
        return {
          customerId: normalizedEmail,
          created: false,
          docRef: newDocRef,
          data: { id: normalizedEmail, ...existingData } as Customer,
        };
      }

      await setDoc(newDocRef, fullData);
      return {
        customerId: normalizedEmail,
        created: true,
        docRef: newDocRef,
        data: { id: normalizedEmail, ...fullData } as Customer,
      };
    }

    const randomRef = await addDoc(customersRef, fullData);
    return {
      customerId: randomRef.id,
      created: true,
      docRef: randomRef,
      data: { id: randomRef.id, ...fullData } as Customer,
    };
  }

  // No email -- random doc ID, no dedup possible
  const fullData = {
    ...baseData,
    marketingConsent: input.marketingConsent ?? true,
    source: input.source,
    totalSpent: 0,
    lastRentalDate: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const randomRef = await addDoc(customersRef, fullData);
  return {
    customerId: randomRef.id,
    created: true,
    docRef: randomRef,
    data: { id: randomRef.id, ...fullData } as Customer,
  };
}

// ---- Update existing customer (explicit edits, bypasses dedup) ----

/**
 * Update an existing customer doc with caller-provided fields.
 * Used for explicit edits (e.g. CRM form save in edit mode).
 *
 * Always sets updatedAt: serverTimestamp.
 * Never touches: createdAt, source, totalSpent, lastRentalDate.
 * Will overwrite any field the caller passes (unlike upsert enrichment).
 */
export async function updateCustomer(
  customerId: string,
  updates: Partial<Omit<Customer, 'id' | 'createdAt' | 'source' | 'totalSpent' | 'lastRentalDate'>>
): Promise<void> {
  const sanitized: Record<string, any> = { updatedAt: serverTimestamp() };

  if ('email' in updates) {
    const norm = normalizeEmail(updates.email as string);
    sanitized.email = norm || "";
  }
  if ('mobileNumber' in updates) {
    const norm = normalizePhone(updates.mobileNumber as string);
    sanitized.mobileNumber = norm || "";
  }

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'email' || key === 'mobileNumber') continue;
    if (['id', 'createdAt', 'source', 'totalSpent', 'lastRentalDate'].includes(key)) {
      continue;
    }
    sanitized[key] = value;
  }

  const ref = doc(db, 'customers', customerId);
  await updateDoc(ref, sanitized);
}
