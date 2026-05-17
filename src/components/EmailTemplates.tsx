import React, { useState, useEffect, useMemo } from 'react';
import { Mail, Save, Copy, Info, Loader2, Check, Zap, Eye, Send, X, Smartphone } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { EmailTemplate, AppSettings } from '../types';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { sanitizeEmailHtml, formatNewlines, processTemplate, sendTemplatedEmail, prepareHtmlForEmail } from '../lib/emailUtils';
import { useCompanyConfig } from '../hooks/useCompanyConfig';

const DYNAMIC_TAGS = [
  { tag: '{{customer_name}}', label: 'Customer Name' },
  { tag: '{{customer_email}}', label: 'Email Address' },
  { tag: '{{customer_phone}}', label: 'Phone Number' },
  { tag: '{{vehicle_model}}', label: 'Vehicle Model' },
  { tag: '{{plate_number}}', label: 'Plate Number' },
  { tag: '{{pickup_date}}', label: 'Pick Up Date' },
  { tag: '{{pickup_time}}', label: 'Pick Up Time' },
  { tag: '{{return_date}}', label: 'Return Date' },
  { tag: '{{return_time}}', label: 'Return Time' },
  { tag: '{{rental_period}}', label: 'Rental Period (Range)' },
  { tag: '{{total_price}}', label: 'Total Price' },
  { tag: '{{delivery_address}}', label: 'Delivery Address' },
  { tag: '{{comments}}', label: 'Comments / Notes' },
  { tag: '{{photos}}', label: 'Damage Photos Grid' },
];

/**
 * Quill configuration moved outside component to prevent re-registration errors
 */
const QUILL_MODULES = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    ['link', 'clean'],
  ],
  clipboard: {
    matchVisual: false, // Prevents extra line breaks on paste
  }
};

const QUILL_FORMATS = [
  'header',
  'bold', 'italic', 'underline', 'strike',
  'color', 'background',
  'list',
  'link',
  'break' 
];

