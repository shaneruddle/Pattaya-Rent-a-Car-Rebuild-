import React, { useState, useEffect } from 'react';
import { collection, getDocs, getDoc, doc, setDoc, deleteDoc, addDoc, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, logSystemActivity } from '../firebase';
import { PricingRule, PricingGrid, WebsiteCar } from '../types';
import { Save, RefreshCw, Plus, Trash2, Info, FileSpreadsheet, ExternalLink, Database, CloudDownload, Calendar, Check, Edit3 } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO, isAfter } from 'date-fns';
import { cn } from '../lib/utils';

import { usePricing } from '../contexts/PricingContext';
import { PricingGridEditor } from './PricingGridEditor';

interface PricingSettings {
  spreadsheetId: string;
  useSheetDirectly: boolean;
  lastSync?: string;
}

const DURATION_TIERS = Array.from({ length: 179 }, (_, i) => (1 + i * 0.5).toString());

export const PricingManager: React.FC = () => {
  const { sheetPricing, loading: pricingLoading, refreshPricing } = usePricing();
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [grids, setGrids] = useState<PricingGrid[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<PricingSettings>({
    spreadsheetId: '1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo',
    useSheetDirectly: false
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportingToDb, setIsImportingToDb] = useState(false);
  const [editingGridCarType, setEditingGridCarType] = useState<string | null>(null);
  const [showNewGridModal, setShowNewGridModal] = useState(false);
  const [newCarType, setNewCarType] = useState('');
  const [customCarType, setCustomCarType] = useState('');
  const [modalMode, setModalMode] = useState<'grid' | 'category'>('grid');
  const [fleetCars, setFleetCars] = useState<WebsiteCar[]>([]);
  const [deletingGridId, setDeletingGridId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ ruleId: string, tier: string, value: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ ruleId: string, tier: string } | null>(null);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (dragStart && dragEnd) {
        const startTierIdx = DURATION_TIERS.indexOf(dragStart.tier);
        const endTierIdx = DURATION_TIERS.indexOf(dragEnd.tier);
        
        const minTierIdx = Math.min(startTierIdx, endTierIdx);
        const maxTierIdx = Math.max(startTierIdx, endTierIdx);
        
        const targetTiers = DURATION_TIERS.slice(minTierIdx, maxTierIdx + 1);
        
        const ruleIds = rules.map(r => r.id);
        const startRuleIdx = ruleIds.indexOf(dragStart.ruleId);
        const endRuleIdx = ruleIds.indexOf(dragEnd.ruleId);
        
        const minRuleIdx = Math.min(startRuleIdx, endRuleIdx);
        const maxRuleIdx = Math.max(startRuleIdx, endRuleIdx);
        
        const targetRuleIds = ruleIds.slice(minRuleIdx, maxRuleIdx + 1);
        
        setRules(prev => prev.map(rule => {
          if (targetRuleIds.includes(rule.id)) {
            const newRates = { ...rule.rates };
            targetTiers.forEach(tier => {
              newRates[tier] = dragStart.value;
            });
            return { ...rule, rates: newRates };
          }
          return rule;
        }));
      }
      setDragStart(null);
      setDragEnd(null);
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [dragStart, dragEnd, rules]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch Fleet
        const qFleet = query(collection(db, 'website_cars'), orderBy('name', 'asc'));
        const fleetSnapshot = await getDocs(qFleet);
        const fleetData = fleetSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WebsiteCar));
        setFleetCars(fleetData);

        // Fetch Rules
        const rulesSnapshot = await getDocs(collection(db, 'pricing'));
        const pricingData = rulesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PricingRule));
        setRules(pricingData);

        // Fetch Grids
        const gridsSnapshot = await getDocs(collection(db, 'pricing_grid'));
        const gridData = gridsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PricingGrid));
        setGrids(gridData);
        setLoading(false);

        // Fetch Settings
        const settingsDoc = await getDoc(doc(db, 'settings', 'pricing'));
        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data() as PricingSettings);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'pricing_data');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    await refreshPricing();
    setIsSyncing(false);
  };

  const importSheetToFirestore = async () => {
    if (!sheetPricing) {
      toast.error('No sheet data found. Please sync with Google Sheets first.');
      return;
    }

    setIsImportingToDb(true);
    try {
      const carTypes = Object.keys(sheetPricing);
      for (const carType of carTypes) {
        const data = sheetPricing[carType];
        await setDoc(doc(db, 'pricing_grid', carType), {
          carType,
          headers: data.headers || [],
          rates: data.data || {},
          updatedAt: new Date().toISOString()
        });
      }

      await setDoc(doc(db, 'settings', 'pricing'), {
        ...settings,
        lastSync: new Date().toISOString()
      }, { merge: true });

      await logSystemActivity(
        'Sync Pricing to Database',
        `Imported pricing data for ${carTypes.length} car types from Google Sheets to Firestore.`,
        'Pricing',
        { carTypes }
      );

      toast.success(`Successfully imported ${carTypes.length} car types to the backend database.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'pricing_grid');
    } finally {
      setIsImportingToDb(false);
    }
  };

  const saveSettings = async () => {
    try {
      await setDoc(doc(db, 'settings', 'pricing'), settings);
      toast.success('Pricing settings saved');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'settings/pricing');
    }
  };

  const getLastFilledDate = (grid: PricingGrid) => {
    const dates = Object.keys(grid.rates);
    if (dates.length === 0) return null;
    
    let lastDate: string | null = null;
    dates.forEach(date => {
      const hasRates = grid.rates[date].some(rate => rate > 0);
      if (hasRates) {
        if (!lastDate || isAfter(parseISO(date), parseISO(lastDate))) {
          lastDate = date;
        }
      }
    });
    return lastDate;
  };

  const handleRateChange = (ruleId: string, tier: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setRules(prev => prev.map(rule => {
      if (rule.id === ruleId) {
        return {
          ...rule,
          rates: {
            ...rule.rates,
            [tier]: numValue
          }
        };
      }
      return rule;
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      for (const rule of rules) {
        const { id, ...data } = rule;
        await setDoc(doc(db, 'pricing', id), data);
      }
      toast.success('Pricing rules updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'pricing');
    } finally {
      setIsSaving(false);
    }
  };

  const handleNewItemSubmit = async () => {
    const carTypeToUse = newCarType === 'custom' ? customCarType.trim() : newCarType.trim();

    if (!carTypeToUse) {
      toast.error('Please enter or select a car type');
      return;
    }

    if (modalMode === 'grid') {
      setEditingGridCarType(carTypeToUse);
    } else {
      const newRule = {
        carType: carTypeToUse,
        rates: DURATION_TIERS.reduce((acc, tier) => ({ ...acc, [tier]: 1200 }), {})
      };

      try {
        const docRef = await addDoc(collection(db, 'pricing'), newRule);
        
        await logSystemActivity(
          'Add Pricing Category',
          `Added new pricing category for car type: ${carTypeToUse}`,
          'Pricing',
          { ruleId: docRef.id, carType: carTypeToUse }
        );

        toast.success('New pricing category added');
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'pricing');
      }
    }

    setNewCarType('');
    setCustomCarType('');
    setShowNewGridModal(false);
  };

  const addNewRule = () => {
    setModalMode('category');
    setShowNewGridModal(true);
  };

  const deleteRule = async (id: string) => {
    const rule = rules.find(r => r.id === id);
    try {
      await deleteDoc(doc(db, 'pricing', id));
      
      if (rule) {
        await logSystemActivity(
          'Delete Pricing Rule',
          `Deleted pricing rule for car type: ${rule.carType}`,
          'Pricing',
          { ruleId: id, carType: rule.carType }
        );
      }

      toast.success('Pricing category removed');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `pricing/${id}`);
    }
  };

  const clearAllRules = async () => {
    try {
      for (const rule of rules) {
        await deleteDoc(doc(db, 'pricing', rule.id));
      }

      await logSystemActivity(
        'Clear Pricing Rules',
        'Cleared all pricing rules',
        'Pricing'
      );

      toast.success('All pricing rules cleared');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'pricing');
    }
  };

  const handlePaste = async () => {
    const text = await navigator.clipboard.readText();
    if (!text) {
      toast.error('Clipboard is empty');
      return;
    }

    const rows = text.split('\n').map(row => row.split('\t'));
    if (rows.length < 1) return;

    // Filter out header if it exists
    const dataRows = rows.filter(row => {
      const firstCell = row[0]?.toLowerCase();
      return firstCell && !firstCell.includes('car type') && !firstCell.includes('days');
    });

    if (dataRows.length === 0) {
      toast.error('No valid data found in clipboard. Make sure you copy rows from your spreadsheet.');
      return;
    }

    const newRules: Partial<PricingRule>[] = dataRows.map(row => {
      const carType = row[0]?.trim();
      const rates: Record<string, number> = {};
      
      DURATION_TIERS.forEach((tier, index) => {
        const val = row[index + 1]?.replace(/[^0-9]/g, '');
        rates[tier] = parseInt(val) || 1200;
      });

      return { carType, rates };
    });

    try {
      for (const rule of newRules) {
        await addDoc(collection(db, 'pricing'), rule);
      }
      toast.success(`Imported ${newRules.length} pricing categories`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'pricing');
    }
  };

  const deleteGrid = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'pricing_grid', id));
      
      await logSystemActivity(
        'Delete Pricing Grid',
        `Deleted manual pricing grid for car type: ${id}`,
        'Pricing',
        { gridId: id }
      );

      toast.success('Pricing grid deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `pricing_grid/${id}`);
    } finally {
      setDeletingGridId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-warm-bg">
        <RefreshCw className="animate-spin text-brand-orange" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 bg-warm-bg overflow-y-auto custom-scrollbar">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
          <div>
            <h1 className="font-serif italic text-5xl mb-4 text-[#1A1A1A]">Pricing Grid</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-xs font-medium">Manage daily rates by car type and duration</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="bg-white/40 backdrop-blur-md border border-white/60 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all shadow-sm active:translate-y-[2px]"
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} /> Sync Sheet
            </button>
            <button
              onClick={clearAllRules}
              className="bg-red-50/50 backdrop-blur-md border border-red-100/50 text-red-600 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-red-100/50 transition-all shadow-sm active:translate-y-[2px]"
            >
              <Trash2 size={14} /> Clear All
            </button>
            <button
              onClick={handlePaste}
              className="bg-white/40 backdrop-blur-md border border-white/60 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all shadow-sm active:translate-y-[2px]"
              title="Copy rows from your spreadsheet and click here to import"
            >
              <RefreshCw size={14} /> Paste from Spreadsheet
            </button>
            <button
              onClick={() => {
                setModalMode('grid');
                setShowNewGridModal(true);
              }}
              className="bg-white/40 backdrop-blur-md border border-white/60 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all shadow-sm active:translate-y-[2px]"
            >
              <Plus size={14} /> Create Manual Grid
            </button>
            <button
              onClick={addNewRule}
              className="bg-white/40 backdrop-blur-md border border-white/60 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all shadow-sm active:translate-y-[2px]"
            >
              <Plus size={14} /> Add Category
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-brand-orange text-white px-8 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20 active:translate-y-[2px] disabled:opacity-50"
            >
              {isSaving ? <RefreshCw className="animate-spin" size={14} /> : <Save size={14} />}
              Save Changes
            </button>
          </div>
        </div>

        {/* Google Sheet Configuration */}
        <div className="bg-white/60 backdrop-blur-xl border border-white/40 p-8 rounded-[32px] shadow-xl mb-12">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/40 flex items-center justify-center border border-white/60 shadow-sm">
                <FileSpreadsheet className="text-brand-orange" size={24} />
              </div>
              <div>
                <h2 className="font-serif italic text-3xl text-[#1A1A1A]">Google Sheet Integration</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Sync external data to your internal database</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-1">Pricing Source</span>
                <div className="flex bg-white/40 p-1 rounded-xl border border-white/60">
                  <button 
                    onClick={() => setSettings(prev => ({ ...prev, useSheetDirectly: true }))}
                    className={cn(
                      "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                      settings.useSheetDirectly ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
                    )}
                  >
                    Direct Sheet
                  </button>
                  <button 
                    onClick={() => setSettings(prev => ({ ...prev, useSheetDirectly: false }))}
                    className={cn(
                      "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                      !settings.useSheetDirectly ? "bg-brand-orange text-white shadow-md" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
                    )}
                  >
                    Internal DB
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-2">Spreadsheet ID</label>
                <input
                  type="text"
                  value={settings.spreadsheetId}
                  onChange={(e) => setSettings(prev => ({ ...prev, spreadsheetId: e.target.value }))}
                  className="w-full bg-white/40 border-b-2 border-white/60 py-3 px-1 font-mono text-sm focus:border-brand-orange outline-none transition-colors text-[#1A1A1A] font-bold"
                  placeholder="e.g. 1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo"
                />
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-2">
                <button
                  onClick={saveSettings}
                  className="bg-white/40 backdrop-blur-md border border-white/60 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:bg-white/60 transition-all shadow-sm active:translate-y-[2px]"
                >
                  <Save size={14} /> Save Settings
                </button>
                <button
                  onClick={importSheetToFirestore}
                  disabled={isImportingToDb || !sheetPricing}
                  className="bg-brand-orange text-white px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20 active:translate-y-[2px] disabled:opacity-50"
                >
                  {isImportingToDb ? <RefreshCw className="animate-spin" size={14} /> : <CloudDownload size={14} />}
                  Sync to Database
                </button>
              </div>
              <p className="text-[10px] text-[#1A1A1A]/40 italic">
                * "Sync to Database" takes the current Google Sheet data and saves it permanently to your app's internal Firestore database.
              </p>
            </div>

            <div className="bg-white/40 backdrop-blur-md p-8 rounded-3xl border border-white/60 border-dashed relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-brand-orange/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
              <h3 className="font-bold uppercase tracking-widest text-[10px] mb-6 flex items-center gap-2 text-[#1A1A1A]/60">
                <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} /> Sheet Status: <span className={sheetPricing ? "text-green-600" : "text-red-600"}>{sheetPricing ? 'Connected' : 'Not Connected'}</span>
              </h3>
              {sheetPricing ? (
                <div className="space-y-4 relative z-10">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Tabs Found</p>
                    <p className="text-sm font-bold text-[#1A1A1A]">{Object.keys(sheetPricing).join(', ')}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Last DB Sync</p>
                    <p className="text-sm font-bold text-[#1A1A1A]">{settings.lastSync ? format(new Date(settings.lastSync), 'dd MMM yyyy HH:mm') : 'Never'}</p>
                  </div>
                  <a 
                    href={`https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-brand-orange hover:underline mt-4 bg-white/60 px-4 py-2 rounded-full border border-white/80 shadow-sm"
                  >
                    Open Spreadsheet <ExternalLink size={12} />
                  </a>
                </div>
              ) : (
                <p className="text-sm text-[#1A1A1A]/40 italic font-medium">
                  Configure the Spreadsheet ID to sync your pricing grid.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Internal Database Grid Status */}
        <div className="bg-white/60 backdrop-blur-xl border border-white/40 p-8 rounded-[32px] shadow-xl mb-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-white/40 flex items-center justify-center border border-white/60 shadow-sm">
              <Database className="text-brand-orange" size={24} />
            </div>
            <div>
              <h2 className="font-serif italic text-3xl text-[#1A1A1A]">Internal Pricing Database</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">High-performance date-specific pricing</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {grids.length === 0 ? (
              <div className="col-span-full p-12 text-center bg-white/40 rounded-3xl border border-white/60 border-dashed">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">No date-specific pricing found in database. Use the sync feature above to import from Google Sheets.</p>
              </div>
            ) : (
              grids.map(grid => (
                <div key={grid.id} className="bg-white/40 p-6 rounded-3xl border border-white/60 hover:border-brand-orange transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-serif italic text-xl text-[#1A1A1A] capitalize">{grid.carType}</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setEditingGridCarType(grid.carType)}
                        className="w-8 h-8 rounded-lg bg-brand-orange/10 text-brand-orange flex items-center justify-center hover:bg-brand-orange/20 transition-all"
                        title="Edit Manually"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button 
                        onClick={() => setDeletingGridId(grid.id)}
                        className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 transition-all"
                        title="Delete Grid"
                      >
                        <Trash2 size={16} />
                      </button>
                      <div className="w-8 h-8 rounded-lg bg-green-50 text-green-500 flex items-center justify-center">
                        <Check size={16} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">
                      <span>Dates Stored</span>
                      <span className="text-[#1A1A1A]">{Object.keys(grid.rates).length}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">
                      <span>Tiers</span>
                      <span className="text-[#1A1A1A]">{grid.headers.length}</span>
                    </div>
                    <div className="pt-4 space-y-1">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-brand-orange">
                        <Calendar size={12} />
                        <span>Updated {grid.updatedAt ? format(parseISO(grid.updatedAt), 'dd MMM') : 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60">
                        <Check size={12} className="text-green-500" />
                        <span>Filled up to {(() => {
                          const lastDate = getLastFilledDate(grid);
                          return lastDate ? format(parseISO(lastDate), 'dd MMM yyyy') : 'No data';
                        })()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {editingGridCarType && (
          <PricingGridEditor 
            carType={editingGridCarType} 
            onClose={() => setEditingGridCarType(null)} 
            initialData={grids.find(g => g.carType.toLowerCase() === editingGridCarType.toLowerCase())}
          />
        )}

        {showNewGridModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl border border-white/20">
              <h3 className="font-serif italic text-3xl text-[#1A1A1A] mb-2">
                {modalMode === 'grid' ? 'Create Manual Grid' : 'Add Pricing Category'}
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-8">
                Enter the car type to {modalMode === 'grid' ? 'start manual editing' : 'add to categories'}
              </p>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Car Type</label>
                  <select
                    autoFocus
                    value={newCarType}
                    onChange={(e) => setNewCarType(e.target.value)}
                    className="w-full bg-warm-bg border-b-2 border-[#1A1A1A]/5 py-3 px-1 font-bold text-lg focus:border-brand-orange outline-none transition-colors appearance-none"
                  >
                    <option value="">Select a vehicle...</option>
                    {fleetCars.map(car => (
                      <option key={car.id} value={car.name}>{car.name}</option>
                    ))}
                    <option value="custom">-- Other (Custom Type) --</option>
                  </select>
                  
                  {newCarType === 'custom' && (
                    <input
                      type="text"
                      autoFocus
                      value={customCarType}
                      onChange={(e) => setCustomCarType(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleNewItemSubmit()}
                      className="w-full bg-warm-bg border-b-2 border-[#1A1A1A]/5 py-3 px-1 font-bold text-lg focus:border-brand-orange outline-none transition-colors mt-4"
                      placeholder="Enter custom car type..."
                    />
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowNewGridModal(false);
                      setNewCarType('');
                    }}
                    className="flex-1 bg-[#1A1A1A]/5 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-[#1A1A1A]/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleNewItemSubmit}
                    className="flex-1 bg-brand-orange text-white px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {deletingGridId && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl border border-white/20">
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-6">
                <Trash2 size={32} />
              </div>
              <h3 className="font-serif italic text-3xl text-[#1A1A1A] mb-2">Delete Pricing Grid?</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-8">
                Are you sure you want to delete the pricing grid for <span className="text-red-500">{deletingGridId}</span>? This action cannot be undone.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingGridId(null)}
                  className="flex-1 bg-[#1A1A1A]/5 px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-[#1A1A1A]/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteGrid(deletingGridId)}
                  className="flex-1 bg-red-500 text-white px-6 py-3 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
