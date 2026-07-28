import React, { useState, useEffect, useCallback } from 'react';
import { auth } from '../firebase';
import { Booking } from '../types';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import { Inbox, RefreshCw, Send, User, Loader2, ChevronLeft } from 'lucide-react';
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
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const res = await authedFetch('/api/mail/threads');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (err: any) {
      console.error('Failed to load threads:', err);
      toast.error('Failed to load inbox');
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  const openThread = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId);
    setShowMobileDetail(true);
    setMessages([]);
    setHistory([]);
    setReplyBody('');
    setMessagesLoading(true);
    try {
      const res = await authedFetch(`/api/mail/threads/${threadId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const msgs: MailMessage[] = data.messages || [];
      setMessages(msgs);

      const customerMsg = [...msgs].reverse().find(m => extractEmail(m.from) !== INFO_MAILBOX) || msgs[msgs.length - 1];
      if (customerMsg) {
        const senderEmail = extractEmail(customerMsg.from);
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
  const customerMessage = [...messages].reverse().find(m => extractEmail(m.from) !== INFO_MAILBOX) || lastMessage;

  const handleSend = async () => {
    if (!replyBody.trim() || !customerMessage || !lastMessage || !selectedThread) return;
    setSending(true);
    try {
      const toEmail = extractEmail(customerMessage.from);
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
