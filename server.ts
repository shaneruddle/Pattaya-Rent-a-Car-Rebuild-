
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
import cors from "cors";

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
let pricingCacheMap: { [spreadsheetId: string]: { data: any, lastFetchTime: number } } = {};
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

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Add logging middleware for API requests
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      console.log(`[API Request] ${req.method} ${req.path}`);
    }
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Fetch all published Marketing Pages for footer/sitemap - MOVE THIS EARLY
  app.get("/api/marketing-pages/list", async (req, res) => {
    console.log(`[Marketing List API] Received request from ${req.ip} - ${req.get('user-agent')?.substring(0, 50)}`);
    
    // Explicit CORS and Cache control
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", "0");

    if (!firestore) {
      console.error("[Marketing List API] Firestore not initialized yet!");
      return res.status(503).json({ error: "Service temporarily unavailable - database initializing" });
    }

    try {
      console.log("[Marketing List API] Fetching list from Firestore...");
      const snapshot = await firestore.collection('marketing_pages')
        .where('status', '==', 'Published')
        .get();
      
      const pages = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        title: doc.data().title,
        slug: doc.data().slug,
        fullUrl: doc.data().fullUrl,
        categoryPath: doc.data().categoryPath,
        layoutType: doc.data().layoutType
      }));
      
      console.log(`[Marketing List API] Found ${pages.length} published pages.`);
      res.json(pages);
    } catch (error: any) {
      console.error("[Marketing List API] Critical Error:", error.message);
      // Log more error details if available
      if (error.code) console.error("[Marketing List API] Error Code:", error.code);
      
      res.status(500).json({ 
        error: "Failed to fetch marketing pages list", 
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
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

  // Class integrity check: full per-class fleet count for pricing engine (read-only)
  app.get("/api/debug/fleet/class-counts", async (req, res) => {
    if (!firestore) {
      return res.status(503).json({ error: "Service temporarily unavailable - database initializing" });
    }
    try {
      // Read ALL cars (not limited) so we catch casing drift and blanks across the whole fleet
      const snapshot = await firestore.collection('cars').get();

      const activeCounts: { [type: string]: number } = {};
      const inactiveCounts: { [type: string]: number } = {};
      const problems: { id: string; reason: string; type: any; isActive: any }[] = [];

      snapshot.docs.forEach((doc: any) => {
        const d = doc.data();
        const rawType = d.type;
        const isActive = d.isActive === true;

        if (rawType === undefined || rawType === null || rawType === '') {
          problems.push({ id: doc.id, reason: 'missing/blank type', type: rawType, isActive: d.isActive });
          return;
        }
        if (typeof rawType !== 'string') {
          problems.push({ id: doc.id, reason: 'type is not a string', type: rawType, isActive: d.isActive });
          return;
        }
        if (rawType !== rawType.trim()) {
          problems.push({ id: doc.id, reason: 'leading/trailing whitespace in type', type: JSON.stringify(rawType), isActive: d.isActive });
        }

        const bucket = isActive ? activeCounts : inactiveCounts;
        bucket[rawType] = (bucket[rawType] || 0) + 1;
      });

      const distinctActiveTypes = Object.keys(activeCounts).sort();
      const distinctInactiveTypes = Object.keys(inactiveCounts).sort();

      res.json({
        totalCars: snapshot.size,
        activeClassCounts: activeCounts,
        inactiveClassCounts: inactiveCounts,
        distinctActiveTypes,
        distinctInactiveTypes,
        problems,
        problemCount: problems.length
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message, code: error.code });
    }
  });
  // One-time CREATE-ONLY endpoint to seed pricing_config/current. Refuses to overwrite. Remove after use.
  app.get("/api/debug/pricing-config/create", async (req, res) => {
    if (!firestore) {
      return res.status(503).json({ error: "Service temporarily unavailable - database initializing" });
    }
    try {
      const ref = firestore.collection('pricing_config').doc('current');
      const existing = await ref.get();
      if (existing.exists) {
        return res.status(409).json({ error: "pricing_config/current already exists — refusing to overwrite.", existing: existing.data() });
      }
      const config = {
        thresholds: { weeklyFromDays: 7, monthlyRedirectFromDays: 30 },
        redirectMessage: "For rentals of 30 days or more, please contact us for a monthly quote.",
        classes: {
          "Economy":       { daily: 1500, weekly: 1300, floor: 400 },
          "Compact Sedan": { daily: 1600, weekly: 1400, floor: 400 },
          "MPV":           { daily: 2000, weekly: 1750, floor: 700 },
          "Pickup Truck":  { daily: 2000, weekly: 1750, floor: 700 },
          "SUV":           { daily: 2500, weekly: 2200, floor: 1000 }
        },
        seasonMultipliers: { peak: 1.0, high: 0.9, medium: 0.8, low: 0.7 },
        defaultSeason: "low",
        seasons: [
          { fromMonth: 12, fromDay: 15, toMonth: 1,  toDay: 31, season: "peak"   },
          { fromMonth: 2,  fromDay: 1,  toMonth: 4,  toDay: 30, season: "high"   },
          { fromMonth: 5,  fromDay: 1,  toMonth: 5,  toDay: 31, season: "low"    },
          { fromMonth: 6,  fromDay: 1,  toMonth: 8,  toDay: 31, season: "medium" },
          { fromMonth: 9,  fromDay: 1,  toMonth: 9,  toDay: 30, season: "low"    },
          { fromMonth: 10, fromDay: 1,  toMonth: 10, toDay: 31, season: "medium" },
          { fromMonth: 11, fromDay: 1,  toMonth: 12, toDay: 14, season: "high"   }
        ],
        availabilityLadder: [
          { minBookedPct: 90, mult: 1.0 },
          { minBookedPct: 80, mult: 0.9 },
          { minBookedPct: 70, mult: 0.8 },
          { minBookedPct: 60, mult: 0.7 },
          { minBookedPct: 50, mult: 0.6 },
          { minBookedPct: 0,  mult: 0.5 }
        ],
        overrides: [],
        _meta: {
          createdBy: "pricing-engine-setup",
          note: "Recurring month-day seasons. Engine quotes daily (1-6 days) and weekly (7-29 days); 30+ days returns redirectMessage. Floors are per-day minimums the dials cannot push below. Motorbike excluded - priced separately."
        }
      };
      await ref.set(config);
      res.json({ created: true, doc: "pricing_config/current", config });
    } catch (error: any) {
      res.status(500).json({ error: error.message, code: error.code });
    }
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

    // Simple cache check with ID keying
    const cached = pricingCacheMap[spreadsheetId];
    if (cached && (Date.now() - cached.lastFetchTime < CACHE_DURATION)) {
      return res.json(cached.data);
    }

    if (isFetching) {
      // If already fetching, wait a bit or return error to avoid overloading
      return res.status(503).json({ error: 'Pricing data is currently being updated. Please try again in a few seconds.' });
    }

    try {
      isFetching = true;
      console.log(`Fetching pricing data for spreadsheet: ${spreadsheetId}`);
      const data = await fetchAllPricingData(spreadsheetId);
      pricingCacheMap[spreadsheetId] = {
        data,
        lastFetchTime: Date.now()
      };
      console.log('Pricing data fetched successfully');
      res.json(data);
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
  setTimeout(async () => {
    // Inspection disabled to avoid PERMISSION_DENIED noise in logs
    logInit('[Debug] Startup inspection skipped to avoid permission noise.');

    let spreadsheetId = '1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo';
    try {
      if (firestore) {
        const configDoc = await firestore.collection('app_settings').doc('pricing').get();
        if (configDoc.exists) {
          const customId = configDoc.data().spreadsheetId;
          if (customId) {
            spreadsheetId = customId;
            logInit(`[Init] Using custom pricing spreadsheet: ${spreadsheetId}`);
          }
        }
      }
    } catch (e) {
      logInit(`[Init] Failed to fetch custom spreadsheet ID: ${e.message}`);
    }

    fetchAllPricingData(spreadsheetId)
      .then(data => {
        pricingCacheMap[spreadsheetId] = {
          data,
          lastFetchTime: Date.now()
        };
        logInit('[Init] Pricing data pre-fetched successfully');
      })
      .catch(err => {
        logInit(`[Init] Pricing pre-fetch failed: ${err.message}`);
        // Silently fail pre-fetch, it will retry on first request if needed
      });
  }, 10000); // Increased delay to 10s to ensure Firestore is fully ready

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

  // --- Google Search Console & Analytics Integration (Manual REST API) ---
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "700448424476-9fsmqpo3qsmud5qomll84kn2gjfndqk7.apps.googleusercontent.com";
  
  async function getAccessToken(): Promise<string> {
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.OAUTH_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientSecret || !refreshToken) {
      throw new Error("Google OAuth credentials not configured (Missing Client Secret or Refresh Token).");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(`Failed to refresh Google access token: ${JSON.stringify(data)}`);
    }

    return data.access_token;
  }

  // Search Console Helper
  async function getSearchConsoleData(startDate: string, endDate: string, siteUrl: string, dimensions: string[] = ['query'], rowLimit: number = 100) {
    const accessToken = await getAccessToken();
    
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions,
        rowLimit
      })
    });

    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(`Search Console API error: ${JSON.stringify(data)}`);
    }

    return data.rows || [];
  }

  // Analytics Helper
  async function getAnalyticsData(startDate: string, endDate: string, propertyId: string) {
    const accessToken = await getAccessToken();
    
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "sessions" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" }
        ],
        limit: "100"
      })
    });

    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(`Analytics API error: ${JSON.stringify(data)}`);
    }

    return data.rows?.map((row: any) => ({
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

  // Fetch Marketing Page by Slugs/URL via Admin SDK (Bypassing Rules)
  app.get("/api/marketing-pages", async (req, res) => {
    const { url, slug } = req.query;
    const reqId = Math.random().toString(36).substring(7);
    console.log(`[Marketing API ${reqId}] Request: url=${url}, slug=${slug}`);
    
    try {
      if (url) {
        // Normalize URL - remove trailing slash, ensure leading slash, lower case for comparison fallback
        const rawUrl = (url as string).split('?')[0].split('#')[0]; // Remove query params/hashes
        const segments = rawUrl.split('/').filter(Boolean);
        const normalizedUrl = '/' + segments.join('/');
        const lowerUrl = normalizedUrl.toLowerCase();
        
        const urls = new Set([
          normalizedUrl, 
          normalizedUrl.substring(1), 
          normalizedUrl + '/',
          lowerUrl,
          lowerUrl.substring(1),
          lowerUrl + '/'
        ]);
        
        const urlList = Array.from(urls);
        console.log(`[Marketing API ${reqId}] Testing URLs:`, urlList);
        
        // Try exact paths first
        let snapshot = await firestore.collection('marketing_pages')
          .where('status', '==', 'Published')
          .where('fullUrl', 'in', urlList)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          console.log(`[Marketing API ${reqId}] Success: Found by fullUrl match: ${doc.id}`);
          return res.json({ id: doc.id, ...doc.data() });
        }

        // Secondary fallback by slug matching
        const derivedSlug = segments[segments.length - 1];
        const categoryPath = segments.length > 1 ? segments[segments.length - 2] : null;

        console.log(`[Marketing API ${reqId}] Fallback Check: Derived Slug=${derivedSlug}, Category=${categoryPath}`);

        if (derivedSlug) {
          let slugQuery = firestore.collection('marketing_pages')
            .where('status', '==', 'Published')
            .where('slug', '==', derivedSlug);
          
          let slugSnapshot = await slugQuery.get();
          
          if (!slugSnapshot.empty) {
            console.log(`[Marketing API ${reqId}] Success: Found ${slugSnapshot.size} matches by slug. Filtering...`);
            
            // If we have multiple matches, try to find the best one by categoryPath
            if (categoryPath) {
              const bestMatch = slugSnapshot.docs.find((d: any) => d.data().categoryPath === categoryPath);
              if (bestMatch) {
                console.log(`[Marketing API ${reqId}] Success: Found best match by categoryPath: ${bestMatch.id}`);
                return res.json({ id: bestMatch.id, ...bestMatch.data() });
              }
            }
            
            // Otherwise just return the first one
            const doc = slugSnapshot.docs[0];
            console.log(`[Marketing API ${reqId}] Success: Returning first available slug match: ${doc.id}`);
            return res.json({ id: doc.id, ...doc.data() });
          }
        }
      } else if (slug) {
        const snapshot = await firestore.collection('marketing_pages')
          .where('status', '==', 'Published')
          .where('slug', '==', slug)
          .limit(1)
          .get();
          
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          console.log(`[Marketing API ${reqId}] Success: Found by direct slug query: ${doc.id}`);
          return res.json({ id: doc.id, ...doc.data() });
        }
      } else {
        return res.status(400).json({ error: "url or slug is required" });
      }

      console.log(`[Marketing API ${reqId}] Not found for inputs.`);
      res.status(404).json({ error: "Page not found" });
    } catch (error: any) {
      console.error(`[Marketing API ${reqId}] Error:`, error.message);
      res.status(500).json({ error: "Failed to fetch marketing page", details: error.message });
    }
  });

  // Catch-all for unhandled API routes
  app.all("/api/*", (req, res) => {
    console.log(`Unhandled API Request: ${req.method} ${req.path}`);
    res.status(404).json({ error: "API route not found", path: req.path, method: req.method });
  });

  // SEO: robots.txt and sitemap.xml
  app.get('/robots.txt', (req, res) => {
    const filePath = path.join(process.cwd(), 'public', 'robots.txt');
    if (fs.existsSync(filePath)) {
      res.type('text/plain').sendFile(filePath);
    } else {
      res.status(404).send('Not Found');
    }
  });

  app.get('/sitemap.xml', (req, res) => {
    const filePath = path.join(process.cwd(), 'public', 'sitemap.xml');
    if (fs.existsSync(filePath)) {
      res.type('application/xml').sendFile(filePath);
    } else {
      res.status(404).send('Not Found');
    }
  });

  // 301 Redirects for old WordPress URLs
  app.get('/index.html', (req, res) => res.redirect(301, '/'));
  app.get('/wp-login.php', (req, res) => res.redirect(301, '/'));
  app.all(['/wp-content/*', '/wp-admin/*'], (req, res) => res.redirect(301, '/'));

  // Known Public Routes for 200 status
  const KNOWN_ROUTES = [
    '/', 
    '/rent-a-car', 
    '/rent-a-bike', 
    '/long-term-rental', 
    '/about', 
    '/contact', 
    '/faq', 
    '/blog', 
    '/search'
  ];

  const isKnownRoute = (url: string) => {
    const cleanUrl = url.split('?')[0].split('#')[0];
    if (KNOWN_ROUTES.includes(cleanUrl)) return true;
    if (cleanUrl.startsWith('/blog/')) return true;
    if (cleanUrl.startsWith('/faq/')) return true;
    if (cleanUrl.startsWith('/services/')) return true;
    if (cleanUrl.startsWith('/pages/')) return true;
    if (cleanUrl.startsWith('/locations/')) return true;
    if (cleanUrl.startsWith('/vehicle/')) return true;
    if (cleanUrl.startsWith('/search/')) return true;
    
    // Any nested path is likely a marketing page
    const segments = cleanUrl.split('/').filter(Boolean);
    if (segments.length >= 2) {
      console.log(`[SEO] Path matched nested segment rule (length ${segments.length}): ${cleanUrl}`);
      return true;
    }
    
    return false;
  };

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.includes('.')) {
        return next();
      }
      
      try {
        const url = req.originalUrl;
        const status = 200; // PATCHED: Always serve SPA - do not return 404 for any routes.
        
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        
        res.status(status).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        res.status(500).end(e.message);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          const status = 200; // PATCHED: Always serve SPA - do not return 404 for any routes.
          res.status(status).sendFile(indexPath);
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
