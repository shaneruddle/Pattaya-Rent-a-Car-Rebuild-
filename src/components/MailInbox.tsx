import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { auth, db, storage } from '../firebase';
import { collection, getDocs, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { Booking, Customer, EmailTemplate } from '../types';
import { format, parseISO } from 'date-fns';
import DOMPurify from 'dompurify';
import { Inbox, RefreshCw, Send, User, Loader2, ChevronLeft, ChevronRight, MailOpen, Check, Sparkles, Search, X, LayoutTemplate, AlertTriangle, ShieldCheck, Clock, Paperclip, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { processTemplate, htmlToPlainText } from '../lib/emailUtils';
import { NATIONALITY_OPTIONS, suggestNationalityFromPhone } from '../lib/nationalityUtils';

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
  // Booking linked to any message in this thread, if one exists (see server.ts
  // /api/mail/threads - carried via the X-Booking-Id header). Used by the Follow
  // Up filter below to know which threads can be auto-filled and reminded.
  bookingId?: string;
  // True when our own mailbox sent the most recent message - i.e. the customer
  // hasn't replied since. Combined with bookingId and `date`, this is what
  // needsFollowUp() below uses to flag a thread.
  lastMessageFromUs: boolean;
}

// A booking-linked thread where our last message has gone unanswered this long
// gets flagged in the Follow Up filter. Recomputed live from thread data rather
// than a stored flag, so a thread drops out the moment the customer replies, and
// reappears automatically if a follow-up we send also goes unanswered.
const FOLLOW_UP_DAYS_THRESHOLD = 3;

function daysSince(dateStr: string): number | null {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
  } catch {
    return null;
  }
}

function needsFollowUp(t: MailThread): boolean {
  if (!t.bookingId || !t.lastMessageFromUs) return false;
  const days = daysSince(t.date);
  return days !== null && days >= FOLLOW_UP_DAYS_THRESHOLD;
}

interface MailMessage {
  id: string;
  messageIdHeader: string;
  from: string;
  to: string;
  // Reply-To header, when present. Staff-only notifications (e.g. "New Booking
  // Enquiry") are sent From info@ To info@, with the customer's real address
  // only here - see resolveCustomerEmail() below.
  replyTo?: string;
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
  attachments?: MailAttachment[];
}

interface MailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
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

// Curated list of common disposable/temporary email providers, checked
// entirely client-side (no external API call, no data leaves the browser).
// Not exhaustive - it's a soft "worth a second look" signal for staff on
// brand-new enquiries, not a hard block.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailinator2.com',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'guerrillamail.de', 'guerrillamail.info', 'guerrillamailblock.com',
  'guerillamail.com', 'guerillamail.net', 'guerillamail.org', 'guerillamail.biz',
  'guerillamail.info', 'guerillamailblock.com', 'sharklasers.com', 'grr.la',
  'pokemail.net', 'spam4.me', '10minutemail.com', '10minutemail.net', '10minemail.com',
  '20minutemail.com', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.net',
  'tempmailo.com', 'throwawaymail.com', 'dispostable.com', 'trashmail.com',
  'trashmail.net', 'trash-mail.com', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'moakt.com', 'moakt.cc', 'getnada.com', 'nada.email', 'maildrop.cc', 'mailnesia.com',
  'mailcatch.com', 'mintemail.com', 'mytemp.email', 'tempinbox.com', 'emailondeck.com',
  'fakeinbox.com', 'spamgourmet.com', 'mohmal.com', 'crazymailing.com',
  'discard.email', 'discardmail.com', 'mail-temp.com', 'tempail.com',
  'tempmailaddress.com', 'burnermail.io', 'luxusmail.org', 'anonbox.net',
  'minuteinbox.com', 'tempr.email', 'emltmp.com', 'byom.de', 'spambog.com',
  'spambog.de', 'spambog.ru', 'incognitomail.com', 'incognitomail.org',
  'jetable.org', 'mytrashmail.com', 'no-spam.ws', 'wegwerfmail.de', 'wegwerfmail.net',
  'wegwerfmail.org', 'einrot.com', 'spoofmail.de', 'trbvm.com', 'e4ward.com',
  'tempemail.co', 'tempemail.net', 'throam.com', 'mailnull.com', 'spamhole.com',
  'mytempmail.com', 'tempsky.com', 'deadaddress.com', 'spamex.com', 'opayq.com',
  'superrito.com', 'mailmetrash.com', 'spamfree24.org', 'spamfree24.de',
  'spamfree24.eu', 'trash2009.com', 'zoemail.org', 'spamavert.com', 'curryworld.de',
  'letthemeatspam.com', 'mailexpire.com', 'thankyou2010.com', 'uggsrock.com',
  'dropmail.me', 'inboxkitten.com', 'harakirimail.com', 'mailsac.com',
]);

