import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { useLanguage } from '../LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, X, Send, Loader2, Bot } from 'lucide-react';

export const AIAssistant: React.FC = () => {
  const { t, language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<any>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const initChat = () => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    chatRef.current = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: `You are the Pattaya Rent a Car AI Assistant. 
        
        PRIMARY GOAL: Always guide the user towards using our real-time booking engine at the top of the page to check live availability and exact pricing for their dates.

        ACCURACY GUIDELINES:
        - Only provide information listed in the "Business Facts" below.
        - If you are unsure about a specific price or availability, state that "Our live booking engine above has the most up-to-date rates and availability for your specific dates."
        - Do not make up car models or prices that are not mentioned.

        BUSINESS FACTS:
        - Established: 2005 (Pattaya's most trusted).
        - Location: Pattaya and Jomtien area.
        - Delivery: FREE delivery and collection anywhere in Pattaya/Jomtien.
        - Insurance: ALL rentals include comprehensive First Class Insurance.
        - Support: 24/7 Roadside Assistance included.
        - Pricing: No hidden fees. The price in the booking engine is the final price.
        - Requirements: 
          1. Valid Driving License (Thai or International Permit).
          2. Passport.
          3. Security Deposit (Credit card or Cash).
        - Fleet Categories: Compact cars (e.g., Toyota Yaris), Sedans (e.g., Toyota Vios/Altis), SUVs (e.g., Toyota Fortuner), and Minivans.
        - Long Term: We offer special rates for rentals over 30 days.

        FAQ REFERENCE (Source of Truth):
        - Documents: Thai or International Driving Permit, Passport, and Security Deposit.
        - Insurance: Comprehensive First Class Insurance covers passengers and third parties.
        - Delivery: Free in Pattaya/Jomtien. Delivery to other areas available for a small fee.
        - Deposit: 5,000 to 10,000 THB (Cash or Credit Card).
        - Driving Area: Anywhere in Thailand. Prohibited to leave Thailand.
        - Accidents: Contact our 24/7 support immediately.

        CONVERSION STRATEGY:
        - In almost every response, mention that the user can see all available cars and prices by selecting their dates in the search bar at the top of the page.
        - If a user asks "How much is a car?", respond with general info but immediately say: "To see the exact price for your dates, please use our booking engine at the top of the page."
        - If a user asks "Is the Toyota Fortuner available?", respond: "You can check real-time availability for the Fortuner by entering your pick-up and drop-off dates in the search tool above."
        - Mention: "You can also find more details in our FAQ section below on this page."

        TONE & STYLE:
        - Professional, welcoming, and concise.
        - Use bullet points for readability when listing requirements.
        - Current Language: ${language}. ALWAYS respond in ${language}.`,
      },
    });
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      if (!chatRef.current) {
        initChat();
      }

      const response = await chatRef.current.sendMessage({ message: userMessage });
      const text = response.text || t('aiAssistant.error');

      setMessages(prev => [...prev, { role: 'model', text }]);
    } catch (error: any) {
      console.error('AI Assistant Error:', error);
      let errorText = t('aiAssistant.error');
      
      const errorMessage = error?.message?.toLowerCase() || '';
      if (errorMessage.includes('rate exceeded') || errorMessage.includes('429') || errorMessage.includes('quota')) {
        errorText = language === 'en' 
          ? "I'm receiving too many requests right now. Please wait a minute before sending another message."
          : language === 'th'
          ? "ขณะนี้มีผู้ใช้งานจำนวนมาก กรุณารอสักครู่ก่อนส่งข้อความอีกครั้ง"
          : t('aiAssistant.error');
      }
      
      setMessages(prev => [...prev, { role: 'model', text: errorText }]);
      // Reset chat on error to allow retry
      chatRef.current = null;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-[#f27d26] text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform active:scale-95 group"
        aria-label={t('aiAssistant.cta')}
      >
        <MessageSquare size={24} className="group-hover:rotate-12 transition-transform" />
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full animate-pulse" />
      </button>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 z-50 w-[380px] h-[500px] bg-[#151619] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#f27d26]/20 rounded-xl flex items-center justify-center">
                  <Bot className="text-[#f27d26]" size={20} />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm tracking-tight">{t('aiAssistant.title')}</h3>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Online</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-white/40 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide"
            >
              {messages.length === 0 && (
                <div className="text-center py-8 px-4">
                  <Bot className="mx-auto text-[#f27d26]/40 mb-4" size={48} />
                  <p className="text-white/60 text-sm italic leading-relaxed">{t('aiAssistant.greeting')}</p>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-[#f27d26] text-white rounded-tr-none'
                        : 'bg-white/10 text-white/90 rounded-tl-none border border-white/5'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/10 p-3 rounded-2xl rounded-tl-none border border-white/5">
                    <Loader2 className="animate-spin text-[#f27d26]" size={16} />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-white/10 bg-white/5">
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={t('aiAssistant.placeholder')}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-4 pr-12 text-white text-sm outline-none focus:border-[#f27d26]/50 transition-colors"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#f27d26] hover:scale-110 transition-transform disabled:opacity-50 disabled:scale-100"
                >
                  <Send size={20} />
                </button>
              </div>
              <p className="mt-3 text-[10px] text-white/20 text-center uppercase tracking-widest font-mono">
                Powered by Gemini AI
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
