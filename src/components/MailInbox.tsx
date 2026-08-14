import React, { useState, useEffect, useCallback, useRef } from 'react';
import { auth, db } from '../firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { Booking, Customer, EmailTemplate } from '../types';
import { format, parseISO } from 'date-fns';
import DOMPurify from 'dompurify';
import { Inbox, RefreshCw, Send, User, Loader2, ChevronLeft, ChevronRight, MailOpen, Check, Sparkles, Search, X, LayoutTemplate } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { processTemplate, htmlToPlainText } from '../lib/emailUtils';

const INFO_MAILBOX = 'info@pattayarentacar.com';

// Templates that aren't standalone customer replies - internal staff
// notifications and the auto-appended signature block - are left out of the
// Inbox picker. Everything else in the Email Templates section is a message
// meant to go to a customer, so it's fair game here.
const NON_REPLY_TEMPLATE_IDS = new Set(['new_booking_website', 'email_signature']);
const isCustomerFacingTemplate = (t: EmailTemplate) =>
  !NON_REPLY_TEMPLATE_IDS.has(t.id) &&
  !/not sent directly/i.test(t.subject || '') &&
  !/staff notification/i.test(t.name || '');

interface MailThread {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  messageCount: number;
  unread: boolean;
}

interface MailMessage {
  id: string;
  messageIdHeader: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
  unread: boolean;
  // Present only on messages sent through /api/send-email with a bookingId
  // (see server.ts) - carried in a custom X-Booking-Id header so the Inbox can
  // look up the live Booking record for template auto-fill. Older threads sent
  // before this existed won't have it.
  bookingId?: string;
}

function extractEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader).trim().toLowerCase();
}

function extractName(fromHeader: string): string {
  const match = fromHeader.match(/^"?([^"<]*)"?\s*</);
  const name = match ? match[1].trim() : '';
  return name || extractEmail(fromHeader);
}

function formatShortDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'dd MMM');
  } catch {
    return '';
  }
}

