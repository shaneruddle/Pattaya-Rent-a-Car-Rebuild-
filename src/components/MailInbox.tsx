import React, { useState, useEffect, useCallback } from 'react';
import { auth } from '../firebase';
import { Booking, Customer } from '../types';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import { Inbox, RefreshCw, Send, User, Loader2, ChevronLeft, MailOpen } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

const INFO_MAILBOX = 'info@pattayarentacar.com';

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

  const sortUnreadFirst = (list: MailThread[]) =>
    [...list].sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0));

  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const res = await authedFetch('/api/mail/threads');
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
      const res = await authedFetch(`/api/mail/threads?pageToken=${encodeURIComponent(nextPageToken)}`);
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
  }, [nextPageToken, loadingMore]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  const openThread = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId);
    setShowMobileDetail(true);
    setMessages([]);
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
          onClick={fetchThreads}
          disabled={threadsLoading}
          className="w-10 h-10 rounded-xl bg-white/60 border border-black/10 flex items-center justify-center hover:bg-white transition-all disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} className={cn(threadsLoading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        <div className={cn(
          'w-full md:w-80 shrink-0 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 overflow-y-auto custom-scrollbar',
          showMobileDetail && 'hidden md:block'
        )}>
          {threadsLoading ? (
            <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-brand-orange" size={24} /></div>
          ) : threads.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#1A1A1A]/40">No threads found</div>
          ) : (
            threads.map(t => (
              <button
                key={t.id}
                onClick={() => openThread(t.id)}
                className={cn(
                  'w-full text-left p-4 border-b border-black/5 hover:bg-white/60 transition-all',
                  selectedThreadId === t.id && 'bg-brand-orange/10'
                )}
              >
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
                  messages.map(m => (
                    <div key={m.id} className="bg-white/60 rounded-2xl border border-black/10 p-4">
                      <div className="flex items-center justify-between mb-2">
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
                  ))
                )}
              </div>
              <div className="p-4 border-t border-black/10">
                <textarea
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder="Write a reply..."
                  rows={3}
                  className="w-full rounded-xl border border-black/10 bg-white/60 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/40 resize-none"
                />
                <div className="flex justify-end mt-2">
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

        {selectedThreadId && (
          <div className="hidden lg:flex w-72 shrink-0 bg-white/40 backdrop-blur-xl rounded-2xl border border-black/10 flex-col overflow-y-auto custom-scrollbar p-4">
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
