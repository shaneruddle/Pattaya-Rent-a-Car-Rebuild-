export interface Car {
  id: string;
  name: string;
  plateNumber: string;
  type: string; // Economy, SUV, Truck, etc.
  category: 'Car' | 'Motorbike' | 'Other';
  make: string;
  makeLogoUrl?: string;
  model: string;
  yearOfManufacture: number;
  insuranceExpiry: string; // ISO date
  taxExpiry: string; // ISO date
  owner: string;
  currentKms: number;
  lastOilChangeKms: number;
  lastOilChangeDate: string; // ISO date
  order: number;
  sortOrder?: number;
  pricePerDay?: number;
  imageUrl?: string;
  seats?: number;
  transmission?: string;
  engine?: string;
  engineSize?: string;
  fuel?: string;
  modelYear?: string;
  isActive?: boolean;
  audio?: string;
}

export interface Customer {
  id: string;
  firstName: string;
  lastName?: string;
  email?: string;
  mobileNumber?: string;
  nationality?: string;
  address?: string;
  addressHotel?: string;
  dob?: string;
  drivingLicence?: string;
  bikeLicenceExpiry?: string;
  carLicenceExpiry?: string;
  notes?: string;
  creationDate?: string;
  updatedAt?: string;
  uniqueId?: string;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
    homeLocation?: {
      lat: number;
      lng: number;
      address?: string;
    };
    // Fields added by Cloud Function / customerService.ts
    createdAt?: any;          // Firestore Timestamp on new docs, undefined on legacy
    marketingConsent?: boolean;
    source?: string;
    totalSpent?: number;
    lastRentalDate?: any;     // Firestore Timestamp or null
}

export interface VehicleLog {
  id: string;
  carId: string;
  type: 'Activity' | 'Maintenance' | 'Note';
  date: string; // ISO date
  user: string;
  description: string;
  details?: any;
}

export interface Booking {
  id: string;
  carId: string;
  customerName: string;
  email?: string;
  mobileNumber?: string;
  nationality?: string;
  comments?: string;
  startDate: string; // ISO string
  endDate: string; // ISO string
  status: 'Paid' | 'Pending' | 'Completed';
  amount?: number;
  notes?: string;
  requestedCarType?: string;
  deliveryAddress?: string;
  deliveryLocation?: {
    lat: number;
    lng: number;
  };
  deliveryNotes?: string;
  returnNote?: string;
  deposit?: number;
  accountId?: string; // finance account selected by staff for the rental fee portion of this booking's payment
  depositAccountId?: string; // finance account selected by staff for the deposit portion, if different from accountId
  isMaintenance?: boolean;
  maintenanceDescription?: string;
  isGapBlock?: boolean;
  paymentStatus?: 'paid' | 'pending';
  createdAt?: any;
  nationality?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  bookingSource?: string; // staff-assigned channel label
}

export interface Rental {
  id: string;
  bookingId?: string;
  customerId: string;
  carId: string;
  dateOut: string; // ISO string
  dateIn: string; // ISO string
  totalCharge: number;
  depositAmount: number;
  damagePhotos: string[]; // base64 or URLs
  status: 'Active' | 'Completed' | 'Cancelled';
  paymentStatus?: 'paid' | 'pending';
  createdAt: string; // ISO string
  processedBy: string; // user email
}

export interface VehicleFinance {
  id: string;
  vehicleId: string; // Reference to Car.id
  lender: string;
  totalLoanAmount: number;
  monthlyInstallment: number;
  totalInstallments: number;
  paidInstallments?: number;
  startDate: string; // ISO string
  interestRate?: number;
}

export interface Transaction {
  id: string;
  type: 'Income' | 'Expense' | 'Transfer' | 'Adjustment';
  amount: number;
  date: string; // ISO string
  category: string;
  carId?: string;
  bookingId?: string;
  accountId: string;
  toAccountId?: string;
  description?: string;
}

export interface FinanceSummary {
  id: string; // 'all-time' or 'YYYY-MM'
  type: 'all-time' | 'monthly';
  month?: string; // 'YYYY-MM'
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  accountBalances: {
    [accountId: string]: number;
  };
  lastUpdated: string; // ISO string
}

export interface Account {
  id: string;
  name: string;
  balance: number;
  type?: 'Cash' | 'Bank' | 'Card' | 'Savings' | 'Other';
}

export interface PricingRule {
  id: string;
  carType: string;
  rates: {
    [durationTier: string]: number;
  };
}

export interface PricingGrid {
  id: string;
  carType: string;
  headers: number[];
  rates: {
    [date: string]: number[];
  };
  updatedAt?: string;
}

export interface WebsiteCar {
  id: string;
  name: string;
  make?: string;
  model?: string;
  yearRange: string;
  pricePerDay: number;
  priceMonthly: number;
  engineSize: string;
  fuelType: string;
  transmission: string;
  passengers: number;
  airCon: boolean;
  audio: string;
  displayOrder: number;
  isActive: boolean;
  mainImage: string;
  shadowImage?: string;
  realImages: string[];
  slug?: string;
  priceGridVehicle?: string;
  category?: 'Car' | 'Motorbike';
  type?: string; // canonical pricing class: Economy | Compact Sedan | Pickup Truck | MPV | SUV (used by the new pricing engine)
}

export interface SystemLog {
  id: string;
  action: string;
  description: string;
  user: string;
  timestamp: string; // ISO string
  category: 'Bookings' | 'Fleet' | 'Website' | 'CRM' | 'Finance' | 'Pricing' | 'System';
  metadata?: any;
}

export interface UserProfile {
  id: string;
  email: string;
  role: 'admin' | 'staff';
  displayName?: string;
  lastLogin?: string; // ISO string
  createdAt?: string; // ISO string
}

export interface CalendarEvent {
  id: string;
  date: string; // ISO date, yyyy-MM-dd (start date)
  endDate?: string; // ISO date, yyyy-MM-dd; end date for multi-day entries, defaults to date if absent
  type: 'shift' | 'event' | 'holiday';
  title: string;
  staffName?: string; // populated for 'shift' entries
  notes?: string;
  createdAt?: string; // ISO string
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  author: string;
  authorId: string;
  coverImage?: string;
  category: string;
  tags: string[];
  status: 'Draft' | 'Published';
  publishedAt?: string; // ISO string
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

export interface Review {
  id: string;
  customerName: string;
  rating: number;
  comment: string;
  date: string; // ISO string
  source: string; // Google, Website, etc.
  reply?: string;
  repliedAt?: string; // ISO string
  isAutomated?: boolean;
}

export interface ReviewSettings {
  id: string;
  autoReplyEnabled: boolean;
  autoReplyTemplate: string;
  minRatingForAutoReply: number;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  lastUpdated?: string;
}

export interface MarketingPage {
  id: string;
  title: string;
  slug: string;
  categoryPath: string; // e.g., /cars/ev-rentals
  content: string; // HTML content
  excerpt: string;
  featuredImageUrl?: string;
  featuredImageAlt?: string;
  status: 'Draft' | 'Published';
  layoutType: 'Service' | 'Location' | 'Blog' | 'Home' | 'Landing' | 'Contact' | 'About' | 'FAQ' | 'Fleet' | 'Custom';
  metaDescription?: string;
  keywords?: string;
  canonicalUrl?: string;
  schemaMarkup?: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  authorId: string;
  fullUrl: string; // Combined path
  nestedCategoryPath?: string; // e.g., faq
}

export interface AppSettings {
  id: string; // 'global'
  bccEmail: string;
  bankDetails: string;
  updatedAt?: string;
}
