import React, { useEffect, useState, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db, auth } from '@/firebase';
import {
  TrendingUp,
  Zap,
  BookOpen,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  XCircle,
  Copy,
  ClipboardCheck,
  Search,
  MousePointerClick,
  Eye,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface GscQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchConsoleData {
  topQueries: GscQuery[];
  topPages: GscPage[];
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number;
  error?: string;
}

interface AgentWeek {
  id: string;
  weekId: string;
  status: 'collected' | 'analysed';
  createdAt?: { toDate: () => Date };
  analysedAt?: { toDate: () => Date };
  summary?: string;
  searchConsole?: SearchConsoleData;
}

interface AgentAction {
  index: number;
  priority: number;
  category: string;
  action: string;
  rationale: string;
}

interface AgentTask {
  id: string;
  weekId: string;
  actionIndex: number;
  status: 'queued' | 'executing' | 'done' | 'failed' | 'ignored' | 'cowork_ready';
  result?: string;
  error?: string;
  coworkPrompt?: string;
  approvedAt?: { toDate: () => Date };
  executedAt?: { toDate: () => Date };
}

interface AgentKnowledge {
  id: string;
  topic: string;
  fact: string;
  source?: string;
  confidence?: string;
  createdAt?: { toDate: () => Date };
}

const PRIORITY_LABEL: Record<number, string> = { 1: 'Critical', 2: 'High', 3: 'Medium' };
const PRIORITY_CLASS: Record<number, string> = {
  1: 'bg-red-50 text-red-700 border-red-200',
  2: 'bg-orange-50 text-orange-700 border-orange-200',
  3: 'bg-blue-50 text-blue-700 border-blue-200',
};
const CHANNEL_CLASS: Record<string, string> = {
  seo: 'bg-purple-50 text-purple-700',
  ads: 'bg-yellow-50 text-yellow-800',
  content: 'bg-teal-50 text-teal-700',
  conversion: 'bg-indigo-50 text-indigo-700',
  technical: 'bg-gray-100 text-gray-700',
  other: 'bg-slate-100 text-slate-600',
};

const STATUS_CONFIG = {
  queued:       { label: 'Queued',       icon: Clock,           className: 'text-amber-600 bg-amber-50' },
  executing:    { label: 'Executing',    icon: Loader2,         className: 'text-blue-600 bg-blue-50', spin: true },
  done:         { label: 'Done',         icon: CheckCircle2,    className: 'text-emerald-600 bg-emerald-50' },
  failed:       { label: 'Failed',       icon: XCircle,         className: 'text-red-600 bg-red-50' },
  ignored:      { label: 'Ignored',      icon: XCircle,         className: 'text-slate-400 bg-slate-50' },
  cowork_ready: { label: 'Needs Cowork', icon: ClipboardCheck,  className: 'text-orange-600 bg-orange-50' },
};

const EXECUTOR_URL = 'https://pattaya-rent-a-car-rebuild-700448424476.us-west1.run.app/api/growth/execute';

export default function GrowthDashboard() {
  const [weeks, setWeeks] = useState<AgentWeek[]>([]);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [tasks, setTasks] = useState<Record<number, AgentTask>>({});
  const [knowledge, setKnowledge] = useState<AgentKnowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingIndex, setApprovingIndex] = useState<number | null>(null);
  const [pasteResults, setPasteResults] = useState<Record<number, string>>({});
  const [submittingResult, setSubmittingResult] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [expandedKnowledge, setExpandedKnowledge] = useState(false);
  const [latestWeekId, setLatestWeekId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const weeksSnap = await getDocs(
          query(collection(db, 'agent_weeks'), orderBy('createdAt', 'desc'), limit(8))
        );
        const weekDocs = weeksSnap.docs.map(d => ({ id: d.id, ...d.data() })) as AgentWeek[];
        setWeeks(weekDocs);

        const latestAnalysed = weekDocs.find(w => w.status === 'analysed');
        if (latestAnalysed) {
          setLatestWeekId(latestAnalysed.weekId);
          // agent_actions is a single doc per week with actions[] array
          const actionsDoc = await getDoc(doc(db, 'agent_actions', latestAnalysed.id));
          if (actionsDoc.exists()) {
            const data = actionsDoc.data();
            const rawActions = (data.actions || []) as any[];
            setActions(rawActions.map((a, i) => ({
              index: i,
              priority: a.priority === 'high' ? 1 : a.priority === 'medium' ? 2 : 3,
              category: a.category,
              action: a.action,
              rationale: a.reasoning,
            })));
          }
        }

        const knowledgeSnap = await getDocs(
          query(collection(db, 'agent_knowledge'), orderBy('createdAt', 'desc'), limit(20))
        );
        setKnowledge(knowledgeSnap.docs.map(d => ({ id: d.id, ...d.data() })) as AgentKnowledge[]);
      } catch (err) {
        console.error('GrowthDashboard load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Live subscription to agent_tasks for latest week
  useEffect(() => {
    if (!latestWeekId) return;
    const q = query(collection(db, 'agent_tasks'), where('weekId', '==', latestWeekId));
    const unsub = onSnapshot(q, snap => {
      const taskMap: Record<number, AgentTask> = {};
      snap.docs.forEach(d => {
        const t = { id: d.id, ...d.data() } as AgentTask;
        taskMap[t.actionIndex] = t;
      });
      setTasks(taskMap);
    });
    return unsub;
  }, [latestWeekId]);

  const handleApprove = useCallback(async (action: AgentAction) => {
    if (!latestWeekId) return;
    setApprovingIndex(action.index);
    try {
      const taskId = `${latestWeekId}-${action.index}`;
      await setDoc(doc(db, 'agent_tasks', taskId), {
        weekId: latestWeekId,
        actionIndex: action.index,
        action: action.action,
        channel: action.category,
        priority: action.priority,
        status: 'queued',
        approvedAt: serverTimestamp(),
      });

      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      fetch(EXECUTOR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ taskId }),
      }).catch(err => console.error('Executor call failed:', err));
    } catch (err: any) {
      console.error('Approve failed:', err);
    } finally {
      setApprovingIndex(null);
    }
  }, [latestWeekId]);

  const handleIgnore = useCallback(async (action: AgentAction) => {
    if (!latestWeekId) return;
    try {
      await setDoc(doc(db, 'agent_tasks', `${latestWeekId}-${action.index}`), {
        weekId: latestWeekId,
        actionIndex: action.index,
        action: action.action,
        channel: action.category,
        priority: action.priority,
        status: 'ignored',
        approvedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Ignore failed:', err);
    }
  }, [latestWeekId]);

  const handleCopyPrompt = useCallback((action: AgentAction, prompt: string) => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopiedIndex(action.index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  }, []);

  const handleSubmitResult = useCallback(async (action: AgentAction) => {
    if (!latestWeekId) return;
    const result = pasteResults[action.index]?.trim();
    if (!result) return;
    setSubmittingResult(action.index);
    try {
      const taskId = `${latestWeekId}-${action.index}`;
      await updateDoc(doc(db, 'agent_tasks', taskId), {
        status: 'done',
        result,
        executedAt: serverTimestamp(),
      });
      // Store in agent_knowledge so future analyses benefit from it
      await addDoc(collection(db, 'agent_knowledge'), {
        topic: action.action.slice(0, 80),
        category: action.category,
        content: result,
        fact: result.slice(0, 300),
        source: 'cowork-execution',
        confidence: 'high',
        weekId: latestWeekId,
        createdAt: serverTimestamp(),
      });
      setPasteResults(prev => { const n = { ...prev }; delete n[action.index]; return n; });
    } catch (err) {
      console.error('Submit result failed:', err);
    } finally {
      setSubmittingResult(null);
    }
  }, [latestWeekId, pasteResults]);

  const latestAnalysed = weeks.find(w => w.status === 'analysed');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded">Growth Agent</span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Growth Dashboard</h1>
        </div>
        <p className="text-sm text-slate-500">AI-generated actions from weekly marketing data analysis. Runs every Monday 07:30 BKK.</p>
      </div>

      {/* Week badges */}
      <div className="flex gap-2 flex-wrap">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 w-24 bg-slate-100 animate-pulse rounded-full" />)
          : weeks.map(week => (
              <div key={week.id} className={cn('flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border', week.status === 'analysed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                {week.status === 'analysed' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                {week.weekId}
              </div>
            ))
        }
      </div>

      {/* Latest analysis summary */}
      {latestAnalysed && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <TrendingUp size={20} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Latest Analysis — {latestAnalysed.weekId}</p>
                <p className="text-sm font-semibold text-slate-800">
                  {latestAnalysed.analysedAt ? `Analysed ${format(latestAnalysed.analysedAt.toDate(), 'EEE d MMM yyyy, HH:mm')}` : 'Recently analysed'}
                </p>
              </div>
            </div>
            <span className="bg-emerald-100 text-emerald-700 border-0 text-[10px] font-bold uppercase tracking-widest">Analysed</span>
          </div>
          {latestAnalysed.summary && (
            <p className="mt-4 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-4">{latestAnalysed.summary}</p>
          )}
        </div>
      )}

      {/* Search Console panel */}
      {(() => {
        const gsc = latestAnalysed?.searchConsole;
        if (!gsc && !loading) return null;
        return (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search size={14} className="text-slate-500" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                  Google Search Console{latestAnalysed ? ` — ${latestAnalysed.weekId}` : ''}
                </span>
              </div>
            </div>
            {loading ? (
              <div className="p-6 space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-3 bg-slate-50 animate-pulse rounded" />)}
              </div>
            ) : gsc?.error ? (
              <div className="px-6 py-5 flex items-center gap-2 text-red-600">
                <AlertCircle size={14} />
                <p className="text-xs">GSC error: {gsc.error}</p>
              </div>
            ) : gsc ? (
              <div className="p-6 space-y-5">
                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5 mb-1">
                      <MousePointerClick size={12} className="text-emerald-600" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Clicks</p>
                    </div>
                    <p className="text-xl font-bold text-slate-800">{gsc.totalClicks.toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5 mb-1">
                      <Eye size={12} className="text-blue-500" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Impressions</p>
                    </div>
                    <p className="text-xl font-bold text-slate-800">{gsc.totalImpressions.toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5 mb-1">
                      <TrendingUp size={12} className="text-purple-500" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg Position</p>
                    </div>
                    <p className="text-xl font-bold text-slate-800">{gsc.avgPosition}</p>
                  </div>
                </div>

                {/* Top queries table */}
                {gsc.topQueries.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Top Queries</p>
                    <div className="rounded-lg border border-slate-100 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="text-left px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Query</th>
                            <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Clicks</th>
                            <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Impr</th>
                            <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">CTR</th>
                            <th className="text-right px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pos</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {gsc.topQueries.slice(0, 10).map((q, i) => (
                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-2 text-slate-700 font-medium max-w-[240px] truncate">{q.query}</td>
                              <td className="px-3 py-2 text-right text-slate-600 font-mono">{q.clicks}</td>
                              <td className="px-3 py-2 text-right text-slate-400 font-mono">{q.impressions.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-slate-400 font-mono">{(q.ctr * 100).toFixed(1)}%</td>
                              <td className="px-4 py-2 text-right font-mono">
                                <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold', q.position <= 3 ? 'bg-emerald-50 text-emerald-700' : q.position <= 10 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500')}>
                                  {q.position}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })()}

      {/* Actions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-slate-500" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
              Recommended Actions{latestAnalysed ? ` — ${latestAnalysed.weekId}` : ''}
            </span>
          </div>
          <span className="text-[10px] font-bold text-slate-400">{actions.length} actions</span>
        </div>
        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-6 py-5">
                <div className="h-4 bg-slate-50 animate-pulse rounded w-3/4 mb-2" />
                <div className="h-3 bg-slate-50 animate-pulse rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : actions.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-2">
            <AlertCircle size={28} className="opacity-20" />
            <p className="text-sm font-medium">No actions yet — analysis runs Monday 07:30 BKK.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {actions.map(action => {
              const task = tasks[action.index];
              const statusCfg = task ? STATUS_CONFIG[task.status] : null;
              const StatusIcon = statusCfg?.icon;
              const isApproving = approvingIndex === action.index;

              return (
                <div key={action.index} className={cn('px-6 py-5 transition-colors', task && task.status !== 'ignored' ? 'bg-slate-50/60' : 'hover:bg-slate-50/50')}>
                  <div className="flex items-start gap-4">
                    <span className={cn('shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border', PRIORITY_CLASS[action.priority] ?? 'bg-slate-50 text-slate-600 border-slate-200')}>
                      P{action.priority} {PRIORITY_LABEL[action.priority] ?? ''}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm font-semibold mb-1', task?.status === 'ignored' ? 'text-slate-400 line-through' : 'text-slate-900')}>
                        {action.action}
                      </p>
                      <p className="text-xs text-slate-500 leading-relaxed">{action.rationale}</p>

                      {task?.result && (
                        <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                          <p className="text-xs text-emerald-800 leading-relaxed">{task.result}</p>
                        </div>
                      )}
                      {task?.error && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                          <p className="text-xs text-red-700 leading-relaxed">{task.error}</p>
                        </div>
                      )}

                      {task?.status === 'cowork_ready' && task.coworkPrompt && (
                        <div className="mt-3 space-y-2">
                          <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold text-orange-700 uppercase tracking-widest">Cowork Prompt</span>
                              <button
                                onClick={() => handleCopyPrompt(action, task.coworkPrompt!)}
                                className="flex items-center gap-1 text-[10px] font-bold text-orange-700 hover:text-orange-900 transition-colors"
                              >
                                {copiedIndex === action.index ? <CheckCircle2 size={11} /> : <Copy size={11} />}
                                {copiedIndex === action.index ? 'Copied!' : 'Copy prompt'}
                              </button>
                            </div>
                            <pre className="text-xs text-orange-900 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">{task.coworkPrompt}</pre>
                          </div>
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paste Cowork result here</p>
                            <textarea
                              className="w-full h-24 text-xs p-2.5 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-slate-300 text-slate-700 placeholder:text-slate-300 bg-white"
                              placeholder="Paste the result from your Cowork session..."
                              value={pasteResults[action.index] ?? ''}
                              onChange={e => setPasteResults(prev => ({ ...prev, [action.index]: e.target.value }))}
                            />
                            <button
                              className="h-7 px-3 text-[10px] font-bold uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => handleSubmitResult(action)}
                              disabled={!pasteResults[action.index]?.trim() || submittingResult === action.index}
                            >
                              {submittingResult === action.index
                                ? <Loader2 size={11} className="animate-spin mr-1" />
                                : <CheckCircle2 size={11} className="mr-1" />
                              }
                              Save Result to Memory
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full', CHANNEL_CLASS[action.category] ?? 'bg-slate-100 text-slate-600')}>
                        {action.category}
                      </span>

                      {task ? (
                        <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold', statusCfg?.className)}>
                          {StatusIcon && (
                            <StatusIcon
                              size={11}
                              className={(statusCfg as any)?.spin ? 'animate-spin' : ''}
                            />
                          )}
                          {statusCfg?.label}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            className="h-7 px-3 text-[10px] font-bold uppercase tracking-widest border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => handleApprove(action)}
                            disabled={isApproving}
                          >
                            {isApproving
                              ? <Loader2 size={11} className="animate-spin mr-1" />
                              : <ThumbsUp size={11} className="mr-1" />
                            }
                            Approve
                          </button>
                          <button
                            className="h-7 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                            onClick={() => handleIgnore(action)}
                            disabled={isApproving}
                          >
                            <ThumbsDown size={11} className="mr-1" />
                            Ignore
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Knowledge base */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-slate-500" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Agent Knowledge Base</span>
          </div>
          <button onClick={() => setExpandedKnowledge(v => !v)} className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors">
            {expandedKnowledge ? 'Show less' : `Show all ${knowledge.length}`}
            {expandedKnowledge ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-6 py-4">
                <div className="h-3 bg-slate-50 animate-pulse rounded w-1/3 mb-2" />
                <div className="h-4 bg-slate-50 animate-pulse rounded w-full" />
              </div>
            ))}
          </div>
        ) : knowledge.length === 0 ? (
          <div className="h-32 flex flex-col items-center justify-center text-slate-400 gap-2">
            <BookOpen size={24} className="opacity-20" />
            <p className="text-sm font-medium">No knowledge entries yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {(expandedKnowledge ? knowledge : knowledge.slice(0, 5)).map(entry => (
              <div key={entry.id} className="px-6 py-4 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{entry.topic}</span>
                      {entry.confidence && (
                        <span className={cn('text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded', entry.confidence === 'high' ? 'bg-emerald-50 text-emerald-600' : entry.confidence === 'medium' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500')}>
                          {entry.confidence}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">{entry.fact}</p>
                    {entry.source && <p className="text-[10px] text-slate-400 mt-1">Source: {entry.source}</p>}
                  </div>
                  {entry.createdAt && (
                    <span className="shrink-0 text-[10px] font-mono text-slate-300">{format(entry.createdAt.toDate(), 'MMM d')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
