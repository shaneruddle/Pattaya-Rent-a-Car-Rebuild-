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
  dob?: string;
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
}

export interface Transaction {
  id: string;
  type: 'Income' | 'Expense' | 'Transfer';
  amount: number;
  date: string; // ISO string
  category: string;
  carId?: string;
  accountId: string;
  toAccountId?: string;
  description?: string;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
}

export interface PricingRule {
  id: string;
  carType: string;
  rates: {
    [durationTier: string]: number;
  };
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
