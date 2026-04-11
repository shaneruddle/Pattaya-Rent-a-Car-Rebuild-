import React, { useState } from 'react';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { initializeFirestore, collection, getDocs, doc, setDoc, writeBatch, query, limit, getDocsFromServer, getFirestore } from 'firebase/firestore';
import { db as newDb, auth } from '../firebase';
import { signInWithPopup, GoogleAuthProvider, getAuth } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { Database, ArrowRight, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

// Old project configuration
const oldConfig = {
  apiKey: "AIzaSyBT6SmEop0pPT200FzG6RjKCh7tZRwtnCQ",
  authDomain: "gen-lang-client-0665145746.firebaseapp.com",
  projectId: "gen-lang-client-0665145746",
  storageBucket: "gen-lang-client-0665145746.firebasestorage.app",
  messagingSenderId: "1006739531410",
  appId: "1:1006739531410:web:88ad1f95c0933ceec6a84b",
  databaseId: "ai-studio-59a5488f-bdb0-4f82-91c1-26c5dc2e731d"
};

const COLLECTIONS = [
  'cars',
  'website_cars',
  'bookings',
  'customers',
  'rentals',
  'transactions',
  'accounts',
  'pricing',
  'pricing_grid',
  'enquiries',
  'users',
  'vehicle_logs',
  'system_logs',
  'system_config',
  'ai_knowledge_base',
  'faqs',
  'blog_posts',
  'reviews',
  'review_settings',
  'mail'
];

interface MigrationToolProps {
  onComplete?: () => void;
}

export const MigrationTool: React.FC<MigrationToolProps> = ({ onComplete }) => {
  const [status, setStatus] = useState<'idle' | 'migrating' | 'completed' | 'error'>('idle');
  const [isConfirming, setIsConfirming] = useState(false);
  const [sourceConfig, setSourceConfig] = useState(oldConfig);
  const [showConfig, setShowConfig] = useState(false);
  const [progress, setProgress] = useState<{ current: string; done: string[]; total: number }>({
    current: '',
    done: [],
    total: COLLECTIONS.length
  });
  const [logs, setLogs] = useState<string[]>([]);
  const logContainerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-200));
  };

  const verifyConnections = async () => {
    addLog('Verifying connections...');
    if (!auth.currentUser) {
      addLog('❌ ERROR: You must be logged in to verify connections.');
      toast.error('Please log in first.');
      return;
    }
    
    addLog(`Logged in as: ${auth.currentUser.email}`);

    try {
      // 1. Check Destination (New Project)
      const destProjectId = (newDb as any)._app?.options?.projectId || 'unknown';
      const destDbId = (newDb as any).databaseId || '(default)';
      addLog(`Destination Project: ${destProjectId} [DB: ${destDbId}]`);
      
      // Test write to destination
      const testCol = collection(newDb, 'migration_test');
      const testDoc = doc(testCol, 'connection_test');
      await setDoc(testDoc, { 
        timestamp: new Date().toISOString(),
        tester: 'MigrationTool',
        user: auth.currentUser.email
      });
      addLog('✅ Destination write test successful.');

      // 2. Check Source (Old Project)
      let oldApp;
      const appName = `source_${sourceConfig.projectId}`;
      if (getApps().find(app => app.name === appName)) {
        oldApp = getApp(appName);
      } else {
        oldApp = initializeApp(sourceConfig, appName);
      }
      
      const oldDb = getFirestore(oldApp, sourceConfig.databaseId || '(default)');

      addLog(`Source Project: ${sourceConfig.projectId} [DB: ${sourceConfig.databaseId || '(default)'}]`);
      
      // Try to read from multiple common collections to find data
      const collectionsToTest = ['cars', 'bookings', 'customers', 'website_cars'];
      let foundAny = false;
      
      for (const colName of collectionsToTest) {
        addLog(`Testing read from source collection: ${colName}...`);
        try {
          const colRef = collection(oldDb, colName);
          const snap = await getDocsFromServer(query(colRef, limit(1)));
          if (snap.size > 0) {
            addLog(`✅ SUCCESS: Found data in "${colName}"!`);
            foundAny = true;
          } else {
            addLog(`ℹ️ Collection "${colName}" is empty.`);
          }
        } catch (e: any) {
          addLog(`❌ Error reading "${colName}": ${e.message}`);
        }
      }

      if (foundAny) {
        addLog('✅ Source connection verified with data found!');
        toast.success('Source verified! Data found.');
      } else {
        addLog('⚠️ WARNING: Connected to source, but NO DATA found in common collections.');
        addLog('Please verify the Project ID and Database ID in your old project settings.');
        toast.warning('Connected, but no data found.');
      }
    } catch (err: any) {
      console.error('Verification failed:', err);
      addLog(`❌ ERROR: ${err.message}`);
      if (err.message.includes('permission')) {
        addLog('💡 TIP: Try clicking "Login to Source" to authenticate with the old project.');
      }
      toast.error(`Verification failed: ${err.message}`);
    }
  };

  const loginToSource = async () => {
    addLog('Attempting to login to source project...');
    try {
      let oldApp;
      const appName = `source_${sourceConfig.projectId}`;
      if (getApps().find(app => app.name === appName)) {
        oldApp = getApp(appName);
      } else {
        oldApp = initializeApp(sourceConfig, appName);
      }
      const oldAuth = getAuth(oldApp);
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(oldAuth, provider);
      addLog(`✅ Logged into source as: ${result.user.email}`);
      toast.success('Logged into source project!');
    } catch (err: any) {
      addLog(`❌ Source login failed: ${err.message}`);
      toast.error(`Login failed: ${err.message}`);
    }
  };

  const startMigration = async () => {
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    setStatus('migrating');
    setIsConfirming(false);
    setLogs([]);
    addLog('Starting migration process...');

    try {
      const destProjectId = (newDb as any)._app?.options?.projectId || 'unknown';
      addLog(`Source Project: ${sourceConfig.projectId}`);
      addLog(`Destination Project: ${destProjectId}`);

      if (sourceConfig.projectId === destProjectId) {
        throw new Error('Source and Destination projects are the same. Migration aborted to prevent data loops.');
      }
      
      // Initialize old app if not already initialized
      let oldApp;
      const appName = `source_${sourceConfig.projectId}`;
      if (getApps().find(app => app.name === appName)) {
        oldApp = getApp(appName);
      } else {
        oldApp = initializeApp(sourceConfig, appName);
      }
      const oldDb = getFirestore(oldApp, sourceConfig.databaseId || '(default)');

      let totalDocsMigrated = 0;

      for (const collectionName of COLLECTIONS) {
        setProgress(prev => ({ ...prev, current: collectionName }));
        addLog(`Checking collection: ${collectionName}...`);

        const sourceCol = collection(oldDb, collectionName);
        let snapshot;
        try {
          // Use getDocsFromServer to bypass cache and ensure fresh data
          snapshot = await getDocsFromServer(sourceCol);
        } catch (err: any) {
          addLog(`ERROR reading ${collectionName}: ${err.message}`);
          continue;
        }
        
        if (snapshot.empty) {
          addLog(`Collection ${collectionName} is empty in source.`);
          setProgress(prev => ({ ...prev, done: [...prev.done, collectionName] }));
          continue;
        }

        const docCount = snapshot.docs.length;
        addLog(`Found ${docCount} documents in ${collectionName}. Starting transfer...`);

        // Use batches for efficiency (Firestore limit is 500 per batch)
        let count = 0;
        let batch = writeBatch(newDb);
        
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const newDocRef = doc(newDb, collectionName, docSnap.id);
          batch.set(newDocRef, data);
          count++;

          if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(newDb);
            addLog(`[${collectionName}] Committed ${count}/${docCount} documents...`);
          }
        }

        await batch.commit();
        totalDocsMigrated += count;
        addLog(`SUCCESS: Migrated ${count} documents for ${collectionName}.`);
        setProgress(prev => ({ ...prev, done: [...prev.done, collectionName] }));
      }

      setStatus('completed');
      addLog(`Migration finished! Total documents migrated: ${totalDocsMigrated}`);
      if (totalDocsMigrated === 0) {
        addLog('WARNING: No documents were found in the source project. Please verify the source project ID.');
      }
      toast.success(`Migration complete! ${totalDocsMigrated} documents moved.`);
      if (onComplete) onComplete();
    } catch (error: any) {
      console.error('Migration failed:', error);
      setStatus('error');
      addLog(`ERROR: ${error.message}`);
      toast.error(`Migration failed: ${error.message}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-warm-bg overflow-hidden">
      <header className="h-24 bg-white/40 backdrop-blur-xl border-b border-white/60 flex items-center justify-between px-12 shrink-0 z-10">
        <div>
          <h1 className="font-serif italic text-3xl text-[#1A1A1A]">Database Migration</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-1">
            Transfer data from Sandbox to Personal Project
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Info Card */}
          <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-8 shadow-sm">
            <div className="flex items-start gap-6">
              <div className="w-16 h-16 bg-brand-orange/10 rounded-2xl flex items-center justify-center text-brand-orange shrink-0">
                <Database size={32} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-serif italic text-black">Data Migration Tool</h3>
                  <button 
                    onClick={() => setShowConfig(!showConfig)}
                    className="text-[10px] font-bold uppercase tracking-widest text-brand-orange hover:underline"
                  >
                    {showConfig ? 'Hide Config' : 'Edit Source Config'}
                  </button>
                </div>
                <p className="text-sm text-black/60 leading-relaxed mb-6">
                  This tool will copy all your existing data from the previous "Sandbox" project to your new personal project. 
                </p>

                <AnimatePresence>
                  {showConfig && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden mb-6"
                    >
                      <div className="p-6 bg-black/5 rounded-2xl border border-black/10 space-y-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">Source Project Configuration</p>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[8px] font-bold uppercase tracking-widest text-black/30 block mb-1">Project ID</label>
                            <input 
                              type="text" 
                              value={sourceConfig.projectId}
                              onChange={(e) => setSourceConfig({...sourceConfig, projectId: e.target.value})}
                              className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-[8px] font-bold uppercase tracking-widest text-black/30 block mb-1">API Key</label>
                            <input 
                              type="text" 
                              value={sourceConfig.apiKey}
                              onChange={(e) => setSourceConfig({...sourceConfig, apiKey: e.target.value})}
                              className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs font-mono"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[8px] font-bold uppercase tracking-widest text-black/30 block mb-1">Auth Domain</label>
                            <input 
                              type="text" 
                              value={sourceConfig.authDomain}
                              onChange={(e) => setSourceConfig({...sourceConfig, authDomain: e.target.value})}
                              className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-[8px] font-bold uppercase tracking-widest text-black/30 block mb-1">Database ID</label>
                            <input 
                              type="text" 
                              value={sourceConfig.databaseId}
                              onChange={(e) => setSourceConfig({...sourceConfig, databaseId: e.target.value})}
                              placeholder="(default)"
                              className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs font-mono"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <button 
                            onClick={loginToSource}
                            className="py-3 bg-brand-orange/10 text-brand-orange border border-brand-orange/20 rounded-xl font-bold uppercase tracking-widest text-[9px] hover:bg-brand-orange/20 transition-all"
                          >
                            Login to Source
                          </button>
                          <button 
                            onClick={verifyConnections}
                            className="py-3 bg-black text-white rounded-xl font-bold uppercase tracking-widest text-[9px] hover:bg-black/80 transition-all"
                          >
                            Verify Connections
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                <div className="flex items-center gap-8 p-6 bg-black/5 rounded-2xl border border-black/5">
                  <div className="flex-1">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-black/30 mb-1">Source Project</p>
                    <p className="text-xs font-bold text-black/60 truncate">
                      {sourceConfig.projectId}
                      <span className="ml-1 opacity-40">[{sourceConfig.databaseId || '(default)'}]</span>
                    </p>
                  </div>
                  <ArrowRight className="text-black/20" size={20} />
                  <div className="flex-1">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-black/30 mb-1">Destination Project</p>
                    <p className="text-xs font-bold text-brand-orange truncate">
                      {(newDb as any)._app?.options?.projectId || 'pattaya-rent-a-car-rebuild'}
                      <span className="ml-1 opacity-40">[(default)]</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Progress Section */}
          <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-[32px] p-8 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <h4 className="text-sm font-bold uppercase tracking-widest text-black/40">Migration Progress</h4>
              {status === 'migrating' && (
                <div className="flex items-center gap-2 text-brand-orange">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Processing...</span>
                </div>
              )}
              {status === 'completed' && (
                <div className="flex items-center gap-2 text-green-500">
                  <CheckCircle2 size={16} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Completed</span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="h-3 bg-black/5 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-brand-orange"
                  initial={{ width: 0 }}
                  animate={{ width: `${(progress.done.length / progress.total) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-black/40">
                <span>{progress.done.length} of {progress.total} collections migrated</span>
                <span>{Math.round((progress.done.length / progress.total) * 100)}%</span>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {COLLECTIONS.map(col => (
                <div 
                  key={col}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest border transition-all flex items-center justify-between",
                    progress.done.includes(col) 
                      ? "bg-green-500/10 border-green-500/20 text-green-600" 
                      : progress.current === col
                        ? "bg-brand-orange/10 border-brand-orange/20 text-brand-orange animate-pulse"
                        : "bg-black/5 border-black/5 text-black/20"
                  )}
                >
                  {col}
                  {progress.done.includes(col) && <CheckCircle2 size={10} />}
                </div>
              ))}
            </div>
          </div>

          {/* Logs */}
          <div 
            ref={logContainerRef}
            className="bg-black/90 rounded-[32px] p-8 shadow-2xl font-mono text-[10px] text-green-400/80 h-80 overflow-y-auto custom-scrollbar relative"
          >
            <div className="sticky top-0 bg-black/90 flex items-center justify-between mb-4 border-b border-green-400/20 pb-2 z-10">
              <span className="uppercase tracking-widest font-bold">Migration Logs</span>
              <button 
                onClick={() => setLogs([])}
                className="text-green-400/40 hover:text-green-400 transition-colors"
              >
                Clear
              </button>
            </div>
            {logs.length === 0 && <p className="text-green-400/20 italic">Waiting to start...</p>}
            {logs.map((log, i) => (
              <p key={i} className="mb-1 leading-relaxed break-all">{log}</p>
            ))}
          </div>

          {/* Action Button */}
          <div className="flex flex-col items-center gap-4 pt-4">
            <button
              onClick={startMigration}
              disabled={status === 'migrating'}
              className={cn(
                "h-16 px-12 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-3 transition-all shadow-xl",
                status === 'migrating' 
                  ? "bg-black/5 text-black/20 cursor-not-allowed"
                  : status === 'completed'
                    ? "bg-green-500 text-white hover:bg-green-600 shadow-green-500/20"
                    : "bg-brand-orange text-white hover:bg-brand-orange/90 shadow-brand-orange/20"
              )}
            >
              {status === 'migrating' ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Migrating Data...
                </>
              ) : status === 'completed' ? (
                <>
                  <CheckCircle2 size={18} />
                  Migration Successful
                </>
              ) : isConfirming ? (
                <>
                  <AlertCircle size={18} />
                  Click Again to Confirm
                </>
              ) : (
                <>
                  <Database size={18} />
                  Start Full Migration
                </>
              )}
            </button>
            
            {status === 'completed' && (
              <button 
                onClick={() => onComplete?.()}
                className="text-[10px] font-bold uppercase tracking-widest text-brand-orange hover:underline flex items-center gap-2"
              >
                <RefreshCw size={12} />
                Refresh App Data Now
              </button>
            )}

            {isConfirming && (
              <button 
                onClick={() => setIsConfirming(false)}
                className="h-16 px-6 rounded-2xl font-bold uppercase tracking-widest text-[10px] text-black/40 hover:text-black/60 transition-all"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
