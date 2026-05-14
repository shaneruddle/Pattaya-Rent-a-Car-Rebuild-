import React from 'react';
import { motion } from 'motion/react';
import { Home, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen bg-warm-bg flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-8">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-24 h-24 bg-brand-orange/10 rounded-full flex items-center justify-center text-brand-orange">
            <AlertTriangle size={48} strokeWidth={1.5} />
          </div>
          <h1 className="text-6xl font-black tracking-tighter text-[#1A1A1A]">404</h1>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Page Not Found</h2>
          <p className="text-[#1A1A1A]/60 font-medium">
            Sorry, we couldn't find the page you're looking for. It might have been moved or doesn't exist anymore.
          </p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <Link
            to="/"
            className="inline-flex items-center gap-2 bg-[#1A1A1A] text-white px-8 py-4 rounded-full font-bold uppercase tracking-[0.2em] text-[10px] hover:bg-brand-orange transition-all shadow-xl hover:shadow-brand-orange/20"
          >
            <Home size={16} />
            Back to Homepage
          </Link>
        </motion.div>
      </div>
    </div>
  );
};

export default NotFound;
