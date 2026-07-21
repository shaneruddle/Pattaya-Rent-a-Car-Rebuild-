import React, { useState, useMemo, useEffect } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, serverTimestamp, getDocs, where, getDoc } from 'firebase/firestore';
import { upsertCustomer, updateCustomer, findExistingByEmail } from '../lib/customerService';
import { db, handleFirestoreError, OperationType, logSystemActivity, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { processTemplate, htmlToPlainText } from '../lib/emailUtils';
import { Booking, Car } from '../types';
import { format, parseISO, isValid, formatDistanceToNow, isToday } from 'date-fns';
import { 
  Search, 
  Filter, 
  MoreVertical, 
  Calendar, 
  Phone, 
  Mail, 
  Car as CarIcon, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Edit2, 
  Trash2,
  MapPin,
  Truck,
  ArrowRight,
  Loader2,
  DollarSign,
  ShieldCheck,
  Copy,
  Globe,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { LocationPicker } from './LocationPicker';

interface LiveEnquiriesProps {
  bookings: Booking[];
  cars: Car[];
  onRefresh?: () => void;
}

export const LiveEnquiries: React.FC<LiveEnquiriesProps> = ({ bookings = [], cars = [], onRefresh }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEnquiry, setSelectedEnquiry] = useState<Booking | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Partial<Booking>>({});
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [carSearch, setCarSearch] = useState('');
  const [carDropdownOpen, setCarDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'followup' | 'dnr'>('active');
  const [showDnrModal, setShowDnrModal] = useState(false);
  const [dnrTarget, setDnrTarget] = useState<Booking | null>(null);
  const [dnrReason, setDnrReason] = useState('');
  const [openMenu, setOpenMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const [sendingEnquiryId, setSendingEnquiryId] = useState<string | null>(null);
  const [sentTimestamps, setSentTimestamps] = useState<Record<string, string>>({});
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [reminderSentTimestamps, setReminderSentTimestamps] = useState<Record<string, string>>({});

  // Fetch templates on mount to avoid async delays during clipboard copy
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'email_templates'));
        const templateMap: Record<string, string> = {};
        querySnapshot.forEach((doc) => {
          templateMap[doc.id] = doc.data().body;
          // Also map by name for fallback support
          if (doc.data().name) {
            templateMap[`name_${doc.data().name}`] = doc.data().body;
          }
        });
        setTemplates(templateMap);
      } catch (err) {
        console.error('Error pre-fetching templates:', err);
      }
    };
    fetchTemplates();
  }, []);

  // Auth observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Auth guard (added to satisfy request to fix fetch useEffect, even if others manage data)
  useEffect(() => {
    if (!auth.currentUser) return;
  }, []);

  const enquiries = useMemo(() => {
    return bookings
      .filter(b => (!b.carId || b.carId === '') && b.status !== 'DNR' && (b as any).status !== 'FollowUp')
      .filter(b => {
        const searchLower = (searchQuery || '').toLowerCase();
        const matchesSearch = 
          (b.customerName?.toLowerCase() || '').includes(searchLower) ||
          (b.email?.toLowerCase() || '').includes(searchLower) ||
          (b.mobileNumber && b.mobileNumber.includes(searchQuery));
        return matchesSearch;
      })
      .sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        
        if (dateA && dateB) return dateB - dateA;
        // Fallback to startDate if createdAt is missing for some reason
        return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
      });
  }, [bookings, searchQuery]);

  const dnrEnquiries = useMemo(() => {
    return bookings
      .filter(b => b.status === 'DNR')
      .filter(b => {
        const searchLower = (searchQuery || '').toLowerCase();
        return (
          (b.customerName?.toLowerCase() || '').includes(searchLower) ||
          (b.email?.toLowerCase() || '').includes(searchLower) ||
          (b.mobileNumber && b.mobileNumber.includes(searchQuery))
        );
      })
      .sort((a, b) => new Date((b as any).dnrAt || b.startDate).getTime() - new Date((a as any).dnrAt || a.startDate).getTime());
  }, [bookings, searchQuery]);

  const followUpEnquiries = useMemo(() => {
    return bookings
      .filter(b => (b as any).status === 'FollowUp')
      .filter(b => {
        const searchLower = (searchQuery || '').toLowerCase();
        return (
          (b.customerName?.toLowerCase() || '').includes(searchLower) ||
          (b.email?.toLowerCase() || '').includes(searchLower) ||
          (b.mobileNumber && b.mobileNumber.includes(searchQuery))
        );
      })
      // Oldest enquiry first — surfaces the most overdue follow-ups at the top of the queue
      .sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return dateA - dateB;
      });
  }, [bookings, searchQuery]);

  const daysSinceEnquiry = (createdAt: any): number | null => {
    if (!createdAt) return null;
    try {
      const date = createdAt?.toDate ? createdAt.toDate() : (typeof createdAt === 'string' ? parseISO(createdAt) : null);
      if (!date || !isValid(date)) return null;
      return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
    } catch {
      return null;
    }
  };

  const formatEnquiryTime = (createdAt: any) => {
    if (!createdAt) return null;
    
    let date: Date;
    try {
      if (createdAt?.toDate) {
        date = createdAt.toDate();
      } else if (typeof createdAt === 'string') {
        date = parseISO(createdAt);
      } else {
        date = new Date(createdAt);
      }
    } catch (e) {
      return null;
    }

    if (!isValid(date)) return null;

    if (isToday(date)) {
      return `Received Today, ${format(date, 'HH:mm')} (${formatDistanceToNow(date, { addSuffix: true })})`;
    }
    return `Received: ${format(date, 'MMM d, HH:mm')}`;
  };

  const handleEdit = (enquiry: Booking) => {
    setSelectedEnquiry(enquiry);
    setFormData(enquiry);
    setIsEditing(true);
  };

  const handleConvert = (enquiry: Booking) => {
    setSelectedEnquiry(enquiry);
    setFormData({ ...enquiry, carId: '' });
    setIsConverting(true);
  };

  const handleNationalityChange = async (enquiry: Booking, nationality: string) => {
    try {
      // Update the booking document
      await updateDoc(doc(db, 'bookings', enquiry.id), {
        nationality,
        updatedAt: serverTimestamp(),
      });

      // Update the customer record if one exists (matched by email)
      if (enquiry.email) {
        const existing = await findExistingByEmail(enquiry.email);
        if (existing) {
          await updateCustomer(existing.id, { nationality });
        }
      }

      toast.success(`Nationality set to ${nationality}`);
    } catch (error) {
      toast.error('Failed to save nationality');
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    }
  };

  const saveEnquiry = async () => {
    if (!selectedEnquiry || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const docRef = doc(db, 'bookings', selectedEnquiry.id);
      await updateDoc(docRef, {
        ...formData,
        updatedAt: serverTimestamp()
      });
      toast.success('Enquiry updated successfully');
      setIsEditing(false);
      setSelectedEnquiry(null);
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Failed to update enquiry');
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmBooking = async () => {
    if (!selectedEnquiry || !formData.carId || isSubmitting) {
      if (!formData.carId && !isSubmitting) toast.error('Please select a car to confirm the booking');
      return;
    }
    setIsSubmitting(true);
    try {
      const docRef = doc(db, 'bookings', selectedEnquiry.id);
      await updateDoc(docRef, {
        ...formData,
        status: 'Pending', // Or 'Confirmed' if we add that status
        updatedAt: serverTimestamp()
      });
      
      // Log system activity
      await logSystemActivity(
        'Booking Confirmed',
        `Enquiry for ${selectedEnquiry.customerName} converted to booking`,
        'Bookings',
        { bookingId: selectedEnquiry.id, carId: formData.carId }
      );

      // Handle CRM update/creation
      if (selectedEnquiry.email) {
        const customerResult = await upsertCustomer({
          firstName: selectedEnquiry.customerName.split(' ')[0] || '',
          lastName: selectedEnquiry.customerName.split(' ').slice(1).join(' '),
          email: selectedEnquiry.email,
          mobileNumber: selectedEnquiry.mobileNumber || '',
          source: 'enquiry_converted',
        });

        // Legacy: write delivery location to customer.location for Timeline pre-fill UX
        if (formData.deliveryLocation) {
          await updateDoc(doc(db, 'customers', customerResult.customerId), {
            location: {
              lat: formData.deliveryLocation.lat,
              lng: formData.deliveryLocation.lng,
              address: formData.deliveryAddress || 'Delivery Location',
            },
          });
        }

        toast.success(customerResult.created ? 'New customer created in CRM' : 'Customer profile updated in CRM');
      }

      toast.success('Enquiry converted to booking successfully');
      setIsConverting(false);
      setSelectedEnquiry(null);
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Failed to confirm booking');
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const initiateDnr = (enquiry: Booking) => {
    setDnrTarget(enquiry);
    setDnrReason('');
    setShowDnrModal(true);
  };

  const markAsFollowUp = async (enquiry: Booking) => {
    try {
      await logSystemActivity(
        'Marked for Follow Up',
        `Marked enquiry for ${enquiry.customerName || enquiry.id} as Follow Up`,
        'Bookings',
        { bookingId: enquiry.id, customerName: enquiry.customerName }
      );
      await updateDoc(doc(db, 'bookings', enquiry.id), {
        status: 'FollowUp',
        followUpAt: new Date().toISOString(),
        followUpBy: auth.currentUser?.email || 'unknown',
      });
      toast.success('Moved to Follow Up');
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Failed to mark as Follow Up');
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    }
  };

  const confirmDnr = async () => {
    if (!dnrTarget || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await logSystemActivity(
        'Did Not Rent',
        `Marked enquiry for ${dnrTarget.customerName || dnrTarget.id} as Did Not Rent${dnrReason ? `: ${dnrReason}` : ''}`,
        'Bookings',
        { bookingId: dnrTarget.id, customerName: dnrTarget.customerName, reason: dnrReason }
      );
      await updateDoc(doc(db, 'bookings', dnrTarget.id), {
        status: 'DNR',
        dnrAt: new Date().toISOString(),
        dnrBy: auth.currentUser?.email || 'unknown',
        dnrNote: dnrReason || '',
      });
      toast.success('Marked as Did Not Rent');
      setShowDnrModal(false);
      setDnrTarget(null);
      setDnrReason('');
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Failed to mark as Did Not Rent');
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyTemplate = async (enquiry: Booking, templateId: string, fallbackName: string, defaultBody: string, successMsg: string) => {
    try {
      // Use pre-fetched template if available
      let bodyTemplate = templates[templateId] || templates[`name_${fallbackName}`] || defaultBody;

      // 2. Process template with enquiry data
      const placeholders = {
        '{{customer_name}}': (enquiry.customerName || 'Customer').split(' ')[0],
        '{{vehicle_model}}': enquiry.requestedCarType || 'requested car',
        '{{total_price}}': (enquiry.amount || 0).toLocaleString(),
        '{{pickup_date}}': enquiry.startDate ? format(parseISO(enquiry.startDate), 'dd MMM yyyy') : '',
        '{{pickup_time}}': enquiry.startDate ? format(parseISO(enquiry.startDate), 'HH:mm') : '',
        '{{return_date}}': enquiry.endDate ? format(parseISO(enquiry.endDate), 'dd MMM yyyy') : '',
        '{{return_time}}': enquiry.endDate ? format(parseISO(enquiry.endDate), 'HH:mm') : '',
        '{{rental_period}}': enquiry.startDate && enquiry.endDate 
          ? `${format(parseISO(enquiry.startDate), 'dd MMM yyyy')} to ${format(parseISO(enquiry.endDate), 'dd MMM yyyy')}` 
          : '',
        '{{delivery_address}}': enquiry.deliveryAddress || 'Not specified',
        '{{customer_email}}': enquiry.email || '',
        '{{customer_phone}}': enquiry.mobileNumber || '',
        '{{comments}}': enquiry.notes || ''
      };

      const finalBody = htmlToPlainText(processTemplate(bodyTemplate, placeholders));

      // 3. Copy to clipboard
      // Explicitly focus window before writing to clipboard
      window.focus();
      await navigator.clipboard.writeText(finalBody);
      toast.success(successMsg);
    } catch (err) {
      console.error(`Failed to copy ${templateId}:`, err);
      toast.error('Failed to copy template');
    }
  };

  const copyEmailTemplate = (enquiry: Booking) => {
    return copyTemplate(
      enquiry,
      'enquiry_reply',
      'Enquiry Reply',
      `Hi {{customer_name}},

Thanks for your email. We can confirm availability of the {{vehicle_model}} (or similar) at a total rate of {{total_price}}

Included in your rental:

- First Class Rental Insurance
- Unlimited kms
- 24 hour breakdown cover for your piece of mind
- Additional drivers
- All taxes

In addition you can book now, pay later and cancel at anytime free of charge

Do you wish to proceed with the booking ?`,
      'Email reply template copied!'
    );
  };

  const sendEmailReply = async (enquiry: Booking) => {
    if (!enquiry.email) {
      toast.error('No email address for this customer');
      return;
    }
    setSendingEnquiryId(enquiry.id || '');
    try {
      const placeholders: Record<string, string> = {
        '{{customer_name}}': (enquiry.customerName || 'Customer').split(' ')[0],
        '{{vehicle_model}}': enquiry.requestedCarType || 'requested car',
        '{{total_price}}': (enquiry.amount || 0).toLocaleString(),
        '{{pickup_date}}': enquiry.startDate ? format(parseISO(enquiry.startDate), 'dd MMM yyyy') : '',
        '{{pickup_time}}': enquiry.startDate ? format(parseISO(enquiry.startDate), 'HH:mm') : '',
        '{{return_date}}': enquiry.endDate ? format(parseISO(enquiry.endDate), 'dd MMM yyyy') : '',
        '{{return_time}}': enquiry.endDate ? format(parseISO(enquiry.endDate), 'HH:mm') : '',
        '{{rental_period}}': enquiry.startDate && enquiry.endDate
          ? `${format(parseISO(enquiry.startDate), 'dd MMM yyyy')} to ${format(parseISO(enquiry.endDate), 'dd MMM yyyy')}`
          : '',
        '{{delivery_address}}': enquiry.deliveryAddress || 'Not specified',
        '{{customer_email}}': enquiry.email || '',
        '{{customer_phone}}': enquiry.mobileNumber || '',
        '{{comments}}': enquiry.notes || '',
      };
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: enquiry.email,
          templateId: 'email_reply',
          skipFinalToOverride: true,
          replyTo: 'info@pattayarentacar.com',
          placeholders,
        }),
      });
      if (!res.ok) throw new Error('Send failed');
      toast.success(`Reply sent to ${enquiry.email}`);
      setSentTimestamps(prev => ({ ...prev, [enquiry.id || '']: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) }));
    } catch (err) {
      toast.error('Failed to send email - please try again');
    } finally {
      setSendingEnquiryId(null);
    }
  };

  const sendFollowUpReminder = async (enquiry: Booking) => {
    if (!enquiry.email) {
      toast.error('No email address for this customer');
      return;
    }
    setSendingReminderId(enquiry.id || '');
    try {
      const placeholders: Record<string, string> = {
        '{{customer_name}}': (enquiry.customerName || 'Customer').split(' ')[0],
        '{{vehicle_model}}': enquiry.requestedCarType || 'requested car',
        '{{total_price}}': (enquiry.amount || 0).toLocaleString(),
        '{{pickup_date}}': enquiry.startDate ? format(parseISO(enquiry.startDate), 'dd MMM yyyy') : '',
        '{{pickup_time}}': enquiry.startDate ? format(parseISO(enquiry.startDate), 'HH:mm') : '',
        '{{return_date}}': enquiry.endDate ? format(parseISO(enquiry.endDate), 'dd MMM yyyy') : '',
        '{{return_time}}': enquiry.endDate ? format(parseISO(enquiry.endDate), 'HH:mm') : '',
        '{{rental_period}}': enquiry.startDate && enquiry.endDate
          ? `${format(parseISO(enquiry.startDate), 'dd MMM yyyy')} to ${format(parseISO(enquiry.endDate), 'dd MMM yyyy')}`
          : '',
        '{{delivery_address}}': enquiry.deliveryAddress || 'Not specified',
        '{{customer_email}}': enquiry.email || '',
        '{{customer_phone}}': enquiry.mobileNumber || '',
        '{{comments}}': enquiry.notes || '',
      };
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: enquiry.email,
          templateId: 'follow_up_reminder',
          skipFinalToOverride: true,
          replyTo: 'info@pattayarentacar.com',
          placeholders,
        }),
      });
      if (!res.ok) throw new Error('Send failed');
      toast.success(`Reminder sent to ${enquiry.email}`);
      setReminderSentTimestamps(prev => ({ ...prev, [enquiry.id || '']: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) }));
    } catch (err) {
      toast.error('Failed to send reminder - please try again');
    } finally {
      setSendingReminderId(null);
    }
  };

  const copyDeliveryEmailTemplate = (enquiry: Booking) => {
    return copyTemplate(
      enquiry,
      'booking_confirmed_with_delivery',
      'Booking Confirmed with Delivery',
      `Hi {{customer_name}},

Confirming availability for {{vehicle_model}} from {{return_date}}.

Delivery Address: {{delivery_address}}

Total Price: {{total_price}} THB

Do you wish to proceed?`,
      'Delivery email reply copied!'
    );
  };

  const copyBookingConfirmTemplate = (enquiry: Booking) => {
    return copyTemplate(
      enquiry,
      'booking_confirmed',
      'Booking Confirmation',
      `Hi {{customer_name}},

We are pleased to confirm your booking for the {{vehicle_model}}.

Rental Period: {{rental_period}}
Total Amount: {{total_price}} THB

See you soon!`,
      'Booking confirmation copied!'
    );
  };

  const copyAlternativeTemplate = (enquiry: Booking) => {
    return copyTemplate(
      enquiry,
      'alternative_option',
      'Alternative Option',
      `Hi {{customer_name}},

Thank you for your enquiry. Unfortunately, the {{vehicle_model}} is not available for your dates.

However, we can offer the following alternative...`,
      'Alternative option reply copied!'
    );
  };

  if (isAuthLoading || !auth.currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 bg-warm-bg">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-brand-orange animate-spin" />
          <h2 className="text-xl font-serif italic text-black/40">Checking Enquiries...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-warm-bg overflow-hidden">
      {/* Header */}
      <header className="h-auto py-6 sm:h-24 sm:py-0 bg-white/40 backdrop-blur-xl border-b border-white/60 flex flex-col sm:flex-row sm:items-center justify-between px-6 sm:px-12 shrink-0 z-10 gap-4">
        <div>
          <h1 className="font-serif italic text-2xl sm:text-3xl text-[#1A1A1A]">Live Enquiries</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-1">
            {activeTab === 'active'
              ? `${enquiries.length} Pending Enquiries from Booking Engine`
              : activeTab === 'followup'
              ? `${followUpEnquiries.length} Awaiting Follow Up`
              : `${dnrEnquiries.length} Did Not Rent`}
          </p>
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto">
          {/* Tab Switcher */}
          <div className="flex bg-black/5 rounded-2xl p-1 shrink-0">
            <button
              onClick={() => setActiveTab('active')}
              className={cn("px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all", activeTab === 'active' ? "bg-white text-brand-orange shadow-sm" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]/60")}
            >
              Active
            </button>
            <button
              onClick={() => setActiveTab('followup')}
              className={cn("px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2", activeTab === 'followup' ? "bg-white text-blue-600 shadow-sm" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]/60")}
            >
              Follow Up
              {followUpEnquiries.length > 0 && <span className="bg-blue-100 text-blue-600 rounded-full w-4 h-4 flex items-center justify-center text-[8px]">{followUpEnquiries.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('dnr')}
              className={cn("px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2", activeTab === 'dnr' ? "bg-white text-amber-600 shadow-sm" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]/60")}
            >
              Did Not Rent
              {dnrEnquiries.length > 0 && <span className="bg-amber-100 text-amber-600 rounded-full w-4 h-4 flex items-center justify-center text-[8px]">{dnrEnquiries.length}</span>}
            </button>
          </div>
          <div className="relative group w-full sm:w-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30 group-focus-within:text-brand-orange transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search enquiries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-80 bg-white/40 border border-white/60 rounded-2xl py-3 pl-12 pr-6 text-sm focus:outline-none focus:bg-white/60 focus:border-brand-orange transition-all font-medium"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-12 custom-scrollbar">
        {activeTab === 'dnr' ? (
          /* DNR Tab */
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8">
            <AnimatePresence mode="popLayout">
              {dnrEnquiries.length === 0 ? (
                <motion.div key="empty-dnr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-2 text-center py-20 bg-white/20 backdrop-blur-md border-2 border-dashed border-white/40 rounded-[40px]">
                  <XCircle className="text-[#1A1A1A]/10 mx-auto mb-4" size={40} />
                  <p className="text-[#1A1A1A]/40 font-bold uppercase tracking-widest text-xs">No did not rent records</p>
                </motion.div>
              ) : dnrEnquiries.map((enquiry) => (
                <motion.div
                  key={enquiry.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white/30 backdrop-blur-xl border border-white/40 rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <span className="px-3 py-1 bg-amber-100 text-amber-600 text-[8px] font-bold uppercase tracking-widest rounded-full">Did Not Rent</span>
                      <h3 className="font-bold text-lg text-[#1A1A1A] mt-3">{enquiry.customerName || 'Unknown'}</h3>
                      <p className="text-xs text-[#1A1A1A]/40 font-medium">{enquiry.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30">Enquiry dates</p>
                      <p className="text-xs font-bold text-[#1A1A1A]/60 mt-1">
                        {enquiry.startDate ? format(parseISO(enquiry.startDate), 'dd MMM') : '—'} – {enquiry.endDate ? format(parseISO(enquiry.endDate), 'dd MMM yyyy') : '—'}
                      </p>
                    </div>
                  </div>
                  {(enquiry as any).dnrNote && (
                    <div className="mt-4 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-1">Reason</p>
                      <p className="text-sm text-[#1A1A1A]/70 font-medium">{(enquiry as any).dnrNote}</p>
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30">
                    <Clock size={10} />
                    {(enquiry as any).dnrAt ? format(parseISO((enquiry as any).dnrAt), 'dd MMM yyyy') : 'Date unknown'}
                    {(enquiry as any).dnrBy && <span>· {(enquiry as any).dnrBy}</span>}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : activeTab === 'followup' ? (
          /* Follow Up Tab */
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8">
            <AnimatePresence mode="popLayout">
              {followUpEnquiries.length === 0 ? (
                <motion.div key="empty-followup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-2 text-center py-20 bg-white/20 backdrop-blur-md border-2 border-dashed border-white/40 rounded-[40px]">
                  <Clock className="text-[#1A1A1A]/10 mx-auto mb-4" size={40} />
                  <p className="text-[#1A1A1A]/40 font-bold uppercase tracking-widest text-xs">No enquiries awaiting follow up</p>
                </motion.div>
              ) : followUpEnquiries.map((enquiry) => {
                const days = daysSinceEnquiry(enquiry.createdAt);
                return (
                <motion.div
                  key={enquiry.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white/30 backdrop-blur-xl border border-white/40 rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 shadow-sm flex flex-col"
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <span className="px-3 py-1 bg-blue-100 text-blue-600 text-[8px] font-bold uppercase tracking-widest rounded-full">Follow Up</span>
                      <h3 className="font-bold text-lg text-[#1A1A1A] mt-3">{enquiry.customerName || 'Unknown'}</h3>
                      <p className="text-xs text-[#1A1A1A]/40 font-medium">{enquiry.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30">Since Enquiry</p>
                      <p className={cn("text-sm font-bold mt-1", days !== null && days >= 7 ? "text-red-500" : "text-[#1A1A1A]/60")}>
                        {days !== null ? `${days} ${days === 1 ? 'day' : 'days'}` : '—'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30 mb-2">
                    <Calendar size={10} />
                    {enquiry.startDate ? format(parseISO(enquiry.startDate), 'dd MMM') : '—'} – {enquiry.endDate ? format(parseISO(enquiry.endDate), 'dd MMM yyyy') : '—'}
                    {enquiry.requestedCarType && <span>· {enquiry.requestedCarType}</span>}
                  </div>

                  {enquiry.notes && (
                    <div className="mt-2 mb-2 bg-black/5 border border-black/5 rounded-2xl px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-black/30 mb-1">Customer Comments</p>
                      <p className="text-xs text-black/60 leading-relaxed italic">"{enquiry.notes}"</p>
                    </div>
                  )}

                  <div className="mt-auto pt-4 flex flex-col sm:flex-row flex-wrap gap-3">
                    <button
                      onClick={() => sendFollowUpReminder(enquiry)}
                      disabled={sendingReminderId === enquiry.id}
                      className="flex-1 min-w-[140px] bg-blue-500 border border-blue-600 text-white py-3 rounded-xl font-bold uppercase tracking-normal text-[9px] flex items-center justify-center gap-2 hover:bg-blue-600 transition-all text-center disabled:opacity-50"
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-2">
                          {sendingReminderId === enquiry.id ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />}
                          {sendingReminderId === enquiry.id ? 'Sending...' : 'Send Reminder'}
                        </div>
                        {reminderSentTimestamps[enquiry.id || ''] && <div className="text-[7px] font-normal normal-case tracking-normal opacity-75">Sent {reminderSentTimestamps[enquiry.id || '']}</div>}
                      </div>
                    </button>
                    <button
                      onClick={() => initiateDnr(enquiry)}
                      className="flex-1 min-w-[140px] bg-white border border-black/10 text-amber-600 py-3 rounded-xl font-bold uppercase tracking-widest text-[8px] flex items-center justify-center gap-2 hover:bg-amber-50 transition-all text-center"
                    >
                      <XCircle size={10} /> Did Not Rent
                    </button>
                    <button
                      onClick={() => handleConvert(enquiry)}
                      className="w-full sm:w-auto flex-none bg-brand-orange text-white py-3 px-6 rounded-xl font-bold uppercase tracking-widest text-[8px] flex items-center justify-center gap-2 hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 text-center"
                    >
                      Confirm & Assign Car <ArrowRight size={10} />
                    </button>
                  </div>
                </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8">
          <AnimatePresence mode="popLayout">
            {enquiries.map((enquiry) => (
              <motion.div
                key={enquiry.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden"
              >
                {/* Status Badge */}
                  <div className="absolute top-6 right-6 sm:top-8 sm:right-8 flex flex-col items-end gap-2 max-w-[110px] sm:max-w-[150px] text-right">
                    <span className="px-3 py-1 bg-brand-orange/10 text-brand-orange text-[8px] font-bold uppercase tracking-widest rounded-full">
                      Pending Enquiry
                    </span>
                    {enquiry.createdAt && (
                      <span className="text-[9px] font-bold text-black/40 uppercase tracking-widest">
                        {formatEnquiryTime(enquiry.createdAt)}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setOpenMenu(openMenu?.id === enquiry.id ? null : { id: enquiry.id, x: rect.right, y: rect.bottom });
                      }}
                      className="p-2 hover:bg-black/5 rounded-full transition-colors"
                    >
                      <MoreVertical size={16} className="text-black/40" />
                    </button>
                </div>

                <div className="flex flex-col h-full">
                  <div className="flex items-start mb-8 pr-28 sm:pr-40">
                    <div>
                      <h3 className="text-xl font-serif italic text-black mb-1">{enquiry.customerName}</h3>
                      <div className="flex flex-wrap gap-4">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/40">
                          <Phone size={12} /> {enquiry.mobileNumber || 'No mobile'}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/40">
                          <Mail size={12} /> {enquiry.email || 'No email'}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/40">
                          <Globe size={12} />
                          <select
                            value={enquiry.nationality || ''}
                            onChange={(e) => handleNationalityChange(enquiry, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-transparent text-[10px] font-bold uppercase tracking-widest text-black/40 border-none outline-none cursor-pointer hover:text-brand-orange transition-colors"
                          >
                            <option value="">Nationality</option>
                            <option value="Thai">Thai</option>
                            <option value="Russian">Russian</option>
                            <option value="Australian">Australian</option>
                            <option value="British">British</option>
                            <option value="German">German</option>
                            <option value="Korean">Korean</option>
                            <option value="Chinese">Chinese</option>
                            <option value="American">American</option>
                            <option value="French">French</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        {(enquiry.utmSource || enquiry.bookingSource) && (
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-brand-orange/60">
                            <Zap size={12} /> {enquiry.bookingSource || enquiry.utmSource}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 mb-8">
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                          <Calendar size={16} />
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Pick Up</p>
                          <p className="text-xs font-bold text-black">{format(parseISO(enquiry.startDate), 'dd MMM yyyy, HH:mm')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                          <Clock size={16} />
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Drop Off</p>
                          <p className="text-xs font-bold text-black">{format(parseISO(enquiry.endDate), 'dd MMM yyyy, HH:mm')}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                          <CarIcon size={16} />
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Requested Car</p>
                          <p className="text-xs font-bold text-black">{enquiry.requestedCarType || 'Not specified'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                          <DollarSign size={16} />
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Estimated Total</p>
                          <p className="text-xs font-bold text-brand-orange">THB{(enquiry.amount || 0).toLocaleString()}</p>
                        </div>
                      </div>
                      {(() => {
                        const start = new Date(enquiry.startDate);
                        const end = new Date(enquiry.endDate);
                        const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                        const perDay = days > 0 && enquiry.amount ? Math.round(enquiry.amount / days) : null;
                        return days > 0 ? (
                          <>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                                <Clock size={16} />
                              </div>
                              <div>
                                <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Duration</p>
                                <p className="text-xs font-bold text-black">{days} {days === 1 ? 'day' : 'days'}</p>
                              </div>
                            </div>
                            {perDay && (
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center text-black/40">
                                  <DollarSign size={16} />
                                </div>
                                <div>
                                  <p className="text-[8px] font-bold uppercase tracking-widest text-black/30">Per Day</p>
                                  <p className="text-xs font-bold text-black/60">THB{perDay.toLocaleString()}/day</p>
                                </div>
                              </div>
                            )}
                          </>
                        ) : null;
                      })()}
                    </div>
                  </div>

                  {enquiry.deliveryAddress && (
                    <div className="mb-8 p-4 bg-brand-orange/5 rounded-2xl border border-brand-orange/10">
                      <div className="flex items-center gap-2 mb-2">
                        <Truck size={14} className="text-brand-orange" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-orange">Delivery Requested</span>
                      </div>
                      <p className="text-xs text-black/60 leading-relaxed">{enquiry.deliveryAddress}</p>
                    </div>
                  )}

                  {enquiry.notes && (
                    <div className="mb-8 p-4 bg-black/5 rounded-2xl border border-black/5">
                      <p className="text-[8px] font-bold uppercase tracking-widest text-black/30 mb-1">Customer Comments</p>
                      <p className="text-xs text-black/60 leading-relaxed italic">"{enquiry.notes}"</p>
                    </div>
                  )}

                  <div className="mt-auto pt-6 border-t border-black/5 flex flex-col sm:flex-row flex-wrap gap-3">
                    <button
                      onClick={() => sendEmailReply(enquiry)}
                      disabled={sendingEnquiryId === enquiry.id}
                      className="flex-1 min-w-[140px] bg-emerald-500 border border-emerald-600 text-white py-3 rounded-xl font-bold uppercase tracking-normal text-[9px] flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all text-center disabled:opacity-50"
                    >
                      <div className="flex flex-col items-center gap-0.5"><div className="flex items-center gap-2">{sendingEnquiryId === enquiry.id ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />} {sendingEnquiryId === enquiry.id ? 'Sending...' : 'Vehicle Available Auto Response'}</div>{sentTimestamps[enquiry.id || ''] && <div className="text-[7px] font-normal normal-case tracking-normal opacity-75">Sent {sentTimestamps[enquiry.id || '']}</div>}</div>
                    </button>
                    <button
                      onClick={() => copyDeliveryEmailTemplate(enquiry)}
                      className="flex-1 min-w-[140px] bg-white border border-black/10 text-black/60 py-3 rounded-xl font-bold uppercase tracking-widest text-[8px] flex items-center justify-center gap-2 hover:bg-black/5 transition-all text-center"
                    >
                      <Truck size={10} /> Delivery Reply
                    </button>
                    <button
                      onClick={() => copyBookingConfirmTemplate(enquiry)}
                      className="flex-1 min-w-[140px] bg-white border border-black/10 text-black/60 py-3 rounded-xl font-bold uppercase tracking-widest text-[8px] flex items-center justify-center gap-2 hover:bg-black/5 transition-all text-center"
                    >
                      <CheckCircle2 size={10} className="text-emerald-500" /> Booking Confirm
                    </button>
                    <button
                      onClick={() => copyAlternativeTemplate(enquiry)}
                      className="flex-1 min-w-[140px] bg-white border border-black/10 text-black/60 py-3 rounded-xl font-bold uppercase tracking-widest text-[8px] flex items-center justify-center gap-2 hover:bg-black/5 transition-all text-center"
                    >
                      <Copy size={10} className="text-blue-500" /> Alternative
                    </button>
                    <button
                      onClick={() => handleConvert(enquiry)}
                      className="w-full sm:w-auto flex-none bg-brand-orange text-white py-3 px-6 rounded-xl font-bold uppercase tracking-widest text-[8px] flex items-center justify-center gap-2 hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 text-center"
                    >
                      Confirm & Assign Car <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {enquiries.length === 0 && (
            <div className="col-span-full py-20 text-center">
              <div className="w-20 h-20 bg-black/5 rounded-full flex items-center justify-center text-black/20 mx-auto mb-6">
                <Mail size={40} />
              </div>
              <h3 className="text-xl font-serif italic text-black/40">No pending enquiries</h3>
              <p className="text-xs font-bold uppercase tracking-widest text-black/20 mt-2">New enquiries from the booking engine will appear here</p>
            </div>
          )}
        </div>
        )} {/* end active tab */}
      </div>

      {/* DNR Confirmation Modal */}
      <AnimatePresence>
        {showDnrModal && dnrTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setShowDnrModal(false); setDnrTarget(null); }}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white/90 backdrop-blur-2xl rounded-[32px] shadow-2xl border border-white/60 p-10"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
                  <XCircle size={24} className="text-amber-600" />
                </div>
                <div>
                  <h2 className="font-serif italic text-2xl text-[#1A1A1A]">Did Not Rent</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">{dnrTarget.customerName}</p>
                </div>
              </div>
              <p className="text-sm text-[#1A1A1A]/60 mb-6 leading-relaxed">
                This enquiry will be saved as Did Not Rent and will appear in the customer's history. The record is preserved and never deleted.
              </p>
              <div className="mb-6">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 block mb-2">Reason <span className="text-[#1A1A1A]/20">(optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. Price too high, went elsewhere..."
                  value={dnrReason}
                  onChange={(e) => setDnrReason(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmDnr()}
                  className="w-full bg-black/5 border-none rounded-2xl px-4 py-3 text-sm focus:bg-black/8 outline-none font-medium"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowDnrModal(false); setDnrTarget(null); }}
                  className="flex-1 h-12 bg-black/5 text-black font-bold uppercase tracking-widest text-[10px] rounded-2xl hover:bg-black/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDnr}
                  disabled={isSubmitting}
                  className="flex-1 h-12 bg-amber-500 text-white font-bold uppercase tracking-widest text-[10px] rounded-2xl hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={14} /> : 'Confirm DNR'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit/Convert Modal */}
      <AnimatePresence>
        {(isEditing || isConverting) && selectedEnquiry && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsEditing(false);
                setIsConverting(false);
                setSelectedEnquiry(null);
              }}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white/80 backdrop-blur-2xl rounded-[40px] shadow-2xl border border-white/60 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-12 overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h2 className="font-serif italic text-4xl text-black">
                      {isConverting ? 'Confirm Booking' : 'Edit Enquiry'}
                    </h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mt-2">
                      {selectedEnquiry.customerName}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setIsConverting(false);
                      setSelectedEnquiry(null);
                    }}
                    className="w-12 h-12 bg-black/5 rounded-full flex items-center justify-center text-black/40 hover:bg-black/10 hover:text-black transition-all"
                  >
                    <XCircle size={24} />
                  </button>
                </div>

                <div className="space-y-8">
                  {/* Customer Info */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Customer Name</label>
                      <input
                        type="text"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.customerName}
                        onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Mobile Number</label>
                      <input
                        type="text"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.mobileNumber}
                        onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Pick Up</label>
                      <input
                        type="datetime-local"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.startDate?.slice(0, 16)}
                        onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Drop Off</label>
                      <input
                        type="datetime-local"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.endDate?.slice(0, 16)}
                        onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Financials */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Total Amount (THB)</label>
                      <input
                        type="number"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.amount || 0}
                        onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Deposit Held (THB)</label>
                      <input
                        type="number"
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.deposit || 0}
                        onChange={e => setFormData({ ...formData, deposit: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  {isConverting && (
                    <div className="space-y-4 p-8 bg-brand-orange/5 rounded-[32px] border border-brand-orange/20">
                      <div className="flex items-center gap-3 mb-2">
                        <CarIcon className="text-brand-orange" size={20} />
                        <h3 className="text-sm font-bold uppercase tracking-widest text-brand-orange">Assign Vehicle</h3>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {/* Searchable car combobox */}
                    <div className="relative">
                      <input
                        type="text"
                        className="w-full bg-white border-none p-4 rounded-2xl text-sm focus:ring-2 focus:ring-brand-orange outline-none transition-all font-bold"
                        placeholder="Search cars..."
                        value={carSearch || (formData.carId ? (cars.find(c => c.id === formData.carId)?.name ?? '') : '')}
                        onChange={e => {
                          setCarSearch(e.target.value);
                          setCarDropdownOpen(true);
                          if (!e.target.value) setFormData({ ...formData, carId: '' });
                        }}
                        onFocus={() => setCarDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setCarDropdownOpen(false), 150)}
                      />
                      {carDropdownOpen && (
                        <div className="absolute z-50 w-full mt-1 bg-white rounded-2xl shadow-lg border border-black/10 max-h-52 overflow-y-auto">
                          {cars
                            .filter(car =>
                              !carSearch ||
                              (car.name ?? "").toLowerCase().includes(carSearch.toLowerCase()) ||
                              car.plateNumber?.toLowerCase().includes(carSearch.toLowerCase()) ||
                              car.type?.toLowerCase().includes(carSearch.toLowerCase())
                            )
                            .map(car => (
                              <div
                                key={car.id}
                                className={`px-4 py-2 text-sm cursor-pointer hover:bg-brand-orange/10 ${formData.carId === car.id ? 'bg-brand-orange/20 font-bold' : ''}`}
                                onMouseDown={() => {
                                  setFormData({ ...formData, carId: car.id });
                                  setCarSearch('');
                                  setCarDropdownOpen(false);
                                }}
                              >
                                {car.name} ({car.plateNumber}) – {car.type}
                              </div>
                            ))}
                          {cars.filter(car =>
                            !carSearch ||
                            (car.name ?? "").toLowerCase().includes(carSearch.toLowerCase()) ||
                            car.plateNumber?.toLowerCase().includes(carSearch.toLowerCase()) ||
                            car.type?.toLowerCase().includes(carSearch.toLowerCase())
                          ).length === 0 && (
                            <div className="px-4 py-2 text-sm text-black/40">No cars found</div>
                          )}
                        </div>
                      )}
                    </div>
                        <p className="text-[10px] text-brand-orange/60 font-bold uppercase tracking-widest ml-4 italic">
                          Requested: {selectedEnquiry.requestedCarType}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Delivery Info */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <Truck className="text-black/40" size={20} />
                      <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Delivery Details</h3>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Delivery Address</label>
                        <input
                          type="text"
                          className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                          value={formData.deliveryAddress || ''}
                          onChange={e => setFormData({ ...formData, deliveryAddress: e.target.value })}
                          placeholder="Enter delivery address..."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Delivery Notes</label>
                        <textarea
                          className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all h-24 resize-none font-bold"
                          value={formData.deliveryNotes || ''}
                          onChange={e => setFormData({ ...formData, deliveryNotes: e.target.value })}
                          placeholder="Internal delivery notes..."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Pin Location</label>
                        <LocationPicker 
                          location={formData.deliveryLocation} 
                          onChange={(loc) => setFormData({ ...formData, deliveryLocation: loc })}
                          height="300px"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Nationality & Source */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Nationality</label>
                      <select
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.nationality || ''}
                        onChange={e => setFormData(p => ({ ...p, nationality: e.target.value }))}
                      >
                        <option value="">—</option>
                        <option value="Thai">Thai</option>
                        <option value="British">British</option>
                        <option value="American">American</option>
                        <option value="Australian">Australian</option>
                        <option value="German">German</option>
                        <option value="French">French</option>
                        <option value="Russian">Russian</option>
                        <option value="Chinese">Chinese</option>
                        <option value="Japanese">Japanese</option>
                        <option value="Korean">Korean</option>
                        <option value="Indian">Indian</option>
                        <option value="Scandinavian">Scandinavian</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Booking Source</label>
                      <select
                        className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all font-bold"
                        value={formData.bookingSource || ''}
                        onChange={e => setFormData(p => ({ ...p, bookingSource: e.target.value }))}
                      >
                        <option value="">—</option>
                        <option value="google_ads">Google Ads</option>
                        <option value="google_organic">Google Organic</option>
                        <option value="facebook">Facebook</option>
                        <option value="direct">Direct</option>
                        <option value="referral">Referral</option>
                        <option value="walk_in">Walk In</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  {(formData.utmSource || formData.utmMedium || formData.utmCampaign) && (
                    <div className="flex flex-wrap gap-2 px-1">
                      {formData.utmSource && <span className="text-[10px] font-bold uppercase tracking-widest text-brand-orange/60 bg-brand-orange/10 px-2 py-1 rounded-full">src: {formData.utmSource}</span>}
                      {formData.utmMedium && <span className="text-[10px] font-bold uppercase tracking-widest text-brand-orange/60 bg-brand-orange/10 px-2 py-1 rounded-full">med: {formData.utmMedium}</span>}
                      {formData.utmCampaign && <span className="text-[10px] font-bold uppercase tracking-widest text-brand-orange/60 bg-brand-orange/10 px-2 py-1 rounded-full">cmp: {formData.utmCampaign}</span>}
                    </div>
                  )}
                  {/* Comments */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 ml-4">Customer Comments</label>
                    <textarea
                      className="w-full bg-black/5 border-none p-4 rounded-2xl text-sm focus:bg-black/10 outline-none transition-all h-32 resize-none font-bold"
                      value={formData.notes || ''}
                      onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="mt-12 flex gap-4">
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setIsConverting(false);
                      setSelectedEnquiry(null);
                    }}
                    className="flex-1 h-16 bg-black/5 text-black font-bold uppercase tracking-widest text-[10px] rounded-2xl hover:bg-black/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={isConverting ? confirmBooking : saveEnquiry}
                    disabled={isSubmitting}
                    className="flex-1 h-16 bg-brand-orange text-white font-bold uppercase tracking-widest text-[10px] rounded-2xl hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      isConverting ? 'Confirm Booking' : 'Save Changes'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openMenu && (() => {
          const menuEnquiry = enquiries.find((e) => e.id === openMenu.id);
          if (!menuEnquiry) return null;
          return (
            <React.Fragment key="enquiry-menu">
              <div className="fixed inset-0 z-[999999]" onClick={() => setOpenMenu(null)} />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="fixed w-48 bg-white/90 backdrop-blur-xl border border-white/60 rounded-2xl shadow-xl z-[1000000] overflow-hidden"
                style={{
                  left: Math.min(window.innerWidth - 208, Math.max(16, openMenu.x - 192)),
                  top: Math.min(window.innerHeight - 100, openMenu.y + 4),
                }}
              >
                <button
                  onClick={() => { handleEdit(menuEnquiry); setOpenMenu(null); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-black/60 hover:bg-black/5 hover:text-brand-orange transition-all"
                >
                  <Edit2 size={14} /> Edit Enquiry
                </button>
                <button
                  onClick={() => { markAsFollowUp(menuEnquiry); setOpenMenu(null); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:bg-blue-50 transition-all"
                >
                  <Clock size={14} /> Follow Up
                </button>
                <button
                  onClick={() => { initiateDnr(menuEnquiry); setOpenMenu(null); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-amber-600 hover:bg-amber-50 transition-all"
                >
                  <XCircle size={14} /> Did Not Rent
                </button>
              </motion.div>
            </React.Fragment>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};
