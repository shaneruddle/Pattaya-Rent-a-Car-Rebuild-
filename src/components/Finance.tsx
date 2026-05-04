import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, query, orderBy, addDoc, updateDoc, setDoc,
  deleteDoc, writeBatch, getDocs, getDoc, doc, onSnapshot,
  onAuthStateChanged, Timestamp, where, limit,
  safeGetDocs, db, handleFirestoreError, OperationType, logSystemActivity, auth 
} from '../firebase';
import { Transaction, Account, Car, Booking } from '../types';
import { format, startOfDay, endOfDay, isSameDay, parseISO, isWithinInterval, parse } from 'date-fns';
import * as Papa from 'papaparse';
import Select, { components, SingleValueProps, OptionProps } from 'react-select';
import { 
  Plus, 
  ArrowUpRight, 
  ArrowDownRight, 
  ArrowRightLeft, 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  LayoutDashboard,
  Search,
  Calendar as CalendarIcon,
  Filter,
  Car as CarIcon,
  MoreVertical,
  Trash2,
  Edit2,
  X,
  ShieldCheck,
  Download,
  Upload,
  Lock,
  Loader2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { safeLocalStorage } from '../lib/storage';

interface FinanceProps {
  cars: Car[];
  bookings: Booking[];
  preFill?: {
    type: 'Income' | 'Expense';
    amount: number;
    carId?: string;
    bookingId?: string;
    description?: string;
    category?: string;
  } | null;
  onClearPreFill?: () => void;
}

const txDataToId = (date: string, amount: number, description: string, account: string) => {
  const str = `${date || ''}_${amount}_${description || ''}_${account || ''}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `import_${Math.abs(hash).toString(36)}`;
};

const parseCSVDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  
  // Clean: Remove quotes and commas
  const cleaned = dateStr.replace(/["']/g, '').replace(/,/g, '').trim();
  
  const monthMap: { [key: string]: number } = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
  };

  // Format: "Jun 30 2021 00:00" or "30 Jun 2021"
  if (cleaned.match(/^[a-zA-Z]{3}/i) || cleaned.match(/^\d{1,2}\s+[a-zA-Z]{3}/i)) {
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 3) {
      let monthName, day, yearStr;
      
      if (cleaned.match(/^[a-zA-Z]{3}/i)) {
        // Month first: "Jun 30 2021"
        monthName = (parts[0] || '').toLowerCase().substring(0, 3);
        day = parseInt(parts[1]);
        yearStr = parts[2];
      } else {
        // Day first: "30 Jun 2021"
        day = parseInt(parts[0]);
        monthName = (parts[1] || '').toLowerCase().substring(0, 3);
        yearStr = parts[2];
      }
      
      let year = parseInt(yearStr);
      const monthIndex = monthMap[monthName];
      
      if (monthIndex !== undefined && !isNaN(day) && !isNaN(year)) {
        if (year < 100) year += 2000;
        
        let hours = 0, minutes = 0;
        let timePart = parts.find(p => p.includes(':'));
        if (timePart) {
          const timeParts = timePart.split(':');
          hours = parseInt(timeParts[0]);
          minutes = parseInt(timeParts[1]);
        }
        
        const d = new Date(year, monthIndex, day, hours, minutes);
        return isNaN(d.getTime()) ? null : d;
      }
    }
  } 
  
  // Format: "27/04/26 13:41" or "27/04/2026 13:41"
  if (cleaned.includes('/')) {
    const parts = cleaned.split(/\s+/);
    const dateComp = parts[0].split('/');
    if (dateComp.length === 3) {
      const day = parseInt(dateComp[0]);
      const month = parseInt(dateComp[1]) - 1;
      let year = parseInt(dateComp[2]);
      
      // If YY is used, decide century (standard rule: 00-69 -> 2000s, 70-99 -> 1900s)
      // The user is in 2026, and importing data likely from 2021-2026.
      if (year < 100) {
        year += (year < 70 ? 2000 : 1900);
      }
      
      let hours = 0, minutes = 0;
      if (parts[1] && parts[1].includes(':')) {
        const timeComp = parts[1].split(':');
        hours = parseInt(timeComp[0]);
        minutes = parseInt(timeComp[1]);
      }
      const d = new Date(year, month, day, hours, minutes);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // Fallback to native parsing only if explicit formats fail
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

const getBrandSlug = (name: string) => {
  const n = (name || '').toLowerCase();
  if (n.includes('toyota')) return 'toyota';
  if (n.includes('honda')) return 'honda';
  if (n.includes('ford')) return 'ford';
  if (n.includes('nissan')) return 'nissan';
  if (n.includes('mg')) return 'mg';
  return null;
};

const cleanCarName = (car: Car) => {
  const name = car.make && car.model ? `${car.make} ${car.model}` : car.name;
  return name?.replace(/Toyota|Honda|Ford|MG|Nissan/gi, '')?.trim() || '';
};

const normalizeDescription = (text: string) => {
  if (!text) return '';
  return text.toLowerCase().replace(/(^\w|\s\w)/g, m => m.toUpperCase());
};

const TransactionRow: React.FC<{
  tx: Transaction;
  accounts: Account[];
  cars: Car[];
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}> = React.memo(({ tx, accounts, cars, onEdit, onDelete }) => {
  const brandSlug = tx.carId ? getBrandSlug(cars.find(c => c.id === tx.carId)?.name || '') : null;
  const car = tx.carId ? cars.find(c => c.id === tx.carId) : null;
  const fromAccount = accounts.find(a => a.id === tx.accountId);
  const toAccount = tx.toAccountId ? accounts.find(a => a.id === tx.toAccountId) : null;

  return (
    <tr className="hover:bg-slate-50/80 transition-colors group border-b border-white/10 last:border-0">
      <td className="p-6 text-xs font-bold text-[#141414]/80">
        {format(parseISO(tx.date), 'MMM d, yyyy HH:mm')}
      </td>
      <td className="p-6">
        <span className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-widest border",
          tx.type === 'Income' ? "bg-green-50 text-green-600 border-green-100" : 
          tx.type === 'Expense' ? "bg-red-50 text-red-600 border-red-100" :
          "bg-white/60 text-[#141414] border-white/80"
        )}>
          {tx.type === 'Income' && <ArrowUpRight size={10} />}
          {tx.type === 'Expense' && <ArrowDownRight size={10} />}
          {tx.type === 'Transfer' && <ArrowRightLeft size={10} />}
          {tx.type}
        </span>
      </td>
      <td className="p-6 text-xs font-bold uppercase tracking-widest text-[#141414]/60">
        <div className="flex flex-col gap-1.5">
          {tx.category}
          {car && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-orange/5 text-[#141414] rounded-lg border border-brand-orange/10 w-fit">
              {brandSlug ? (
                <img 
                  src={`https://cdn.simpleicons.org/${brandSlug}`}
                  alt={brandSlug}
                  className="w-3 h-3 shrink-0"
                  width={12}
                  height={12}
                  loading="lazy"
                />
              ) : (
                <CarIcon size={10} className="text-brand-orange" />
              )}
              <span className="text-[9px] font-bold">
                {car.name.replace(/Toyota|Honda|Ford|MG|Nissan/gi, '').trim()} <span className="text-[#141414]/40 font-mono">({car.plateNumber})</span>
              </span>
            </div>
          )}
        </div>
      </td>
      <td className="p-6 text-xs font-bold text-[#141414]/80">
        <div className="flex flex-col gap-1">
          {fromAccount?.name}
          {tx.type === 'Transfer' && toAccount && (
            <div className="flex items-center gap-2 text-[#141414]/40">
              <ArrowRightLeft size={10} /> {toAccount.name}
            </div>
          )}
        </div>
      </td>
      <td className="p-6 text-[12px] text-slate-800 font-sans font-medium tracking-tight leading-relaxed max-w-xs">
        {normalizeDescription(tx.description)}
      </td>
      <td className={cn(
        "p-6 text-right font-bold text-base",
        tx.type === 'Income' ? "text-green-600" : 
        tx.type === 'Expense' ? "text-red-600" :
        "text-[#141414]"
      )}>
        {tx.type === 'Expense' ? '-' : tx.type === 'Income' ? '+' : ''}
        ฿{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </td>
      <td className="p-6 text-right">
        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onEdit(tx)}
            className="p-2 hover:bg-brand-orange hover:text-white rounded-lg transition-all text-[#141414]/40"
          >
            <Edit2 size={14} />
          </button>
          <button 
            onClick={() => onDelete(tx)}
            className="p-2 hover:bg-red-500 hover:text-white rounded-lg transition-all text-[#141414]/40"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
});

