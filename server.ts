
import "dotenv/config";
import fs from 'fs';
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as Papa from "papaparse";
import https from "https";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import cors from "cors";
import { growthCollectorApp } from "./src/agent/growthDataCollector.js";
import { growthAnalyserApp } from "./src/agent/growthAnalyser.js";
import { growthOutcomeScorerApp } from "./src/agent/growthOutcomeScorer.js";
import { growthExecutorApp } from "./src/agent/growthExecutor.js";

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

// Read-only availability diagnostic for the pricing engine. Computes occupancy for a class + date range. Writes nothing.
app.get("/api/debug/pricing/availability", async (req, res) => {
  if (!firestore) {
    return res.status(503).json({ error: "Service temporarily unavailable - database initializing" });
  }
  const carClass = req.query.class as string;
  const fromISO = req.query.from as string;
  const toISO = req.query.to as string;
  if (!carClass || !fromISO || !toISO) {
    return res.status(400).json({ error: "Required query params: class, from (YYYY-MM-DD), to (YYYY-MM-DD)" });
  }
  try {
    // Date-only helpers: same-day return = available, strict boundary.
    const dayInt = (iso: string) => {
      const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
      return y * 10000 + m * 100 + d;
    };
    const rf = dayInt(fromISO);
    const rt = dayInt(toISO);

    // Phase 1: active car IDs of this class (this is N).
    const carsSnap = await firestore.collection('cars')
      .where('type', '==', carClass)
      .where('isActive', '==', true)
      .get();
    const classCarIds = new Set<string>();
    carsSnap.docs.forEach((d: any) => classCarIds.add(d.id));
    const N = classCarIds.size;

    // Phase 2: candidate bookings — endDate strictly after the request's start day.
    // Use start-of-day for fromDate in the query so we don't drop same-day-boundary bookings before code-side strict check.
    const fromDayStart = fromISO.slice(0, 10) + 'T00:00:00.000Z';
    const bookingsSnap = await firestore.collection('bookings')
      .where('endDate', '>', fromDayStart)
      .get();

    // Phase 3: filter in code — overlap (date-only strict), occupying status, assigned car, class membership.
    const occupied: { [carId: string]: any[] } = {};
    let scanned = 0;
    bookingsSnap.docs.forEach((doc: any) => {
      const b = doc.data();
      scanned++;
      const carId = b.carId;
      if (!carId || carId === '' || carId === 'unassigned') return;       // unassigned enquiry
      if (!classCarIds.has(carId)) return;                                // not this class
      const occupyingStatus = b.isMaintenance === true || b.status === 'Paid' || b.status === 'Pending';
      if (!occupyingStatus) return;                                       // Completed/Cancelled/other
      if (!b.startDate || !b.endDate) return;                             // malformed
      const bs = dayInt(b.startDate);
      const be = dayInt(b.endDate);
      const overlaps = bs < rt && be > rf;                                // date-only, strict
      if (!overlaps) return;
      if (!occupied[carId]) occupied[carId] = [];
      occupied[carId].push({
        bookingId: doc.id,
        status: b.status,
        isMaintenance: b.isMaintenance === true,
        startDate: b.startDate,
        endDate: b.endDate
      });
    });

    const occupiedCarIds = Object.keys(occupied);
    const B = Math.min(occupiedCarIds.length, N);
    const bookedPct = N > 0 ? (B / N) * 100 : 0;

    // Ladder lookup (read from pricing_config for consistency).
    const cfgSnap = await firestore.collection('pricing_config').doc('current').get();
    const ladder = cfgSnap.exists ? cfgSnap.data().availabilityLadder : null;
    let multiplier = null;
    if (ladder) {
      for (const rung of ladder) {
        if (bookedPct >= rung.minBookedPct) { multiplier = rung.mult; break; }
      }
    }

    res.json({
      class: carClass,
      from: fromISO,
      to: toISO,
      fleetSize_N: N,
      occupiedCount_B: B,
      bookedPct: Math.round(bookedPct * 10) / 10,
      availabilityMultiplier: multiplier,
      occupiedCars: occupied,          // carId -> the bookings that occupy it (so you can verify by eye)
      classCarIds: Array.from(classCarIds),
      diagnostics: { bookingsScanned: scanned }
    });
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

// Pricing engine quote endpoint. Reads pricing_config/current, computes occupancy live, applies tier x season x availability with floor.
app.get("/api/pricing/quote", async (req, res) => {
  if (!firestore) {
    return res.status(503).json({ error: "Service temporarily unavailable - database initializing" });
  }
  const carClass = req.query.class as string;
  const fromISO = req.query.from as string;
  const toISO = req.query.to as string;
  if (!carClass || !fromISO || !toISO) {
    return res.status(400).json({ error: "Required query params: class, from (YYYY-MM-DD), to (YYYY-MM-DD)" });
  }
  try {
    const dayInt = (iso: string) => { const [y,m,d] = iso.slice(0,10).split('-').map(Number); return y*10000+m*100+d; };

    // Load config
    const cfgSnap = await firestore.collection('pricing_config').doc('current').get();
    if (!cfgSnap.exists) {
      return res.status(500).json({ error: "pricing_config/current not found" });
    }
    const cfg = cfgSnap.data();

    // Guard 1: class must be configured (Motorbike etc. fall through)
    const cls = cfg.classes ? cfg.classes[carClass] : null;
    if (!cls) {
      return res.json({ quotable: false, reason: "class_not_configured", class: carClass });
    }

    // Rental length (date-only): 26th -> 29th = 3 days
    const aMs = new Date(fromISO.slice(0,10) + 'T00:00:00Z').getTime();
    const bMs = new Date(toISO.slice(0,10) + 'T00:00:00Z').getTime();
    const days = Math.round((bMs - aMs) / 86400000);

    // Guard 2: sane length
    if (!days || days < 1) {
      return res.json({ quotable: false, reason: "invalid_dates", days });
    }

    // Guard 2b: minimum rental length (config-driven; absent or 0 -> no minimum)
    const minDays = cfg.thresholds.minRentalDays || 0;
    if (minDays > 0 && days < minDays) {
      return res.json({ quotable: false, reason: "below_min_days", days, minDays });
    }

    // Guard 3: 30+ days -> redirect, no quote
    if (days >= cfg.thresholds.monthlyRedirectFromDays) {
      return res.json({ quotable: false, reason: "monthly_redirect", days, message: cfg.redirectMessage });
    }

    // Tier
    const isWeekly = days >= cfg.thresholds.weeklyFromDays;
    const tierRate = isWeekly ? cls.weekly : cls.daily;
    const tierName = isWeekly ? "weekly" : "daily";

    // Season (recurring month-day, by START date; handles year-end wrap)
    const xs = fromISO.slice(0,10).split('-').map(Number);
    const x = xs[1]*100 + xs[2];
    let season = cfg.defaultSeason;
    for (const s of cfg.seasons) {
      const lo = s.fromMonth*100 + s.fromDay, hi = s.toMonth*100 + s.toDay;
      if (lo <= hi) { if (x >= lo && x <= hi) { season = s.season; break; } }
      else { if (x >= lo || x <= hi) { season = s.season; break; } }
    }
    const seasonMult = cfg.seasonMultipliers[season];

    // Availability window: the occupancy dial only applies to near-term bookings (config-driven).
    // Outside the window, occupancy reflects "how early it is" not demand, so we disable it (mult = 1.0).
    const windowDays = (cfg.availabilityWindowDays != null) ? cfg.availabilityWindowDays : 14;
    const todayMs = new Date(new Date().toISOString().slice(0,10) + 'T00:00:00Z').getTime();
    const startMs = new Date(fromISO.slice(0,10) + 'T00:00:00Z').getTime();
    const leadDays = Math.round((startMs - todayMs) / 86400000);
    const availabilityActive = leadDays <= windowDays;

    // Availability (live) — same proven logic as the availability diagnostic
    const rf = dayInt(fromISO), rt = dayInt(toISO);
    let N: number | null = null, B: number | null = null, bookedPct: number | null = null, availMult = 1.0;
    if (availabilityActive) {
      const carsSnap = await firestore.collection('cars')
        .where('type', '==', carClass).where('isActive', '==', true).get();
      const classCarIds = new Set<string>();
      carsSnap.docs.forEach((d: any) => classCarIds.add(d.id));
      N = classCarIds.size;

      // Guard 4: no fleet -> can't quote (avoid divide-by-zero)
      if (!N || N <= 0) {
        return res.json({ quotable: false, reason: "no_active_fleet", class: carClass });
      }

      const fromDayStart = fromISO.slice(0,10) + 'T00:00:00.000Z';
      const bookingsSnap = await firestore.collection('bookings').where('endDate', '>', fromDayStart).get();
      const occupiedCarIds = new Set<string>();
      bookingsSnap.docs.forEach((doc: any) => {
        const b = doc.data();
        const cid = b.carId;
        if (!cid || cid === '' || cid === 'unassigned') return;
        if (!classCarIds.has(cid)) return;
        const occupying = b.isMaintenance === true || b.status === 'Paid' || b.status === 'Pending';
        if (!occupying) return;
        if (!b.startDate || !b.endDate) return;
        if (!(dayInt(b.startDate) < rt && dayInt(b.endDate) > rf)) return;
        occupiedCarIds.add(cid);
      });
      B = Math.min(occupiedCarIds.size, N);
      bookedPct = (B / N) * 100;

      let availMultInner = cfg.availabilityLadder[cfg.availabilityLadder.length - 1].mult;
      for (const r of cfg.availabilityLadder) {
        if (bookedPct >= r.minBookedPct) { availMultInner = r.mult; break; }
      }
      availMult = availMultInner;
    }

    // Formula: tier x season x availability, clamp UP to per-day floor, then round per-day UP to nearest 50.
    const effectiveDaily = tierRate * seasonMult * availMult;
    const flooredDaily = Math.max(effectiveDaily, cls.floor);
    const floorApplied = flooredDaily > effectiveDaily;
    const roundedDaily = Math.ceil(flooredDaily / 50) * 50;   // round UP to nearest 50
    const totalPrice = roundedDaily * days;                    // total derives from rounded per-day (reconciles)

    res.json({
      quotable: true,
      class: carClass,
      from: fromISO,
      to: toISO,
      days,
      tier: tierName,
      tierRate,
      season,
      seasonMult,
      availabilityActive,
      leadDays,
      fleetSize_N: N,
      occupiedCount_B: B,
      bookedPct: bookedPct !== null ? Math.round(bookedPct * 10) / 10 : null,
      availMult,
      effectiveDaily: Math.round(effectiveDaily * 100) / 100,
      perDay: roundedDaily,
      floorApplied,
      totalPrice
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, code: error.code });
  }
});

  // Email API
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, html, replyTo, fromName, skipFinalToOverride, templateId, placeholders , website,
                  enquiryName, enquiryEmail, enquiryPhone, enquiryType, enquiryNote,
                  enquiryNationality, enquiryUtmSource, enquiryUtmMedium, enquiryUtmCampaign } = req.body;

    // Honeypot check — silently return success if bait field filled
    if (website) {
      console.log('[Honeypot] Blocked spam submission from /api/send-email');
      return res.status(200).json({ success: true });
    }

// Write marketing site enquiries to bookings collection so they appear in LiveEnquiries
            if (enquiryEmail && enquiryType) {
                          try {
                                            const now = new Date().toISOString();
                                            await firestore.collection('bookings').add({
                                                                  customerName:     enquiryName  || '',
                                                                  email:            enquiryEmail.toLowerCase().trim(),
                                                                  mobileNumber:     enquiryPhone || '',
                                                                  notes:            enquiryNote  || '',
                                                                  requestedCarType: enquiryType === 'long-term' ? 'Long-Term Hire' : 'General Enquiry',
                                                                  carId:            '',
                                                                  status:           'Enquiry',
                                                                  source:           'marketing-site',
                                                                  startDate:        now,
                                                                  endDate:          now,
                                                                  amount:           0,
                                                                  deposit:          0,
                                                                  createdAt:        FieldValue.serverTimestamp(),
                                                                  nationality:      enquiryNationality || null,
                                                                  utmSource:        enquiryUtmSource   || null,
                                                                  utmMedium:        enquiryUtmMedium   || null,
                                                                  utmCampaign:      enquiryUtmCampaign || null,
                                            });
                                            console.log(`[Enquiry] Bookings write OK: ${enquiryEmail} (${enquiryType})`);
                          } catch (firestoreErr: any) {
                                            console.error('[Enquiry] Bookings write failed (email send continues):', firestoreErr.message);
                          }
            }
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

    // ── Server-side template render (admin SDK) ─────────────────────────────────
    // templateId present → read email_templates/<id> via admin SDK, render, send, return early.
    // templateId absent  → fall through to the existing subject/html path (unchanged).
    if (templateId) {
      let tmpl: { subject: string; body: string } | undefined;
      try {
        const templateDoc = await firestore.collection('email_templates').doc(String(templateId)).get();
        if (!templateDoc.exists) {
          console.error(`[Email] Template "${templateId}" not found in Firestore.`);
          return res.status(500).json({ error: `Template "${templateId}" not found in Firestore.` });
        }
        tmpl = templateDoc.data() as { subject: string; body: string };
        if (!tmpl.subject || !tmpl.body) {
          console.error(`[Email] Template "${templateId}" is missing subject or body fields.`);
          return res.status(500).json({ error: `Template "${templateId}" is malformed (missing subject or body).` });
        }
      } catch (tmplErr: any) {
        console.error(`[Email] Firestore error reading template "${templateId}":`, tmplErr);
        return res.status(500).json({ error: `Failed to load template "${templateId}"`, details: tmplErr.message });
      }

      // Placeholder substitution — mirrors client processTemplate (no {{photos}} array case needed)
      const safePhMap: Record<string, string> = (placeholders as Record<string, string>) ?? {};
      const renderTmpl = (str: string): string => {
        let out = str;
        for (const [key, value] of Object.entries(safePhMap)) {
          const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          out = out.replace(new RegExp(escaped, 'g'), value ?? '');
        }
        return out;
      };

      const renderedSubject = renderTmpl(tmpl.subject);
      const rawBody = renderTmpl(tmpl.body);

      // Format newlines — mirrors client formatNewlines
      const formattedBody = (() => {
        if (!rawBody) return '';
        if (/<(p|br|div|span|h[1-6]|ul|li)[\s>]/i.test(rawBody)) return rawBody;
        return rawBody.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>');
      })();

      // Inline <p> styles — mirrors client prepareHtmlForEmail
      // (DOMPurify skipped: templates are staff-authored and sanitized on save)
      const pStyle = 'margin-bottom: 4px; min-height: 1.2em;';
      const styledBody = formattedBody
        .replace(/<p([^>]*?)>/g, (_m: string, attrs: string) => {
          if (attrs.includes('margin-bottom: 4px')) return _m;
          if (attrs.includes('style=')) return `<p${attrs.replace(/style="([^"]*)"/, `style="$1 ${pStyle}"`)}>`;
          return `<p style="${pStyle}"${attrs}>`;
        })
        .replace(/<p(\s[^>]*)?\s*>\s*&nbsp;\s*<\/p>/gi, `<p style="${pStyle}">&nbsp;</p>`);

      // Wrapper div — verbatim copy of client sendTemplatedEmail finalHtml wrapper
      const renderedHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.4; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${styledBody}
      </div>
    `;

      // Routing guard — same ternary logic as existing finalTo below
      const tmplFinalTo = !to ? 'info@pattayarentacar.com'
        : skipFinalToOverride ? to
        : renderedSubject.toLowerCase().includes('enquiry') ? 'info@pattayarentacar.com'
        : to;

      // Use already-fetched dynamicReplyTo / dynamicFromName from above
      const tmplReplyTo = replyTo || dynamicReplyTo || gmailUser;
      const tmplFromName = fromName || dynamicFromName || 'Pattaya Rent a Car';

      if (!gmailPass) {
        console.log(`[Email Mock/Template] To: ${tmplFinalTo}, Subject: ${renderedSubject}`);
        return res.json({ success: true, message: 'Simulation success (template)' });
      }

      console.log(`[Email] Template "${templateId}" — sending to ${tmplFinalTo}...`);
      try {
        const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
        const info = await transporter.sendMail({
          from: `"${tmplFromName}" <${gmailUser}>`,
          to: tmplFinalTo,
          replyTo: tmplReplyTo,
          subject: renderedSubject,
          html: renderedHtml,
        });
        console.log(`[Email] Template "${templateId}" sent OK:`, info.messageId);
        return res.json({ success: true, messageId: info.messageId });
      } catch (sendErr: any) {
        console.error(`[Email] Template "${templateId}" send failed:`, sendErr);
        return res.status(500).json({ error: 'Failed to send template email', details: sendErr.message });
      }
    }
    // ── End template branch ─────────────────────────────────────────────────────

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

            // Route: empty to → info@ always; skipFinalToOverride → use to directly; enquiry subject → info@; else → to
      const finalTo = !to
        ? "info@pattayarentacar.com"
        : (!skipFinalToOverride && subject?.toLowerCase().includes('enquiry'))
          ? "info@pattayarentacar.com"
          : to;

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
  // CORS preflight for growth executor — must be BEFORE vite.middlewares
  const GROWTH_CMS_ORIGIN = 'https://admin-pattayarentacar.web.app';
  app.options('/api/growth/execute', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', GROWTH_CMS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.status(204).end();
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

// Growth agent routes
app.use(growthCollectorApp);
app.use(growthAnalyserApp);
app.use(growthOutcomeScorerApp);
app.use(growthExecutorApp);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });}

startServer().catch(err => {
  console.error("CRITICAL: Failed to start server:", err);
  // Delay exit to prevent tight restart loops
  setTimeout(() => process.exit(1), 5000);
});
