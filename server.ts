
import "dotenv/config";
import fs from 'fs';
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as XLSX from "xlsx";
import { format, parse, isValid } from "date-fns";
import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as Papa from "papaparse";
import https from "https";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";

const getDirname = () => {
  if (typeof __dirname !== 'undefined') return __dirname;
  return path.dirname(fileURLToPath((import.meta as any).url));
};
const __dirname_resolved = getDirname();

let initLogs: string[] = [];
function logInit(msg: string) {
  console.log(msg);
  initLogs.push(`${new Date().toISOString()}: ${msg}`);
  try {
    fs.appendFileSync('./debug_logs.txt', `${new Date().toISOString()}: ${msg}\n`);
  } catch (e) {
    // Ignore
  }
}

// Read config immediately
const resolveConfigPath = () => {
  const paths = [
    path.join(process.cwd(), 'firebase-applet-config.json'),
    path.join(__dirname_resolved, 'firebase-applet-config.json'),
    './firebase-applet-config.json'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return paths[0]; // fallback
};

const firebaseConfig = JSON.parse(fs.readFileSync(resolveConfigPath(), 'utf8'));
const configProjectId = firebaseConfig.projectId;
const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';

let effectiveProjectId = configProjectId;
let metadataProjectId: string | null = null;

async function fetchMetadata() {
  try {
    const metadataUrl = "http://metadata.google.internal/computeMetadata/v1/project/project-id";
    const fetchResponse = await fetch(metadataUrl, { headers: { "Metadata-Flavor": "Google" }, timeout: 2000 } as any);
    if (fetchResponse.ok) {
      metadataProjectId = await fetchResponse.text();
      logInit(`[Init] Metadata Server Project ID: ${metadataProjectId}`);
    }
  } catch (e) {
    // Ignore metadata fetch errors
  }
}
fetchMetadata(); // run in background

// Initial initialization with config ID
logInit(`[Init] Primary Project ID: ${effectiveProjectId}`);

process.env.GOOGLE_CLOUD_PROJECT = effectiveProjectId;
process.env.GCLOUD_PROJECT = effectiveProjectId;

const httpsAgent = new https.Agent({ keepAlive: true });

// Use explicit (default) database as requested to avoid sync issues
const dbId = '(default)';

// Initialize Firestore
let firestore: any = null;
let isFirestoreReady = false;

function initializeAdmin(pid: string) {
  try {
    if (admin.apps.length > 0) {
      admin.app().delete();
    }
    
    logInit(`[Init] Initializing Admin SDK for: ${pid}`);
    
    let options: admin.AppOptions = {
      projectId: pid,
      storageBucket: firebaseConfig.storageBucket
    };

    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        options.credential = admin.credential.cert(serviceAccount);
        logInit(`[Init] Using provided FIREBASE_SERVICE_ACCOUNT_KEY.`);
      } catch (err: any) {
        logInit(`[Init] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY: ${err.message}`);
      }
    } else {
      logInit(`[Init] Using default application credentials.`);
      // Explicitly set the credential to application default to ensure it doesn't try to inherit anything weird, 
      // although it does this by default.
      options.credential = admin.credential.applicationDefault();
    }

    logInit(`[Init] Using storage bucket: ${options.storageBucket}`);

    admin.initializeApp(options);
    
    firestore = getFirestore();
    // Enable logging for debugging
    admin.firestore.setLogFunction((msg) => {
      if (msg.includes('error') || msg.includes('Error')) {
        logInit(`[Firestore SDK Internal] ${msg}`);
      }
    });
    
    firestore.settings({ ignoreUndefinedProperties: true });
    return true;
  } catch (e: any) {
    logInit(`[Init] Initialization failed for ${pid}: ${e.message}`);
    return false;
  }
}

// Start with config project
initializeAdmin(effectiveProjectId);