export const Finance: React.FC<FinanceProps> = ({ cars = [], bookings = [], preFill, onClearPreFill }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showSummaryReport, setShowSummaryReport] = useState(false);
  const [showDepositsModal, setShowDepositsModal] = useState(false);
  const [modalType, setModalType] = useState<'Income' | 'Expense' | 'Transfer' | 'AccountEdit' | 'TransactionEdit'>('Income');
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [localSearchTerm, setLocalSearchTerm] = useState('');
  const [displayLimit, setDisplayLimit] = useState(50);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(localSearchTerm);
      setDisplayLimit(50); // Reset limit on search
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearchTerm]);

  const [filterCategory, setFilterCategory] = useState('All');
  const [filterCarId, setFilterCarId] = useState('All');
  const [filterYear, setFilterYear] = useState('All');
  const [filterMonth, setFilterMonth] = useState('All');
  const [successAction, setSuccessAction] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [importProgress, setImportProgress] = useState<{
    total: number;
    current: number;
    status: string;
  } | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    amount: 0,
    date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    category: '',
    carId: '',
    bookingId: '',
    accountId: '',
    toAccountId: '',
    description: ''
  });

  const carOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...cars.map(car => ({
      value: car.id,
      label: `${car.name} (${car.plateNumber})`,
      car: car
    }))
  ], [cars]);

  const CustomOption = (props: OptionProps<any>) => {
    const car = props.data.car as Car;
    if (!car) return <components.Option {...props}>{props.children}</components.Option>;

    const brandSlug = getBrandSlug(car.name || '');
    const displayName = cleanCarName(car);
    const year = car.yearOfManufacture?.toString()?.slice(-4) || '';
    const engine = car.engineSize?.toString()?.replace(/cc/gi, '') || '';

    return (
      <components.Option {...props}>
        <div className="flex items-center gap-2 w-full">
          {brandSlug ? (
            <img 
              src={`https://cdn.simpleicons.org/${brandSlug}`}
              alt={brandSlug}
              className="w-4 h-4 shrink-0"
              width={16}
              height={16}
              loading="lazy"
            />
          ) : (
            <div className="w-4 h-4" />
          )}
          <div className="flex-1 flex items-center justify-between min-w-0">
            <span className="text-[11px] font-bold text-gray-900 truncate">
              {displayName} {year} {engine && `· ${engine}`}
            </span>
            <span className="text-xs text-gray-500 font-mono ml-auto shrink-0">
              {car.plateNumber}
            </span>
          </div>
        </div>
      </components.Option>
    );
  };

  const CustomSingleValue = (props: SingleValueProps<any>) => {
    const car = props.data.car as Car;
    if (!car) return <components.SingleValue {...props}>{props.children}</components.SingleValue>;

    const brandSlug = getBrandSlug(car.name || '');
    const displayName = cleanCarName(car);
    const year = car.yearOfManufacture?.toString()?.slice(-4) || '';
    const engine = car.engineSize?.toString()?.replace(/cc/gi, '') || '';

    return (
      <components.SingleValue {...props}>
        <div className="flex items-center gap-2">
          {brandSlug && (
            <img 
              src={`https://cdn.simpleicons.org/${brandSlug}`}
              alt={brandSlug}
              className="w-4 h-4 shrink-0"
              width={16}
              height={16}
              loading="lazy"
            />
          )}
          <span className="text-sm">
            {displayName} {year} {engine && `· ${engine}`} <span className="text-xs text-gray-400">({car.plateNumber})</span>
          </span>
        </div>
      </components.SingleValue>
    );
  };

  const vehicleFilterOptions = useMemo(() => [
    { value: 'All', label: 'All Vehicles' },
    ...cars.map(car => ({
      value: car.id,
      label: `${car.name} (${car.plateNumber})`,
      car: car
    }))
  ], [cars]);

  const filteredTransactions = useMemo(() => {
    let result = transactions;

    // Filter by Category
    if (filterCategory !== 'All') {
      result = result.filter(tx => tx.category === filterCategory);
    }

    // Filter by Vehicle
    if (filterCarId !== 'All') {
      result = result.filter(tx => tx.carId === filterCarId);
    }

    // Filter by Year
    if (filterYear !== 'All') {
      result = result.filter(tx => format(parseISO(tx.date), 'yyyy') === filterYear);
    }

    // Filter by Month
    if (filterMonth !== 'All') {
      result = result.filter(tx => format(parseISO(tx.date), 'MM') === filterMonth);
    }

    // Filter by Search Term
    if (searchTerm) {
      const lowerSearch = (searchTerm || '').toLowerCase();
      result = result.filter(tx => {
        const categoryMatch = (tx.category || '').toLowerCase().includes(lowerSearch);
        const descriptionMatch = tx.description?.toLowerCase().includes(lowerSearch) ?? false;
        const typeMatch = (tx.type || '').toLowerCase().includes(lowerSearch);
        const accountName = (accounts.find(a => a.id === tx.accountId)?.name || '').toLowerCase();
        const accountMatch = accountName.includes(lowerSearch);
        const carName = tx.carId ? (cars.find(c => c.id === tx.carId)?.name || '').toLowerCase() : '';
        const carMatch = carName.includes(lowerSearch);
        
        return categoryMatch || descriptionMatch || typeMatch || accountMatch || carMatch;
      });
    }

    // Sort by date desc - ensure latest is first
    return [...result].sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, searchTerm, filterCategory, filterCarId, filterYear, filterMonth, accounts, cars]);

  const monthlyStats = useMemo(() => {
    const categoryTotals: { [key: string]: { income: number; expense: number } } = {};
    let totalIncome = 0;
    let totalExpense = 0;

    filteredTransactions.forEach(tx => {
      if (!tx.category) return;
      if (!categoryTotals[tx.category]) {
        categoryTotals[tx.category] = { income: 0, expense: 0 };
      }
      if (tx.type === 'Income') {
        categoryTotals[tx.category].income += tx.amount;
        totalIncome += tx.amount;
      } else if (tx.type === 'Expense') {
        categoryTotals[tx.category].expense += tx.amount;
        totalExpense += tx.amount;
      }
    });

    const sortedCategories = Object.entries(categoryTotals)
      .map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => (b.income + b.expense) - (a.income + a.expense));

    return {
      categories: sortedCategories,
      totalIncome,
      totalExpense,
      profit: totalIncome - totalExpense
    };
  }, [filteredTransactions]);

  useEffect(() => {
    if (!showModal && successAction) {
      // Use a small delay to ensure the modal animation has finished
      const timer = setTimeout(() => {
        toast.success(successAction);
        setSuccessAction(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [showModal, successAction]);

  useEffect(() => {
    if (preFill && accounts.length > 0) {
      setModalType(preFill.type);
      setFormData(prev => ({
        ...prev,
        amount: preFill.amount,
        carId: preFill.carId || '',
        bookingId: preFill.bookingId || '',
        description: preFill.description || '',
        category: preFill.category || '',
        accountId: accounts[0]?.id || ''
      }));
      setShowModal(true);
      onClearPreFill?.();
    }
  }, [preFill, accounts]);

  // Real-time synchronization
  useEffect(() => {
    let unsubscribeAccounts: (() => void) | null = null;
    let unsubscribeTransactions: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      if (!user) {
        setLoading(false);
        if (unsubscribeAccounts) {
          unsubscribeAccounts();
          unsubscribeAccounts = null;
        }
        if (unsubscribeTransactions) {
          unsubscribeTransactions();
          unsubscribeTransactions = null;
        }
        return;
      }

      // Listen to Accounts
      if (!unsubscribeAccounts) {
        unsubscribeAccounts = onSnapshot(collection(db, 'accounts'), (snapshot) => {
          const accountsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account));
          
          const requiredAccounts = ["Cash Car", "Kbank Auto", "Kbank Shane", "KTB Auto"];
          
          if (accountsData.length === 0) {
            fetchData();
            return;
          }

          const sorted = [...accountsData].sort((a, b) => {
            const idxA = requiredAccounts.indexOf(a.name);
            const idxB = requiredAccounts.indexOf(b.name);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.name.localeCompare(b.name);
          });

          setAccounts(sorted);
          safeLocalStorage.setItem('prac_cached_accounts', JSON.stringify(sorted), true);
          setLoading(false);
        }, (error) => {
          // Only show error if we are actually signed in
          if (auth.currentUser) {
            handleFirestoreError(error, OperationType.GET, 'accounts');
          }
        });
      }

      // Listen to Transactions
      if (!unsubscribeTransactions) {
        const txQuery = query(collection(db, 'transactions'), orderBy('date', 'desc'), limit(500));
        unsubscribeTransactions = onSnapshot(txQuery, (snapshot) => {
          const transactionsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
          setTransactions(transactionsData);
          safeLocalStorage.setItem('prac_cached_transactions', JSON.stringify(transactionsData), true);
        }, (error) => {
          if (auth.currentUser) {
            handleFirestoreError(error, OperationType.GET, 'transactions');
          }
        });
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeAccounts) unsubscribeAccounts();
      if (unsubscribeTransactions) unsubscribeTransactions();
    };
  }, []);

  const fetchData = React.useCallback(async (force = false) => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const accountsSnapshot = await getDocs(collection(db, 'accounts'));
      if (accountsSnapshot.empty) {
        const batch = writeBatch(db);
        const requiredAccounts = ["Cash Car", "Kbank Auto", "Kbank Shane", "KTB Auto"];
        requiredAccounts.forEach(name => {
          const ref = doc(collection(db, 'accounts'));
          batch.set(ref, { name, balance: 0, type: name.includes('Cash') ? 'Cash' : 'Bank' });
        });
        await batch.commit();
      }
    } catch (e) {
      console.error("fetchData error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.amount <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }

    try {
      if (!formData.accountId) {
        toast.error("Please select an account");
        return;
      }

      const account = accounts.find(a => a.id === formData.accountId);
      if (!account) {
        toast.error("Account not found");
        return;
      }

      if (editingTransactionId) {
        const oldTx = transactions.find(t => t.id === editingTransactionId);
        if (!oldTx) return;

        // 1. Revert old transaction balance
        if (oldTx.type === 'Transfer') {
          const oldFromAcc = accounts.find(a => a.id === oldTx.accountId);
          const oldToAcc = accounts.find(a => a.id === oldTx.toAccountId);
          if (oldFromAcc) await updateDoc(doc(db, 'accounts', oldFromAcc.id), { balance: oldFromAcc.balance + oldTx.amount });
          if (oldToAcc) await updateDoc(doc(db, 'accounts', oldToAcc.id), { balance: oldToAcc.balance - oldTx.amount });
        } else {
          const oldAcc = accounts.find(a => a.id === oldTx.accountId);
          if (oldAcc) {
            const revertedBalance = oldTx.type === 'Income' ? oldAcc.balance - oldTx.amount : oldAcc.balance + oldTx.amount;
            await updateDoc(doc(db, 'accounts', oldAcc.id), { balance: revertedBalance });
          }
        }

        // 2. Update transaction document
        if (modalType === 'Transfer' || oldTx.type === 'Transfer') {
          const toAccount = accounts.find(a => a.id === formData.toAccountId);
          if (!toAccount) {
            toast.error("Please select a destination account");
            return;
          }
          
          await updateDoc(doc(db, 'transactions', editingTransactionId), {
            type: 'Transfer',
            amount: formData.amount,
            date: formData.date,
            category: 'Transfer',
            accountId: formData.accountId,
            toAccountId: formData.toAccountId,
            description: formData.description
          });

          // 3. Apply new balance
          // We need to re-calculate based on the latest state.
          // To be safe, we'll use the current accounts state and manually adjust for the revert we just did.
          const currentFromAcc = accounts.find(a => a.id === formData.accountId)!;
          const currentToAcc = accounts.find(a => a.id === formData.toAccountId)!;
          
          let fromBalanceAdjustment = 0;
          if (oldTx.type === 'Transfer') {
            if (oldTx.accountId === currentFromAcc.id) fromBalanceAdjustment += oldTx.amount;
            if (oldTx.toAccountId === currentFromAcc.id) fromBalanceAdjustment -= oldTx.amount;
          } else {
            if (oldTx.accountId === currentFromAcc.id) fromBalanceAdjustment += (oldTx.type === 'Income' ? -oldTx.amount : oldTx.amount);
          }
          
          await updateDoc(doc(db, 'accounts', currentFromAcc.id), { balance: currentFromAcc.balance + fromBalanceAdjustment - formData.amount });
          
          let toBalanceAdjustment = 0;
          if (oldTx.type === 'Transfer') {
            if (oldTx.accountId === currentToAcc.id) toBalanceAdjustment += oldTx.amount;
            if (oldTx.toAccountId === currentToAcc.id) toBalanceAdjustment -= oldTx.amount;
          } else {
            if (oldTx.accountId === currentToAcc.id) toBalanceAdjustment += (oldTx.type === 'Income' ? -oldTx.amount : oldTx.amount);
          }
          await updateDoc(doc(db, 'accounts', currentToAcc.id), { balance: currentToAcc.balance + toBalanceAdjustment + formData.amount });

        } else {
          await updateDoc(doc(db, 'transactions', editingTransactionId), {
            type: oldTx.type,
            amount: formData.amount,
            date: formData.date,
            category: formData.category,
            carId: formData.carId || null,
            accountId: formData.accountId,
            description: formData.description
          });
          
          const currentAcc = accounts.find(a => a.id === formData.accountId)!;
          let balanceAdjustment = 0;
          
          if (oldTx.accountId === currentAcc.id) {
            balanceAdjustment += (oldTx.type === 'Income' ? -oldTx.amount : oldTx.amount);
          }
          
          const newBalance = currentAcc.balance + balanceAdjustment + (oldTx.type === 'Income' ? formData.amount : -formData.amount);
          await updateDoc(doc(db, 'accounts', currentAcc.id), { balance: newBalance });
        }
        
        setSuccessAction("Transaction updated successfully");
      } else {
        if (modalType === 'Transfer') {
          const toAccount = accounts.find(a => a.id === formData.toAccountId);
          if (!toAccount) {
            toast.error("Please select a destination account");
            return;
          }

          // Add Transfer Transaction
          await addDoc(collection(db, 'transactions'), {
            type: 'Transfer',
            amount: formData.amount,
            date: formData.date,
            category: 'Transfer',
            accountId: formData.accountId,
            toAccountId: formData.toAccountId,
            description: formData.description || `Transfer from ${account.name} to ${toAccount.name}`
          });

          // Update Balances
          await updateDoc(doc(db, 'accounts', account.id), {
            balance: account.balance - formData.amount
          });
          await updateDoc(doc(db, 'accounts', toAccount.id), {
            balance: toAccount.balance + formData.amount
          });
        } else {
          // Add Income or Expense
          await addDoc(collection(db, 'transactions'), {
            type: modalType,
            amount: formData.amount,
            date: formData.date,
            category: formData.category,
            carId: formData.carId || null,
            bookingId: formData.bookingId || null,
            accountId: formData.accountId,
            description: formData.description
          });

          // If this is linked to a booking, update the booking status to Paid
          if (formData.bookingId) {
            try {
              await updateDoc(doc(db, 'bookings', formData.bookingId), {
                status: 'Paid'
              });
              toast.success("Booking status updated to Paid");
            } catch (err) {
              console.error("Error updating booking status:", err);
              toast.error("Transaction logged, but failed to update booking status");
            }
          }

          // Update Balance
          const newBalance = modalType === 'Income' 
            ? account.balance + formData.amount 
            : account.balance - formData.amount;
          
          await updateDoc(doc(db, 'accounts', account.id), {
            balance: newBalance
          });
        }
        setSuccessAction(`${modalType} logged successfully`);
      }

      await logSystemActivity(
        editingTransactionId ? 'Transaction Updated' : 'Transaction Logged',
        `${editingTransactionId ? 'Updated' : 'Created'} ${modalType === 'Transfer' ? 'transfer' : modalType} transaction: ${formData.description || 'No description'} (THB ${formData.amount.toLocaleString()})`,
        'Finance',
        { transactionId: editingTransactionId || 'new', type: modalType, amount: formData.amount }
      );

      setShowModal(false);
      resetForm();
      fetchData(true); // Refresh data to show new transaction
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'transactions/accounts');
      toast.error("Failed to process transaction");
    }
  };

  const handleEditTransaction = React.useCallback((tx: Transaction) => {
    setEditingTransactionId(tx.id);
    setModalType(tx.type === 'Transfer' ? 'Transfer' : 'TransactionEdit');
    setFormData({
      amount: tx.amount,
      date: tx.date,
      category: tx.category,
      carId: tx.carId || '',
      accountId: tx.accountId,
      toAccountId: tx.toAccountId || '',
      description: tx.description || '',
      bookingId: tx.bookingId || ''
    });
    setShowModal(true);
  }, [transactions, editingTransactionId]);

  const handleDeleteTransaction = React.useCallback((tx: Transaction) => {
    setTransactionToDelete(tx);
    setShowDeleteConfirm(true);
  }, []);

  const confirmDelete = async () => {
    if (!transactionToDelete) return;
    const tx = transactionToDelete;

    try {
      // Revert balance
      if (tx.type === 'Transfer') {
        const fromAcc = accounts.find(a => a.id === tx.accountId);
        const toAcc = accounts.find(a => a.id === tx.toAccountId);
        if (fromAcc) await updateDoc(doc(db, 'accounts', fromAcc.id), { balance: fromAcc.balance + tx.amount });
        if (toAcc) await updateDoc(doc(db, 'accounts', toAcc.id), { balance: toAcc.balance - tx.amount });
      } else {
        const acc = accounts.find(a => a.id === tx.accountId);
        if (acc) {
          const newBalance = tx.type === 'Income' ? acc.balance - tx.amount : acc.balance + tx.amount;
          await updateDoc(doc(db, 'accounts', acc.id), { balance: newBalance });
        }
      }

      await deleteDoc(doc(db, 'transactions', tx.id));
      
      await logSystemActivity(
        'Transaction Deleted',
        `Deleted ${tx.type === 'Transfer' ? 'transfer' : tx.type} transaction: ${tx.description || 'No description'} (THB ${tx.amount.toLocaleString()})`,
        'Finance',
        { transactionId: tx.id }
      );

      toast.success("Transaction deleted and balance reverted");
      setShowDeleteConfirm(false);
      setTransactionToDelete(null);
      fetchData(true); // Refresh data
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transactions/${tx.id}`);
      toast.error("Failed to delete transaction");
    }
  };

  const handleAccountUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;

    try {
      await updateDoc(doc(db, 'accounts', selectedAccount.id), {
        balance: formData.amount
      });
      
      setShowModal(false);
      resetForm();
      setSuccessAction("Account balance updated successfully");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `accounts/${selectedAccount.id}`);
      toast.error("Failed to update balance");
    }
  };

  const resetForm = () => {
    setFormData({
      amount: 0,
      date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      category: '',
      carId: '',
      bookingId: '',
      accountId: '',
      toAccountId: '',
      description: ''
    });
    setSelectedAccount(null);
    setEditingTransactionId(null);
  };

  const openModal = (type: typeof modalType, account?: Account) => {
    setModalType(type);
    if (account) {
      setSelectedAccount(account);
      setFormData(prev => ({ ...prev, accountId: account.id, amount: account.balance }));
    } else {
      setFormData(prev => ({ ...prev, accountId: accounts[0]?.id || '' }));
    }
    setShowModal(true);
  };

  const totalBalance = useMemo(() => accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0), [accounts]);

  const [isReconciling, setIsReconciling] = useState(false);

  const handleReconcileBalances = async (accountsOverride?: Account[]) => {
    setIsReconciling(true);
    const loadingToast = toast.loading("Reconciling account balances from transactions...");
    try {
      let accountsToUse = accountsOverride || accounts;
      
      // If no override and we suspect stale state (e.g. after import), fetch fresh
      if (!accountsOverride) {
        const accSnapshot = await getDocs(collection(db, 'accounts'));
        accountsToUse = accSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account));
      }

      const allTxSnapshot = await getDocs(collection(db, 'transactions'));
      const allTx = allTxSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      
      const newBalances: { [key: string]: number } = {};
      accountsToUse.forEach(acc => newBalances[acc.id] = 0);

      allTx.forEach(tx => {
        let accId = tx.accountId;
        // Fix for legacy fallback 'cash' ID
        if (accId === 'cash') {
          const cashAcc = accountsToUse.find(a => a.name.toLowerCase().includes('cash'));
          if (cashAcc) accId = cashAcc.id;
        }

        if (tx.type === 'Transfer') {
          if (newBalances[accId] !== undefined) newBalances[accId] -= tx.amount;
          if (tx.toAccountId && newBalances[tx.toAccountId] !== undefined) newBalances[tx.toAccountId] += tx.amount;
        } else {
          if (newBalances[accId] !== undefined) {
            newBalances[accId] += (tx.type === 'Income' ? tx.amount : -tx.amount);
          }
        }
      });

      const batch = writeBatch(db);
      Object.entries(newBalances).forEach(([accountId, balance]) => {
        batch.update(doc(db, 'accounts', accountId), { balance });
      });
      await batch.commit();
      
      toast.dismiss(loadingToast);
      toast.success("Balances reconciled successfully.");
    } catch (error) {
      console.error("Reconcile error:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to reconcile balances.");
    } finally {
      setIsReconciling(false);
    }
  };

  const handleExportCSV = async () => {
    toast.loading("Preparing export...", { id: 'export-loading' });
    try {
      const allTxSnapshot = await getDocs(collection(db, 'transactions'));
      const allTx = allTxSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      // Sort by date desc for export
      allTx.sort((a, b) => b.date.localeCompare(a.date));

      const exportData = allTx.map(tx => ({
        Date: format(parseISO(tx.date), 'yyyy-MM-dd HH:mm'),
        Type: tx.type,
        Category: tx.category,
        Account: accounts.find(a => a.id === tx.accountId)?.name || 'Unknown',
        'To Account': tx.toAccountId ? accounts.find(a => a.id === tx.toAccountId)?.name : '',
        Vehicle: tx.carId ? cars.find(c => c.id === tx.carId)?.name : '',
        Description: tx.description,
        Amount: tx.amount
      }));

      const csv = Papa.unparse(exportData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `finance_export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.dismiss('export-loading');
      toast.success("Finance data exported successfully");
    } catch (error) {
      console.error("Export error:", error);
      toast.dismiss('export-loading');
      toast.error("Failed to export transactions");
    }
  };

  const [isResetting, setIsResetting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClearAllTransactions = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      toast("Click again to confirm clearing ALL transactions.", {
        action: {
          label: "Confirm",
          onClick: () => handleClearAllTransactions()
        }
      });
      setTimeout(() => setConfirmClear(false), 5000);
      return;
    }

    setIsResetting(true);
    const loadingToast = toast.loading("Clearing all transactions...");
    
    try {
      // 1. Delete all transactions
      const txSnapshot = await getDocs(collection(db, 'transactions'));
      
      if (txSnapshot.size > 0) {
        // Use batches of 500
        const docs = txSnapshot.docs;
        for (let i = 0; i < docs.length; i += 500) {
          const batch = writeBatch(db);
          docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      
      // 2. Reset all account balances to 0
      const accSnapshot = await getDocs(collection(db, 'accounts'));
      if (accSnapshot.size > 0) {
        const batch = writeBatch(db);
        accSnapshot.docs.forEach((adoc) => {
          batch.update(adoc.ref, { balance: 0 });
        });
        await batch.commit();
      }

      await logSystemActivity(
        'Clear Transactions',
        `Cleared all transactions (${txSnapshot.size}) and reset account balances.`,
        'Finance'
      );

      toast.dismiss(loadingToast);
      toast.success(`Successfully cleared ${txSnapshot.size} transactions and reset balances.`);
      
      // Refresh local state
      setTransactions([]);
      setAccounts(prev => prev.map(a => ({ ...a, balance: 0 })));
      setConfirmClear(false);
      
    } catch (error: any) {
      toast.dismiss(loadingToast);
      console.error("Clear error details:", error);
      toast.error("Failed to clear transactions. " + (error.message || "Unknown error"));
    } finally {
      setIsResetting(false);
    }
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const loadingToast = toast.loading("Importing transactions...");

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => (header || '').toString().toLowerCase().trim().replace(/\s+/g, '_'),
      complete: async (results) => {
        const data = results.data as any[];
        let importedCount = 0;
        let errorCount = 0;

        const localBalances = new Map<string, number>();
        accounts.forEach(acc => localBalances.set(acc.id, acc.balance));

        const totalRows = data.length;
        let batch = writeBatch(db);
        let batchSize = 0;

        for (const row of data) {
          try {
            const getVal = (possibleKeys: string[]) => {
              for (const k of possibleKeys) {
                const normalizedK = k.toLowerCase().replace(/\s+/g, '_');
                if (row[normalizedK] !== undefined) return row[normalizedK];
              }
              return '';
            };

            let amountStr = getVal(['Amount', 'Sum', 'Price', 'Total', 'Value']).toString().trim().replace(/,/g, '');
            let rawAmount = 0;
            if (amountStr.startsWith('(') && amountStr.endsWith(')')) {
              rawAmount = -parseFloat(amountStr.substring(1, amountStr.length - 1));
            } else {
              rawAmount = parseFloat(amountStr || '0');
            }
            const amount = Math.abs(rawAmount);
            
            let type = getVal(['Type', 'Action', 'Kind', 'Transaction Type']).toString();
            if (!type) {
              type = rawAmount >= 0 ? 'Income' : 'Expense';
            }

            const dateStr = getVal(['Date', 'Time', 'Created At', 'Timestamp']).toString().trim();
            const category = getVal(['Category', 'Group', 'Type', 'Tag']).toString().trim() || 'Other';
            const accountName = getVal(['Account', 'Which Account', 'Bank', 'Payment Method', 'Source']).toString().trim();
            const toAccountName = getVal(['To Account', 'Destination', 'Transfer To']).toString().trim();
            const vehicleName = getVal(['Vehicle', 'Which Vehicle', 'Car', 'Asset']).toString().trim();
            const description = getVal(['Description', 'Notes', 'Reference', 'Memo']).toString().trim();
            const uniqueId = getVal(['unique id', 'id']).toString().trim();

            if (isNaN(amount) || !type || !dateStr || !accountName) {
              errorCount++;
              continue;
            }

            // Robust date parsing
            const parsedDate = parseCSVDate(dateStr);

            if (!parsedDate) {
              toast.error(`Invalid date format at row index: "${dateStr}". Stopping import.`);
              toast.dismiss(loadingToast);
              return;
            }

            // Normalize account name mapping for common variations
            let normalizedAccountName = accountName;
            const lowerAcc = (accountName || '').toString().toLowerCase();
            
            if (lowerAcc.includes('cash') || lowerAcc === 'cash') normalizedAccountName = 'Cash Car';
            else if (lowerAcc.includes('kasikorn') || lowerAcc.includes('kbank') || lowerAcc.includes('k-bank')) {
              if (lowerAcc.includes('company') || lowerAcc.includes('auto')) normalizedAccountName = 'Kbank Auto';
              else if (lowerAcc.includes('personal') || lowerAcc.includes('shane')) normalizedAccountName = 'Kbank Shane';
              else normalizedAccountName = 'Kbank Auto'; // Default to Auto if generic Kbank
            }
            else if (lowerAcc.includes('krungthai') || lowerAcc.includes('krung thai') || lowerAcc.includes('ktb')) normalizedAccountName = 'KTB Auto';
            else if (lowerAcc.includes('car') && lowerAcc.includes('cash')) normalizedAccountName = 'Cash Car';
            else if (lowerAcc.includes('auto') && lowerAcc.includes('kbank')) normalizedAccountName = 'Kbank Auto';
            else if (lowerAcc.includes('shane') && lowerAcc.includes('kbank')) normalizedAccountName = 'Kbank Shane';
            else if (lowerAcc.includes('ktb') || lowerAcc.includes('krung')) normalizedAccountName = 'KTB Auto';

            const account = accounts.find(a => (a.name?.toLowerCase() || '') === (normalizedAccountName?.toLowerCase() || ''));
            if (!account) {
              // Try to find any fallback account to avoid dropping data
              const fallbackAccount = accounts.find(a => (a.name?.toLowerCase() || '').includes('cash')) || accounts[0];
              if (fallbackAccount) {
                // We'll use fallback but log it
                console.warn(`Account "${accountName}" not found, using fallback "${fallbackAccount.name}"`);
              } else {
                errorCount++;
                continue;
              }
            }
            const usedAccount = account || accounts.find(a => (a.name?.toLowerCase() || '').includes('cash')) || accounts[0];
            if (!usedAccount) {
              errorCount++;
              continue;
            }

            let toAccountId = '';
            if (type === 'Transfer' && toAccountName) {
              const toAccount = accounts.find(a => (a.name?.toLowerCase() || '') === (toAccountName?.toLowerCase() || ''));
              if (toAccount) toAccountId = toAccount.id;
            }

            const car = vehicleName ? cars.find(c => (c.name?.toLowerCase() || '') === (vehicleName?.toLowerCase() || '')) : null;

            // Use unique id from CSV if available, otherwise deterministic ID for deduplication
            const deterministicId = uniqueId || txDataToId(parsedDate.toISOString(), amount, description, normalizedAccountName);
            const txRef = doc(db, 'transactions', deterministicId);
            
            batch.set(txRef, {
              type,
              amount,
              date: format(parsedDate, "yyyy-MM-dd'T'HH:mm"),
              category,
              accountId: usedAccount.id,
              toAccountId: toAccountId || null,
              carId: car?.id || null,
              description: description || '',
            });
            batchSize++;

            if (type === 'Transfer' && toAccountId) {
              const currentFromBalance = localBalances.get(usedAccount.id) || 0;
              const newFromBalance = currentFromBalance - amount;
              localBalances.set(usedAccount.id, newFromBalance);
              batch.update(doc(db, 'accounts', usedAccount.id), { balance: newFromBalance });
              batchSize++;

              const currentToBalance = localBalances.get(toAccountId) || 0;
              const newToBalance = currentToBalance + amount;
              localBalances.set(toAccountId, newToBalance);
              batch.update(doc(db, 'accounts', toAccountId), { balance: newToBalance });
              batchSize++;
            } else {
              const currentBalance = localBalances.get(usedAccount.id) || 0;
              const newBalance = type === 'Income' ? currentBalance + amount : currentBalance - amount;
              localBalances.set(usedAccount.id, newBalance);
              batch.update(doc(db, 'accounts', usedAccount.id), { balance: newBalance });
              batchSize++;
            }

            // Commit if batch is full (max 500 operations)
            if (batchSize >= 450) {
              await batch.commit();
              batch = writeBatch(db);
              batchSize = 0;
            }

            importedCount++;
          } catch (err) {
            console.error("Error importing row:", err);
            errorCount++;
          }
        }

        // Final commit
        if (batchSize > 0) {
          await batch.commit();
        }

        toast.dismiss(loadingToast);
        if (importedCount > 0) {
          toast.success(`Successfully imported ${importedCount} transactions`);
          
          toast.loading("Verifying balances...", { id: 'recon-loading' });
          await handleReconcileBalances();
          toast.dismiss('recon-loading');

          await logSystemActivity(
            'Import Transactions',
            `Imported ${importedCount} transactions from CSV`,
            'Finance',
            { count: importedCount }
          );
          fetchData(true); // Refresh data after import
        }
        if (errorCount > 0) {
          toast.error(`Failed to import ${errorCount} rows. Check format.`);
        }
        
        e.target.value = '';
      }
    });
  };

  const handleAdvancedImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!auth.currentUser?.emailVerified) {
      toast.error("You must have a verified email to perform this heavy operation.");
      return;
    }

    setImportProgress({ total: 100, current: 0, status: 'Parsing CSV...' });

    Papa.parse(file, {
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data as any[][];
        
        // Target Headers: "Amount", "Category", "Date", "Description", "Which Account", "unique id"
        const targetHeaders = ["Amount", "Category", "Date", "Description", "Which Account", "unique id"];
        
        // Find header row based on specific headers requested
        const headerIndex = rows.findIndex(row => 
          row.some(val => targetHeaders.some(th => th.toLowerCase() === val?.toString().trim().toLowerCase()))
        );

        if (headerIndex === -1) {
          toast.error("Could not find required CSV headers (Amount, Category, Date, Description, Which Account, unique id).");
          setImportProgress(null);
          return;
        }

        const headers = rows[headerIndex].map(h => h?.toString().trim());
        const dataRows = rows.slice(headerIndex + 1);

        const data = dataRows.map(row => {
          const obj: any = {};
          headers.forEach((h, i) => {
            if (h) {
              const key = h.toLowerCase().trim().replace(/\s+/g, '_');
              obj[key] = row[i];
            }
          });
          return obj;
        }).filter(row => {
          const amount = row.amount || row.sum || row.price || row.total || row.value;
          return amount !== undefined && amount !== null && amount !== '';
        });

        const totalRows = data.length;
        
        try {
          setImportProgress({ total: totalRows, current: 0, status: 'Fetching current accounts...' });
          
          const accountsSnapshot = await getDocs(collection(db, 'accounts'));
          const currentAccounts = accountsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account));
          
          setImportProgress({ total: totalRows, current: 0, status: 'Mapping and processing data...' });

          const normalize = (name: string) => name?.toString().trim().toLowerCase() || '';

          const uniqueAccountNames = new Set<string>();
          const monthMap: { [key: string]: number } = {
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
          };

          const processedData = [];
          
          try {
            for (let i = 0; i < data.length; i++) {
              const row = data[i];
              const getVal = (possibleKeys: string[]) => {
                for (const k of possibleKeys) {
                  const normalizedK = k.toLowerCase().replace(/\s+/g, '_');
                  if (row[normalizedK] !== undefined) return row[normalizedK];
                }
                return '';
              };

              const dateStr = getVal(['Date', 'Time', 'Created At', 'Timestamp']).toString().trim();
              const date = parseCSVDate(dateStr);
              
              if (!date) {
                throw new Error(`Invalid date format at row ${i + headerIndex + 2}: "${dateStr}". Expected formats like "Jun 30, 2021 00:00" or "27/04/26 13:41"`);
              }

              let amountStr = getVal(['Amount', 'Sum', 'Price', 'Total', 'Value']).toString().trim().replace(/,/g, '');
              let rawAmount = 0;
              if (amountStr.startsWith('(') && amountStr.endsWith(')')) {
                rawAmount = -parseFloat(amountStr.substring(1, amountStr.length - 1));
              } else {
                rawAmount = parseFloat(amountStr || '0');
              }
              const amount = Math.abs(rawAmount);
              
              if (isNaN(amount)) continue;

          let typeRaw = getVal(['Type', 'Action', 'Kind', 'Transaction Type']).toString().toLowerCase();
          let type: 'Income' | 'Expense' | 'Transfer' = 'Income';
          
          if (typeRaw.includes('transfer')) type = 'Transfer';
          else if (typeRaw.includes('income') || typeRaw.includes('deposit') || typeRaw.includes('in') || typeRaw.includes('receive') || typeRaw.includes('cr')) type = 'Income';
          else if (typeRaw.includes('expense') || typeRaw.includes('withdraw') || typeRaw.includes('out') || typeRaw.includes('pay') || typeRaw.includes('dr')) type = 'Expense';
          else {
            type = rawAmount >= 0 ? 'Income' : 'Expense';
          }
          
          let accountName = getVal(['Which Account', 'Account', 'Bank', 'Payment Method', 'Source']).toString() || 'Cash Car';
          
          const lowerAcc = accountName.toString().toLowerCase();
          if (lowerAcc.includes('cash') || lowerAcc === 'cash') accountName = 'Cash Car';
          else if (lowerAcc.includes('kasikorn') || lowerAcc.includes('kbank') || lowerAcc.includes('k-bank')) {
            if (lowerAcc.includes('company') || lowerAcc.includes('auto')) accountName = 'Kbank Auto';
            else if (lowerAcc.includes('personal') || lowerAcc.includes('shane')) accountName = 'Kbank Shane';
            else accountName = 'Kbank Auto';
          }
          else if (lowerAcc.includes('krungthai') || lowerAcc.includes('krung thai') || lowerAcc.includes('ktb')) accountName = 'KTB Auto';
          else if (lowerAcc.includes('car') && lowerAcc.includes('cash')) accountName = 'Cash Car';
          else if (lowerAcc.includes('auto') && lowerAcc.includes('kbank')) accountName = 'Kbank Auto';
          else if (lowerAcc.includes('shane') && lowerAcc.includes('kbank')) accountName = 'Kbank Shane';
          else if (lowerAcc.includes('ktb') || lowerAcc.includes('krung')) accountName = 'KTB Auto';
              
              uniqueAccountNames.add(accountName);

              const description = getVal(['Description', 'Notes', 'Reference', 'Memo']).toString().trim() || '';
              const uniqueId = getVal(['unique id', 'id']).toString().trim();
              let toAccountName = getVal(['To Account', 'Destination', 'Transfer To']).toString().trim();

              if (toAccountName) {
                const lowerTo = toAccountName.toLowerCase();
                if (lowerTo.includes('cash') || lowerTo === 'cash') toAccountName = 'Cash Car';
                else if (lowerTo.includes('kasikorn') || lowerTo.includes('kbank') || lowerTo.includes('k-bank')) {
                  if (lowerTo.includes('company') || lowerTo.includes('auto')) toAccountName = 'Kbank Auto';
                  else if (lowerTo.includes('personal') || lowerTo.includes('shane')) toAccountName = 'Kbank Shane';
                  else toAccountName = 'Kbank Auto';
                }
                else if (lowerTo.includes('krungthai') || lowerTo.includes('krung thai') || lowerTo.includes('ktb')) toAccountName = 'KTB Auto';
                
                uniqueAccountNames.add(toAccountName);
              }

              processedData.push({
                id: uniqueId || undefined,
                amount,
                date,
                type: type as 'Income' | 'Expense' | 'Transfer',
                category: getVal(['Category', 'Group', 'Type', 'Tag']).toString().trim() || 'Other',
                account: accountName,
                toAccount: toAccountName || undefined,
                description,
                vehicleId: getVal(['Which Vehicle', 'Vehicle', 'Car', 'Asset']).toString().trim() || undefined
              });
            }
          } catch (e: any) {
            toast.error(e.message);
            console.error("Import Date Error:", e);
            setImportProgress(null);
            return;
          }


          // Ensure all accounts in CSV exist
          setImportProgress({ total: totalRows, current: 0, status: 'Creating missing accounts...' });
          const allAccountsMap = new Map<string, Account>();
          currentAccounts.forEach(acc => allAccountsMap.set(normalize(acc.name), acc));

          for (const rawName of uniqueAccountNames) {
            const norm = normalize(rawName);
            if (!allAccountsMap.has(norm) && norm !== '') {
              const newAccRef = doc(collection(db, 'accounts'));
              const newAcc = { id: newAccRef.id, name: rawName, balance: 0 };
              await setDoc(newAccRef, { name: rawName, balance: 0 });
              allAccountsMap.set(norm, newAcc);
            }
          }

          // Aggregates
          setImportProgress({ total: totalRows, current: 0, status: 'Calculating aggregates...' });
          const monthlySummaries: { [key: string]: any } = {};
          const accountBalances: { [key: string]: number } = {};
          
          // Initialize balances with current values to support incremental imports
          currentAccounts.forEach(acc => {
            accountBalances[acc.id] = acc.balance || 0;
          });

          let allTimeIncome = 0;
          let allTimeExpense = 0;

          processedData.forEach(tx => {
            const monthKey = format(tx.date, 'yyyy-MM');
            if (!monthlySummaries[monthKey]) {
              monthlySummaries[monthKey] = {
                id: monthKey,
                type: 'monthly',
                month: monthKey,
                totalIncome: 0,
                totalExpense: 0,
                netProfit: 0,
                lastUpdated: new Date().toISOString()
              };
            }

            if (tx.type === 'Income') {
              monthlySummaries[monthKey].totalIncome += tx.amount;
              allTimeIncome += tx.amount;
            } else if (tx.type === 'Expense') {
              monthlySummaries[monthKey].totalExpense += tx.amount;
              allTimeExpense += tx.amount;
            }

            const account = allAccountsMap.get(normalize(tx.account));
            if (account) {
              const currentBal = accountBalances[account.id] || 0;
              if (tx.type === 'Income') accountBalances[account.id] = currentBal + tx.amount;
              else if (tx.type === 'Expense') accountBalances[account.id] = currentBal - tx.amount;
            }
          });

          // Write Transactions in chunks of 500
          setImportProgress({ total: processedData.length, current: 0, status: 'Writing transactions...' });
          
          for (let i = 0; i < processedData.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = processedData.slice(i, i + 500);
            
            chunk.forEach(tx => {
              const account = allAccountsMap.get(normalize(tx.account));
              const toAccount = tx.toAccount ? allAccountsMap.get(normalize(tx.toAccount)) : null;
              
              // Use unique id from CSV as Document ID
              const txRef = tx.id ? doc(db, 'transactions', tx.id) : doc(collection(db, 'transactions'));
              
              batch.set(txRef, {
                type: tx.type,
                amount: tx.amount,
                date: tx.date.toISOString(),
                category: tx.category,
                accountId: account?.id || 'cash',
                toAccountId: toAccount?.id || null,
                description: tx.description,
                carId: tx.vehicleId || null
              }, { merge: true });
            });

            await batch.commit();
            const currentProgress = i + chunk.length;
            setImportProgress(prev => prev ? { ...prev, current: currentProgress } : null);
            console.log(`Imported ${currentProgress}/${processedData.length}`);
          }

          // Summaries
          const summariesBatch = writeBatch(db);
          Object.values(monthlySummaries).forEach((s: any) => {
            summariesBatch.set(doc(db, 'finance_summaries', s.id), { ...s, netProfit: s.totalIncome - s.totalExpense }, { merge: true });
          });
          summariesBatch.set(doc(db, 'finance_summaries', 'all-time'), {
            id: 'all-time',
            type: 'all-time',
            totalIncome: allTimeIncome,
            totalExpense: allTimeExpense,
            netProfit: allTimeIncome - allTimeExpense,
            accountBalances,
            lastUpdated: new Date().toISOString()
          }, { merge: true });
          
          // CRITICAL: Update the actual accounts collection balances
          Object.entries(accountBalances).forEach(([accountId, balance]) => {
            summariesBatch.update(doc(db, 'accounts', accountId), { balance });
          });

          await summariesBatch.commit();

          toast.success(`Imported ${totalRows} rows and updated all balances.`);
          setImportProgress(null);
          
          // Refresh data so accounts state contains any newly created accounts
          await fetchData(true);
          
          toast.loading("Verifying balances...", { id: 'recon-loading' });
          await handleReconcileBalances();
          toast.dismiss('recon-loading');

          await logSystemActivity('Heavy Import', `Imported ${totalRows} transactions.`, 'Finance', { totalRows });

        } catch (err: any) {
          console.error("Advanced Import Error:", err);
          toast.error("Import failed: " + err.message);
          setImportProgress(null);
        }
        
        e.target.value = '';
      }
    });
  };

  const resetFilters = () => {
    setLocalSearchTerm('');
    setSearchTerm('');
    setFilterCategory('All');
    setFilterCarId('All');
    setFilterYear('All');
    setFilterMonth('All');
    setDisplayLimit(50);
  };

  if (!auth.currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-warm-bg">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center text-black/20 mx-auto mb-6">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-serif italic mb-2 text-[#141414]">Access Restricted</h2>
          <p className="text-[#141414]/40 mb-8 max-w-xs mx-auto text-sm">Please sign in to your authorized account to access your financial records.</p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-8 py-3 bg-[#141414] text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange transition-all shadow-lg shadow-black/10"
          >
            Sign In / Refresh
          </button>
        </motion.div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-warm-bg">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-black/10 animate-spin mx-auto mb-4" />
          <p className="text-[#141414]/40 font-bold uppercase tracking-widest text-[10px]">Decrypting Ledger...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-warm-bg p-8">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header */}
        <header className="flex justify-between items-end">
          <div>
            <h1 className="font-serif italic text-5xl text-[#141414] mb-2">Finance</h1>
            <p className="text-[#141414]/60 uppercase tracking-[0.2em] text-[10px] font-bold">Financial Operations & Tracking</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setShowSummaryReport(true)}
              className="h-12 px-6 bg-white/60 text-[#141414]/60 border border-white/60 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-white hover:text-brand-orange transition-all shadow-lg flex items-center gap-2"
              title="View month-by-month category breakdown"
            >
              <LayoutDashboard size={16} /> 
              Overview
            </button>
            <button 
              onClick={() => openModal('Income')}
              className="h-12 px-8 bg-green-500 text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:scale-105 active:scale-95 transition-all shadow-lg shadow-green-500/20 flex items-center gap-2"
            >
              <TrendingUp size={16} /> Log Income
            </button>
            <button 
              onClick={() => openModal('Expense')}
              className="h-12 px-8 bg-red-500 text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:scale-105 active:scale-95 transition-all shadow-lg shadow-red-500/20 flex items-center gap-2"
            >
              <TrendingDown size={16} /> Log Expense
            </button>
            <button 
              onClick={() => openModal('Transfer')}
              className="h-12 px-8 bg-brand-orange text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:scale-105 active:scale-95 transition-all shadow-lg shadow-brand-orange/20 flex items-center gap-2"
            >
              <ArrowRightLeft size={16} /> Transfer
            </button>
            <button 
              onClick={() => setShowDepositsModal(true)}
              className="h-12 px-8 bg-[#141414] text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:scale-105 active:scale-95 transition-all shadow-lg shadow-black/20 flex items-center gap-2"
            >
              <ShieldCheck size={16} /> Deposits
            </button>
            <div className="flex gap-3">
              <button 
                onClick={handleExportCSV}
                className="h-12 w-12 bg-white/60 text-[#141414]/60 border border-white/60 rounded-2xl flex items-center justify-center hover:bg-white hover:text-brand-orange transition-all shadow-lg"
                title="Export all transactions to CSV"
              >
                <Download size={18} />
              </button>
              <div className="relative group">
                <button 
                  className="h-12 w-12 bg-white/60 text-[#141414]/60 border border-white/60 rounded-2xl flex items-center justify-center hover:bg-white hover:text-brand-orange transition-all shadow-lg"
                  title="Import transactions from CSV (Basic)"
                >
                  <Upload size={18} />
                </button>
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleImportCSV}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
              <div className="relative group">
                <button 
                  className="h-12 w-12 bg-white/60 text-brand-orange border border-brand-orange/20 rounded-2xl flex items-center justify-center hover:bg-brand-orange hover:text-white transition-all shadow-lg"
                  title="Advanced Heavy Import (Full mapping + Balances)"
                >
                  <Search size={18} />
                </button>
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleAdvancedImportCSV}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </header>

        {/* Progress Bar */}
        <AnimatePresence>
          {importProgress && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-black/5 rounded-2xl p-6 border border-black/10 overflow-hidden"
            >
              <div className="flex justify-between items-end mb-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-1">Importing Data</h3>
                  <p className="text-xs text-black/60">{importProgress.status}</p>
                </div>
                <p className="text-xs font-mono font-bold">
                  {Math.round((importProgress.current / importProgress.total) * 100)}%
                </p>
              </div>
              <div className="h-2 bg-black/10 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-black rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Account Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {accounts.map(account => (
            <motion.div 
              key={account.id}
              whileHover={{ y: -4, scale: 1.02 }}
              className="bg-white/60 backdrop-blur-xl border border-white/40 p-8 rounded-[32px] shadow-xl group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-orange/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 bg-brand-orange/10 rounded-2xl border border-brand-orange/20">
                  <Wallet size={20} className="text-brand-orange" />
                </div>
                <button 
                  onClick={() => openModal('AccountEdit', account)}
                  className="p-2 bg-white/40 hover:bg-white/80 rounded-xl border border-white/60 transition-all"
                >
                  <Edit2 size={14} className="text-[#141414]/40" />
                </button>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 mb-1">{account.name}</p>
              <p className="text-3xl font-bold tracking-tight text-[#141414]">
                ฿{account.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </motion.div>
          ))}
          
          {/* Total Summary Card */}
          <div className="bg-brand-orange text-white p-8 rounded-[32px] shadow-2xl shadow-brand-orange/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl group-hover:scale-150 transition-transform duration-700" />
            <div className="flex justify-between items-start mb-6 relative">
              <div className="p-3 bg-white/20 rounded-2xl border border-white/30">
                <TrendingUp size={20} className="text-white" />
              </div>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1 relative">Total Net Worth</p>
            <p className="text-3xl font-bold tracking-tight relative">
              ฿{totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          {/* Active Filter Summary */}
          {(filterCategory !== 'All' || filterCarId !== 'All' || filterYear !== 'All' || filterMonth !== 'All' || searchTerm) && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[#141414] text-white p-8 rounded-[32px] shadow-2xl relative overflow-hidden group border border-white/5"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-brand-orange/10 rounded-full -mr-16 -mt-16 blur-2xl group-hover:scale-150 transition-transform duration-700" />
              <div className="flex justify-between items-start mb-4 relative">
                <div className="p-3 bg-white/10 rounded-2xl border border-white/20">
                  <TrendingUp size={20} className={cn(monthlyStats.profit >= 0 ? "text-green-400" : "text-red-400")} />
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/40 mb-1">Active Filters</span>
                  <div className="flex gap-1">
                    {filterCarId !== 'All' && <div className="w-1.5 h-1.5 rounded-full bg-brand-orange" />}
                    {filterCategory !== 'All' && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    {(filterYear !== 'All' || filterMonth !== 'All') && <div className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                  </div>
                </div>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1 relative">Selected Net Profit</p>
              <p className={cn(
                "text-3xl font-bold tracking-tight relative mb-4",
                monthlyStats.profit >= 0 ? "text-green-400" : "text-red-400"
              )}>
                {monthlyStats.profit < 0 ? '-' : ''}฿{Math.abs(monthlyStats.profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest relative pt-4 border-t border-white/10">
                <div className="flex flex-col">
                  <span className="text-white/40 mb-0.5 text-[8px]">Total In</span>
                  <span className="text-green-400">฿{monthlyStats.totalIncome.toLocaleString()}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-white/40 mb-0.5 text-[8px]">Total Out</span>
                  <span className="text-red-400">฿{monthlyStats.totalExpense.toLocaleString()}</span>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Transactions Table */}
        <div className="space-y-6">
          <div className="bg-white/40 backdrop-blur-md border border-white/60 rounded-[40px] shadow-xl overflow-hidden">
          <div className="p-8 border-b border-white/20 flex justify-between items-center bg-white/40 backdrop-blur-xl">
            <div>
              <h2 className="font-serif italic text-3xl text-[#141414]">Recent Transactions</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 mt-1">History of all movements</p>
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              {(searchTerm || filterCategory !== 'All' || filterCarId !== 'All' || filterYear !== 'All' || filterMonth !== 'All') && (
                <button 
                  onClick={resetFilters}
                  className="px-4 py-2 bg-[#141414] text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-brand-orange transition-all flex items-center gap-2"
                >
                  <X size={12} />
                  Reset
                </button>
              )}

              {/* Vehicle Filter */}
              <div className="relative z-20 min-w-[200px]">
                <Select
                  options={vehicleFilterOptions}
                  value={filterCarId === 'All' ? { value: 'All', label: 'All Vehicles' } : vehicleFilterOptions.find(opt => opt.value === filterCarId)}
                  onChange={(newValue: any) => setFilterCarId(newValue.value)}
                  isSearchable
                  placeholder="Filter vehicle..."
                  components={{ Option: CustomOption, SingleValue: CustomSingleValue }}
                  styles={{
                    control: (base) => ({
                      ...base,
                      backgroundColor: 'rgba(255, 255, 255, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.6)',
                      borderRadius: '1rem',
                      fontSize: '10px',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      minHeight: '42px',
                      paddingLeft: '8px',
                      boxShadow: 'none',
                      '&:hover': {
                        borderColor: '#FF6B00'
                      }
                    }),
                    menu: (base) => ({
                      ...base,
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      backdropFilter: 'blur(10px)',
                      borderRadius: '1rem',
                      overflow: 'hidden',
                      zIndex: 100,
                      border: '1px solid rgba(255, 255, 255, 0.4)',
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
                    }),
                    option: (base, state) => ({
                      ...base,
                      backgroundColor: state.isFocused ? 'rgba(255, 107, 0, 0.1)' : 'transparent',
                      color: 'inherit',
                      cursor: 'pointer',
                      '&:active': {
                        backgroundColor: 'rgba(255, 107, 0, 0.2)'
                      }
                    }),
                    input: (base) => ({
                      ...base,
                      color: '#1A1A1A'
                    }),
                    singleValue: (base) => ({
                      ...base,
                      color: '#1A1A1A'
                    })
                  }}
                />
              </div>

              {/* Category Filter */}
              <div className="relative">
                <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/40" size={14} />
                <select 
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="pl-10 pr-6 py-2.5 bg-white/40 border border-white/60 rounded-2xl text-[10px] font-bold uppercase tracking-widest focus:border-brand-orange focus:bg-white/60 outline-none transition-all appearance-none min-w-[140px]"
                >
                  <option value="All">All Categories</option>
                  {[...new Set(transactions.map(t => t.category))].filter(Boolean).sort().map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Year Filter */}
              <div className="relative">
                <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/40" size={14} />
                <select 
                  value={filterYear}
                  onChange={e => setFilterYear(e.target.value)}
                  className="pl-10 pr-6 py-2.5 bg-white/40 border border-white/60 rounded-2xl text-[10px] font-bold uppercase tracking-widest focus:border-brand-orange focus:bg-white/60 outline-none transition-all appearance-none min-w-[120px]"
                >
                  <option value="All">All Years</option>
                  {[...new Set(transactions.map(t => format(parseISO(t.date), 'yyyy')))].filter(Boolean).sort().reverse().map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>

              {/* Month Filter */}
              <div className="relative">
                <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/40" size={14} />
                <select 
                  value={filterMonth}
                  onChange={e => setFilterMonth(e.target.value)}
                  className="pl-10 pr-6 py-2.5 bg-white/40 border border-white/60 rounded-2xl text-[10px] font-bold uppercase tracking-widest focus:border-brand-orange focus:bg-white/60 outline-none transition-all appearance-none min-w-[140px]"
                >
                  <option value="All">All Months</option>
                  {/* Generate months 01-12 */}
                  {Array.from({ length: 12 }, (_, i) => {
                    const m = (i + 1).toString().padStart(2, '0');
                    return (
                      <option key={m} value={m}>
                        {format(new Date(2021, i, 1), 'MMMM')}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/40" size={16} />
                <input 
                  type="text" 
                  placeholder="Search transactions..."
                  value={localSearchTerm}
                  onChange={e => setLocalSearchTerm(e.target.value)}
                  className="pl-11 pr-6 py-2.5 bg-white/40 border border-white/60 rounded-2xl text-[10px] font-bold uppercase tracking-widest focus:border-brand-orange focus:bg-white/60 outline-none transition-all w-64"
                />
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-white/20 border-b border-white/10">
                  <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Date</th>
                  <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Type</th>
                  <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Category</th>
                  <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Account</th>
                  <th className="p-6 text-left text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Description</th>
                  <th className="p-6 text-right text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Amount</th>
                  <th className="p-6 text-right text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-20 text-center text-[#141414]/40 italic font-serif text-xl">
                      {(searchTerm || filterCategory !== 'All' || filterYear !== 'All' || filterMonth !== 'All') 
                        ? "No transactions match your filters." 
                        : "No transactions logged yet."}
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.slice(0, displayLimit).map(tx => (
                    <TransactionRow 
                      key={tx.id} 
                      tx={tx} 
                      accounts={accounts} 
                      cars={cars} 
                      onEdit={handleEditTransaction}
                      onDelete={handleDeleteTransaction}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredTransactions.length > displayLimit && (
            <div className="p-8 flex justify-center bg-white/20 border-t border-white/10">
              <button 
                onClick={() => setDisplayLimit(prev => prev + 50)}
                className="px-8 py-3 bg-white hover:bg-brand-orange hover:text-white text-[#141414] rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all shadow-lg flex items-center gap-2"
              >
                <Plus size={16} />
                Load More Transactions
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Summary Report Modal */}
      <AnimatePresence>
        {showSummaryReport && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSummaryReport(false)}
              className="absolute inset-0 bg-[#0a0a0a]/80 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-7xl h-[85vh] bg-white rounded-[40px] shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-8 border-b border-black/5 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h2 className="font-serif italic text-3xl text-[#141414]">Financial Overview</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 mt-1">Yearly Category Matrix</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex bg-gray-100 p-1 rounded-xl">
                    {(() => {
                      const years = Array.from(new Set(transactions.map(t => format(parseISO(t.date), 'yyyy'))))
                        .sort()
                        .reverse();
                      
                      // Auto-select latest year if 'All' is selected when entering overview
                      if (filterYear === 'All' && years.length > 0 && showSummaryReport) {
                        setTimeout(() => setFilterYear(years[0]), 0);
                      }

                      return years.map(year => (
                        <button
                          key={year}
                          onClick={() => setFilterYear(year)}
                          className={cn(
                            "px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                            filterYear === year ? "bg-white text-brand-orange shadow-sm" : "text-black/40 hover:text-black"
                          )}
                        >
                          {year}
                        </button>
                      ));
                    })()}
                  </div>
                  <button 
                    onClick={() => setShowSummaryReport(false)}
                    className="p-2 hover:bg-gray-200 rounded-full transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-8 custom-scrollbar">
                <div className="min-w-[1000px]">
                  <table className="w-full border-separate border-spacing-0">
                    {/* Matrix Generation */}
                    {(() => {
                      const colRange = (() => {
                        if (filterYear !== 'All') {
                          return Array.from({ length: 12 }, (_, i) => {
                            const date = new Date(parseInt(filterYear), i, 1);
                            return {
                              key: format(date, 'yyyy-MM'),
                              label: format(date, 'MMM yy')
                            };
                          });
                        }
                        
                        if (transactions.length === 0) return [];
                        
                        const dates = transactions.map(t => parseISO(t.date));
                        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
                        const maxDate = new Date(Math.max(...dates.map(d => d.getTime()), new Date().getTime()));
                        
                        const range = [];
                        let curr = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
                        const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
                        
                        while (curr <= end) {
                          range.push({
                            key: format(curr, 'yyyy-MM'),
                            label: format(curr, 'MMM yy')
                          });
                          curr.setMonth(curr.getMonth() + 1);
                        }
                        return range;
                      })();

                      const categories = [...new Set(transactions.filter(t => (filterYear === 'All' || format(parseISO(t.date), 'yyyy') === filterYear) && (filterCarId === 'All' || t.carId === filterCarId)).map(t => t.category))].sort();
                      
                      const matrix: { [cat: string]: { [mKey: string]: number } } = {};
                      const colIncomeTotals: { [mKey: string]: number } = {};
                      const colExpenseTotals: { [mKey: string]: number } = {};
                      const colGrandTotals: { [mKey: string]: number } = {};
                      let grandTotal = 0;
                      let totalIncome = 0;
                      let totalExpense = 0;

                      categories.forEach(cat => {
                        matrix[cat] = {};
                        colRange.forEach(col => {
                          const txs = transactions.filter(t => t.category === cat && format(parseISO(t.date), 'yyyy-MM') === col.key && (filterCarId === 'All' || t.carId === filterCarId));
                          const val = txs.reduce((sum, t) => sum + (t.type === 'Income' ? t.amount : -t.amount), 0);
                          const inc = txs.filter(t => t.type === 'Income').reduce((sum, t) => sum + t.amount, 0);
                          const exp = txs.filter(t => t.type === 'Expense').reduce((sum, t) => sum + t.amount, 0);
                          
                          matrix[cat][col.key] = val;
                          colIncomeTotals[col.key] = (colIncomeTotals[col.key] || 0) + inc;
                          colExpenseTotals[col.key] = (colExpenseTotals[col.key] || 0) + exp;
                          colGrandTotals[col.key] = (colGrandTotals[col.key] || 0) + val;
                          grandTotal += val;
                          totalIncome += inc;
                          totalExpense += exp;
                        });
                      });

                      return (
                        <>
                          <thead className="sticky top-0 z-30">
                            <tr>
                              <th className="sticky left-0 z-40 bg-gray-50 p-4 text-left font-serif italic text-lg border-b border-black/5 min-w-[200px] shadow-[2px_0_5px_rgba(0,0,0,0.05)]">Category</th>
                              {colRange.map((col, i) => (
                                <th key={i} className="p-4 text-center text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 bg-gray-50">
                                  {col.label}
                                </th>
                              ))}
                              <th className="p-4 text-center text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 bg-gray-50 sticky right-0 z-10 shadow-[-2px_0_5px_rgba(0,0,0,0.05)]">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {categories.map((cat, idx) => (
                              <tr key={idx} className="group hover:bg-gray-50/50">
                                <td className="sticky left-0 z-20 bg-white group-hover:bg-gray-50/50 p-4 border-b border-black/5 font-bold text-xs uppercase tracking-wider text-[#141414] shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                                  {cat}
                                </td>
                                {colRange.map(col => {
                                  const val = matrix[cat][col.key];
                                  return (
                                    <td key={col.key} className={cn(
                                      "p-4 text-center font-mono text-xs border-b border-black/5 bg-white/40",
                                      val > 0 ? "text-green-600" : val < 0 ? "text-red-600" : "text-black/20"
                                    )}>
                                      {val !== 0 ? `฿${Math.abs(val).toLocaleString()}` : '-'}
                                    </td>
                                  );
                                })}
                                <td className="p-4 text-center font-mono text-xs font-bold border-b border-black/5 bg-gray-50 sticky right-0 z-10 shadow-[-2px_0_5px_rgba(0,0,0,0.05)]">
                                  {(() => {
                                    const rowTotal = colRange.reduce((sum, col) => sum + matrix[cat][col.key], 0);
                                    return (
                                      <span className={rowTotal > 0 ? "text-green-600" : rowTotal < 0 ? "text-red-600" : ""}>
                                        ฿{Math.abs(rowTotal).toLocaleString()}
                                      </span>
                                    );
                                  })()}
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-gray-100 font-bold sticky bottom-[64px] z-30">
                              <td className="sticky left-0 z-40 bg-gray-100 p-4 border-t-2 border-black/10 text-xs uppercase tracking-widest shadow-[2px_0_5px_rgba(0,0,0,0.05)]">NET PROFIT</td>
                              {colRange.map(col => (
                                <td key={col.key} className={cn(
                                  "p-4 text-center font-mono text-xs border-t-2 border-black/10",
                                  colGrandTotals[col.key] > 0 ? "text-green-600" : colGrandTotals[col.key] < 0 ? "text-red-600" : ""
                                )}>
                                  ฿{colGrandTotals[col.key] ? Math.abs(colGrandTotals[col.key]).toLocaleString() : 0}
                                </td>
                              ))}
                              <td className={cn(
                                "p-4 text-center font-mono text-xs border-t-2 border-black/10 bg-gray-200 sticky right-0 z-40 shadow-[-2px_0_5px_rgba(0,0,0,0.05)]",
                                grandTotal > 0 ? "text-green-600" : grandTotal < 0 ? "text-red-600" : ""
                              )}>
                                ฿{Math.abs(grandTotal).toLocaleString()}
                              </td>
                            </tr>
                            <tr className="bg-green-50 font-bold sticky bottom-[32px] z-30">
                              <td className="sticky left-0 z-40 bg-green-50 p-4 border-t border-black/5 text-xs uppercase tracking-widest text-green-600 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">INCOME</td>
                              {colRange.map(col => (
                                <td key={col.key} className="p-4 text-center font-mono text-xs border-t border-black/5 text-green-600">
                                  ฿{colIncomeTotals[col.key] ? colIncomeTotals[col.key].toLocaleString() : 0}
                                </td>
                              ))}
                              <td className="p-4 text-center font-mono text-xs border-t border-black/5 bg-green-100/50 text-green-600 sticky right-0 z-40 shadow-[-2px_0_5px_rgba(0,0,0,0.05)]">
                                ฿{totalIncome.toLocaleString()}
                              </td>
                            </tr>
                            <tr className="bg-red-50 font-bold sticky bottom-0 z-30">
                              <td className="sticky left-0 z-40 bg-red-50 p-4 border-t border-black/5 text-xs uppercase tracking-widest text-red-600 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">EXPENSES</td>
                              {colRange.map(col => (
                                <td key={col.key} className="p-4 text-center font-mono text-xs border-t border-black/5 text-red-600">
                                  ฿{colExpenseTotals[col.key] ? colExpenseTotals[col.key].toLocaleString() : 0}
                                </td>
                              ))}
                              <td className="p-4 text-center font-mono text-xs border-t border-black/5 bg-red-100/50 text-red-600 sticky right-0 z-40 shadow-[-2px_0_5px_rgba(0,0,0,0.05)]">
                                ฿{totalExpense.toLocaleString()}
                              </td>
                            </tr>
                          </tbody>
                        </>
                      );
                    })()}
                  </table>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="absolute inset-0 bg-warm-bg/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white/60 backdrop-blur-xl border border-white/40 shadow-2xl w-full max-w-xl overflow-hidden rounded-[40px]"
            >
              <div className="p-6 border-b border-white/20 flex justify-between items-center bg-white/40 backdrop-blur-xl">
                <h2 className="font-serif italic text-2xl text-gray-900">
                  {modalType === 'AccountEdit' ? `Edit ${selectedAccount?.name}` : 
                   modalType === 'TransactionEdit' ? 'Edit Transaction' :
                   `Log ${modalType}`}
                </h2>
                <button 
                  onClick={() => setShowModal(false)} 
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/40 hover:bg-brand-orange hover:text-white transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8">
                {modalType === 'AccountEdit' ? (
                  <form onSubmit={handleAccountUpdate} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">New Balance (THB)</label>
                      <div className="relative">
                        <input 
                          type="number"
                          step="0.01"
                          className="w-full bg-white/40 border-b-2 border-white/60 p-4 text-2xl font-bold focus:border-brand-orange outline-none transition-all rounded-t-2xl"
                          value={formData.amount}
                          onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
                          required
                        />
                      </div>
                    </div>
                    <button 
                      type="submit"
                      className="w-full bg-brand-orange text-white py-4 rounded-3xl font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange/90 transition-all shadow-lg shadow-brand-orange/20"
                    >
                      Update Balance
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleTransactionSubmit} className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Amount (THB)</label>
                        <input 
                          type="number"
                          step="0.01"
                          className="w-full bg-white/40 border-b-2 border-white/60 p-3 text-lg font-bold focus:border-brand-orange outline-none transition-all rounded-t-2xl"
                          value={formData.amount}
                          onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Date & Time</label>
                        <input 
                          type="datetime-local"
                          className="w-full bg-white/40 border-b-2 border-white/60 p-3 text-sm focus:border-brand-orange outline-none transition-all rounded-t-2xl"
                          value={formData.date}
                          onChange={e => setFormData({ ...formData, date: e.target.value })}
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">
                          {modalType === 'Transfer' ? 'From Account' : 'Account'}
                        </label>
                        <select 
                          className="w-full bg-white/40 border-b-2 border-white/60 p-3 text-sm focus:border-brand-orange outline-none transition-all rounded-t-2xl appearance-none"
                          value={formData.accountId}
                          onChange={e => setFormData({ ...formData, accountId: e.target.value })}
                          required
                        >
                          {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>{acc.name}</option>
                          ))}
                        </select>
                      </div>
                      {modalType === 'Transfer' ? (
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">To Account</label>
                          <select 
                            className="w-full bg-white/40 border-b-2 border-white/60 p-3 text-sm focus:border-brand-orange outline-none transition-all rounded-t-2xl appearance-none"
                            value={formData.toAccountId}
                            onChange={e => setFormData({ ...formData, toAccountId: e.target.value })}
                            required
                          >
                            <option value="">Select destination...</option>
                            {accounts.filter(a => a.id !== formData.accountId).map(acc => (
                              <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Category</label>
                          <select 
                            className="w-full bg-white/40 border-b-2 border-white/60 p-3 text-sm focus:border-brand-orange outline-none transition-all rounded-t-2xl appearance-none"
                            value={formData.category}
                            onChange={e => setFormData({ ...formData, category: e.target.value })}
                            required
                          >
                            <option value="">Select category...</option>
                            {(modalType === 'Income' || (modalType === 'TransactionEdit' && transactions.find(t => t.id === editingTransactionId)?.type === 'Income')) ? (
                              <>
                                <option value="Rental">Rental</option>
                                <option value="Deposit">Deposit</option>
                                <option value="Insurance Claim">Insurance Claim</option>
                                <option value="Other Income">Other Income</option>
                              </>
                            ) : (
                              <>
                                <option value="Maintenance">Maintenance</option>
                                <option value="Fuel">Fuel</option>
                                <option value="Insurance">Insurance</option>
                                <option value="Tax">Tax</option>
                                <option value="Staff Salary">Staff Salary</option>
                                <option value="Rent">Rent</option>
                                <option value="Utilities">Utilities</option>
                                <option value="Marketing">Marketing</option>
                                <option value="Other Expense">Other Expense</option>
                              </>
                            )}
                          </select>
                        </div>
                      )}
                    </div>

                    {modalType !== 'Transfer' && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4 flex items-center gap-2">
                          Vehicle (Optional)
                        </label>
                        <Select
                          options={carOptions}
                          value={carOptions.find(opt => opt.value === formData.carId)}
                          onChange={(newValue: any) => setFormData({ ...formData, carId: newValue.value })}
                          isSearchable
                          placeholder="Search vehicle..."
                          components={{ Option: CustomOption, SingleValue: CustomSingleValue }}
                          styles={{
                            control: (base) => ({
                              ...base,
                              backgroundColor: 'rgba(255, 255, 255, 0.4)',
                              border: 'none',
                              borderBottom: '2px solid rgba(255, 255, 255, 0.6)',
                              borderRadius: '1rem 1rem 0 0',
                              padding: '2px',
                              boxShadow: 'none',
                              '&:hover': {
                                borderBottomColor: '#FF6B00'
                              }
                            }),
                            menu: (base) => ({
                              ...base,
                              backgroundColor: 'rgba(255, 255, 255, 0.95)',
                              backdropFilter: 'blur(10px)',
                              borderRadius: '1rem',
                              overflow: 'hidden',
                              border: '1px solid rgba(255, 255, 255, 0.4)',
                              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
                            }),
                            option: (base, state) => ({
                              ...base,
                              backgroundColor: state.isFocused ? 'rgba(255, 107, 0, 0.1)' : 'transparent',
                              color: 'inherit',
                              cursor: 'pointer',
                              '&:active': {
                                backgroundColor: 'rgba(255, 107, 0, 0.2)'
                              }
                            }),
                            input: (base) => ({
                              ...base,
                              color: '#1A1A1A'
                            }),
                            singleValue: (base) => ({
                              ...base,
                              color: '#1A1A1A'
                            })
                          }}
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-4">Description / Notes</label>
                      <textarea 
                        className="w-full bg-white/40 border-b-2 border-white/60 p-3 text-sm focus:border-brand-orange outline-none transition-all h-24 resize-none rounded-t-2xl"
                        value={formData.description}
                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                      />
                    </div>

                    <button 
                      type="submit"
                      className={cn(
                        "w-full py-4 rounded-3xl font-bold uppercase tracking-widest text-[10px] transition-all shadow-lg",
                        (modalType === 'Income' || (modalType === 'TransactionEdit' && transactions.find(t => t.id === editingTransactionId)?.type === 'Income')) ? "bg-green-500 text-white shadow-green-500/20" : 
                        (modalType === 'Expense' || (modalType === 'TransactionEdit' && transactions.find(t => t.id === editingTransactionId)?.type === 'Expense')) ? "bg-red-500 text-white shadow-red-500/20" :
                        "bg-brand-orange text-white shadow-brand-orange/20"
                      )}
                    >
                      {editingTransactionId ? 'Update Transaction' : `Log ${modalType}`}
                    </button>
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Deposits Modal */}
      <AnimatePresence>
        {showDepositsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDepositsModal(false)}
              className="absolute inset-0 bg-warm-bg/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white/60 backdrop-blur-xl border border-white/40 shadow-2xl w-full max-w-4xl overflow-hidden rounded-[40px]"
            >
              <div className="p-6 border-b border-white/20 flex justify-between items-center bg-white/40 backdrop-blur-xl">
                <h2 className="font-serif italic text-2xl text-gray-900">Vehicle Deposits</h2>
                <button 
                  onClick={() => setShowDepositsModal(false)} 
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/40 hover:bg-brand-orange hover:text-white transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 overflow-y-auto max-h-[70vh]">
                <div className="grid grid-cols-1 gap-4">
                  {cars.map(car => {
                    const now = new Date();
                    const currentBooking = bookings.find(b => 
                      b.carId === car.id && 
                      isWithinInterval(now, { 
                        start: parseISO(b.startDate), 
                        end: parseISO(b.endDate) 
                      })
                    );

                    return (
                      <div key={car.id} className="bg-white/40 border border-white/60 p-6 rounded-3xl flex items-center justify-between group hover:bg-white/60 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-brand-orange/10 rounded-2xl flex items-center justify-center border border-brand-orange/20">
                            <CarIcon size={24} className="text-brand-orange" />
                          </div>
                          <div>
                            <h4 className="font-bold text-[#141414]">{car.name}</h4>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">{car.plateNumber}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-12">
                          <div className="text-right">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 mb-1">Current Renter</p>
                            <p className={cn(
                              "text-sm font-bold",
                              currentBooking ? "text-[#141414]" : "text-[#141414]/20 italic"
                            )}>
                              {currentBooking ? currentBooking.customerName : 'No active rental'}
                            </p>
                          </div>

                          <div className="text-right min-w-[120px]">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 mb-1">Deposit Held</p>
                            <p className={cn(
                              "text-lg font-bold",
                              (currentBooking?.deposit || 0) > 0 ? "text-emerald-600" : "text-[#141414]/20"
                            )}>
                              ฿{(currentBooking?.deposit || 0).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-warm-bg/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white/60 backdrop-blur-xl border border-white/40 shadow-2xl w-full max-w-md overflow-hidden rounded-[40px] p-8 text-center"
            >
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-100">
                <Trash2 size={32} className="text-red-500" />
              </div>
              <h3 className="font-serif italic text-2xl text-gray-900 mb-2">Confirm Deletion</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                Are you sure you want to delete this transaction? This will also revert the account balance. This action cannot be undone.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-4 rounded-3xl font-bold uppercase tracking-widest text-[10px] bg-white/40 hover:bg-white/60 transition-all border border-white/60"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 py-4 rounded-3xl font-bold uppercase tracking-widest text-[10px] bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