export const EmailTemplates: React.FC = () => {
  const { config } = useCompanyConfig();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    id: 'global',
    bccEmail: config.email || 'info@pattayarentacar.com',
    bankDetails: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [showTestEmailModal, setShowTestEmailModal] = useState(false);
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [newTemplateData, setNewTemplateData] = useState({ name: '', id: '' });
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (auth.currentUser?.email) {
      setTestEmailAddress(auth.currentUser.email);
    }
  }, []);

  const activeTemplate = useMemo(() => 
    templates.find(t => t.id === activeTemplateId) || null, 
    [templates, activeTemplateId]
  );

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Fetch templates
      const templatesSnap = await getDocs(collection(db, 'email_templates'));
      if (templatesSnap.empty) {
        // Initial seed if empty
        const initialTemplates: EmailTemplate[] = [
          {
            id: 'rental_confirmation',
            name: 'Rental Confirmation',
            subject: 'Rental Confirmation - {{vehicle_model}}',
            body: '<p>Dear {{customer_name}},</p><p>Your booking for <strong>{{vehicle_model}}</strong> ({{plate_number}}) has been confirmed.</p><p><strong>Return Date:</strong> {{return_date}}<br><strong>Total Price:</strong> {{total_price}} THB</p><p>For your peace of mind, we have recorded the condition of the vehicle at the time of rental. Please see the photos below:</p>{{photos}}<p>Thank you for choosing us.</p>',
          },
          {
            id: 'extension_acknowledged',
            name: 'Extension Acknowledged',
            subject: 'Rental Extension Confirmation - {{vehicle_model}}',
            body: 'Dear {{customer_name}},\n\nYour rental extension for {{vehicle_model}} has been confirmed.\n\nNew Return Date: {{return_date}}\n\nThank you.',
          },
          {
            id: 'return_confirmation',
            name: 'Return Confirmation',
            subject: 'Rental Return Receipt - {{vehicle_model}}',
            body: 'Dear {{customer_name}},\n\nThank you for returning the {{vehicle_model}} ({{plate_number}}).\n\nTotal Paid: {{total_price}} THB\n\nWe hope to see you again soon.',
          },
          {
            id: 'booking_confirmed_with_delivery',
            name: 'Booking Confirmed with Delivery',
            subject: 'Booking Confirmed - {{vehicle_model}}',
            body: '<p>Hi {{customer_name}},</p><p>We are pleased to confirm your booking for <strong>{{vehicle_model}}</strong> with delivery to your location.</p><p><strong>Delivery Address:</strong> {{delivery_address}}</p><p><strong>Total Price:</strong> ฿{{total_price}}</p><p>See you soon!</p>',
          },
          {
            id: 'booking_enquiry',
            name: 'Booking Enquiry Confirmation',
            subject: 'Thank you for your enquiry',
            body: 'Dear {{customer_name}},\n\nThank you for your enquiry for a {{vehicle_model}}.\n\nRental Period: {{return_date}}\nTotal Price: {{total_price}} THB\n\nWe have received your request and will get back to you as soon as possible.\n\nBest regards.',
          },
          {
            id: 'website_enquiry',
            name: 'Website Enquiry Confirmation',
            subject: 'We have received your message',
            body: 'Dear {{customer_name}},\n\nThank you for contacting us through our website.\n\nWe have received your message and our team will get back to you shortly.\n\nBest regards.',
          },
          {
            id: 'enquiry_reply',
            name: 'Enquiry Reply (Manual)',
            subject: 'Re: Your rental enquiry',
            body: 'Hi {{customer_name}},\n\nThanks for your email. We can confirm availability of the {{vehicle_model}} (or similar) at a total rate of {{total_price}} THB\n\nIncluded in your rental:\n\n- First Class Rental Insurance\n- Unlimited kms\n- 24 hour breakdown cover for your piece of mind\n- Additional drivers\n- All taxes\n\nIn addition you can book now, pay later and cancel at anytime free of charge\n\nDo you wish to proceed with the booking ?',
          },
        ];

        for (const t of initialTemplates) {
          await setDoc(doc(db, 'email_templates', t.id), t);
        }
        setTemplates(initialTemplates);
        setActiveTemplateId(initialTemplates[0].id);
      } else {
        const fetchedTemplates = templatesSnap.docs.map(doc => {
          const data = doc.data();
          return {
            ...data,
            id: doc.id
          } as EmailTemplate;
        });
        setTemplates(fetchedTemplates);
        // Try to keep active template if it still exists, otherwise use first
        if (activeTemplateId) {
          const stillExists = fetchedTemplates.some(t => t.id === activeTemplateId);
          if (!stillExists) setActiveTemplateId(fetchedTemplates[0]?.id || null);
        } else {
          setActiveTemplateId(fetchedTemplates[0]?.id || null);
        }
      }

      // Fetch global settings
      const settingsSnap = await getDoc(doc(db, 'app_settings', 'global'));
      if (settingsSnap.exists()) {
        setSettings(settingsSnap.data() as AppSettings);
      } else {
        await setDoc(doc(db, 'app_settings', 'global'), settings);
      }
    } catch (error) {
      console.error('Error fetching email settings:', error);
      toast.error('Failed to load email settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'app_settings', 'global'), {
        ...settings,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      toast.success('Global settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = async (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    setSaving(true);
    try {
      await setDoc(doc(db, 'email_templates', templateId), {
        ...template,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
      toast.success(`${template.name} updated successfully`);
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTemplateData.name || !newTemplateData.id) {
      toast.error('Please enter name and ID');
      return;
    }

    // Sanitize ID
    const sanitizedId = newTemplateData.id.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (templates.some(t => t.id === sanitizedId)) {
      toast.error('A template with this ID already exists');
      return;
    }

    setSaving(true);
    try {
      const newTemplate: EmailTemplate = {
        id: sanitizedId,
        name: newTemplateData.name,
        subject: `New Template: ${newTemplateData.name}`,
        body: '<p>Hi {{customer_name}},</p><p>Start typing your message here...</p>',
        lastUpdated: new Date().toISOString()
      };

      await setDoc(doc(db, 'email_templates', sanitizedId), newTemplate);
      setTemplates(prev => [...prev, newTemplate]);
      setActiveTemplateId(sanitizedId);
      setShowNewTemplateModal(false);
      setNewTemplateData({ name: '', id: '' });
      toast.success('Template created successfully');
    } catch (error) {
      console.error('Error creating template:', error);
      toast.error('Failed to create template');
    } finally {
      setSaving(false);
    }
  };

  const updateTemplateField = (id: string, field: keyof EmailTemplate, value: string) => {
    setTemplates(prev => {
      const exists = prev.some(t => t.id === id);
      if (!exists) return prev;
      return prev.map(t => t.id === id ? { ...t, [field]: value } : t);
    });
  };

  const copyTag = (tag: string) => {
    navigator.clipboard.writeText(tag);
    toast.success(`Copied ${tag} to clipboard`);
  };

  const handleSendTestEmail = async () => {
    if (!activeTemplateId || !activeTemplate || !testEmailAddress) return;
    
    setSendingTest(true);
    try {
      // We must save first to use sendTemplatedEmail as it fetches from DB
      await handleSaveTemplate(activeTemplateId);
      
      const testPlaceholders = {
        '{{customer_name}}': 'John Doe',
        '{{customer_email}}': 'john@example.com',
        '{{customer_phone}}': '081-234-5678',
        '{{vehicle_model}}': 'Toyota Fortuner',
        '{{plate_number}}': 'ABC-1234',
        '{{pickup_date}}': '15 May 2024',
        '{{pickup_time}}': '10:00',
        '{{return_date}}': '20 May 2024',
        '{{return_time}}': '10:00',
        '{{rental_period}}': '15 May 2024 to 20 May 2024',
        '{{total_price}}': '15,000',
        '{{delivery_address}}': '123 Beach Road, Pattaya',
        '{{comments}}': 'Please bring a child seat.',
        '{{photos}}': [
          'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&q=80&w=400',
          'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=400',
          'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&q=80&w=400',
          'https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&q=80&w=400'
        ]
      };

      await sendTemplatedEmail(activeTemplateId, testEmailAddress, testPlaceholders);
      toast.success('Test email sent successfully');
      setShowTestEmailModal(false);
    } catch (error) {
      console.error('Error sending test email:', error);
      toast.error('Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const previewContent = useMemo(() => {
    if (!activeTemplate) return '';
    const testPlaceholders = {
      '{{customer_name}}': 'John Doe',
      '{{vehicle_model}}': 'Toyota Fortuner',
      '{{plate_number}}': 'ABC-1234',
      '{{pickup_date}}': '15 May 2024',
      '{{pickup_time}}': '10:00',
      '{{return_date}}': '20 May 2024',
      '{{return_time}}': '10:00',
      '{{rental_period}}': '15 May 2024 to 20 May 2024',
      '{{total_price}}': '15,000',
      '{{delivery_address}}': '123 Beach Road, Pattaya',
      '{{photos}}': [
        'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&q=80&w=400',
        'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=400',
        'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&q=80&w=400',
        'https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&q=80&w=400'
      ]
    };
    
    const bodyWithPlaceholders = processTemplate(activeTemplate.body, testPlaceholders);
    const sanitizedLayout = sanitizeEmailHtml(formatNewlines(bodyWithPlaceholders));
    return prepareHtmlForEmail(sanitizedLayout);
  }, [activeTemplate]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-orange" size={48} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F9F7F2]">
      <div className="p-8 max-w-6xl mx-auto space-y-8 pb-32">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif italic text-4xl text-[#1A1A1A]">Email Templates</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 mt-1">Manage automated communications and global settings</p>
          </div>
        </div>

        {/* Global Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white/40 backdrop-blur-xl border border-white/60 p-6 rounded-[32px] shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/60 flex items-center gap-2">
              <Info size={14} className="text-brand-orange" />
              Global Settings
            </h2>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-2">BCC Address</label>
                <input
                  type="email"
                  value={settings.bccEmail}
                  onChange={e => setSettings({ ...settings, bccEmail: e.target.value })}
                  className="w-full bg-white/60 border-0 p-4 rounded-2xl text-sm font-medium focus:ring-2 ring-brand-orange outline-none transition-all"
                  placeholder="e.g. info@pattayarentacar.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-2">Bank Details</label>
                <textarea
                  value={settings.bankDetails}
                  onChange={e => setSettings({ ...settings, bankDetails: e.target.value })}
                  className="w-full bg-white/60 border-0 p-4 rounded-2xl text-sm font-medium h-24 focus:ring-2 ring-brand-orange outline-none transition-all resize-none"
                  placeholder="e.g. Kasikorn Bank&#10;Account: 123-4-56789-0&#10;Name: PRAC Co., Ltd."
                />
              </div>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="flex items-center justify-center gap-2 px-6 h-12 bg-[#1A1A1A] text-white rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-brand-orange transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Global Settings
              </button>
            </div>
          </div>

          {/* Dynamic Tags Legend */}
          <div className="bg-[#1A1A1A] p-6 rounded-[32px] shadow-xl text-white space-y-4 group">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-white/60 flex items-center gap-2">
                <Zap size={14} className="text-brand-orange" />
                Dynamic Tags
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {DYNAMIC_TAGS.map(({ tag, label }) => (
                <button
                  key={tag}
                  onClick={() => copyTag(tag)}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-left"
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-brand-orange text-xs">{tag}</span>
                    <span className="text-[9px] text-white/40 uppercase tracking-widest">{label}</span>
                  </div>
                  <Copy size={12} className="text-white/20 group-hover:text-white/40 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Template Editor */}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Template List */}
          <div className="w-full md:w-64 flex flex-col gap-2">
            <div className="flex items-center justify-between px-4 mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">Templates</p>
              <button 
                onClick={() => setShowNewTemplateModal(true)}
                className="w-6 h-6 rounded-full bg-brand-orange text-white flex items-center justify-center hover:scale-110 transition-all shadow-sm"
                title="Create New Template"
              >
                <Zap size={12} fill="currentColor" />
              </button>
            </div>
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTemplateId(t.id)}
                className={cn(
                  "w-full h-14 rounded-2xl px-6 flex items-center gap-3 transition-all text-left",
                  activeTemplateId === t.id
                    ? "bg-brand-orange text-white shadow-lg shadow-brand-orange/20"
                    : "bg-white/40 hover:bg-white/60 text-[#1A1A1A]/60 border border-black/5"
                )}
              >
                <Mail size={16} />
                <span className="font-bold uppercase tracking-widest text-[9px]">{t.name}</span>
              </button>
            ))}
          </div>

          {/* Editor Area */}
          <div className="flex-1 bg-white/40 backdrop-blur-xl border border-white/60 p-8 rounded-[40px] shadow-sm space-y-6">
            {activeTemplate ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif italic text-2xl text-[#1A1A1A]">{activeTemplate.name}</h3>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowPreview(true)}
                      className="flex items-center gap-2 px-6 h-12 bg-white text-[#1A1A1A] border border-black/5 rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-black/5 transition-all shadow-sm"
                    >
                      <Eye size={14} />
                      Preview
                    </button>
                    <button
                      onClick={() => setShowTestEmailModal(true)}
                      disabled={sendingTest || saving}
                      className="flex items-center gap-2 px-6 h-12 bg-blue-500 text-white rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50"
                    >
                      <Send size={14} />
                      Test Send
                    </button>
                    <button
                      onClick={() => handleSaveTemplate(activeTemplate.id)}
                      disabled={saving || sendingTest}
                      className="flex items-center gap-2 px-6 h-12 bg-brand-orange text-white rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-[#1A1A1A] transition-all shadow-lg shadow-brand-orange/20 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Update Template
                    </button>
                  </div>
                </div>

                <div key={`editor-${activeTemplate.id}`} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Subject Line</label>
                    <input
                      type="text"
                      value={activeTemplate.subject}
                      onChange={e => updateTemplateField(activeTemplate.id, 'subject', e.target.value)}
                      className="w-full bg-white border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all shadow-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4 flex justify-between items-center w-full">
                      <span>Email Body</span>
                      <span className="text-[8px] text-brand-orange lowercase italic">Rich text enabled — placeholders supported</span>
                    </label>
                    <div className="quill-wrapper bg-white rounded-[32px] overflow-hidden border border-black/5 shadow-sm min-h-[400px]">
                      {isMounted ? (
                        <ReactQuill
                          theme="snow"
                          value={activeTemplate.body}
                          onChange={value => {
                            if (value !== activeTemplate.body) {
                              updateTemplateField(activeTemplate.id, 'body', value);
                            }
                          }}
                          modules={QUILL_MODULES}
                          formats={QUILL_FORMATS}
                          className="h-[400px] border-none"
                          placeholder="Start typing your email message here..."
                        />
                      ) : (
                        <div className="h-[400px] flex items-center justify-center bg-gray-50 text-gray-400">
                          <Loader2 className="animate-spin mr-2" size={16} />
                          Loading editor...
                        </div>
                      )}
                    </div>
                    <style>{`
                      .quill-wrapper .ql-toolbar.ql-snow {
                        border: none;
                        border-bottom: 1px solid rgba(0,0,0,0.05);
                        padding: 12px 24px;
                        background: rgba(0,0,0,0.02);
                      }
                      .quill-wrapper .ql-container.ql-snow {
                        border: none;
                        height: 350px;
                        font-family: 'Inter', sans-serif;
                      }
                      .quill-wrapper .ql-editor {
                        padding: 24px;
                        font-size: 14px;
                        line-height: 1.4;
                        color: #1A1A1A;
                      }
                      .quill-wrapper .ql-editor.ql-blank::before {
                        left: 24px;
                        font-style: italic;
                        color: rgba(0,0,0,0.2);
                        font-weight: 500;
                      }
                      .quill-wrapper .ql-editor p {
                        margin-bottom: 4px !important;
                      }
                      .quill-wrapper .ql-editor .email-signature {
                        font-size: 12px;
                        line-height: 1.2;
                        color: #666;
                        margin-top: 10px;
                        white-space: pre-wrap;
                        display: block;
                      }
                      .quill-wrapper .ql-editor .email-signature p {
                        margin-bottom: 2px !important;
                      }
                      .quill-wrapper .ql-snow.ql-toolbar button:hover,
                      .quill-wrapper .ql-snow.ql-toolbar button.ql-active,
                      .quill-wrapper .ql-snow.ql-toolbar .ql-picker-label:hover,
                      .quill-wrapper .ql-snow.ql-toolbar .ql-picker-label.ql-active,
                      .quill-wrapper .ql-snow.ql-toolbar .ql-picker-item:hover,
                      .quill-wrapper .ql-snow.ql-toolbar .ql-picker-item.ql-active {
                        color: #ff5a1f;
                      }
                      .quill-wrapper .ql-snow.ql-toolbar button:hover .ql-stroke,
                      .quill-wrapper .ql-snow.ql-toolbar button.ql-active .ql-stroke,
                      .quill-wrapper .ql-snow.ql-toolbar .ql-picker-label:hover .ql-stroke,
                      .quill-wrapper .ql-snow.ql-toolbar .ql-picker-label.ql-active .ql-stroke,
                      .quill-wrapper .ql-snow.ql-toolbar .ql-picker-item:hover .ql-stroke,
                      .quill-wrapper .ql-snow.ql-toolbar .ql-picker-item.ql-active .ql-stroke {
                        stroke: #ff5a1f;
                      }
                    `}</style>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[#1A1A1A]/20 py-20">
                <Mail size={48} />
                <p className="mt-4 font-bold uppercase tracking-widest text-xs">Select a template to edit</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      <AnimatePresence>
        {showPreview && activeTemplate && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPreview(false)}
              className="absolute inset-0 bg-[#1A1A1A]/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-[400px] bg-[#F9F7F2] rounded-[48px] overflow-hidden shadow-2xl flex flex-col items-center"
              style={{ height: '85vh' }}
            >
              {/* Phone Frame Header */}
              <div className="w-full h-12 bg-white flex items-center justify-between px-8 text-[#1A1A1A]/40">
                <span className="text-xs font-bold">9:41</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-2.5 rounded-sm border border-current" />
                  <div className="w-1 h-2.5 bg-current rounded-sm" />
                </div>
              </div>

              {/* Email Content */}
              <div className="flex-1 w-full overflow-y-auto px-6 py-8">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 min-h-full">
                  <div className="mb-6 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30">Subject</p>
                    <p className="text-sm font-bold text-[#1A1A1A]">{processTemplate(activeTemplate.subject, { '{{vehicle_model}}': 'Toyota Fortuner' })}</p>
                  </div>
                  <div className="w-full h-[1px] bg-black/5 mb-6" />
                  <div 
                    className="prose prose-sm max-w-none text-[#1A1A1A] font-sans preview-body"
                    dangerouslySetInnerHTML={{ __html: previewContent }}
                  />
                </div>
              </div>

              {/* Close Button */}
              <button 
                onClick={() => setShowPreview(false)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white border border-black/5 flex items-center justify-center text-[#1A1A1A] hover:bg-brand-orange hover:text-white transition-all shadow-md"
              >
                <X size={16} />
              </button>

              <div className="w-full h-10 bg-white flex items-center justify-center px-8">
                <div className="w-32 h-1.5 bg-[#1A1A1A]/10 rounded-full" />
              </div>
            </motion.div>
            <style>{`
              .preview-body {
                white-space: normal !important;
                line-height: 1.4 !important;
                font-family: 'Inter', sans-serif !important;
              }
              .preview-body p {
                margin-bottom: 4px !important;
                display: block !important;
              }
              .preview-body .email-signature, .preview-body [class*="signature"] {
                font-size: 12px !important;
                line-height: 1.2 !important;
                color: #666 !important;
                margin-top: 24px !important;
                white-space: pre-wrap !important;
                display: block !important;
              }
              .preview-body .email-signature p, .preview-body [class*="signature"] p {
                margin-bottom: 4px !important;
              }
              .preview-body p:last-child {
                margin-bottom: 0 !important;
              }
              .preview-body br {
                content: "";
                display: block;
                margin-bottom: 0.5em;
              }
              .preview-body a {
                color: #1a73e8 !important;
                text-decoration: underline !important;
              }
              .preview-body ul, .preview-body ol {
                margin-left: 1.5rem !important;
                margin-bottom: 1.25rem !important;
                list-style-position: outside !important;
              }
              .preview-body li {
                margin-bottom: 0.5rem !important;
              }
              .preview-body strong, .preview-body b {
                font-weight: 700 !important;
              }
              .preview-body em, .preview-body i {
                font-style: italic !important;
              }
              .preview-body u {
                text-decoration: underline !important;
              }
              /* Ensure tailwind prose doesn't override our explicit styles */
              .prose p {
                margin-top: 0 !important;
                margin-bottom: 4px !important;
              }
            `}</style>
          </div>
        )}
      </AnimatePresence>

      {/* New Template Modal */}
      <AnimatePresence>
        {showNewTemplateModal && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewTemplateModal(false)}
              className="absolute inset-0 bg-[#1A1A1A]/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[32px] p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-serif italic text-2xl text-[#1A1A1A]">Create New Template</h3>
                <button onClick={() => setShowNewTemplateModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Template Name</label>
                  <input
                    type="text"
                    value={newTemplateData.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                      setNewTemplateData({ name, id });
                    }}
                    placeholder="e.g. Booking Confirmation"
                    className="w-full bg-[#F9F7F2] border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">System ID (read-only)</label>
                  <input
                    type="text"
                    value={newTemplateData.id}
                    readOnly
                    className="w-full bg-gray-50 border-0 p-4 rounded-2xl text-xs font-mono text-gray-400 cursor-not-allowed outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowNewTemplateModal(false)}
                  className="flex-1 h-12 bg-gray-100 text-gray-500 rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTemplate}
                  disabled={saving || !newTemplateData.name}
                  className="flex-1 h-12 bg-brand-orange text-white rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-[#1A1A1A] transition-all shadow-lg shadow-brand-orange/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  Create Template
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Test Email Modal */}
      <AnimatePresence>
        {showTestEmailModal && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTestEmailModal(false)}
              className="absolute inset-0 bg-[#1A1A1A]/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[32px] p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-serif italic text-2xl text-[#1A1A1A]">Send Test Email</h3>
                <button onClick={() => setShowTestEmailModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/40 ml-4">Recipient Email</label>
                  <input
                    type="email"
                    value={testEmailAddress}
                    onChange={(e) => setTestEmailAddress(e.target.value)}
                    placeholder="Enter email address..."
                    className="w-full bg-[#F9F7F2] border-0 p-4 rounded-2xl text-sm font-bold focus:ring-2 ring-brand-orange outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowTestEmailModal(false)}
                  className="flex-1 h-12 bg-gray-100 text-gray-500 rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendTestEmail}
                  disabled={sendingTest || !testEmailAddress}
                  className="flex-1 h-12 bg-blue-500 text-white rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {sendingTest ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Send Now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