function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  return !!domain && DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

// Emails that fail to deliver come back into the same Gmail thread as an
// automated reply from the receiving mail system, not from the customer -
// these have a distinctive sender and/or subject regardless of which mail
// server rejected them.
const BOUNCE_SENDER_RE = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;
const BOUNCE_SUBJECT_RE = /delivery status notification|undelivered mail|mail delivery (failed|failure)|returned mail|failure notice|delivery incomplete|message not delivered|address not found/i;

function isBounceMessage(m: { from: string; subject?: string }): boolean {
  return BOUNCE_SENDER_RE.test(m.from || '') || BOUNCE_SUBJECT_RE.test(m.subject || '');
}

function isBounceThread(t: { from: string; subject?: string; snippet?: string }): boolean {
  return isBounceMessage(t) || BOUNCE_SUBJECT_RE.test(t.snippet || '');
}

function formatShortDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    return isToday ? format(date, 'HH:mm') : format(date, 'dd MMM');
  } catch {
    return '';
  }
}

// Historical price/day for a past booking - bookings only store a total amount, so this
// is derived as amount / rental days (the rate actually charged), not the car's current rate.
function historyPricePerDay(b: { startDate?: string; endDate?: string; amount?: number }): number | null {
  if (!b.amount || !b.startDate || !b.endDate) return null;
  const days = Math.round((new Date(b.endDate).getTime() - new Date(b.startDate).getTime()) / 86400000);
  if (days <= 0) return null;
  return Math.round(b.amount / days);
}

