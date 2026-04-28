import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { UserProfile } from '../types';
import { Shield, User as UserIcon, Mail, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO, isValid } from 'date-fns';
import { toast } from 'sonner';

export const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'users'), orderBy('lastLogin', 'desc'));
        const snapshot = await getDocs(q);
        const usersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile));
        setUsers(usersData);
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'users');
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const formatLastLogin = (dateString?: string) => {
    if (!dateString) return 'Never';
    try {
      const date = parseISO(dateString);
      if (!isValid(date)) return 'Invalid Date';
      return format(date, 'MMM d, yyyy HH:mm');
    } catch (e) {
      return 'Invalid Date';
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-orange" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-warm-bg custom-scrollbar">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="font-serif italic text-4xl text-[#1A1A1A] mb-2">User Management</h1>
            <p className="text-[#1A1A1A]/60 uppercase tracking-widest text-xs">Manage staff access and roles</p>
          </div>
          <div className="bg-white/40 backdrop-blur-md border border-white/60 px-6 py-3 rounded-2xl flex items-center gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/60">
              {users.length} Active Staff Members
            </span>
          </div>
        </div>

        <div className="grid gap-4">
          <AnimatePresence mode="popLayout">
            {users.map((user) => (
              <motion.div
                key={user.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white/40 backdrop-blur-xl border border-white/60 p-6 rounded-[32px] shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-brand-orange/10 rounded-2xl flex items-center justify-center text-brand-orange">
                      <UserIcon size={32} />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-bold text-lg text-[#1A1A1A]">{user.displayName || 'Unnamed User'}</h3>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest",
                          user.role === 'admin' ? "bg-brand-orange text-white" : "bg-white/60 text-[#1A1A1A]/60 border border-white/60"
                        )}>
                          {user.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[#1A1A1A]/40 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Mail size={12} />
                          {user.email}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} />
                          Last Login: {formatLastLogin(user.lastLogin)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Role change buttons and delete button removed as requested */}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="mt-12 bg-brand-orange/5 border border-brand-orange/10 p-8 rounded-[40px]">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-brand-orange/10 rounded-2xl flex items-center justify-center text-brand-orange shrink-0">
              <Shield size={24} />
            </div>
            <div>
              <h3 className="font-bold text-[#1A1A1A] mb-2">Security Note</h3>
              <p className="text-sm text-[#1A1A1A]/60 leading-relaxed">
                Roles define what users can see and do. <span className="font-bold text-brand-orange">Admins</span> have full access to all settings, including user management and financial records. <span className="font-bold text-[#1A1A1A]">Staff</span> can manage the fleet and bookings but cannot modify system settings or view sensitive financial data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function for class names
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