async function verifyFirestore() {
  const startTime = Date.now();
  const maxRetries = 10; 
  
  // Initial delay to let the environment settle
  await new Promise(resolve => setTimeout(resolve, 5000));

  for (let i = 0; i < maxRetries; i++) {
    try {
      if (i > 0) {
        const delay = Math.min(15000 * i, 60000); // Backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      logInit(`[Init] Connection Attempt ${i + 1}/${maxRetries} (${effectiveProjectId})...`);
      
      // Use a very simple read to verify connection
      // If this fails with PERMISSION_DENIED, we'll stop trying as it's not a transient connection error
      const testDoc = firestore.collection('system_config').doc('test');
      await testDoc.get();
      
      logInit(`[Init] SUCCESS: Verified connection to ${effectiveProjectId}`);
      isFirestoreReady = true;
      return;
    } catch (err: any) {
      const isPermissionError = err.message?.includes('PERMISSION_DENIED') || err.code === 7;
      
      if (isPermissionError) {
        logInit(`[Init] Attempt ${i + 1} denied (Permissions). Skipping further verification. Target: ${effectiveProjectId}`);
        isFirestoreReady = true; // Mark as ready to proceed anyway, we'll handle errors at runtime
        return; 
      } else {
        logInit(`[Init] Attempt ${i + 1} failed: ${err.message}`);
      }
    }
  }

  isFirestoreReady = true; // Proceed anyway
}

verifyFirestore().catch(err => {
  logInit(`Critical Firestore verification failure: ${err.message}`);
});

// Help for Firestore error reporting as per guidelines
function handleFirestoreError(error: any, operation: string, path: string) {
  const currentProjectId = effectiveProjectId;
  const currentDatabaseId = '(default)';
  
  // Create a safe error object to avoid circular references
  const safeError = {
    message: error.message || String(error),
    code: error.code,
    details: error.details,
    stack: error.stack ? error.stack.substring(0, 500) : undefined
  };

  let userMessage = `${safeError.code || 'UNKNOWN'}: ${safeError.message}`;
  
  // Add helpful context for permission errors
  if (safeError.code === 7 || safeError.message.includes('PERMISSION_DENIED')) {
    userMessage += ` (Tip: This means the Service Account or Security Rules denied access. Target: ${currentProjectId}/${currentDatabaseId})`;
  }

  const errorInfo = {
    error: userMessage,
    code: safeError.code,
    details: safeError.details,
    operation,
    path,
    projectId: currentProjectId,
    databaseId: currentDatabaseId,
    env: process.env.NODE_ENV
  };
  console.error(`Firestore Error [${operation}] on ${currentProjectId}/${currentDatabaseId}:`, JSON.stringify(errorInfo, null, 2));
  throw new Error(JSON.stringify(errorInfo));
}

// Cache for pricing data
let pricingCache: { [carType: string]: { headers: number[], data: { [date: string]: number[] } } } | null = null;
let lastFetchTime = 0;
let isFetching = false;
let currentFetchPromise: Promise<any> | null = null;
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes cache for pricing data

// Global crash handlers to prevent silent restarts
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Give some time for logs to flush before exiting
  // Increased delay to prevent tight restart loops
  setTimeout(() => process.exit(1), 5000);
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/debug/firestore/inspect", async (req, res) => {
    try {
      const collections = ['cars', 'bookings', 'enquiries', 'pricing', 'faqs', 'users', 'customers'];
      const results: any = {
        currentDatabase: dbId || '(default)',
        projectId: effectiveProjectId,
        collections: {}
      };
      
      for (const col of collections) {
        const snapshot = await firestore.collection(col).limit(5).get();
        results.collections[col] = {
          count: snapshot.size,
          exists: snapshot.size > 0,
          samples: snapshot.docs.map((doc: any) => ({ id: doc.id, data: doc.data() }))
        };
      }
      
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  app.get("/api/debug/firestore/logs", (req, res) => {
    res.json({ 
      logs: initLogs,
      projectId: effectiveProjectId,
      databaseId,
      isFirestoreReady,
      firestoreDefined: !!firestore
    });
  });

  // Middleware to check if Firestore is ready
  app.use((req, res, next) => {
    // Just log if Firestore is not ready yet, but don't block
    if (req.path.startsWith('/api/') && req.path !== '/api/health' && req.path !== '/api/debug/firestore/logs' && !isFirestoreReady) {
      console.log(`[Middleware] Warning: Firestore not fully verified yet for ${req.path}`);
    }
    next();
  });

  // API routes FIRST
  // Proxy Download Route to bypass CORS
  app.get("/api/storage/proxy-download", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      console.log(`[Proxy] Downloading from: ${url.substring(0, 50)}...`);
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      const contentTypeRaw = response.headers['content-type'];
      const contentType = typeof contentTypeRaw === 'string' ? contentTypeRaw : 'application/octet-stream';
      res.set('Content-Type', contentType);
      res.set('Access-Control-Allow-Origin', '*'); // Ensure client can read it
      res.send(response.data);
    } catch (error: any) {
      console.error("[Proxy] Download Error:", error.message);
      res.status(500).json({ error: "Failed to proxy download", details: error.message });
    }
  });

  // Storage Rename API Route
  app.post("/api/storage/rename", async (req, res) => {
    const { oldName, newName } = req.body;
    
    if (!oldName || !newName) {
      return res.status(400).json({ error: "Missing oldName or newName" });
    }

    try {
      console.log(`[Storage] Renaming "${oldName}" to "${newName}"...`);
      const bucket = admin.storage().bucket();
      const file = bucket.file(oldName);
      
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        return res.status(404).json({ error: `File "${oldName}" not found` });
      }

      // Move (Rename) the file
      await file.move(newName);
      
      console.log(`[Storage] Successfully renamed "${oldName}" to "${newName}"`);
      res.json({ success: true, oldName, newName });
    } catch (error: any) {
      console.error("[Storage] Rename Error:", error);
      res.status(500).json({ 
        error: "Failed to rename file in storage", 
        details: error.message,
        code: error.code 
      });
    }
  });

  // Legacy API handlers to guide users to refresh their browser
  app.post("/api/crm/import-csv", (req, res) => {
    res.status(400).json({ 
      error: "Legacy API", 
      message: "This import method has been updated. Please refresh your browser (Ctrl+R or Cmd+R) to use the new, more reliable import system." 
    });
  });

  app.post("/api/fleet/import-csv", (req, res) => {
    res.status(400).json({ 
      error: "Legacy API", 
      message: "This import method has been updated. Please refresh your browser (Ctrl+R or Cmd+R) to use the new, more reliable import system." 
    });
  });

  // Debug route to check Firestore connection
  app.get("/api/debug/firestore", async (req, res) => {
    try {
      const currentProjectId = effectiveProjectId;
      // @ts-ignore
      const currentDatabaseId = (firestore as any).databaseId || '(default)';
      
      const testDoc = firestore.collection('system_config').doc('test_connection');
      await testDoc.set({ timestamp: Date.now(), status: 'ok' });
      const snapshot = await testDoc.get();
      
      res.json({
        status: "success",
        connection: "ok",
        details: {
          activeProjectId: currentProjectId,
          activeDatabaseId: currentDatabaseId,
          configProjectId: firebaseConfig.projectId,
          configDatabaseId: firebaseConfig.firestoreDatabaseId || '(default)',
          envProjectId: process.env.GOOGLE_CLOUD_PROJECT || 'not set',
          envGcloudProject: process.env.GCLOUD_PROJECT || 'not set',
          docExists: snapshot.exists,
          data: snapshot.data()
        }
      });
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: error.message,
        code: error.code,
        details: {
          activeProjectId: effectiveProjectId,
          // @ts-ignore
          activeDatabaseId: (firestore as any).databaseId || '(default)',
          configProjectId: firebaseConfig.projectId,
          configDatabaseId: firebaseConfig.firestoreDatabaseId || '(default)',
          envProjectId: process.env.GOOGLE_CLOUD_PROJECT || 'not set',
          envGcloudProject: process.env.GCLOUD_PROJECT || 'not set'
        }
      });
    }
  });

  async function fetchAllPricingData(spreadsheetId: string, retries = 12): Promise<any> {
    if (currentFetchPromise) {
      console.log('Using existing fetch promise for pricing data');
      return currentFetchPromise;
    }

    const fetchTask = async (currentRetries: number): Promise<any> => {
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
      console.log(`Fetching spreadsheet from: ${url} (Retries left: ${currentRetries})`);
      
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          }
        });

        if (!response.ok) {
          const status = response.status;
          const text = status !== 404 ? await response.text() : 'Not Found';
          throw new Error(`Server returned ${status}: ${text.substring(0, 100)}`);
        }

        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || '';
        console.log(`Successfully downloaded spreadsheet (${buffer.byteLength} bytes), Content-Type: ${contentType}`);
        
        if (contentType && !contentType.includes('spreadsheetml') && !contentType.includes('application/octet-stream') && !contentType.includes('application/vnd.ms-excel') && !contentType.includes('application/zip')) {
          // If we get HTML, it's likely a login page or error page
          if (contentType.includes('text/html')) {
            const html = Buffer.from(buffer).toString('utf8');
            if (html.includes('Service Login') || html.includes('Sign in')) {
              throw new Error('The spreadsheet is not public. Please ensure "Anyone with the link" can view it.');
            }
          }
          throw new Error(`Invalid content type: ${contentType}. Expected a spreadsheet.`);
        }

        const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        
        const allData: { [carType: string]: { headers: number[], data: { [date: string]: number[] } } } = {};

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          
          if (rows.length < 2) continue;

          // Parse headers (durations) - Row 0, starting from index 1
          const headers = rows[0].slice(1).map(h => parseFloat(h)).filter(h => !isNaN(h));
          
          // Parse data rows
          const data: { [date: string]: number[] } = {};
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const dateVal = row[0];
            if (!dateVal) continue;
            
            let parsedDate: Date | null = null;
            if (typeof dateVal === 'number') {
              // Excel date to JS date
              parsedDate = new Date((dateVal - 25569) * 86400 * 1000);
            } else if (typeof dateVal === 'string') {
              const formats = ["dd/MM/yyyy", "d/M/yyyy", "MM/dd/yyyy", "M/d/yyyy", "yyyy-MM-dd"];
              for (const fmt of formats) {
                const d = parse(dateVal.trim(), fmt, new Date());
                if (isValid(d)) {
                  parsedDate = d;
                  break;
                }
              }
            }

            if (parsedDate && isValid(parsedDate)) {
              const key = format(parsedDate, "yyyy-MM-dd");
              const rates = row.slice(1).map(r => parseFloat(r)).filter(r => !isNaN(r));
              if (rates.length > 0) {
                data[key] = rates;
              }
            }
          }

          allData[sheetName.toLowerCase()] = { headers, data };
        }

        return allData;
      } catch (error: any) {
        console.error(`Pricing fetch failed: [${error.name || error.code || 'NO_CODE'}] ${error.message}`);
        
        const isTimeout = error.name === 'AbortError' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.message?.toLowerCase().includes('timeout');
        const isNetworkError = error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || 
                              error.code === 'ERR_STREAM_PREMATURE_CLOSE' || 
                              error.code === 'ERR_BAD_RESPONSE' ||
                              error.code === 'ERR_NETWORK' ||
                              error.message?.toLowerCase().includes('premature close') || 
                              error.message?.toLowerCase().includes('aborted') ||
                              error.message?.toLowerCase().includes('stream has been aborted') ||
                              error.message?.toLowerCase().includes('fetch failed');
        
        const status = error.response?.status || (error.message?.includes('Server returned ') ? parseInt(error.message.split('Server returned ')[1]) : null);
        const isRateLimit = status === 429 || status === 503;
        const is404 = status === 404;

        if (currentRetries > 0 && !is404 && (isTimeout || isNetworkError || isRateLimit)) {
          const delay = Math.min(10000, Math.pow(2, 6 - currentRetries) * 1000);
          console.warn(`Fetch error (${error.message}), retrying in ${delay}ms... ${currentRetries} attempts left`);
          await new Promise(r => setTimeout(r, delay));
          return fetchTask(currentRetries - 1);
        }
        throw error;
      }
    };

    currentFetchPromise = fetchTask(retries);
    try {
      const result = await currentFetchPromise;
      return result;
    } finally {
      currentFetchPromise = null;
    }
  }

  app.get("/api/pricing/sheet", async (req, res) => {
    const spreadsheetId = (req.query.spreadsheetId as string) || '1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo';

    // Simple cache check
    if (pricingCache && (Date.now() - lastFetchTime < CACHE_DURATION)) {
      return res.json(pricingCache);
    }

    if (isFetching) {
      // If already fetching, wait a bit or return error to avoid overloading
      return res.status(503).json({ error: 'Pricing data is currently being updated. Please try again in a few seconds.' });
    }

    try {
      isFetching = true;
      console.log(`Fetching pricing data for spreadsheet: ${spreadsheetId}`);
      const data = await fetchAllPricingData(spreadsheetId);
      pricingCache = data;
      lastFetchTime = Date.now();
      console.log('Pricing data fetched successfully');
      res.json(pricingCache);
    } catch (error: any) {
      console.error('Error fetching pricing sheet:', error.message || error);
      res.status(500).json({ error: error.message || 'Failed to fetch pricing data' });
    } finally {
      isFetching = false;
    }
  });

  // Email API
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, html, replyTo, fromName } = req.body;
    
    // Fetch company name and email from Firestore if not provided
    let dynamicFromName = fromName;
    let dynamicReplyTo = replyTo;
    
    try {
      const configDoc = await firestore.collection('app_settings').doc('company').get();
      if (configDoc.exists) {
        const config = configDoc.data();
        if (!dynamicFromName) dynamicFromName = config.companyName;
        if (!dynamicReplyTo) dynamicReplyTo = config.email;
      }
    } catch (e) {
      console.warn('[Email] Failed to fetch company config for send-email:', e);
    }

    const gmailUser = process.env.GMAIL_USER || "info@pattayarentacar.com";
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (!gmailPass) {
      console.log("[Email] GMAIL_APP_PASSWORD not found, simulating email send");
      console.log(`[Email Mock] To: ${to}, Subject: ${subject}`);
      return res.json({ success: true, message: "Simulation success" });
    }

    console.log("[Email] GMAIL_APP_PASSWORD found, attempting real send...");

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass
        }
      });

      // Force enquiry emails and default emails to info@pattayarentacar.com
      const finalTo = (subject?.toLowerCase().includes('enquiry') || !to) ? "info@pattayarentacar.com" : to;

      const mailOptions = {
        from: `"${dynamicFromName || 'Company'}" <${gmailUser}>`,
        to: finalTo,
        replyTo: dynamicReplyTo || gmailUser,
        subject: subject || "New Message from Website",
        html: html
      };

      console.log(`[Email] Sending email to ${mailOptions.to} with subject: ${mailOptions.subject}`);
      const info = await transporter.sendMail(mailOptions);
      console.log("[Email] Message sent successfully: %s", info.messageId);
      
      res.json({ success: true, messageId: info.messageId });
    } catch (error: any) {
      console.error("[Email] Critical Send Error:", error);
      console.error("[Email] Stack Trace:", error.stack);
      res.status(500).json({ error: "Failed to send email", details: error.message });
    }
  });

  // Business Info / Reviews API
  app.get("/api/reviews", async (req, res) => {
    // Fetch company settings for address and phone
    let address = "123/45 Moo 10, Pattaya City, Bang Lamung District, Chon Buri 20150, Thailand";
    let phone = "+66 83 077 6928";
    
    try {
      const configDoc = await firestore.collection('app_settings').doc('company').get();
      if (configDoc.exists) {
        const config = configDoc.data();
        address = config.address || address;
        phone = config.phone || phone;
      }
    } catch (e) {
      console.warn('[Reviews] Failed to fetch company config for reviews API:', e);
    }

    res.json({
      formatted_address: address,
      international_phone_number: phone,
      rating: 4.9,
      user_ratings_total: 1256,
      reviews: [
        { author_name: "John Doe", rating: 5, text: "Best rental service in Pattaya! Very professional and clean vehicles.", relative_time_description: "a week ago" },
        { author_name: "Sarah Smith", rating: 5, text: "Free delivery to my hotel was so convenient. Highly recommended.", relative_time_description: "2 weeks ago" },
        { author_name: "Mike Johnson", rating: 4, text: "Great service, easy booking process.", relative_time_description: "1 month ago" }
      ],
      opening_hours: {
        open_now: true,
        weekday_text: ["Monday: 8:00 AM – 6:00 PM", "Tuesday: 8:00 AM – 6:00 PM", "Wednesday: 8:00 AM – 6:00 PM", "Thursday: 8:00 AM – 6:00 PM", "Friday: 8:00 AM – 6:00 PM", "Saturday: 8:00 AM – 6:00 PM", "Sunday: 8:00 AM – 6:00 PM"]
      },
      geometry: {
        location: { lat: 12.9149, lng: 100.8673 }
      }
    });
  });

  // Pre-fetch pricing data on startup with a longer delay and better error handling
  const DEFAULT_SPREADSHEET_ID = '1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo';
  setTimeout(async () => {
    // Inspection disabled to avoid PERMISSION_DENIED noise in logs
    logInit('[Debug] Startup inspection skipped to avoid permission noise.');

    fetchAllPricingData(DEFAULT_SPREADSHEET_ID)
      .then(data => {
        pricingCache = data;
        lastFetchTime = Date.now();
      })
      .catch(err => {
        // Silently fail pre-fetch, it will retry on first request if needed
      });
  }, 5000);

  // Google Places Proxy for Review Manager
  app.post("/api/places/details", async (req, res) => {
    const { place_id } = req.body;
    const key = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!place_id) {
      console.error("[Proxy] Missing place_id in request body");
      return res.status(400).json({ error: "Missing place_id" });
    }

    if (!key) {
      console.error("[Proxy] VITE_GOOGLE_MAPS_API_KEY is not configured on the server");
      return res.status(500).json({ error: "Google Maps API Key is not configured on the server. Please add VITE_GOOGLE_MAPS_API_KEY to secrets." });
    }

    try {
      const url = `https://places.googleapis.com/v1/places/${place_id}`;
      logInit(`[Proxy] Fetching Places (New) details for ${place_id}`);
      
      const response = await axios.get(url, {
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'displayName,rating,userRatingCount,reviews.authorAttribution,reviews.rating,reviews.text,reviews.publishTime,reviews.relativePublishTimeDescription,reviews.name',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000 // 10s timeout
      });
      
      logInit(`[Proxy] Successfully fetched details for ${place_id}`);
      // Log the reviews structure to check for replies
      if (response.data?.reviews) {
        logInit(`[Proxy] Fetched ${response.data.reviews.length} reviews. Sample review keys: ${Object.keys(response.data.reviews[0]).join(', ')}`);
        // Log one full review to be absolutely sure
        logInit(`[Proxy] Sample review: ${JSON.stringify(response.data.reviews[0]).substring(0, 500)}`);
      }
      res.json(response.data);
    } catch (error: any) {
      const statusCode = error.response?.status || 500;
      const responseData = error.response?.data;

      if (statusCode === 403) {
        console.log('Google API 403 response:', JSON.stringify(responseData));
      }
      
      // Handle non-JSON responses (like HTML 403s)
      let errorMessage = "Internal Server Error";
      if (typeof responseData === 'string' && responseData.includes('<html>')) {
        errorMessage = `API Error (${statusCode}): The API returned an HTML error instead of JSON. This often means the API key is invalid or the service is restricted.`;
      } else if (responseData?.error?.message) {
        errorMessage = responseData.error.message;
      } else {
        errorMessage = error.message || errorMessage;
      }
      
      console.error("Google Places API Proxy Error:", {
        status: statusCode,
        message: errorMessage,
        url: error.config?.url,
        data: typeof responseData === 'string' ? responseData.substring(0, 200) : responseData
      });
      
      res.status(statusCode).json({ error: errorMessage });
    }
  });

  // --- Google Search Console & Analytics Integration ---
  const GOOGLE_CLIENT_ID = "700448424476-9fsmqpo3qsmud5qomll84kn2gjfndqk7.apps.googleusercontent.com";
  const getOAuth2Client = () => {
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientSecret || !refreshToken) {
      return null;
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      clientSecret,
      "http://localhost:3000"
    );

    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    return oauth2Client;
  };

  // Search Console Helper
  async function getSearchConsoleData(startDate: string, endDate: string, siteUrl: string, dimensions: string[] = ['query'], rowLimit: number = 100) {
    const auth = getOAuth2Client();
    if (!auth) throw new Error("Google OAuth credentials not configured.");

    const searchconsole = google.searchconsole({ version: "v1", auth });
    const response = await searchconsole.searchanalytics.query({
      siteUrl: siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions,
        rowLimit
      }
    });

    return response.data.rows || [];
  }

  // Analytics Helper
  async function getAnalyticsData(startDate: string, endDate: string, propertyId: string) {
    const auth = getOAuth2Client();
    if (!auth) throw new Error("Google OAuth credentials not configured.");

    const analyticsdata = google.analyticsdata({ version: "v1beta", auth });
    const response = await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "sessions" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" }
        ],
        limit: "100"
      }
    });

    const reportData = (response as any).data;
    return reportData.rows?.map((row: any) => ({
      pagePath: row.dimensionValues?.[0]?.value,
      pageViews: parseInt(row.metricValues?.[0]?.value || "0"),
      sessions: parseInt(row.metricValues?.[1]?.value || "0"),
      avgSessionDuration: parseFloat(row.metricValues?.[2]?.value || "0"),
      bounceRate: parseFloat(row.metricValues?.[3]?.value || "0")
    })) || [];
  }

  app.post("/api/searchconsole/performance", async (req, res) => {
    try {
      const { startDate, endDate, dimensions, rowLimit } = req.body;
      const siteUrl = "sc-domain:pattayarentacar.com";
      const data = await getSearchConsoleData(startDate, endDate, siteUrl, dimensions, rowLimit);
      res.json(data);
    } catch (error: any) {
      console.error("[Search Console] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/searchconsole/suggestions", async (req, res) => {
    try {
      const siteUrl = "sc-domain:pattayarentacar.com";
      const endDate = format(new Date(), "yyyy-MM-dd");
      const startDate = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd");
      
      const topQueries = await getSearchConsoleData(startDate, endDate, siteUrl, ['query'], 50);
      
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });
      }

      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const queriesText = topQueries.map((q: any) => `- ${q.keys[0]} (Impressions: ${q.impressions}, Clicks: ${q.clicks})`).join("\n");
      
      const prompt = `
        You are an SEO expert for "Pattaya Rent a Car", a car rental company in Pattaya, Thailand.
        Based on the following top search queries from Google Search Console, generate 10 content ideas (blog posts or pages) that would help drive more traffic.
        
        Top Queries:
        ${queriesText}
        
        Return a JSON array of objects. Each object MUST have:
        - title: A catchy headlines
        - targetKeyword: The primary keyword this content targets
        - rationale: 2 sentences explaining why this will drive traffic
        - estimatedImpact: "high", "medium", or "low"
        
        Format the response as raw JSON only, no markdown markers.
      `;

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const cleanText = text.replace(/```json|```/g, "").trim();
      const suggestions = JSON.parse(cleanText);
      
      res.json(suggestions);
    } catch (error: any) {
      console.error("[Search Console Suggestions] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/analytics/pages", async (req, res) => {
    try {
      const { startDate, endDate } = req.body;
      const propertyId = "311694159";
      const data = await getAnalyticsData(startDate, endDate, propertyId);
      res.json(data);
    } catch (error: any) {
      console.error("[Analytics] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Catch-all for unhandled API routes
  app.all("/api/*", (req, res) => {
    console.log(`Unhandled API Request: ${req.method} ${req.path}`);
    res.status(404).json({ error: "API route not found", path: req.path, method: req.method });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send('Static files not found. Please run "npm run build".');
        }
      });
    } else {
      console.error(`ERROR: Production requested but dist directory not found at: ${distPath}`);
      // Fallback to serving root if dist is missing (debugging)
      app.use(express.static(process.cwd()));
      app.get('*', (req, res) => {
        res.sendFile(path.join(process.cwd(), 'index.html'));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("CRITICAL: Failed to start server:", err);
  // Delay exit to prevent tight restart loops
  setTimeout(() => process.exit(1), 5000);
});