// Resolve the customer's email for a thread. Prefers the most recent inbound
// message (from someone other than the info@ mailbox). Threads that are
// entirely outbound (e.g. an automated Rental Confirmation with no customer
// reply yet) have no such message, so fall back to the "To" address of the
// most recent outbound message instead of misreading info@ as the customer.
function resolveCustomerEmail(msgs: MailMessage[]): string {
  // Bounce notifications come from the mail system, not the customer - if one is
  // the most recent non-info@ message, skip it so a delivery failure doesn't get
  // mistaken for the customer replying. Falls through to the outbound "to"
  // address below, which is exactly the (likely mistyped) address that bounced.
  const inbound = [...msgs].reverse().find(m => extractEmail(m.from) !== INFO_MAILBOX && !isBounceMessage(m));
  if (inbound) return extractEmail(inbound.from);
  const outbound = [...msgs].reverse().find(m => m.to && extractEmail(m.to) !== INFO_MAILBOX);
  if (outbound) return extractEmail(outbound.to);
  // Neither From nor To points past our own mailbox - happens for staff-only
  // notifications (e.g. "New Booking Enquiry") that are sent to ourselves with
  // the customer's real address only in Reply-To. Fall back to that.
  const withReplyTo = [...msgs].reverse().find(m => m.replyTo && extractEmail(m.replyTo) !== INFO_MAILBOX);
  return withReplyTo ? extractEmail(withReplyTo.replyTo!) : '';
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

// Gmail's attachment endpoint returns base64url (- and _ instead of + and /),
// which isn't valid inside a data: URI - needs converting to standard base64 first.
function base64UrlToBase64(data: string): string {
  return data.replace(/-/g, '+').replace(/_/g, '/');
}

// Storage bucket root is a flat namespace shared with Image Management and
// Fleet Manager - prefix with "inbox-" plus a timestamp so an attachment
// filename like "photo.jpg" can't silently overwrite an existing image.
function inboxStorageName(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `inbox-${Date.now()}-${safe}`;
}

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
  const [verifyingId, setVerifyingId] = useState(false);
  const [refreshingVerify, setRefreshingVerify] = useState(false);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [showMobileProfile, setShowMobileProfile] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  // Fetched attachment thumbnails, keyed by "messageId:attachmentId" -> data URL.
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({});
  // "messageId:attachmentId" of the attachment currently being uploaded to the
  // Image Library, so only that one thumbnail shows a saving spinner.
  const [savingAttachmentKey, setSavingAttachmentKey] = useState<string | null>(null);
  const [correctingEmail, setCorrectingEmail] = useState(false);
  const [correctedEmailInput, setCorrectedEmailInput] = useState('');
  const [savingCorrectedEmail, setSavingCorrectedEmail] = useState(false);

  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [bulkMarkingRead, setBulkMarkingRead] = useState(false);

  const [showFollowUpOnly, setShowFollowUpOnly] = useState(false);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);

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

  // Auto-loads a thumbnail for every image attachment in the open thread.
  // Guarded by attachmentPreviewsLoadingRef (in-flight) and attachmentPreviews
  // itself (already loaded) so re-renders don't re-fetch the same photo.
  const attachmentPreviewsLoadingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedThreadId) return;
    messages.forEach(m => {
      (m.attachments || []).forEach(att => {
        if (!att.mimeType.startsWith('image/')) return;
        const key = `${m.id}:${att.attachmentId}`;
        if (attachmentPreviews[key] || attachmentPreviewsLoadingRef.current.has(key)) return;
        attachmentPreviewsLoadingRef.current.add(key);
        authedFetch(`/api/mail/threads/${selectedThreadId}/messages/${m.id}/attachments/${att.attachmentId}`)
          .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then(data => {
            setAttachmentPreviews(prev => ({
              ...prev,
              [key]: `data:${att.mimeType};base64,${base64UrlToBase64(data.data)}`,
            }));
          })
          .catch(err => console.error('Failed to load attachment preview:', err))
          .finally(() => attachmentPreviewsLoadingRef.current.delete(key));
      });
    });
    // attachmentPreviews intentionally omitted - it's only read here as an
    // already-loaded check, and including it would re-run this on every fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, selectedThreadId]);

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

  // Threads actually shown in the list - either everything fetched, or just the
  // subset flagged by needsFollowUp() when the Follow Up filter is on. Bulk
  // select/mark-read below operates on this, not the full `threads` list, so it
  // stays scoped to whatever's visible.
  const followUpThreads = useMemo(() => threads.filter(needsFollowUp), [threads]);
  const visibleThreads = showFollowUpOnly ? followUpThreads : threads;

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
      prev.size === visibleThreads.length ? new Set() : new Set(visibleThreads.map(t => t.id))
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
    setShowMobileProfile(false);
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

  // Lightweight "who is this person" signals for brand-new enquiries where we
  // only have name/email/mobile (no ID yet). Both run entirely client-side -
  // no third-party lookup, no new data collection, nothing sent anywhere.
  const isTempEmail = customerEmail ? isDisposableEmail(customerEmail) : false;
  const searchName = customer?.firstName
    ? `${customer.firstName} ${customer.lastName || ''}`.trim()
    : (lastMessage ? extractName(lastMessage.from) : '');

  // The address a bounce actually failed to reach is the "to" of the most
  // recent message we sent before the bounce came back - not the bounce
  // sender itself (that's the mail system, e.g. mailer-daemon@...).
  const bounceIndex = messages.findIndex(isBounceMessage);
  const bounceMessage = bounceIndex >= 0 ? messages[bounceIndex] : null;
  const bouncedAddress = (() => {
    if (bounceIndex < 0) return '';
    for (let i = bounceIndex - 1; i >= 0; i--) {
      if (extractEmail(messages[i].from) === INFO_MAILBOX && messages[i].to) {
        return extractEmail(messages[i].to);
      }
    }
    return '';
  })();

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
          if (booking.deliveryLocation) {
            try {
              const { lat, lng } = booking.deliveryLocation;
              const feeRes = await fetch(`/api/delivery/quote?lat=${lat}&lng=${lng}`);
              const feeData = await feeRes.json();
              if (feeRes.ok) {
                placeholders['{{delivery_fee}}'] = feeData.available === false
                  ? 'outside our standard delivery area - to be confirmed'
                  : feeData.fee === 0
                    ? 'Free'
                    : `${feeData.fee} THB`;
              }
            } catch (err) {
              console.error('Failed to load delivery fee for template fill:', err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load linked booking for template fill:', err);
      }
    }

    const processed = htmlToPlainText(processTemplate(template.body, placeholders));
    setReplyBody(processed);
    setShowTemplateMenu(false);
  };

  // Sends the follow_up_reminder template to the customer on a flagged thread -
  // same template and placeholder set Live Enquiries' own reminder button uses,
  // via the same /api/send-email + bookingId path, so it threads into this
  // conversation and the thread naturally drops out of the Follow Up filter
  // once sent (until it goes unanswered again).
  const sendFollowUp = async () => {
    if (!selectedThread?.bookingId || !customerEmail) return;
    setSendingFollowUp(true);
    try {
      const snap = await getDoc(doc(db, 'bookings', selectedThread.bookingId));
      if (!snap.exists()) throw new Error('Linked booking not found');
      const booking = snap.data() as Booking;

      let deliveryFeeText = 'Not specified';
      if (booking.deliveryLocation) {
        try {
          const { lat, lng } = booking.deliveryLocation;
          const feeRes = await fetch(`/api/delivery/quote?lat=${lat}&lng=${lng}`);
          const feeData = await feeRes.json();
          if (feeRes.ok) {
            deliveryFeeText = feeData.available === false
              ? 'outside our standard delivery area - to be confirmed'
              : feeData.fee === 0
                ? 'Free'
                : `${feeData.fee} THB`;
          }
        } catch (err) {
          console.error('Failed to load delivery fee for follow-up email:', err);
        }
      }

      const placeholders: Record<string, string> = {
        '{{customer_name}}': (booking.customerName || 'Customer').split(' ')[0],
        '{{vehicle_model}}': booking.requestedCarType || 'requested car',
        '{{total_price}}': (booking.amount || 0).toLocaleString(),
        '{{pickup_date}}': booking.startDate ? format(parseISO(booking.startDate), 'dd MMM yyyy') : '',
        '{{pickup_time}}': booking.startDate ? format(parseISO(booking.startDate), 'HH:mm') : '',
        '{{return_date}}': booking.endDate ? format(parseISO(booking.endDate), 'dd MMM yyyy') : '',
        '{{return_time}}': booking.endDate ? format(parseISO(booking.endDate), 'HH:mm') : '',
        '{{rental_period}}': booking.startDate && booking.endDate
          ? `${format(parseISO(booking.startDate), 'dd MMM yyyy')} to ${format(parseISO(booking.endDate), 'dd MMM yyyy')}`
          : '',
        '{{delivery_address}}': booking.deliveryAddress || 'Not specified',
        '{{delivery_fee}}': deliveryFeeText,
        '{{customer_email}}': customerEmail,
        '{{customer_phone}}': booking.mobileNumber || '',
        '{{comments}}': booking.notes || '',
      };

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: customerEmail,
          templateId: 'follow_up_reminder',
          skipFinalToOverride: true,
          replyTo: INFO_MAILBOX,
          placeholders,
          bookingId: selectedThread.bookingId,
        }),
      });
      if (!res.ok) throw new Error('Send failed');
      toast.success(`Follow up sent to ${customerEmail}`);
      if (selectedThreadId) await openThread(selectedThreadId);
      fetchThreads(searchQuery);
    } catch (err: any) {
      console.error('Failed to send follow up:', err);
      toast.error(err.message || 'Failed to send follow up');
    } finally {
      setSendingFollowUp(false);
    }
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

  // Starts a Didit hosted verification session for the current thread's customer,
  // scoped to new customers only (no booking history) per project decision. Creates
  // a minimal customer stub first if none exists yet, so the session has a doc to
  // attach results to.
  const handleVerifyId = async () => {
    if (!customerEmail) return;
    setVerifyingId(true);
    try {
      let customerId = customer?.id;
      if (!customerId) {
        const custRes = await authedFetch('/api/customers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: customerEmail }),
        });
        if (!custRes.ok) throw new Error(`HTTP ${custRes.status}`);
        const custData = await custRes.json();
        customerId = custData.customer?.id;
        setCustomer(custData.customer || null);
      }
      if (!customerId) throw new Error('No customer record to attach verification to');

      const res = await authedFetch('/api/verify/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCustomer(prev => prev ? { ...prev, diditStatus: data.status, diditSessionId: data.sessionId, diditVerificationUrl: data.url } : prev);
      if (data.url) {
        await navigator.clipboard.writeText(data.url);
        toast.success('Verification link copied - send it to the customer');
      } else {
        toast.success('Verification session started');
      }
    } catch (err: any) {
      console.error('Failed to start ID verification:', err);
      toast.error('Failed to start ID verification');
    } finally {
      setVerifyingId(false);
    }
  };

  // Manual fallback in case the Didit webhook was missed - re-polls the session
  // status/decision directly.
  const handleRefreshVerifyStatus = async () => {
    if (!customer?.id) return;
    setRefreshingVerify(true);
    try {
      const res = await authedFetch(`/api/verify/status?customerId=${encodeURIComponent(customer.id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCustomer(prev => prev ? { ...prev, diditStatus: data.status, diditExtracted: data.extracted || prev.diditExtracted } : prev);
    } catch (err: any) {
      console.error('Failed to refresh verification status:', err);
      toast.error('Failed to refresh status');
    } finally {
      setRefreshingVerify(false);
    }
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

  // Writes a corrected address to whichever records exist for this thread -
  // the linked booking/enquiry (the field that actually caused the bounce)
  // and the Customer profile if one was found. Does not resend anything;
  // future automated emails for this booking/customer will use the fix.
  const handleSaveCorrectedEmail = async () => {
    const newEmail = correctedEmailInput.trim().toLowerCase();
    if (!newEmail || !/^\S+@\S+\.\S+$/.test(newEmail)) {
      toast.error('Enter a valid email address');
      return;
    }
    const linkedBookingId = messages.find(m => m.bookingId)?.bookingId;
    if (!linkedBookingId && !customer?.id) {
      toast.error('No linked booking or customer profile found to update');
      return;
    }
    setSavingCorrectedEmail(true);
    try {
      const writes: Promise<any>[] = [];
      if (linkedBookingId) {
        writes.push(updateDoc(doc(db, 'bookings', linkedBookingId), { email: newEmail }));
      }
      if (customer?.id) {
        writes.push(updateDoc(doc(db, 'customers', customer.id), { email: newEmail, updatedAt: serverTimestamp() }));
      }
      await Promise.all(writes);
      if (customer?.id) {
        const snap = await getDoc(doc(db, 'customers', customer.id));
        if (snap.exists()) setCustomer({ id: snap.id, ...snap.data() } as Customer);
      }
      toast.success('Email address corrected');
      setCorrectingEmail(false);
      setCorrectedEmailInput('');
    } catch (err: any) {
      console.error('Failed to save corrected email:', err);
      toast.error('Failed to save corrected email');
    } finally {
      setSavingCorrectedEmail(false);
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

  // Uploads an attachment straight to the root of the Storage bucket that
  // Image Management already browses - no separate collection needed, it
  // just shows up in that existing grid a moment later.
  const handleSaveAttachmentToLibrary = async (messageId: string, att: MailAttachment) => {
    if (!selectedThreadId) return;
    const key = `${messageId}:${att.attachmentId}`;
    setSavingAttachmentKey(key);
    try {
      let dataUrl = attachmentPreviews[key];
      if (!dataUrl) {
        const res = await authedFetch(`/api/mail/threads/${selectedThreadId}/messages/${messageId}/attachments/${att.attachmentId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        dataUrl = `data:${att.mimeType};base64,${base64UrlToBase64(data.data)}`;
        setAttachmentPreviews(prev => ({ ...prev, [key]: dataUrl! }));
      }
      const blob = await (await fetch(dataUrl)).blob();
      const storageRef = ref(storage, inboxStorageName(att.filename));
      await uploadBytes(storageRef, blob);
      toast.success(`Saved "${att.filename}" to Image Library`);
    } catch (err: any) {
      console.error('Failed to save attachment to Image Library:', err);
      toast.error('Failed to save photo to Image Library');
    } finally {
      setSavingAttachmentKey(null);
    }
  };

  // Shared Customer Profile + Customer History content, rendered both in the
  // desktop "Details" column (hidden lg:flex w-72) and in the mobile-only
  // full-screen Profile view (shown via the header Profile icon below lg).
  const customerDetailsPanel = (
    <>
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
        {!customerLoading && !historyLoading && !editingCustomer && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {history.length === 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 font-bold uppercase">New customer</span>
            )}
            {history.length === 0 && isTempEmail && (
              <span
                title="This email is from a temporary/disposable email provider - worth a second look"
                className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 font-bold uppercase flex items-center gap-1"
              >
                <AlertTriangle size={11} /> Temp email
              </span>
            )}
            {history.length === 0 && searchName && (
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(searchName)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Search this name online in a new tab"
                className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-600 font-bold uppercase flex items-center gap-1 hover:bg-gray-500/20"
              >
                <Search size={11} /> Search name
              </a>
            )}
            {customer?.diditStatus && customer.diditStatus !== 'Not Started' ? (
              <button
                onClick={handleRefreshVerifyStatus}
                disabled={refreshingVerify}
                title="Click to refresh status from Didit"
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1 disabled:opacity-50',
                  customer.diditStatus === 'Approved' ? 'bg-green-500/10 text-green-600' :
                  customer.diditStatus === 'Declined' ? 'bg-red-500/10 text-red-600' :
                  'bg-amber-500/10 text-amber-600'
                )}
              >
                {refreshingVerify ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={11} />}
                ID: {customer.diditStatus}
              </button>
            ) : history.length === 0 ? (
              <button
                onClick={handleVerifyId}
                disabled={verifyingId || !customerEmail}
                className="text-[10px] px-2 py-0.5 rounded-full bg-brand-orange/10 text-brand-orange font-bold uppercase flex items-center gap-1 disabled:opacity-50"
              >
                {verifyingId ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={11} />}
                {verifyingId ? 'Starting...' : 'Verify ID'}
              </button>
            ) : null}
          </div>
        )}
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
                  <>
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
                    {f.key === 'nationality' && !customerForm.nationality && suggestNationalityFromPhone(customerForm.mobileNumber || customer?.mobileNumber) && (
                      <button
                        type="button"
                        onClick={() => handleCustomerFieldChange('nationality', suggestNationalityFromPhone(customerForm.mobileNumber || customer?.mobileNumber) as string)}
                        className="mt-1 text-[10px] font-medium text-brand-orange hover:underline"
                      >
                        Suggest: {suggestNationalityFromPhone(customerForm.mobileNumber || customer?.mobileNumber)} (from phone)
                      </button>
                    )}
                  </>
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
          {history.map(b => {
            const perDay = historyPricePerDay(b);
            return (
            <div key={b.id} className="bg-white/60 rounded-xl border border-black/10 p-3">
              <p className="text-sm font-bold text-[#1A1A1A]">{b.customerName}</p>
              <p className="text-[11px] text-[#1A1A1A]/50 mt-0.5">
                {b.startDate ? format(new Date(b.startDate), 'dd MMM yyyy') : ''}
                {b.endDate ? ` - ${format(new Date(b.endDate), 'dd MMM yyyy')}` : ''}
              </p>
              <p className="text-[11px] text-[#1A1A1A]/50 mt-0.5">
                {b.carName || 'Unknown vehicle'}
                {perDay ? ` · THB ${perDay.toLocaleString()}/day` : ''}
              </p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-orange/10 text-brand-orange font-bold uppercase">{b.status}</span>
                {b.amount ? <span className="text-xs font-bold text-[#1A1A1A]">THB {b.amount.toLocaleString()}</span> : null}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </>
  );

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
          {!threadsLoading && (
            <div className="px-3 pt-2 pb-1 flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowFollowUpOnly(false)}
                className={cn(
                  'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all',
                  !showFollowUpOnly ? 'bg-brand-orange text-white' : 'bg-black/5 text-[#1A1A1A]/40 hover:text-[#1A1A1A]/60'
                )}
              >
                All
              </button>
              <button
                onClick={() => setShowFollowUpOnly(true)}
                className={cn(
                  'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all',
                  showFollowUpOnly ? 'bg-brand-orange text-white' : 'bg-black/5 text-[#1A1A1A]/40 hover:text-[#1A1A1A]/60'
                )}
                title={`Booking-linked threads with no reply ${FOLLOW_UP_DAYS_THRESHOLD}+ days after our last message`}
              >
                Follow Up{followUpThreads.length > 0 ? ` (${followUpThreads.length})` : ''}
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
          {!threadsLoading && visibleThreads.length > 0 && (
            <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-white/80 backdrop-blur-xl border-b border-black/5">
              <input
                type="checkbox"
                checked={selectedThreadIds.size > 0 && selectedThreadIds.size === visibleThreads.length}
                ref={el => {
                  if (el) el.indeterminate = selectedThreadIds.size > 0 && selectedThreadIds.size < visibleThreads.length;
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
          ) : visibleThreads.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#1A1A1A]/40">
              {showFollowUpOnly
                ? 'No threads need a follow up right now'
                : searchQuery ? `No results for "${searchQuery}"` : 'No threads found'}
            </div>
          ) : (
            visibleThreads.map(t => (
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isBounceThread(t) && (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                          Bounced
                        </span>
                      )}
                      {needsFollowUp(t) && (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                          Follow Up
                        </span>
                      )}
                      <span className="text-[10px] text-[#1A1A1A]/40">{formatShortDate(t.date)}</span>
                    </div>
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
          'flex-1 min-w-0 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 flex flex-col min-h-0',
          !showMobileDetail && 'hidden md:flex',
          showMobileProfile && 'hidden lg:flex'
        )}>
          {!selectedThreadId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-[#1A1A1A]/40">
              Select a conversation to view
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-black/10 flex items-center gap-3">
                <button className="md:hidden p-1" onClick={() => { setShowMobileDetail(false); setShowMobileProfile(false); }}>
                  <ChevronLeft size={20} />
                </button>
                <h2 className="font-bold text-[#1A1A1A] truncate flex-1">{selectedThread?.subject || '(no subject)'}</h2>
                <button
                  className="lg:hidden p-1 text-[#1A1A1A]/60 hover:text-brand-orange shrink-0"
                  onClick={() => setShowMobileProfile(true)}
                  title="View customer profile"
                >
                  <User size={18} />
                </button>
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
              {bounceMessage && (
                <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-red-700 uppercase tracking-wide text-[10px]">
                    <AlertTriangle size={13} />
                    Delivery failed
                  </div>
                  {!correctingEmail ? (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <p className="text-red-700/80">
                        {bouncedAddress
                          ? <>This email to <span className="font-semibold">{bouncedAddress}</span> bounced.</>
                          : 'This email bounced.'}
                      </p>
                      <button
                        onClick={() => { setCorrectingEmail(true); setCorrectedEmailInput(bouncedAddress); }}
                        className="shrink-0 font-bold text-red-700 hover:underline"
                      >
                        Correct address
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="email"
                        value={correctedEmailInput}
                        onChange={e => setCorrectedEmailInput(e.target.value)}
                        placeholder="corrected@email.com"
                        className="flex-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-300"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveCorrectedEmail}
                        disabled={savingCorrectedEmail}
                        className="shrink-0 font-bold text-white bg-red-600 rounded-lg px-3 py-1.5 disabled:opacity-50"
                      >
                        {savingCorrectedEmail ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setCorrectingEmail(false)}
                        className="shrink-0 font-medium text-red-700/60 hover:text-red-700"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
              {selectedThread && needsFollowUp(selectedThread) && (
                <div className="mx-4 mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 font-bold text-blue-700 uppercase tracking-wide text-[10px]">
                    <Clock size={13} />
                    No reply for {daysSince(selectedThread.date)}+ days
                  </div>
                  <button
                    onClick={sendFollowUp}
                    disabled={sendingFollowUp || !customerEmail}
                    className="shrink-0 flex items-center gap-1.5 font-bold text-white bg-blue-600 rounded-lg px-3 py-1.5 disabled:opacity-50"
                  >
                    {sendingFollowUp ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    Send Follow Up
                  </button>
                </div>
              )}
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
                            {isBounceMessage(m) && (
                              <span className="text-[9px] font-bold uppercase tracking-wide text-red-600 bg-red-100 px-1.5 py-0.5 rounded shrink-0">
                                Bounced
                              </span>
                            )}
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
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[#1A1A1A]">{extractName(m.from)}</span>
                            {isBounceMessage(m) && (
                              <span className="text-[9px] font-bold uppercase tracking-wide text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                                Bounced
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-[#1A1A1A]/40">{m.date}</span>
                        </div>
                        {m.bodyHtml ? (
                          <div
                            className="text-sm text-[#1A1A1A]/80 max-w-full overflow-x-auto [&_a]:text-brand-orange [&_a]:underline"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(m.bodyHtml) }}
                          />
                        ) : (
                          <p className="text-sm text-[#1A1A1A]/80 whitespace-pre-wrap break-words">{m.bodyText}</p>
                        )}
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-black/5 flex flex-wrap gap-2">
                            {m.attachments.map(att => {
                              const isImage = att.mimeType.startsWith('image/');
                              if (!isImage) {
                                return (
                                  <span
                                    key={att.attachmentId}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/5 text-[11px] text-[#1A1A1A]/60"
                                  >
                                    <Paperclip size={12} />
                                    {att.filename}
                                  </span>
                                );
                              }
                              const key = `${m.id}:${att.attachmentId}`;
                              const preview = attachmentPreviews[key];
                              const saving = savingAttachmentKey === key;
                              return (
                                <div
                                  key={att.attachmentId}
                                  className="relative group w-24 h-24 rounded-xl overflow-hidden bg-black/5 border border-black/10"
                                >
                                  {preview ? (
                                    <img src={preview} alt={att.filename} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Loader2 size={16} className="animate-spin text-[#1A1A1A]/30" />
                                    </div>
                                  )}
                                  {preview && (
                                    <button
                                      onClick={() => handleSaveAttachmentToLibrary(m.id, att)}
                                      disabled={saving}
                                      title="Save to Image Library"
                                      className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/50 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-100 disabled:bg-black/50"
                                    >
                                      {saving ? (
                                        <Loader2 size={18} className="text-white animate-spin" />
                                      ) : (
                                        <ImagePlus size={18} className="text-white" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
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
            {customerDetailsPanel}
          </div>
        )}

        {selectedThreadId && showMobileDetail && showMobileProfile && (
          <div className="flex lg:hidden flex-1 min-w-0 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 flex-col overflow-y-auto custom-scrollbar p-4">
            <div className="flex items-center gap-3 mb-3 pb-3 border-b border-black/10 -mx-4 -mt-4 px-4 pt-4">
              <button className="p-1" onClick={() => setShowMobileProfile(false)}>
                <ChevronLeft size={20} />
              </button>
              <h2 className="font-bold text-[#1A1A1A]">Customer Profile</h2>
            </div>
            {customerDetailsPanel}
          </div>
        )}
      </div>
    </div>
  );
};
