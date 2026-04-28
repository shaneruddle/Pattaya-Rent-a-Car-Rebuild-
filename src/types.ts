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
  pricePerDay?: number;
  imageUrl?: string;
  seats?: number;
  transmission?: string;
  engine?: string;
  fuel?: string;
  modelYear?: string;
  isActive?: boolean;
  audio?: string;
}

export interface Customer {
  id: string;
  firstName: string;
  lastName?: string;
  email: string;
  mobileNumber?: string;
  address?: string;
  addressHotel?: string;
  dob?: string;
  drivingLicence?: string;
  bikeLicenceExpiry?: string;
  carLicenceExpiry?: string;
  notes?: string;
  creationDate?: string;
  uniqueId?: string;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
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
  startDate: string; // ISO string
  endDate: string; // ISO string
  status: 'Paid' | 'Pending';
  amount?: number;
  notes?: string;
  requestedCarType?: string;
  deliveryAddress?: string;
  deliveryLocation?: {
    lat: number;
    lng: number;
  };
  deliveryNotes?: string;
  deposit?: number;
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
  createdAt: string; // ISO string
  processedBy: string; // user email
}

export interface Transaction {
  id: string;
  type: 'Income' | 'Expense' | 'Transfer';
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
