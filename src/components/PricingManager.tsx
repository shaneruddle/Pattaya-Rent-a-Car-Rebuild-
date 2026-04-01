import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, logSystemActivity } from '../firebase';
import { PricingRule } from '../types';
import { Save, RefreshCw, Plus, Trash2, Info, FileSpreadsheet, ExternalLink, Database } from 'lucide-react';
import { toast } from 'sonner';

interface SheetConfig {
  spreadsheetId: string;
  enabled: boolean;
}

const DURATION_TIERS = ['1-3', '4-7', '8-14', '15-29', '30+'];

export const PricingManager: React.FC = () => {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [sheetConfig, setSheetConfig] = useState<SheetConfig>({
    spreadsheetId: '1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo',
    enabled: true
  });
  const [sheetData, setSheetData] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'pricing'), (snapshot) => {
      const pricingData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PricingRule));
      setRules(pricingData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'pricing');
      setLoading(false);
    });

    // Load sheet config from settings if it exists
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'pricing'), (snapshot) => {
      if (snapshot.exists()) {
        setSheetConfig(snapshot.data() as SheetConfig);
      }
    });

    fetchSheetData();

    return () => {
      unsubscribe();
      unsubscribeSettings();
    };
  }, []);

  const fetchSheetData = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/pricing/sheet?spreadsheetId=${sheetConfig.spreadsheetId}`);
      if (response.ok) {
        const data = await response.json();
        setSheetData(data);
      } else {
        toast.error('Failed to fetch Google Sheet data');
      }
    } catch (error) {
      console.error('Error fetching sheet data:', error);
      toast.error('Error connecting to pricing API');
    } finally {
      setIsSyncing(false);
    }
  };

  const saveSheetConfig = async () => {
    try {
      await setDoc(doc(db, 'settings', 'pricing'), sheetConfig);
      toast.success('Google Sheet configuration saved');
      fetchSheetData();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'settings/pricing');
    }
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

  const addNewRule = async () => {
    const carType = prompt('Enter Car Type (e.g. Small, Medium, SUV, Luxury):');
    if (!carType) return;

    const newRule = {
      carType,
      rates: DURATION_TIERS.reduce((acc, tier) => ({ ...acc, [tier]: 1200 }), {})
    };

    try {
      const docRef = await addDoc(collection(db, 'pricing'), newRule);
      
      await logSystemActivity(
        'Add Pricing Rule',
        `Added new pricing rule for car type: ${carType}`,
        'Pricing',
        { ruleId: docRef.id, carType }
      );

      toast.success('New pricing category added');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'pricing');
    }
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
              onClick={fetchSheetData}
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
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-white/40 flex items-center justify-center border border-white/60 shadow-sm">
              <FileSpreadsheet className="text-brand-orange" size={24} />
            </div>
            <h2 className="font-serif italic text-3xl text-[#1A1A1A]">Google Sheet Integration</h2>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-2">Spreadsheet ID</label>
                <input
                  type="text"
                  value={sheetConfig.spreadsheetId}
                  onChange={(e) => setSheetConfig(prev => ({ ...prev, spreadsheetId: e.target.value }))}
                  className="w-full bg-white/40 border-b-2 border-white/60 py-3 px-1 font-mono text-sm focus:border-brand-orange outline-none transition-colors text-[#1A1A1A] font-bold"
                  placeholder="e.g. 1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo"
                />
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 pt-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={sheetConfig.enabled}
                      onChange={(e) => setSheetConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                      className="peer sr-only"
                    />
                    <div className="w-10 h-6 bg-white/40 border border-white/60 rounded-full peer-checked:bg-brand-orange transition-all duration-300" />
                    <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 peer-checked:translate-x-4 shadow-sm" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60 group-hover:text-brand-orange transition-colors">Enable Sheet Pricing</span>
                </label>
                <button
                  onClick={saveSheetConfig}
                  className="bg-brand-orange text-white px-6 py-2.5 rounded-full font-bold uppercase tracking-widest text-[10px] hover:opacity-90 transition-all shadow-lg shadow-brand-orange/20"
                >
                  Save Config
                </button>
              </div>
            </div>

            <div className="bg-white/40 backdrop-blur-md p-8 rounded-3xl border border-white/60 border-dashed relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-brand-orange/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
              <h3 className="font-bold uppercase tracking-widest text-[10px] mb-6 flex items-center gap-2 text-[#1A1A1A]/60">
                <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} /> Status: <span className={sheetData ? "text-green-600" : "text-red-600"}>{sheetData ? 'Connected' : 'Not Connected'}</span>
              </h3>
              {sheetData ? (
                <div className="space-y-4 relative z-10">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Tabs Found</p>
                    <p className="text-sm font-bold text-[#1A1A1A]">{Object.keys(sheetData).join(', ')}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Sync Status</p>
                    <p className="text-sm font-bold text-[#1A1A1A]">All car types synchronized</p>
                  </div>
                  <a 
                    href={`https://docs.google.com/spreadsheets/d/${sheetConfig.spreadsheetId}/edit`}
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

        <div className="bg-white/60 backdrop-blur-xl border border-white/40 rounded-[32px] shadow-xl overflow-hidden mb-12">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-white/40 border-b border-white/60">
                  <th className="p-6 text-left font-serif italic text-2xl text-[#1A1A1A] border-r border-white/20">Car Type</th>
                  {DURATION_TIERS.map(tier => (
                    <th key={tier} className="p-6 text-center font-bold uppercase tracking-widest text-[10px] text-[#1A1A1A]/40 border-r border-white/20">
                      {tier} Days
                    </th>
                  ))}
                  <th className="p-6 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={DURATION_TIERS.length + 2} className="p-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <Database className="text-[#1A1A1A]/10" size={48} />
                        <p className="text-[#1A1A1A]/40 font-bold uppercase tracking-widest text-[10px]">No pricing rules defined. Click "Add Category" to start.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => (
                    <tr key={rule.id} className="border-b border-white/20 hover:bg-white/40 transition-colors group">
                      <td className="p-6 border-r border-white/20">
                        <input
                          type="text"
                          value={rule.carType}
                          onChange={(e) => {
                            const newType = e.target.value;
                            setRules(prev => prev.map(r => r.id === rule.id ? { ...r, carType: newType } : r));
                          }}
                          className="bg-transparent border-none focus:ring-0 w-full font-bold text-[#1A1A1A] text-lg tracking-tight outline-none"
                        />
                      </td>
                      {DURATION_TIERS.map(tier => (
                        <td key={tier} className="p-6 border-r border-white/20">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[8px] font-bold uppercase tracking-widest text-brand-orange/60">THB / Day</span>
                            <input
                              type="number"
                              value={rule.rates[tier] || 0}
                              onChange={(e) => handleRateChange(rule.id, tier, e.target.value)}
                              className="w-24 bg-white/40 border-b border-white/60 text-center focus:border-brand-orange outline-none font-bold text-sm text-[#1A1A1A] py-1 rounded-t-lg transition-colors"
                            />
                          </div>
                        </td>
                      ))}
                      <td className="p-6 text-center">
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-[#1A1A1A]/20 hover:text-red-600 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-8 bg-white/60 backdrop-blur-xl border border-white/40 rounded-[32px] flex flex-col md:flex-row gap-8 items-start shadow-xl">
          <div className="w-12 h-12 bg-brand-orange text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-brand-orange/20">
            <Info size={24} />
          </div>
          <div className="space-y-4">
            <h3 className="font-serif italic text-2xl text-[#1A1A1A]">How it works</h3>
            <div className="space-y-4 text-sm text-[#1A1A1A]/60 leading-relaxed font-medium">
              <p>
                The booking engine will automatically look up the daily rate based on the car's type and the total duration of the rental. 
                If a car type is not found in this grid, it will fallback to the default price set on the vehicle profile.
              </p>
              <div className="p-4 bg-brand-orange/5 border-l-4 border-brand-orange rounded-r-2xl">
                <p className="text-[#1A1A1A] font-bold">
                  Important: The "Car Type" in this grid must exactly match the "Type" field on your vehicle profiles (e.g., "Sedan", "SUV", "Small").
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
