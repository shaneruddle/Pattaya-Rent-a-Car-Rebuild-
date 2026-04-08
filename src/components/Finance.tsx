import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, doc, deleteDoc, Timestamp, where, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, logSystemActivity } from '../firebase';
import { Transaction, Account, Car, Booking } from '../types';
import { format, startOfDay, endOfDay, isSameDay, parseISO, isWithinInterval } from 'date-fns';
import { 
  Plus, 
  ArrowUpRight, 
  ArrowDownRight, 
  ArrowRightLeft, 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  Search,
  Calendar as CalendarIcon,
  Filter,
  Car as CarIcon,
  MoreVertical,
  Trash2,
  Edit2,
  X,
  ShieldCheck
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

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

export const Finance: React.FC<FinanceProps> = ({ cars, bookings, preFill, onClearPreFill }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDepositsModal, setShowDepositsModal] = useState(false);
  const [modalType, setModalType] = useState<'Income' | 'Expense' | 'Transfer' | 'AccountEdit' | 'TransactionEdit'>('Income');
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [successAction, setSuccessAction] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  
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

  const filteredTransactions = useMemo(() => {
    if (!searchTerm) return transactions;
    const lowerSearch = searchTerm.toLowerCase();
    return transactions.filter(tx => {
      const categoryMatch = tx.category.toLowerCase().includes(lowerSearch);
      const descriptionMatch = tx.description?.toLowerCase().includes(lowerSearch) ?? false;
      const typeMatch = tx.type.toLowerCase().includes(lowerSearch);
      const accountName = accounts.find(a => a.id === tx.accountId)?.name.toLowerCase() ?? '';
      const accountMatch = accountName.includes(lowerSearch);
      const carName = tx.carId ? (cars.find(c => c.id === tx.carId)?.name.toLowerCase() ?? '') : '';
      const carMatch = carName.includes(lowerSearch);
      
      return categoryMatch || descriptionMatch || typeMatch || accountMatch || carMatch;
    });
  }, [transactions, searchTerm, accounts, cars]);

  useEffect(() => {
    if (!showModal && successAction) {
      // Use a small delay to ensure the modal animation has finished
      const timer = setTimeout(() => {
        window.alert(successAction);
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

  useEffect(() => {
    const unsubscribeAccounts = onSnapshot(collection(db, 'accounts'), (snapshot) => {
      const accountsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account));
      setAccounts(accountsData);
      
      // Initialize accounts if they don't exist
      if (accountsData.length === 0) {
        const initialAccounts = [
          "Kasikorn company bank",
          "Kasikorn personal bank",
          "Cash",
          "Krungthai bank"
        ];
        initialAccounts.forEach(name => {
          addDoc(collection(db, 'accounts'), { name, balance: 0 }).catch(error => {
            handleFirestoreError(error, OperationType.CREATE, 'accounts');
          });
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'accounts');
    });

    const transactionsQuery = query(collection(db, 'transactions'), orderBy('date', 'desc'), limit(100));
    const unsubscribeTransactions = onSnapshot(transactionsQuery, (snapshot) => {
      const transactionsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(transactionsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
      setLoading(false);
    });

    return () => {
      unsubscribeAccounts();
      unsubscribeTransactions();
    };
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
        editingTransactionId ? 'Update Transaction' : 'New Transaction',
        `${editingTransactionId ? 'Updated' : 'Created'} ${modalType === 'Transfer' ? 'transfer' : modalType} transaction: ${formData.description} (THB ${formData.amount.toLocaleString()})`,
        'Finance',
        { transactionId: editingTransactionId || 'new', type: modalType, amount: formData.amount }
      );

      setShowModal(false);
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'transactions/accounts');
      toast.error("Failed to process transaction");
    }
  };

  const handleEditTransaction = (tx: Transaction) => {
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
  };

  const handleDeleteTransaction = (tx: Transaction) => {
    setTransactionToDelete(tx);
    setShowDeleteConfirm(true);
  };

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
        'Delete Transaction',
        `Deleted ${tx.type === 'Transfer' ? 'transfer' : tx.type} transaction: ${tx.description} (THB ${tx.amount.toLocaleString()})`,
        'Finance',
        { transactionId: tx.id }
      );

      toast.success("Transaction deleted and balance reverted");
      setShowDeleteConfirm(false);
      setTransactionToDelete(null);
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

  const totalBalance = useMemo(() => accounts.reduce((sum, acc) => sum + acc.balance, 0), [accounts]);

  return (
    <div className="flex-1 overflow-auto bg-warm-bg p-8">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header */}
        <header className="flex justify-between items-end">
          <div>
            <h1 className="font-serif italic text-5xl text-[#141414] mb-2">Finance</h1>
            <p className="text-[#141414]/60 uppercase tracking-[0.2em] text-[10px] font-bold">Financial Operations & Tracking</p>
          </div>
          <div className="flex gap-4">
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
          </div>
        </header>

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
        </div>

        {/* Transactions Table */}
        <div className="bg-white/40 backdrop-blur-md border border-white/60 rounded-[40px] shadow-xl overflow-hidden">
          <div className="p-8 border-b border-white/20 flex justify-between items-center bg-white/40 backdrop-blur-xl">
            <div>
              <h2 className="font-serif italic text-3xl text-[#141414]">Recent Transactions</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 mt-1">History of all movements</p>
            </div>
            <div className="flex gap-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/40" size={16} />
                <input 
                  type="text" 
                  placeholder="Search transactions..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-11 pr-6 py-2.5 bg-white/40 border border-white/60 rounded-2xl text-[10px] font-bold uppercase tracking-widest focus:border-brand-orange focus:bg-white/60 outline-none transition-all w-72"
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
                      {searchTerm ? "No transactions match your search." : "No transactions logged yet."}
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-white/40 transition-colors group">
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
                          {tx.carId && (
                            <span className="px-2 py-1 bg-brand-orange/10 text-brand-orange rounded-lg text-[8px] flex items-center gap-1.5 w-fit">
                              <CarIcon size={10} /> {cars.find(c => c.id === tx.carId)?.name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-6 text-xs font-bold text-[#141414]/80">
                        <div className="flex flex-col gap-1">
                          {accounts.find(a => a.id === tx.accountId)?.name}
                          {tx.type === 'Transfer' && (
                            <div className="flex items-center gap-2 text-[#141414]/40">
                              <ArrowRightLeft size={10} /> {accounts.find(a => a.id === tx.toAccountId)?.name}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="p-6 text-xs text-[#141414]/60 italic font-serif leading-relaxed max-w-xs">
                        {tx.description}
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
                            onClick={() => handleEditTransaction(tx)}
                            className="p-2 hover:bg-brand-orange hover:text-white rounded-lg transition-all text-[#141414]/40"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => handleDeleteTransaction(tx)}
                            className="p-2 hover:bg-red-500 hover:text-white rounded-lg transition-all text-[#141414]/40"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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
                        <select 
                          className="w-full bg-white/40 border-b-2 border-white/60 p-3 text-sm focus:border-brand-orange outline-none transition-all rounded-t-2xl appearance-none"
                          value={formData.carId}
                          onChange={e => setFormData({ ...formData, carId: e.target.value })}
                        >
                          <option value="">None</option>
                          {cars.map(car => (
                            <option key={car.id} value={car.id}>{car.name} ({car.plateNumber})</option>
                          ))}
                        </select>
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
