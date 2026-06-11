import React, { useState, useEffect } from 'react';
import { collection, getDocs, getDoc, doc, setDoc, deleteDoc, addDoc, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, logSystemActivity, auth } from '../firebase';
import { PricingRule, PricingGrid, WebsiteCar } from '../types';
import { Save, RefreshCw, Plus, Trash2, Info, Database, Calendar, Edit3 } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO, isAfter } from 'date-fns';
import { cn } from '../lib/utils';

const DURATION_TIERS = Array.from({ length: 179 }, (_, i) => (1 + i * 0.5).toString());

export const PricingManager: React.FC = () => {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showNewGridModal, setShowNewGridModal] = useState(false);
  const [newCarType, setNewCarType] = useState('');
  const [customCarType, setCustomCarType] = useState('');
  const [modalMode, setModalMode] = useState<'grid' | 'category'>('grid');
  const [fleetCars, setFleetCars] = useState<WebsiteCar[]>([]);
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
      if (!auth.currentUser) return;
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

        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'pricing_data');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

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

    if (modalMode === 'category') {
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

        {showNewGridModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl border border-white/20">
              <h3 className="font-serif italic text-3xl text-[#1A1A1A] mb-2">
                Add Pricing Category
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-8">
                Enter the car type to add to categories
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
      </div>
    </div>
  );
};