// Resolve the customer's email for a thread. Prefers the most recent inbound
// message (from someone other than the info@ mailbox). Threads that are
// entirely outbound (e.g. an automated Rental Confirmation with no customer
// reply yet) have no such message, so fall back to the "To" address of the
// most recent outbound message instead of misreading info@ as the customer.
function resolveCustomerEmail(msgs: MailMessage[]): string {
  const inbound = [...msgs].reverse().find(m => extractEmail(m.from) !== INFO_MAILBOX);
  if (inbound) return extractEmail(inbound.from);
  const outbound = [...msgs].reverse().find(m => m.to && extractEmail(m.to) !== INFO_MAILBOX);
  return outbound ? extractEmail(outbound.to) : '';
}

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not authenticated');
  return fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${idToken}`,
    },
  });
}

const NATIONALITY_OPTIONS = [
  'Thai', 'British', 'American', 'Australian', 'German', 'French',
  'Russian', 'Chinese', 'Japanese', 'Korean', 'Indian', 'Other',
];

const PROFILE_FIELDS: { key: keyof Customer; label: string; type?: 'text' | 'textarea' | 'checkbox' | 'select'; options?: string[] }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'mobileNumber', label: 'Mobile' },
  { key: 'nationality', label: 'Nationality', type: 'select', options: NATIONALITY_OPTIONS },
  { key: 'address', label: 'Address' },
  { key: 'addressHotel', label: 'Hotel address' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'drivingLicence', label: 'Driving licence' },
  { key: 'carLicenceExpiry', label: 'Car licence expiry' },
  { key: 'bikeLicenceExpiry', label: 'Bike licence expiry' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'marketingConsent', label: 'Marketing consent', type: 'checkbox' },
];

export const MailInbox: React.FC = () => {
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Booking[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState<Partial<Customer>>({});
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);

  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [bulkMarkingRead, setBulkMarkingRead] = useState(false);

  const [suggestingReply, setSuggestingReply] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const isFirstLoad = useRef(true);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  // Templates rarely change, so fetch them once rather than per-thread.
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const snap = await getDocs(collection(db, 'email_templates'));
        const list = snap.docs
          .map(d => ({ ...(d.data() as Omit<EmailTemplate, 'id'>), id: d.id }))
          .filter(isCustomerFacingTemplate)
          .sort((a, b) => a.name.localeCompare(b.name));
        setTemplates(list);
      } catch (err) {
        console.error('Failed to load email templates:', err);
      }
    };
    fetchTemplates();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) {
        setShowTemplateMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sortUnreadFirst = (list: MailThread[]) =>
    [...list].sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0));

  const fetchThreads = useCallback(async (q?: string) => {
    setThreadsLoading(true);
    setSelectedThreadIds(new Set());
    try {
      const params = new URLSearchParams();
      if (q && q.trim()) params.set('q', q.trim());
      const qs = params.toString();
      const res = await authedFetch(`/api/mail/threads${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setThreads(sortUnreadFirst(data.threads || []));
      setNextPageToken(data.nextPageToken || null);
    } catch (err: any) {
      console.error('Failed to load threads:', err);
      toast.error('Failed to load inbox');
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const loadMoreThreads = useCallback(async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ pageToken: nextPageToken });
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      const res = await authedFetch(`/api/mail/threads?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setThreads(prev => sortUnreadFirst([...prev, ...(data.threads || [])]));
      setNextPageToken(data.nextPageToken || null);
    } catch (err: any) {
      console.error('Failed to load more threads:', err);
      toast.error('Failed to load more emails');
    } finally {
      setLoadingMore(false);
    }
  }, [nextPageToken, loadingMore, searchQuery]);

  // Debounce search-as-you-type, but load immediately on first mount rather
  // than waiting out the debounce delay.
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      fetchThreads();
      return;
    }
    const handle = setTimeout(() => {
      fetchThreads(searchQuery);
    }, 400);
    return () => clearTimeout(handle);
  }, [searchQuery, fetchThreads]);

  const toggleThreadSelected = (threadId: string) => {
    setSelectedThreadIds(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  const toggleSelectAllThreads = () => {
    setSelectedThreadIds(prev =>
      prev.size === threads.length ? new Set() : new Set(threads.map(t => t.id))
    );
  };

  const clearThreadSelection = () => setSelectedThreadIds(new Set());

  const handleBulkMarkRead = async () => {
    const ids = Array.from(selectedThreadIds);
    if (ids.length === 0) return;
    setBulkMarkingRead(true);
    try {
      const res = await authedFetch('/api/mail/threads/read-state/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const okIds = new Set(
        (data.results || []).filter((r: any) => r.ok).map((r: any) => r.id)
      );
      setThreads(prev => prev.map(t => (okIds.has(t.id) ? { ...t, unread: false } : t)));
      clearThreadSelection();
      const failedCount = ids.length - okIds.size;
      if (failedCount > 0) {
        toast.error(`Marked ${okIds.size} as read, ${failedCount} failed`);
      } else {
        toast.success(`Marked ${okIds.size} as read`);
      }
    } catch (err: any) {
      console.error('Failed to bulk mark read:', err);
      toast.error('Failed to mark selected emails as read');
    } finally {
      setBulkMarkingRead(false);
    }
  };

  const openThread = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId);
    setShowMobileDetail(true);
    setMessages([]);
    setExpandedMessageIds(new Set());
    setHistory([]);
    setCustomer(null);
    setEditingCustomer(false);
    setCustomerForm({});
    setReplyBody('');
    setMessagesLoading(true);
    try {
      const res = await authedFetch(`/api/mail/threads/${threadId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const msgs: MailMessage[] = data.messages || [];
      setMessages(msgs);
      setThreads(prev => prev.map(t => (t.id === threadId ? { ...t, unread: false } : t)));

      const senderEmail = resolveCustomerEmail(msgs);
      if (senderEmail) {
        setHistoryLoading(true);
        try {
          const histRes = await authedFetch(`/api/mail/history?email=${encodeURIComponent(senderEmail)}`);
          if (histRes.ok) {
            const histData = await histRes.json();
            setHistory(histData.bookings || []);
          }
        } catch (err) {
          console.error('Failed to load customer history:', err);
        } finally {
          setHistoryLoading(false);
        }

        setCustomerLoading(true);
        try {
          const custRes = await authedFetch(`/api/customers?email=${encodeURIComponent(senderEmail)}`);
          if (custRes.ok) {
            const custData = await custRes.json();
            setCustomer(custData.customer || null);
          }
        } catch (err) {
          console.error('Failed to load customer profile:', err);
        } finally {
          setCustomerLoading(false);
        }
      }
    } catch (err: any) {
      console.error('Failed to load thread:', err);
      toast.error('Failed to load conversation');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const selectedThread = threads.find(t => t.id === selectedThreadId) || null;
  const lastMessage = messages[messages.length - 1] || null;
  const customerEmail = resolveCustomerEmail(messages);

  const toggleMessageExpanded = (id: string) => {
    setExpandedMessageIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (!replyBody.trim() || !customerEmail || !lastMessage || !selectedThread) return;
    setSending(true);
    try {
      const toEmail = customerEmail;
      const html = replyBody.split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('');
      const res = await authedFetch('/api/mail/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          subject: selectedThread.subject,
          html,
          inReplyToMessageId: lastMessage.messageIdHeader || undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      toast.success('Reply sent');
      setMessages(prev => [
        ...prev,
        {
          id: `local-${prev.length}`,
          messageIdHeader: '',
          from: INFO_MAILBOX,
          to: toEmail,
          subject: selectedThread.subject,
          date: new Date().toString(),
          bodyText: replyBody,
          bodyHtml: html,
          unread: false,
        },
      ]);
      setReplyBody('');
    } catch (err: any) {
      console.error('Failed to send reply:', err);
      toast.error(err.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const handleSuggestReply = async () => {
    if (!selectedThreadId) return;
    setSuggestingReply(true);
    try {
      const res = await authedFetch(`/api/mail/threads/${selectedThreadId}/suggest-reply`, { method: 'POST' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.draft) {
        setReplyBody(data.draft);
      } else {
        toast.error('No suggestion returned');
      }
    } catch (err: any) {
      console.error('Failed to suggest reply:', err);
      toast.error(err.message || 'Failed to suggest a reply');
    } finally {
      setSuggestingReply(false);
    }
  };

  // If a message in this thread carries our custom X-Booking-Id header (set in
  // server.ts /api/send-email whenever an email is tied to a booking), we can
  // pull the live Booking record and auto-fill every tag the template needs -
  // vehicle, dates, price, delivery, comments - the same fields Live Enquiries
  // fills from. Threads with no linked booking (sent before this existed, or
  // unrelated to a booking) fall back to just customer name/email/phone from
  // the thread itself. Anything we still can't fill is left as a literal
  // {{tag}} - a visible flag for staff to fill in by hand.
  const applyTemplate = async (template: EmailTemplate) => {
    if (replyBody.trim() && !window.confirm(`Replace your current draft with the "${template.name}" template?`)) {
      return;
    }

    const inboundMessage = [...messages].reverse().find(m => extractEmail(m.from) !== INFO_MAILBOX);
    const derivedName = customer?.firstName
      || (inboundMessage ? extractName(inboundMessage.from).split(' ')[0] : '')
      || 'Customer';

    const placeholders: Record<string, string> = { '{{customer_name}}': derivedName };
    if (customerEmail) placeholders['{{customer_email}}'] = customerEmail;
    if (customer?.mobileNumber) placeholders['{{customer_phone}}'] = customer.mobileNumber;

    const linkedBookingId = messages.find(m => m.bookingId)?.bookingId;
    if (linkedBookingId) {
      try {
        const snap = await getDoc(doc(db, 'bookings', linkedBookingId));
        if (snap.exists()) {
          const booking = snap.data() as Booking;
          if (booking.customerName) placeholders['{{customer_name}}'] = booking.customerName.split(' ')[0];
          if (booking.email) placeholders['{{customer_email}}'] = booking.email;
          if (booking.mobileNumber) placeholders['{{customer_phone}}'] = booking.mobileNumber;
          if (booking.requestedCarType) placeholders['{{vehicle_model}}'] = booking.requestedCarType;
          if (booking.amount) placeholders['{{total_price}}'] = booking.amount.toLocaleString();
          if (booking.startDate) {
            placeholders['{{pickup_date}}'] = format(parseISO(booking.startDate), 'dd MMM yyyy');
            placeholders['{{pickup_time}}'] = format(parseISO(booking.startDate), 'HH:mm');
          }
          if (booking.endDate) {
            placeholders['{{return_date}}'] = format(parseISO(booking.endDate), 'dd MMM yyyy');
            placeholders['{{return_time}}'] = format(parseISO(booking.endDate), 'HH:mm');
          }
          if (booking.startDate && booking.endDate) {
            placeholders['{{rental_period}}'] =
              `${format(parseISO(booking.startDate), 'dd MMM yyyy')} to ${format(parseISO(booking.endDate), 'dd MMM yyyy')}`;
          }
          if (booking.deliveryAddress) placeholders['{{delivery_address}}'] = booking.deliveryAddress;
          if (booking.notes) placeholders['{{comments}}'] = booking.notes;
        }
      } catch (err) {
        console.error('Failed to load linked booking for template fill:', err);
      }
    }

    const processed = htmlToPlainText(processTemplate(template.body, placeholders));
    setReplyBody(processed);
    setShowTemplateMenu(false);
  };

  const handleStartEditCustomer = () => {
    setCustomerForm({
      firstName: customer?.firstName || '',
      lastName: customer?.lastName || '',
      mobileNumber: customer?.mobileNumber || '',
      nationality: customer?.nationality || '',
      address: customer?.address || '',
      addressHotel: customer?.addressHotel || '',
      dob: customer?.dob || '',
      drivingLicence: customer?.drivingLicence || '',
      carLicenceExpiry: customer?.carLicenceExpiry || '',
      bikeLicenceExpiry: customer?.bikeLicenceExpiry || '',
      notes: customer?.notes || '',
      marketingConsent: customer?.marketingConsent || false,
      source: customer?.source || '',
    });
    setEditingCustomer(true);
  };

  const handleCancelEditCustomer = () => {
    setEditingCustomer(false);
    setCustomerForm({});
  };

  const handleCustomerFieldChange = (field: keyof Customer, value: string | boolean) => {
    setCustomerForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveCustomer = async () => {
    if (!customerEmail) return;
    setSavingCustomer(true);
    try {
      const res = await authedFetch('/api/customers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: customerEmail, ...customerForm }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCustomer(data.customer || null);
      setEditingCustomer(false);
      toast.success('Customer profile saved');
    } catch (err: any) {
      console.error('Failed to save customer profile:', err);
      toast.error('Failed to save customer profile');
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleMarkUnread = async () => {
    if (!selectedThreadId) return;
    setMarkingUnread(true);
    try {
      const res = await authedFetch(`/api/mail/threads/${selectedThreadId}/read-state`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const threadId = selectedThreadId;
      setThreads(prev => prev.map(t => (t.id === threadId ? { ...t, unread: true } : t)));
      setSelectedThreadId(null);
      toast.success('Marked as unread');
    } catch (err: any) {
      console.error('Failed to mark thread unread:', err);
      toast.error('Failed to mark as unread');
    } finally {
      setMarkingUnread(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-orange/10 flex items-center justify-center">
            <Inbox className="text-brand-orange" size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Inbox</h1>
            <p className="text-xs text-[#1A1A1A]/50">{INFO_MAILBOX}</p>
          </div>
        </div>
        <button
          onClick={() => fetchThreads(searchQuery)}
          disabled={threadsLoading}
          className="w-10 h-10 rounded-xl bg-white/60 border border-black/10 flex items-center justify-center hover:bg-white transition-all disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} className={cn(threadsLoading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {leftCollapsed ? (
          <div className="hidden md:flex w-10 shrink-0 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 flex-col items-center pt-4">
            <button
              onClick={() => setLeftCollapsed(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1A1A1A]/50 hover:bg-black/5 hover:text-brand-orange transition-all"
              title="Expand inbox list"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : (
        <div className={cn(
          'w-full md:w-80 shrink-0 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 flex flex-col min-h-0',
          showMobileDetail && 'hidden md:flex'
        )}>
          <div className="p-3 border-b border-black/10 flex items-center gap-2 shrink-0">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search inbox..."
                className="w-full pl-8 pr-7 py-2 text-sm rounded-xl border border-black/10 bg-white/70 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#1A1A1A]/30 hover:text-[#1A1A1A]/60"
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setLeftCollapsed(true)}
              className="hidden md:flex w-8 h-8 rounded-lg items-center justify-center text-[#1A1A1A]/50 hover:bg-black/5 hover:text-brand-orange transition-all shrink-0"
              title="Collapse inbox list"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
          {!threadsLoading && threads.length > 0 && (
            <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-white/80 backdrop-blur-xl border-b border-black/5">
              <input
                type="checkbox"
                checked={selectedThreadIds.size > 0 && selectedThreadIds.size === threads.length}
                ref={el => {
                  if (el) el.indeterminate = selectedThreadIds.size > 0 && selectedThreadIds.size < threads.length;
                }}
                onChange={toggleSelectAllThreads}
                className="shrink-0 accent-brand-orange"
                title="Select all"
              />
              {selectedThreadIds.size > 0 ? (
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xs font-medium text-[#1A1A1A]/60 shrink-0">{selectedThreadIds.size} selected</span>
                  <button
                    onClick={handleBulkMarkRead}
                    disabled={bulkMarkingRead}
                    className="ml-auto flex items-center gap-1.5 text-xs font-bold text-brand-orange hover:underline disabled:opacity-40 shrink-0"
                  >
                    {bulkMarkingRead ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Mark as read
                  </button>
                  <button
                    onClick={clearThreadSelection}
                    disabled={bulkMarkingRead}
                    className="text-xs font-medium text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70 disabled:opacity-40 shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-[#1A1A1A]/40">Select all</span>
              )}
            </div>
          )}
          {threadsLoading ? (
            <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-brand-orange" size={24} /></div>
          ) : threads.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#1A1A1A]/40">
              {searchQuery ? `No results for "${searchQuery}"` : 'No threads found'}
            </div>
          ) : (
            threads.map(t => (
              <div
                key={t.id}
                className={cn(
                  'w-full flex items-start gap-2 p-4 border-b border-black/5 hover:bg-white/60 transition-all',
                  selectedThreadId === t.id && 'bg-brand-orange/10'
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedThreadIds.has(t.id)}
                  onChange={() => toggleThreadSelected(t.id)}
                  onClick={e => e.stopPropagation()}
                  className="mt-1 shrink-0 accent-brand-orange"
                />
                <button onClick={() => openThread(t.id)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-sm truncate', t.unread ? 'font-bold text-[#1A1A1A]' : 'font-medium text-[#1A1A1A]/70')}>
                      {extractName(t.from)}
                    </span>
                    <span className="text-[10px] text-[#1A1A1A]/40 shrink-0">{formatShortDate(t.date)}</span>
                  </div>
                  <p className={cn('text-sm truncate mt-0.5', t.unread ? 'font-semibold text-[#1A1A1A]' : 'text-[#1A1A1A]/60')}>
                    {t.subject || '(no subject)'}
                  </p>
                  <p className="text-xs text-[#1A1A1A]/40 truncate mt-0.5">{t.snippet}</p>
                </button>
              </div>
            ))
          )}
          {nextPageToken && (
            <div className="p-3 text-center">
              <button
                onClick={loadMoreThreads}
                disabled={loadingMore}
                className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
          </div>
        </div>
        )}

        <div className={cn(
          'flex-1 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 flex flex-col min-h-0',
          !showMobileDetail && 'hidden md:flex'
        )}>
          {!selectedThreadId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-[#1A1A1A]/40">
              Select a conversation to view
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-black/10 flex items-center gap-3">
                <button className="md:hidden p-1" onClick={() => setShowMobileDetail(false)}>
                  <ChevronLeft size={20} />
                </button>
                <h2 className="font-bold text-[#1A1A1A] truncate">{selectedThread?.subject || '(no subject)'}</h2>
                <button
                  onClick={handleMarkUnread}
                  disabled={markingUnread}
                  className="ml-auto shrink-0 flex items-center gap-1.5 text-xs font-medium text-[#1A1A1A]/60 hover:text-brand-orange px-2 py-1 rounded-lg hover:bg-black/5 transition-all disabled:opacity-40"
                  title="Mark as unread"
                >
                  <MailOpen size={14} />
                  Mark unread
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                {messagesLoading ? (
                  <div className="flex justify-center p-8"><Loader2 className="animate-spin text-brand-orange" size={24} /></div>
                ) : (
                  messages.map((m, i) => {
                    const isDefaultExpanded = i === messages.length - 1 || m.unread;
                    const isExpanded = expandedMessageIds.has(m.id) ? !isDefaultExpanded : isDefaultExpanded;
                    if (!isExpanded) {
                      const snippet = (m.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 100);
                      return (
                        <div
                          key={m.id}
                          onClick={() => toggleMessageExpanded(m.id)}
                          className="bg-white/60 rounded-2xl border border-black/10 px-4 py-2 cursor-pointer hover:bg-white/80 transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-bold text-[#1A1A1A] shrink-0">{extractName(m.from)}</span>
                            <span className="text-xs text-[#1A1A1A]/50 truncate">{snippet}</span>
                          </div>
                          <span className="text-[10px] text-[#1A1A1A]/40 shrink-0">{m.date}</span>
                        </div>
                      );
                    }
                    return (
                      <div key={m.id} className="bg-white/60 rounded-2xl border border-black/10 p-4">
                        <div
                          className="flex items-center justify-between mb-2 cursor-pointer"
                          onClick={() => toggleMessageExpanded(m.id)}
                        >
                          <span className="text-sm font-bold text-[#1A1A1A]">{extractName(m.from)}</span>
                          <span className="text-[10px] text-[#1A1A1A]/40">{m.date}</span>
                        </div>
                        {m.bodyHtml ? (
                          <div
                            className="text-sm text-[#1A1A1A]/80 [&_a]:text-brand-orange [&_a]:underline"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(m.bodyHtml) }}
                          />
                        ) : (
                          <p className="text-sm text-[#1A1A1A]/80 whitespace-pre-wrap">{m.bodyText}</p>
                        )}
                      </div>
                      );
                  })
                )}
              </div>
              <div className="p-4 border-t border-black/10">
                <textarea
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder="Write a reply..."
                  rows={8}
                  className="w-full rounded-xl border border-black/10 bg-white/60 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/40 resize-y min-h-[160px] max-h-[60vh]"
                />
                <div className="flex justify-between items-center mt-2">
                  <div className="flex items-center gap-2">
                    <div className="relative" ref={templateMenuRef}>
                      <button
                        onClick={() => setShowTemplateMenu(v => !v)}
                        disabled={templates.length === 0}
                        className="h-10 px-4 rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A]/70 font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-white hover:text-brand-orange transition-all disabled:opacity-40"
                        title="Insert a saved email template"
                      >
                        <LayoutTemplate size={14} />
                        Templates
                      </button>
                      {showTemplateMenu && (
                        <div className="absolute bottom-full left-0 mb-2 w-64 max-h-72 overflow-y-auto rounded-xl border border-black/10 bg-white shadow-xl z-20 py-1">
                          {templates.map(t => (
                            <button
                              key={t.id}
                              onClick={() => applyTemplate(t)}
                              className="w-full text-left px-4 py-2.5 text-xs font-medium text-[#1A1A1A]/80 hover:bg-brand-orange/10 hover:text-brand-orange transition-colors"
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleSuggestReply}
                      disabled={suggestingReply}
                      className="h-10 px-4 rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A]/70 font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-white hover:text-brand-orange transition-all disabled:opacity-40"
                      title="Draft a reply with AI - review before sending"
                    >
                      {suggestingReply ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Suggest reply
                    </button>
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={sending || !replyBody.trim()}
                    className="h-10 px-5 rounded-xl bg-brand-orange text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-[#1A1A1A] transition-all disabled:opacity-40"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {selectedThreadId && rightCollapsed && (
          <div className="hidden lg:flex w-10 shrink-0 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 flex-col items-center pt-4">
            <button
              onClick={() => setRightCollapsed(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1A1A1A]/50 hover:bg-black/5 hover:text-brand-orange transition-all"
              title="Expand customer panel"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        )}
        {selectedThreadId && !rightCollapsed && (
          <div className="hidden lg:flex w-72 shrink-0 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 flex-col overflow-y-auto custom-scrollbar p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30">Details</span>
              <button
                onClick={() => setRightCollapsed(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#1A1A1A]/50 hover:bg-black/5 hover:text-brand-orange transition-all"
                title="Collapse customer panel"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="mb-4 pb-4 border-b border-black/10">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <User size={16} className="text-brand-orange" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60">Customer Profile</h3>
                </div>
                {!customerLoading && !editingCustomer && (
                  <button
                    onClick={handleStartEditCustomer}
                    className="text-[11px] font-medium text-brand-orange hover:underline"
                  >
                    {customer ? 'Edit' : 'Add details'}
                  </button>
                )}
              </div>
              {customerLoading ? (
                <div className="flex justify-center p-4"><Loader2 className="animate-spin text-brand-orange" size={18} /></div>
              ) : editingCustomer ? (
                <div className="space-y-2">
                  {PROFILE_FIELDS.map(f => (
                    <div key={f.key}>
                      <label className="text-[10px] uppercase tracking-wide text-[#1A1A1A]/40">{f.label}</label>
                      {f.type === 'textarea' ? (
                        <textarea
                          value={(customerForm[f.key] as string) || ''}
                          onChange={e => handleCustomerFieldChange(f.key, e.target.value)}
                          className="w-full text-xs rounded-lg border border-black/10 p-2 mt-0.5"
                          rows={2}
                        />
                      ) : f.type === 'checkbox' ? (
                        <input
                          type="checkbox"
                          checked={!!customerForm[f.key]}
                          onChange={e => handleCustomerFieldChange(f.key, e.target.checked)}
                          className="mt-1"
                        />
                      ) : f.type === 'select' ? (
                        <select
                          value={(customerForm[f.key] as string) || ''}
                          onChange={e => handleCustomerFieldChange(f.key, e.target.value)}
                          className="w-full text-xs rounded-lg border border-black/10 p-2 mt-0.5 bg-white"
                        >
                          <option value="">Select...</option>
                          {(f.options || []).map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={(customerForm[f.key] as string) || ''}
                          onChange={e => handleCustomerFieldChange(f.key, e.target.value)}
                          className="w-full text-xs rounded-lg border border-black/10 p-2 mt-0.5"
                        />
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleSaveCustomer}
                      disabled={savingCustomer}
                      className="text-xs font-bold text-white bg-brand-orange rounded-lg px-3 py-1.5 disabled:opacity-50"
                    >
                      {savingCustomer ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={handleCancelEditCustomer}
                      disabled={savingCustomer}
                      className="text-xs font-medium text-[#1A1A1A]/60 px-3 py-1.5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : customer ? (
                <div className="space-y-1.5">
                  {PROFILE_FIELDS.filter(f => f.type !== 'checkbox').map(f => (
                    customer[f.key] ? (
                      <p key={f.key} className="text-xs text-[#1A1A1A]">
                        <span className="text-[#1A1A1A]/40">{f.label}: </span>
                        {String(customer[f.key])}
                      </p>
                    ) : null
                  ))}
                  {customer.marketingConsent ? (
                    <p className="text-xs text-[#1A1A1A]">
                      <span className="text-[#1A1A1A]/40">Marketing consent: </span>Yes
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-[#1A1A1A]/40">No profile on file for this email.</p>
              )}
            </div>
            <div className="flex items-center gap-2 mb-4">
              <User size={16} className="text-brand-orange" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60">Customer History</h3>
            </div>
            {historyLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="animate-spin text-brand-orange" size={18} /></div>
            ) : history.length === 0 ? (
              <p className="text-xs text-[#1A1A1A]/40">No past bookings found for this email.</p>
            ) : (
              <div className="space-y-3">
                {history.map(b => (
                  <div key={b.id} className="bg-white/60 rounded-xl border border-black/10 p-3">
                    <p className="text-sm font-bold text-[#1A1A1A]">{b.customerName}</p>
                    <p className="text-[11px] text-[#1A1A1A]/50 mt-0.5">
                      {b.startDate ? format(new Date(b.startDate), 'dd MMM yyyy') : ''}
                      {b.endDate ? ` - ${format(new Date(b.endDate), 'dd MMM yyyy')}` : ''}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-orange/10 text-brand-orange font-bold uppercase">{b.status}</span>
                      {b.amount ? <span className="text-xs font-bold text-[#1A1A1A]">THB {b.amount.toLocaleString()}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
