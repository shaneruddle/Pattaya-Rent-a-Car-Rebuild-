
import "dotenv/config";
import fs from 'fs';
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import admin from "firebase-admin";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as Papa from "papaparse";
import https from "https";
import crypto from "crypto";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import cors from "cors";
import { growthCollectorApp, collectData } from "./src/agent/growthDataCollector.js";
import { growthAnalyserApp, analyseWeek } from "./src/agent/growthAnalyser.js";
import { runAnalysis } from "./src/agent/growthAgent.js";
import { growthOutcomeScorerApp } from "./src/agent/growthOutcomeScorer.js";
import { growthExecutorApp } from "./src/agent/growthExecutor.js";
import Anthropic from "@anthropic-ai/sdk";

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

  // Force HTTPS — permanent redirect for all HTTP traffic
  // Cloud Run sits behind Google's load balancer which terminates TLS.
  // The original protocol is forwarded in X-Forwarded-Proto.
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'];
    if (proto && proto !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });

  // Block crawlers on app.pattayarentacar.com — this subdomain is the raw
  // Cloud Run service and should never appear in search results.
  app.use((req, res, next) => {
    const host = (req.headers.host || '').split(':')[0];
    if (host === 'app.pattayarentacar.com') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });

  // Disallow-all robots.txt for app.pattayarentacar.com
  app.get('/robots.txt', (req, res, next) => {
    const host = (req.headers.host || '').split(':')[0];
    if (host === 'app.pattayarentacar.com') {
      res.type('text/plain');
      return res.send('User-agent: *\nDisallow: /\n');
    }
    next();
  });

  app.use(cors());
  app.use(express.json({
    limit: '50mb',
    // Stashes the exact raw bytes of every request body on req.rawBody -
    // needed by the LINE webhook (see /api/line/webhook below), which
    // verifies its signature over the untouched bytes LINE originally sent
    // and signed. Re-serializing req.body with JSON.stringify isn't
    // guaranteed to byte-match that, so the parsed object alone isn't enough.
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));

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

    // Billable duration: prefer the client-supplied duration (accounts for pickup/drop-off
    // time-of-day, rounded to half-day increments client-side). Falls back to the whole
    // calendar-day count if absent/invalid. Only affects tier selection and the final total -
    // season, availability window, min-days and monthly-redirect guards keep using calendar `days`.
    const rawDuration = req.query.durationDays;
    const parsedDuration = rawDuration !== undefined ? parseFloat(rawDuration as string) : NaN;
    const billableDays = (Number.isFinite(parsedDuration) && parsedDuration > 0) ? parsedDuration : days;

    // Tier
    const hasMonthly = cls.monthly != null && cls.monthlyFromDays != null && billableDays >= cls.monthlyFromDays;
    const isWeekly = !hasMonthly && billableDays >= cfg.thresholds.weeklyFromDays;
    const tierRate = hasMonthly ? cls.monthly : (isWeekly ? cls.weekly : cls.daily);
    const tierName = hasMonthly ? "monthly" : (isWeekly ? "weekly" : "daily");

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
    const totalPrice = roundedDaily * billableDays;                    // total derives from rounded per-day (reconciles)

    res.json({
      quotable: true,
      class: carClass,
      from: fromISO,
      to: toISO,
      days,
      billableDays,
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

// Delivery fee: distance-based, config-driven (pricing_config/delivery). Straight-line
// (Haversine) distance from the office - matches what LocationPicker.tsx already gives us
// (customer drops a pin, we get lat/lng), no geocoding API needed. Shared by the public
// quote endpoint below, the suggest-reply prompt, and the Inbox/Live Enquiries template
// fillers, so the rule only lives in one place.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Free within freeRadiusKm. Beyond that: baseFee for the first km over, then +incrementPerKm
// for each additional full km (partial km rounds up) - e.g. with the current config
// (free<=10km, base 500, +50/km, cap 20km): 10.5km->500, 12km->550, 20km->950 (max).
// Beyond maxRadiusKm we don't quote a fee at all - staff confirm delivery separately.
function calculateDeliveryFee(distanceKm: number, cfg: any): { fee: number | null; available: boolean } {
  if (distanceKm <= cfg.freeRadiusKm) return { fee: 0, available: true };
  if (distanceKm > cfg.maxRadiusKm) return { fee: null, available: false };
  const extraKm = Math.ceil(distanceKm - cfg.freeRadiusKm);
  const fee = cfg.baseFee + cfg.incrementPerKm * (extraKm - 1);
  return { fee, available: true };
}

app.get("/api/delivery/quote", async (req, res) => {
  if (!firestore) {
    return res.status(503).json({ error: "Service temporarily unavailable - database initializing" });
  }
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "Required query params: lat, lng" });
  }
  try {
    const cfgSnap = await firestore.collection('pricing_config').doc('delivery').get();
    if (!cfgSnap.exists) {
      return res.status(500).json({ error: "pricing_config/delivery not found" });
    }
    const cfg = cfgSnap.data();
    const distanceKm = haversineKm(cfg.officeLat, cfg.officeLng, lat, lng);
    const { fee, available } = calculateDeliveryFee(distanceKm, cfg);
    res.json({
      distanceKm: Math.round(distanceKm * 10) / 10,
      fee,
      available,
      freeRadiusKm: cfg.freeRadiusKm,
      maxRadiusKm: cfg.maxRadiusKm,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, code: error.code });
  }
});

  // Email API

  // Fallback company email signature (Gift's), used only if the editable
  // Firestore template below can't be loaded. Keep this in sync with
  // email_templates/email_signature (Email Templates admin page) by hand -
  // it's a safety net, not the source of truth, so it's deliberately a
  // shorter version (no help-links) rather than something staff edit here.
  const EMAIL_SIGNATURE_FALLBACK = `<br><br><table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;"><tr><td style="padding-right:20px;vertical-align:top;white-space:nowrap;"><p style="font-size:22px;font-weight:900;line-height:1.1;color:#000;margin:0 0 3px;">Gift<br>Suphaphon</p><p style="font-size:12px;color:#555;margin:0 0 12px;">Manager</p><p style="font-size:12px;line-height:1.9;color:#333;margin:0;"><span style="color:#e8631a;margin-right:6px;">&#9679;</span>+66-83-077-6928<br><span style="color:#e8631a;margin-right:6px;">&#9679;</span>www.pattayarentacar.com<br><span style="color:#e8631a;margin-right:6px;">&#9679;</span>info@pattayarentacar.com<br><span style="color:#e8631a;margin-right:6px;">&#9679;</span>359/119 Moo 12 Nongprue, Pattaya City</p></td><td style="border-left:3px solid #e8631a;padding:0 20px;">&nbsp;</td><td style="vertical-align:middle;"><img src="https://firebasestorage.googleapis.com/v0/b/pattaya-rent-a-car-rebuild.firebasestorage.app/o/PRAC-Logo-1.png?alt=media" alt="Pattaya RentaCar" width="110" style="display:block;"></td></tr></table>`;

  // Loads the current company email signature HTML - the single source of
  // truth is email_templates/email_signature (editable via the Email
  // Templates admin page), falling back to EMAIL_SIGNATURE_FALLBACK above if
  // that read fails for any reason. Shared by every outgoing-email path
  // (templated sends below, and direct Mail Inbox replies) so there's one
  // signature, not one per send path that can quietly drift apart.
  async function loadEmailSignatureHtml(): Promise<string> {
    try {
      const sigDoc = await firestore.collection('email_templates').doc('email_signature').get();
      const sigBody = sigDoc.exists ? (sigDoc.data() as any)?.body : undefined;
      if (sigBody) return sigBody;
    } catch (sigErr: any) {
      console.warn('[Email] Failed to load email_signature template, using fallback signature:', sigErr?.message || sigErr);
    }
    return EMAIL_SIGNATURE_FALLBACK;
  }

  app.post("/api/send-email", async (req, res) => {
    const { to, subject, html, replyTo, fromName, skipFinalToOverride, templateId, placeholders , website,
                  enquiryName, enquiryEmail, enquiryPhone, enquiryType, enquiryNote,
                  enquiryNationality, enquiryUtmSource, enquiryUtmMedium, enquiryUtmCampaign, enquiryUtmContent, enquiryUtmTerm,
                  bookingId } = req.body;

    // Honeypot check — silently return success if bait field filled
    if (website) {
      console.log('[Honeypot] Blocked spam submission from /api/send-email');
      return res.status(200).json({ success: true });
    }

    // ── Email threading helpers ──────────────────────────────────────────────
    // A booking's `enquiryMessageId` field, once set, anchors the customer-facing
    // thread: the FIRST email ever sent for that booking gets its Message-ID stored
    // here, and every later reply for the same booking sets In-Reply-To/References
    // to it so Gmail (and other clients) group them as one conversation instead of
    // starting a brand new thread each time.
    let resolvedBookingId: string | undefined = bookingId ? String(bookingId) : undefined;

    const lookupInReplyTo = async (bkId?: string): Promise<string | undefined> => {
      if (!bkId) return undefined;
      try {
        const snap = await firestore.collection('bookings').doc(bkId).get();
        const existing = snap.exists ? (snap.data() as any)?.enquiryMessageId : undefined;
        return existing || undefined;
      } catch (e) {
        console.warn('[Email] Failed to look up enquiryMessageId for threading:', e);
        return undefined;
      }
    };

    const maybeStoreMessageId = async (bkId: string | undefined, messageId: string | undefined) => {
      if (!bkId || !messageId) return;
      try {
        const ref = firestore.collection('bookings').doc(bkId);
        const snap = await ref.get();
        if (snap.exists && !(snap.data() as any)?.enquiryMessageId) {
          await ref.update({ enquiryMessageId: messageId });
        }
      } catch (e) {
        console.warn('[Email] Failed to store enquiryMessageId:', e);
      }
    };

// Write marketing site enquiries to bookings collection so they appear in LiveEnquiries
            if (enquiryEmail && enquiryType) {
                          try {
                                            const now = new Date().toISOString();
                                            const enquiryDocRef = await firestore.collection('bookings').add({
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
                                                                  utmContent:       enquiryUtmContent  || null,
                                                                  utmTerm:          enquiryUtmTerm     || null,
                                            });
                                            // Only used for threading if the caller didn't already pass an explicit bookingId
                                            if (!resolvedBookingId) resolvedBookingId = enquiryDocRef.id;
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
        const tmplInReplyTo = await lookupInReplyTo(resolvedBookingId);
        // Skip the read entirely when sending the signature template itself -
        // the result wouldn't be used anyway (see the html ternary below).
        const signatureHtml = templateId === 'email_signature' ? '' : await loadEmailSignatureHtml();
      const info = await transporter.sendMail({
          from: `"${tmplFromName}" <${gmailUser}>`,
          to: tmplFinalTo,
          bcc: templateId === 'rental_confirmation' ? 'info@pattayarentacar.com' : undefined,
          replyTo: tmplReplyTo,
          subject: renderedSubject,
          html: templateId === "email_signature" ? renderedHtml : renderedHtml + signatureHtml,
          ...(tmplInReplyTo ? { inReplyTo: tmplInReplyTo, references: tmplInReplyTo } : {}),
          // Lets the Inbox (see /api/mail/threads/:id below) link this email back
          // to its Booking record for template auto-fill, once the reply lands.
          ...(resolvedBookingId ? { headers: { 'X-Booking-Id': resolvedBookingId } } : {}),
        });
        console.log(`[Email] Template "${templateId}" sent OK:`, info.messageId, tmplInReplyTo ? `(threaded, In-Reply-To ${tmplInReplyTo})` : '');
        await maybeStoreMessageId(resolvedBookingId, info.messageId);
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

      const legacyInReplyTo = await lookupInReplyTo(resolvedBookingId);

      const mailOptions = {
        from: `"${dynamicFromName || 'Company'}" <${gmailUser}>`,
        to: finalTo,
        replyTo: dynamicReplyTo || gmailUser,
        subject: subject || "New Message from Website",
        html: html,
        ...(legacyInReplyTo ? { inReplyTo: legacyInReplyTo, references: legacyInReplyTo } : {}),
        // Lets the Inbox (see /api/mail/threads/:id below) link this email back
        // to its Booking record for template auto-fill, once the reply lands.
        ...(resolvedBookingId ? { headers: { 'X-Booking-Id': resolvedBookingId } } : {}),
      };

      console.log(`[Email] Sending email to ${mailOptions.to} with subject: ${mailOptions.subject}`);
      const info = await transporter.sendMail(mailOptions);
      console.log("[Email] Message sent successfully: %s", info.messageId, legacyInReplyTo ? `(threaded, In-Reply-To ${legacyInReplyTo})` : '');
      await maybeStoreMessageId(resolvedBookingId, info.messageId);

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

  // GSC performance via service account (Secret Manager)
  app.get('/api/gsc/performance', async (req, res) => {
    try {
      const { google } = await import('googleapis');
      const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

      const secretmanager = google.secretmanager({ version: 'v1' });
      const adcAuth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const adcClient = await adcAuth.getClient();

      const secretResp = await secretmanager.projects.secrets.versions.access({
        auth: adcClient as any,
        name: `projects/${projectId}/secrets/GSC_SERVICE_ACCOUNT_KEY/versions/latest`,
      });

      const keyJson = Buffer.from(
        secretResp.data.payload!.data! as string,
        'base64'
      ).toString('utf8');
      const credentials = JSON.parse(keyJson);

      const gscAuth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      });

      const searchconsole = google.searchconsole({ version: 'v1', auth: gscAuth });

      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 3);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
      const fmt = (d: Date) => d.toISOString().split('T')[0];

      const [topQueriesResp, totalsResp] = await Promise.all([
        searchconsole.searchanalytics.query({
          siteUrl: 'sc-domain:pattayarentacar.com',
          requestBody: {
            startDate: fmt(startDate),
            endDate: fmt(endDate),
            dimensions: ['query'],
            rowLimit: 25,
            dataState: 'final',
          },
        }),
        searchconsole.searchanalytics.query({
          siteUrl: 'sc-domain:pattayarentacar.com',
          requestBody: {
            startDate: fmt(startDate),
            endDate: fmt(endDate),
            rowLimit: 1,
            dataState: 'final',
          },
        }),
      ]);

      const rows = topQueriesResp.data.rows || [];
      const totalsRow = (totalsResp.data.rows || [])[0] || {};

      res.json({
        period: { startDate: fmt(startDate), endDate: fmt(endDate) },
        totals: {
          clicks: totalsRow.clicks ?? 0,
          impressions: totalsRow.impressions ?? 0,
          ctr: totalsRow.ctr ?? 0,
          position: totalsRow.position ?? 0,
        },
        topQueries: rows.map((row: any) => ({
          query: row.keys?.[0] ?? '',
          clicks: row.clicks ?? 0,
          impressions: row.impressions ?? 0,
          ctr: row.ctr ?? 0,
          position: row.position ?? 0,
        })),
      });
    } catch (err: any) {
      console.error('GSC API error:', err?.message || err);
      res.status(500).json({ error: 'Failed to fetch GSC data', detail: err?.message });
    }
  });



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


  // GA4 performance — service account auth (analytics.readonly)
  app.get('/api/ga4/performance', async (req, res) => {
    try {
      const { google } = await import('googleapis');
      const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

      const secretmanager = google.secretmanager({ version: 'v1' });
      const adcAuth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const adcClient = await adcAuth.getClient();

      const secretResp = await secretmanager.projects.secrets.versions.access({
        auth: adcClient as any,
        name: `projects/${projectId}/secrets/GSC_SERVICE_ACCOUNT_KEY/versions/latest`,
      });
      const keyJson = Buffer.from(
        secretResp.data.payload!.data! as string,
        'base64'
      ).toString('utf8');
      const credentials = JSON.parse(keyJson);

      const ga4Auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      });

      const analyticsData = google.analyticsdata('v1beta');
      const propertyId = '311694159';

      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 27);
      const fmt = (d: Date) => d.toISOString().split('T')[0];

      const [channelRes, pagesRes] = await Promise.all([
        analyticsData.properties.runReport({
          property: `properties/${propertyId}`,
          auth: ga4Auth as any,
          requestBody: {
            dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
            dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
            metrics: [
              { name: 'sessions' },
              { name: 'newUsers' },
              { name: 'bounceRate' },
              { name: 'engagementRate' },
            ],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          },
        }),
        analyticsData.properties.runReport({
          property: `properties/${propertyId}`,
          auth: ga4Auth as any,
          requestBody: {
            dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }, { name: 'bounceRate' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 25,
          },
        }),
      ]);

      const channels = (channelRes.data.rows || []).map((r: any) => ({
        channel: r.dimensionValues?.[0]?.value || 'unknown',
        sessions: parseInt(r.metricValues?.[0]?.value || '0'),
        newUsers: parseInt(r.metricValues?.[1]?.value || '0'),
        bounceRate: parseFloat(r.metricValues?.[2]?.value || '0'),
        engagementRate: parseFloat(r.metricValues?.[3]?.value || '0'),
      }));

      const topPages = (pagesRes.data.rows || []).map((r: any) => ({
        pagePath: r.dimensionValues?.[0]?.value || '',
        sessions: parseInt(r.metricValues?.[0]?.value || '0'),
        pageViews: parseInt(r.metricValues?.[1]?.value || '0'),
        bounceRate: parseFloat(r.metricValues?.[2]?.value || '0'),
      }));

      res.json({
        period: { startDate: fmt(startDate), endDate: fmt(endDate) },
        propertyId,
        channels,
        topPages,
        totals: {
          sessions: channels.reduce((s: number, c: any) => s + c.sessions, 0),
          newUsers: channels.reduce((s: number, c: any) => s + c.newUsers, 0),
        },
      });
    } catch (err: any) {
      console.error('GA4 API error:', err?.message || err);
      res.status(500).json({ error: 'Failed to fetch GA4 data', detail: err?.message });
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

  app.post('/api/growth/run-now', async (req: any, res: any) => {
  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { await admin.auth().verifyIdToken(authHeader.slice(7)); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
  try {
    // force=true: re-analyses existing collected/analysed data without re-collecting
    // Raw data (GA4, Search Console, Bing) stays intact; only AI analysis is re-run
    const result = await runAnalysis();
    console.log('[run-now] completed successfully');
    res.json({ success: true, runId: result.runId, actionsCount: result.actionsCount });
  } catch (err: any) {
    console.error('[run-now] failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Gmail Inbox Integration (info@pattayarentacar.com only, read + reply) ---
// Read access via Gmail API using a dedicated OAuth client (Internal user type,
// so refresh tokens do not expire). Sending reuses the existing Nodemailer
// mechanism above so all outbound mail keeps flowing through the same proven path.
const GMAIL_OAUTH_CLIENT_ID = "700448424476-dq43t9du8mvcri226n3cb3g0br6n75tj.apps.googleusercontent.com";
const GMAIL_INBOX_MAILBOX = "info@pattayarentacar.com";

// Extracts the bare address from a "Name <addr>" style header, or returns the
// header as-is (lowercased) if it's already a bare address. Shared by the
// threads-list route (last-message-from-us check) and resolveThreadCustomerEmail.
function emailOf(header: string): string {
  const match = header.match(/<([^>]+)>/);
  return (match ? match[1] : header).trim().toLowerCase();
}

async function getSecretValue(secretName: string): Promise<string> {
  const { google } = await import('googleapis');
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const secretmanager = google.secretmanager({ version: 'v1' });
  const adcAuth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const adcClient = await adcAuth.getClient();
  const secretResp = await secretmanager.projects.secrets.versions.access({
    auth: adcClient as any,
    name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
  });
  return Buffer.from(secretResp.data.payload!.data! as string, 'base64').toString('utf8');
}

let cachedGmailAccessToken: { token: string; expiresAt: number } | null = null;

async function getGmailAccessToken(): Promise<string> {
  if (cachedGmailAccessToken && cachedGmailAccessToken.expiresAt > Date.now() + 30000) {
    return cachedGmailAccessToken.token;
  }
  const [clientSecret, refreshToken] = await Promise.all([
    getSecretValue('gmail-oauth-client-secret'),
    getSecretValue('gmail-oauth-refresh-token'),
  ]);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_OAUTH_CLIENT_ID,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = await response.json() as any;
  if (!response.ok) {
    throw new Error(`Failed to refresh Gmail access token: ${JSON.stringify(data)}`);
  }
  cachedGmailAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3000) * 1000,
  };
  return data.access_token;
}

async function gmailApiFetch(path: string): Promise<any> {
  const accessToken = await getGmailAccessToken();
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Gmail API error: ${JSON.stringify(data)}`);
  }
  return data;
}

function gmailHeader(headers: any[], name: string): string {
  const found = (headers || []).find((h: any) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value || '';
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractGmailBody(payload: any): { text: string; html: string } {
  let text = '';
  let html = '';
  function walk(part: any) {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/plain' && part.body?.data) {
      text += decodeBase64Url(part.body.data);
    } else if (mime === 'text/html' && part.body?.data) {
      html += decodeBase64Url(part.body.data);
    } else if (part.parts) {
      part.parts.forEach(walk);
    }
  }
  walk(payload);
  return { text, html };
}

// Real (non-inline) attachments only - parts with a filename and an
// attachmentId, excluding inline parts (Content-Disposition: inline, or a
// Content-ID present - the cid: signal used to reference the part from
// bodyHtml). Without this, a signature logo shows up as a "photo" on every
// single thread. Inline images referenced via cid: aren't surfaced here at
// all; fetching those would need cid resolution, out of scope for the
// "save a photo to the image library" use case below.
function extractGmailAttachments(payload: any): { attachmentId: string; filename: string; mimeType: string; size: number }[] {
  const attachments: { attachmentId: string; filename: string; mimeType: string; size: number }[] = [];
  function walk(part: any) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      const disposition = gmailHeader(part.headers || [], 'Content-Disposition');
      const contentId = gmailHeader(part.headers || [], 'Content-ID');
      const isInline = /^inline/i.test(disposition) || !!contentId;
      if (!isInline) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }
    }
    if (part.parts) {
      part.parts.forEach(walk);
    }
  }
  walk(payload);
  return attachments;
}

function requireStaffAuth(req: any, res: any): boolean {
  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// List recent inbox threads (subject/from/date/snippet only - no bodies)
app.get('/api/mail/threads', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
    // `q` uses standard Gmail search syntax (e.g. "booking toyota", "from:john@x.com"),
    // same as the Gmail search bar. Combined with labelIds=INBOX so results stay
    // scoped to the inbox view rather than searching the whole mailbox.
    const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const qParam = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '';
    const listResp = await gmailApiFetch(
      `/threads?labelIds=INBOX&maxResults=20${qParam}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    );
    const threadStubs = listResp.threads || [];
    const threads = await Promise.all(threadStubs.map(async (t: any) => {
      const full = await gmailApiFetch(
        `/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=X-Booking-Id`
      );
      const messages = full.messages || [];
      const lastMsg = messages[messages.length - 1];
      const headers = lastMsg?.payload?.headers || [];
      // X-Booking-Id can land on any message in the thread (set by /api/send-email
      // whenever a templated send carries a bookingId - see below), not just the
      // last one, so scan the whole thread rather than just lastMsg. Used by the
      // Mail Inbox "Follow Up" filter to know which threads are booking-linked.
      const bookingId = messages
        .map((m: any) => gmailHeader(m.payload?.headers || [], 'X-Booking-Id'))
        .find((id: string) => !!id) || undefined;
      // True when our own mailbox sent the most recent message in the thread -
      // i.e. the customer hasn't replied since. Combined with bookingId and the
      // thread's date, this is what the Follow Up filter uses to flag a thread.
      const lastMessageFromUs = emailOf(gmailHeader(headers, 'From')) === GMAIL_INBOX_MAILBOX;
      return {
        id: t.id,
        snippet: lastMsg?.snippet || t.snippet || '',
        subject: gmailHeader(headers, 'Subject'),
        from: gmailHeader(headers, 'From'),
        date: gmailHeader(headers, 'Date'),
        messageCount: messages.length,
        lastMessageId: lastMsg?.id || null,
        bookingId,
        lastMessageFromUs,
      };
    }));
    // Read/unread is tracked entirely inside our own app (Firestore), not via Gmail's
    // real UNREAD label. A thread is unread until opened here, and becomes unread
    // again if a new message arrives after that (lastMessageId will no longer match
    // what was recorded as read). Staff can reverse this via
    // DELETE /api/mail/threads/:id/read-state, which clears the record.
    const readSnaps = await Promise.all(
      threads.map((t: any) => firestore.collection('mail_read_state').doc(t.id).get())
    );
    const threadsWithRead = threads.map((t: any, i: number) => {
      const readData = readSnaps[i].exists ? readSnaps[i].data() : null;
      const unread = !readData || readData!.readMessageId !== t.lastMessageId;
      return { ...t, unread };
    });
    res.json({ threads: threadsWithRead, nextPageToken: listResp.nextPageToken || null });
  } catch (err: any) {
    console.error('[Mail] threads list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Full thread detail, including message bodies, for the reply view
app.get('/api/mail/threads/:id', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const full = await gmailApiFetch(`/threads/${req.params.id}?format=full`);
    const messages = (full.messages || []).map((m: any) => {
      const headers = m.payload?.headers || [];
      const { text, html } = extractGmailBody(m.payload);
      const attachments = extractGmailAttachments(m.payload);
      return {
        id: m.id,
        messageIdHeader: gmailHeader(headers, 'Message-ID') || gmailHeader(headers, 'Message-Id'),
        from: gmailHeader(headers, 'From'),
        to: gmailHeader(headers, 'To'),
        replyTo: gmailHeader(headers, 'Reply-To') || undefined,
        subject: gmailHeader(headers, 'Subject'),
        date: gmailHeader(headers, 'Date'),
        bodyText: text,
        bodyHtml: html,
        unread: (m.labelIds || []).includes('UNREAD'),
        bookingId: gmailHeader(headers, 'X-Booking-Id') || undefined,
        attachments,
      };
    });
    // Mark read in our own app-level tracking only (does not touch the real Gmail
    // UNREAD label). Recorded against the current last message, so a later reply on
    // this thread makes it unread again automatically. Staff can reverse this via
    // DELETE /api/mail/threads/:id/read-state, which clears this record.
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      await firestore.collection('mail_read_state').doc(full.id).set({
        readMessageId: lastMessage.id,
        readAt: FieldValue.serverTimestamp(),
      });
    }
    res.json({ id: full.id, messages });
  } catch (err: any) {
    console.error('[Mail] thread detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch a single attachment's raw bytes (base64url, as Gmail returns it) so
// the client can render a thumbnail or hand it to the "Save to Image
// Library" flow. Only the server holds Gmail OAuth credentials, so this has
// to be proxied rather than fetched directly from the client.
app.get('/api/mail/threads/:threadId/messages/:messageId/attachments/:attachmentId', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const { messageId, attachmentId } = req.params;
    const attachment = await gmailApiFetch(`/messages/${messageId}/attachments/${attachmentId}`);
    res.json({ data: attachment.data, size: attachment.size });
  } catch (err: any) {
    console.error('[Mail] attachment fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reply within a thread - reuses the existing Nodemailer send mechanism above,
// so all outbound mail (automated and staff replies) goes through one proven path.
// Storage download URLs look like https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&token=...
// Attachments below are fetched server-side (by nodemailer's `href` option)
// from whatever URL the client sends, so validation pins that fetch to THIS
// app's own Storage bucket specifically - checking the host alone would still
// let a forged request point at any other Firebase project's public bucket
// (SSRF / arbitrary-content-exfil guard) - staff-authenticated caller or not.
const ALLOWED_ATTACHMENT_HOST = 'firebasestorage.googleapis.com';
const ALLOWED_ATTACHMENT_BUCKET: string = firebaseConfig.storageBucket;
const MAX_REPLY_ATTACHMENTS = 12;
// Gmail's practical send limit is ~25MB including headers/body/MIME overhead;
// stay well under that. Enforced via HEAD Content-Length before sendMail is
// ever called, so an oversized (or forged-huge) attachment fails fast with a
// clear error instead of nodemailer downloading tens of MB and the whole send
// still bouncing at the SMTP layer.
const MAX_REPLY_ATTACHMENTS_TOTAL_BYTES = 18 * 1024 * 1024;

app.post('/api/mail/reply', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const { to, subject, html, inReplyToMessageId, attachments } = req.body || {};
    if (!to || !html) return res.status(400).json({ error: 'Missing to/html' });

    // Real vehicle photos attached from the Mail Inbox "Car Photos" picker.
    // The frontend already caps this per vehicle, but that's a client-side
    // convenience, not a guarantee - re-validate and re-cap here too.
    let mailAttachments: { filename: string; href: string }[] | undefined;
    if (attachments !== undefined) {
      if (!Array.isArray(attachments)) {
        return res.status(400).json({ error: 'attachments must be an array' });
      }
      if (attachments.length > MAX_REPLY_ATTACHMENTS) {
        return res.status(400).json({ error: `Too many attachments (max ${MAX_REPLY_ATTACHMENTS})` });
      }
      for (const a of attachments) {
        if (!a || typeof a.filename !== 'string' || typeof a.url !== 'string') {
          return res.status(400).json({ error: 'Each attachment needs a filename and url' });
        }
        let parsed: URL;
        try {
          parsed = new URL(a.url);
        } catch {
          return res.status(400).json({ error: `Invalid attachment url: ${a.url}` });
        }
        const bucketMatch = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\//);
        if (
          parsed.protocol !== 'https:' ||
          parsed.hostname !== ALLOWED_ATTACHMENT_HOST ||
          !bucketMatch ||
          bucketMatch[1] !== ALLOWED_ATTACHMENT_BUCKET
        ) {
          return res.status(400).json({ error: "Attachment url must be a link to this app's Storage bucket" });
        }
      }

      let totalBytes = 0;
      for (const a of attachments) {
        try {
          const headRes = await fetch(a.url, { method: 'HEAD' });
          const len = parseInt(headRes.headers.get('content-length') || '', 10);
          if (!headRes.ok || !Number.isFinite(len) || len <= 0) {
            return res.status(400).json({ error: `Could not verify size of attachment: ${a.filename}` });
          }
          totalBytes += len;
        } catch (err) {
          return res.status(400).json({ error: `Could not verify size of attachment: ${a.filename}` });
        }
      }
      if (totalBytes > MAX_REPLY_ATTACHMENTS_TOTAL_BYTES) {
        return res.status(400).json({
          error: `Attachments too large (${(totalBytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_REPLY_ATTACHMENTS_TOTAL_BYTES / 1024 / 1024}MB)`,
        });
      }

      mailAttachments = attachments.map((a: any) => ({ filename: a.filename, href: a.url }));
    }

    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    const gmailUser = process.env.GMAIL_USER || GMAIL_INBOX_MAILBOX;
    if (!gmailPass) return res.status(500).json({ error: 'GMAIL_APP_PASSWORD not configured' });

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
    const finalSubject = subject && /^re:/i.test(subject) ? subject : `Re: ${subject || ''}`;
    // Same company signature as the templated booking/confirmation emails
    // (see loadEmailSignatureHtml above) - direct Mail Inbox replies didn't
    // get one at all before this, so a customer replying to a signed
    // booking-confirmation email would get an unsigned reply back.
    const signatureHtml = await loadEmailSignatureHtml();
    const signedHtml = html + signatureHtml;

    const info = await transporter.sendMail({
      from: `"Pattaya Rent A Car" <${gmailUser}>`,
      to,
      subject: finalSubject,
      html: signedHtml,
      ...(inReplyToMessageId ? { inReplyTo: inReplyToMessageId, references: inReplyToMessageId } : {}),
      ...(mailAttachments && mailAttachments.length > 0 ? { attachments: mailAttachments } : {}),
    });
    console.log(`[Mail] Reply sent OK: ${info.messageId}`);
    // Return the final signed HTML so the client's optimistic thread update
    // (MailInbox.tsx handleSend) can show staff the same message the
    // customer actually received, instead of the unsigned draft.
    res.json({ success: true, messageId: info.messageId, html: signedHtml });
  } catch (err: any) {
    console.error('[Mail] reply send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Same "who's the customer" heuristic the frontend uses (MailInbox.tsx
// resolveCustomerEmail): prefer the most recent inbound message (from someone
// other than the info@ mailbox), falling back to the "To" address of the most
// recent outbound message for threads that are entirely outbound so far.
function resolveThreadCustomerEmail(msgs: { from: string; to: string; replyTo?: string }[]): string {
  const inbound = [...msgs].reverse().find(m => emailOf(m.from) !== GMAIL_INBOX_MAILBOX);
  if (inbound) return emailOf(inbound.from);
  const outbound = [...msgs].reverse().find(m => m.to && emailOf(m.to) !== GMAIL_INBOX_MAILBOX);
  if (outbound) return emailOf(outbound.to);
  // Neither From nor To points past our own mailbox - happens for staff-only
  // notifications (e.g. "New Booking Enquiry") sent to ourselves with the
  // customer's real address only in Reply-To. Fall back to that.
  const withReplyTo = [...msgs].reverse().find(m => m.replyTo && emailOf(m.replyTo) !== GMAIL_INBOX_MAILBOX);
  return withReplyTo ? emailOf(withReplyTo.replyTo!) : '';
}

// AI-drafted reply suggestion for a thread. Staff review and edit before sending -
// nothing here sends mail. Grounded only in the thread transcript plus whatever
// customer profile/booking history we have on file; does not touch pricing or
// booking logic.
app.post('/api/mail/threads/:id/suggest-reply', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));

    const full = await gmailApiFetch(`/threads/${req.params.id}?format=full`);
    const rawMessages = full.messages || [];
    if (rawMessages.length === 0) return res.status(404).json({ error: 'Thread not found' });

    const messages = rawMessages.map((m: any) => {
      const headers = m.payload?.headers || [];
      const { text, html } = extractGmailBody(m.payload);
      return {
        from: gmailHeader(headers, 'From'),
        to: gmailHeader(headers, 'To'),
        replyTo: gmailHeader(headers, 'Reply-To') || undefined,
        date: gmailHeader(headers, 'Date'),
        body: (text || stripHtmlTags(html) || '').trim(),
        bookingId: gmailHeader(headers, 'X-Booking-Id') || undefined,
      };
    });
    const subject = gmailHeader(rawMessages[rawMessages.length - 1]?.payload?.headers || [], 'Subject');
    const customerEmail = resolveThreadCustomerEmail(messages);

    // If this thread is linked to a booking (X-Booking-Id header, set at send time - see
    // /api/send-email), pull its delivery fee the same way the enquiry form and templates
    // do, so the draft states the actual fee instead of guessing one.
    let deliveryFeeInfo: string | null = null;
    const linkedBookingId = messages.find((m: any) => m.bookingId)?.bookingId;
    if (linkedBookingId) {
      const bookingSnap = await firestore.collection('bookings').doc(linkedBookingId).get();
      const loc = bookingSnap.exists ? bookingSnap.data()?.deliveryLocation : null;
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
        const deliveryCfgSnap = await firestore.collection('pricing_config').doc('delivery').get();
        if (deliveryCfgSnap.exists) {
          const deliveryCfg = deliveryCfgSnap.data();
          const distanceKm = haversineKm(deliveryCfg.officeLat, deliveryCfg.officeLng, loc.lat, loc.lng);
          const { fee, available } = calculateDeliveryFee(distanceKm, deliveryCfg);
          deliveryFeeInfo = !available
            ? `This address is ~${distanceKm.toFixed(1)}km from our office, outside our standard ${deliveryCfg.maxRadiusKm}km delivery area - do not quote a fee, tell the customer delivery availability and cost will need to be confirmed by our team.`
            : fee === 0
              ? `This address is ~${distanceKm.toFixed(1)}km from our office, within our free delivery zone (${deliveryCfg.freeRadiusKm}km) - delivery is free.`
              : `This address is ~${distanceKm.toFixed(1)}km from our office - the delivery fee is ${fee} THB.`;
        }
      }
    }

    let customerProfile: any = null;
    let bookingHistory: any[] = [];
    let faqSnapPromise = firestore.collection('faqs').get();
    if (customerEmail) {
      const [custSnap, bookingsSnap] = await Promise.all([
        firestore.collection('customers').where('email', '==', customerEmail).limit(1).get(),
        firestore.collection('bookings').where('email', '==', customerEmail).get(),
      ]);
      if (!custSnap.empty) customerProfile = custSnap.docs[0].data();
      const toMillis = (v: any) => (v && v.toMillis) ? v.toMillis() : (v ? new Date(v).getTime() : 0);
      bookingHistory = bookingsSnap.docs
        .map((d: any) => d.data())
        .sort((a: any, b: any) => toMillis(b.createdAt) - toMillis(a.createdAt))
        .slice(0, 10)
        .map((b: any) => ({ startDate: b.startDate, endDate: b.endDate, status: b.status, amount: b.amount, carName: b.carName }));
    }
    // Suggested replies use every FAQ in the collection regardless of its `published`
    // flag - unpublished FAQs are still fine to draw on for staff email replies, they're
    // just excluded from the public marketing site.
    const faqSnap = await faqSnapPromise;
    const faqs = faqSnap.docs
      .map((d: any) => d.data())
      .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
      .map((f: any) => ({ q: f.q, a: f.a }));

    const transcript = messages
      .map((m: any) => `From: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\n\n${m.body}`)
      .join('\n\n---\n\n');

    const promptParts = [
      `You are drafting a reply email for staff at Pattaya Rent A Car, a car rental company in Pattaya, Thailand (operating since 2009). A staff member will review and edit this draft before sending, so write it as a complete, ready-to-send reply to the customer's most recent message below.`,
      `Only use information given in this prompt - do not invent prices, dates, availability, or other specifics you have not been given.`,
      `Write in plain text only (no HTML, no markdown, no subject line). Keep it warm, professional and concise. Sign off as "Pattaya Rent A Car".`,
      `\nEmail subject: ${subject || '(no subject)'}`,
      `\nThread so far (oldest to newest):\n${transcript}`,
    ];
    if (customerProfile) {
      promptParts.push(`\nCustomer profile on file: ${JSON.stringify(customerProfile)}`);
    }
    if (bookingHistory.length > 0) {
      promptParts.push(`\nCustomer's past bookings on file: ${JSON.stringify(bookingHistory)}`);
    }
    if (faqs.length > 0) {
      promptParts.push(`\nCompany FAQ knowledge base (use these for factual answers where relevant): ${JSON.stringify(faqs)}`);
    }
    if (deliveryFeeInfo) {
      promptParts.push(`\nDelivery fee for this booking's address: ${deliveryFeeInfo}`);
    }
    const prompt = promptParts.join('\n');

    const anthropicKey = await getSecretValue('ANTHROPIC_API_KEY');
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });
    const draft = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';

    res.json({ draft });
  } catch (err: any) {
    console.error('[Mail] suggest-reply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Customer history - match the sender's email against past bookings/enquiries
app.get('/api/mail/history', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const email = typeof req.query.email === 'string' ? req.query.email.toLowerCase().trim() : '';
    if (!email) return res.json({ bookings: [] });
    const snap = await firestore.collection('bookings')
      .where('email', '==', email)
      .get();
    const toMillis = (v: any) => (v && v.toMillis) ? v.toMillis() : (v ? new Date(v).getTime() : 0);
    const bookings = snap.docs
      .map((d: any) => ({ id: d.id, ...d.data() }))
      .sort((a: any, b: any) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, 20);

    // Resolve each booking's carId to the vehicle's name so staff see what was hired
    // without a separate lookup. Bookings only store a total amount, not a per-day
    // rate - the frontend derives price/day as amount / rental days for historical accuracy.
    const carIds = Array.from(new Set(bookings.map((b: any) => b.carId).filter(Boolean)));
    if (carIds.length > 0) {
      const carDocs = await Promise.all(carIds.map((id: string) => firestore.collection('cars').doc(id).get()));
      const carNameById: Record<string, string> = {};
      carDocs.forEach((doc: any) => { if (doc.exists) carNameById[doc.id] = doc.data()?.name || ''; });
      bookings.forEach((b: any) => { b.carName = carNameById[b.carId] || null; });
    }

    res.json({ bookings });
  } catch (err: any) {
    console.error('[Mail] history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Customer profile lookup, matched by email (same key as the history endpoint above)
const FINANCE_MOVEMENT_CATEGORIES = ['Deposit', 'Deposit Refund', 'Investment Returned', 'Transfer Between Accounts', 'Purchased Bike', 'Purchased Car', 'Sold Car', 'Sold Bike'];

// Distinct years that have transaction data, derived cheaply from the earliest/latest
// transaction dates (avoids scanning the full transactions collection just to build
// the Financial Overview year picker).
app.get('/api/finance/years', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const earliestSnap = await firestore.collection('transactions').orderBy('date', 'asc').limit(1).get();
    const latestSnap = await firestore.collection('transactions').orderBy('date', 'desc').limit(1).get();
    if (earliestSnap.empty || latestSnap.empty) return res.json({ years: [] });
    const earliestYear = parseInt(String(earliestSnap.docs[0].data().date).slice(0, 4), 10);
    const latestYear = parseInt(String(latestSnap.docs[0].data().date).slice(0, 4), 10);
    const years: string[] = [];
    for (let y = latestYear; y >= earliestYear; y--) years.push(String(y));
    res.json({ years });
  } catch (err: any) {
    console.error('[Finance] years lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Server-side aggregation for the Financial Overview matrix. Queries only the
// selected year's transactions directly from Firestore (not the client's capped
// 500-doc recent-transactions list) and computes per-category-per-month totals
// in memory here, returning a compact payload instead of shipping thousands of
// full transaction documents to the browser.
app.get('/api/finance/overview', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const year = typeof req.query.year === 'string' ? req.query.year : '';
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'year is required (yyyy)' });
    const carId = typeof req.query.carId === 'string' && req.query.carId !== 'All' ? req.query.carId : null;

    const startISO = `${year}-01-01T00:00:00.000Z`;
    const endISO = `${Number(year) + 1}-01-01T00:00:00.000Z`;
    const snap = await firestore.collection('transactions')
      .where('date', '>=', startISO)
      .where('date', '<', endISO)
      .get();

    const matrix: { [cat: string]: { [mKey: string]: number } } = {};
    const colIncomeTotals: { [mKey: string]: number } = {};
    const colExpenseTotals: { [mKey: string]: number } = {};
    const colGrandTotals: { [mKey: string]: number } = {};
    let grandTotal = 0;
    let totalIncome = 0;
    let totalExpense = 0;
    const categoriesSet = new Set<string>();
  const categoryTypeSums: { [cat: string]: { income: number; expense: number } } = {};

    snap.docs.forEach(doc => {
      const t = doc.data() as any;
      if (carId && t.carId !== carId) return;
      const cat = t.category || 'Uncategorized';
      const dateStr = typeof t.date === 'string' ? t.date : '';
      const mKey = dateStr.slice(0, 7);
      if (!mKey) return;
      categoriesSet.add(cat);
      if (!matrix[cat]) matrix[cat] = {};
      const amount = typeof t.amount === 'number' ? t.amount : 0;
      const signed = t.type === 'Adjustment' ? amount : (t.type === 'Income' ? amount : -amount);
      matrix[cat][mKey] = (matrix[cat][mKey] || 0) + signed;

    if (!categoryTypeSums[cat]) categoryTypeSums[cat] = { income: 0, expense: 0 };
    if (t.type === 'Income') categoryTypeSums[cat].income += amount;
    else if (t.type === 'Expense') categoryTypeSums[cat].expense += amount;

      const isMovement = FINANCE_MOVEMENT_CATEGORIES.includes(cat);
      if (!isMovement) {
        if (t.type === 'Income') {
          colIncomeTotals[mKey] = (colIncomeTotals[mKey] || 0) + amount;
          totalIncome += amount;
        } else if (t.type === 'Expense') {
          colExpenseTotals[mKey] = (colExpenseTotals[mKey] || 0) + amount;
          totalExpense += amount;
        }
        colGrandTotals[mKey] = (colGrandTotals[mKey] || 0) + signed;
        grandTotal += signed;
      }
    });

    const categoryTypes: { [cat: string]: string } = {};
  categoriesSet.forEach(cat => {
    if (FINANCE_MOVEMENT_CATEGORIES.includes(cat)) {
      categoryTypes[cat] = 'Movement';
    } else {
      const sums = categoryTypeSums[cat] || { income: 0, expense: 0 };
      categoryTypes[cat] = sums.income >= sums.expense ? 'Income' : 'Expense';
    }
  });

  res.json({
      categories: Array.from(categoriesSet).sort(),
    categoryTypes,
      matrix,
      colIncomeTotals,
      colExpenseTotals,
      colGrandTotals,
      totalIncome,
      totalExpense,
      grandTotal,
    });
  } catch (err: any) {
    console.error('[Finance] overview aggregation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Server-side search for the Recent Transactions list. Queries the full
// transactions collection (bounded by category/carId/year/month filters when
// given) instead of the client's capped 500-doc recent-transactions snapshot,
// so filtering/search covers the whole history, not just the most recent 500
// rows. Free-text search still happens client-side against this result, since
// it needs joins against the accounts/cars collections already cached in the
// browser (account name, car name).
app.get('/api/finance/transactions', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const category = typeof req.query.category === 'string' && req.query.category !== 'All' ? req.query.category : null;
    const carId = typeof req.query.carId === 'string' && req.query.carId !== 'All' ? req.query.carId : null;
    const year = typeof req.query.year === 'string' && req.query.year !== 'All' ? req.query.year : null;
    const month = typeof req.query.month === 'string' && req.query.month !== 'All' ? req.query.month : null;

    const snap = await firestore.collection('transactions').orderBy('date', 'desc').get();
    let results = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (category) results = results.filter((t: any) => t.category === category);
    if (carId) results = results.filter((t: any) => t.carId === carId);
    if (year) results = results.filter((t: any) => typeof t.date === 'string' && t.date.slice(0, 4) === year);
    if (month) results = results.filter((t: any) => typeof t.date === 'string' && t.date.slice(5, 7) === month);

    res.json({ transactions: results });
  } catch (err: any) {
    console.error('[Finance] transactions search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const email = typeof req.query.email === 'string' ? req.query.email.toLowerCase().trim() : '';
    if (!email) return res.json({ customer: null });
    const snap = await firestore.collection('customers').where('email', '==', email).limit(1).get();
    if (snap.empty) return res.json({ customer: null });
    const doc = snap.docs[0];
    res.json({ customer: { id: doc.id, ...doc.data() } });
  } catch (err: any) {
    console.error('[Mail] customer lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

let cachedTransactionCategories: { categories: string[]; expiresAt: number } | null = null;

// Complete, always-current list of every category value used anywhere in
// the transactions collection (not capped like the Recent Transactions
// client list, which only loads the most recent 500 rows and therefore
// misses rare categories like "Sold Car"). Powers the Category Filter
// dropdown on the Transactions page. Requires a full collection scan, so
// the result is cached in memory for 1 hour.
app.get('/api/finance/categories', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    if (cachedTransactionCategories && cachedTransactionCategories.expiresAt > Date.now()) {
      return res.json({ categories: cachedTransactionCategories.categories });
    }
    const snap = await firestore.collection('transactions').select('category').get();
    const categoriesSet = new Set<string>();
    snap.docs.forEach(doc => {
      const cat = doc.data().category;
      if (typeof cat === 'string' && cat.trim()) categoriesSet.add(cat);
    });
    const categories = Array.from(categoriesSet).sort();
    cachedTransactionCategories = { categories, expiresAt: Date.now() + 60 * 60 * 1000 };
    res.json({ categories });
  } catch (err: any) {
    console.error('[Finance] categories fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Customer profile create/update, upserted by email (creates a new record if none exists)
app.put('/api/customers', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    if (!email) return res.status(400).json({ error: 'email is required' });
    const { id: _ignoreId, ...fields } = req.body;
    const snap = await firestore.collection('customers').where('email', '==', email).limit(1).get();
    if (snap.empty) {
      const newDoc = await firestore.collection('customers').add({
        ...fields,
        email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const saved = await newDoc.get();
      return res.json({ customer: { id: newDoc.id, ...saved.data() } });
    }
    const doc = snap.docs[0];
    await doc.ref.set({ ...fields, email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const updated = await doc.ref.get();
    res.json({ customer: { id: doc.id, ...updated.data() } });
  } catch (err: any) {
    console.error('[Mail] customer update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Didit ID Verification (staff-triggered from Mail Inbox, scoped to new
// customers - i.e. no prior booking history - per project decision) ---
const DIDIT_API_BASE = 'https://verification.didit.me/v3';

// Creates a hosted Didit verification session for a customer and stores the
// session reference on their record. vendor_data is set to the customers/{id}
// doc ID so the webhook below can write results back to the right record.
app.post('/api/verify/start', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : '';
    if (!customerId) return res.status(400).json({ error: 'customerId is required' });

    const apiKey = process.env.DIDIT_API_KEY;
    const workflowId = process.env.DIDIT_WORKFLOW_ID;
    if (!apiKey || !workflowId) return res.status(500).json({ error: 'Didit is not configured' });

    const diditRes = await fetch(`${DIDIT_API_BASE}/session/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ workflow_id: workflowId, vendor_data: customerId }),
    });
    const diditData = await diditRes.json() as any;
    if (!diditRes.ok) {
      console.error('[Didit] session create error:', diditData);
      return res.status(502).json({ error: 'Failed to create verification session' });
    }

    await firestore.collection('customers').doc(customerId).set({
      diditStatus: diditData.status || 'Not Started',
      diditSessionId: diditData.session_id,
      diditVerificationUrl: diditData.url,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ url: diditData.url, sessionId: diditData.session_id, status: diditData.status });
  } catch (err: any) {
    console.error('[Didit] verify/start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Didit webhook - verification result notifications. Public endpoint (Didit calls
// this directly, so no staff auth) - authenticated instead via HMAC signature
// (X-Signature-V2, per docs.didit.me/integration/webhooks) using the shared
// webhook secret from the destination configured in the Didit console.
app.post('/api/didit/webhook', async (req: any, res: any) => {
  try {
    const secret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ error: 'Webhook not configured' });

    const signature = req.headers['x-signature-v2'] as string | undefined;
    const timestampHeader = req.headers['x-timestamp'] as string | undefined;
    if (!signature || !timestampHeader) return res.status(401).json({ error: 'Missing signature' });

    const timestamp = parseInt(timestampHeader, 10);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
      return res.status(401).json({ error: 'Stale timestamp' });
    }

    // Canonicalize per Didit's X-Signature-V2 spec: sort object keys recursively,
    // compact separators, preserve unescaped unicode.
    function canonicalize(value: any): any {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value && typeof value === 'object') {
        const sorted: any = {};
        Object.keys(value).sort().forEach(k => { sorted[k] = canonicalize(value[k]); });
        return sorted;
      }
      return value;
    }
    const canonical = JSON.stringify(canonicalize(req.body));
    const expected = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    if (!valid) {
      console.error('[Didit] webhook signature mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { session_id, status, vendor_data, decision } = req.body || {};
    const customerId = typeof vendor_data === 'string' ? vendor_data : '';
    if (!customerId) return res.json({ ok: true });

    const idVerification = decision?.id_verifications?.[0];
    const livenessCheck = decision?.liveness_checks?.[0];
    const faceMatch = decision?.face_matches?.[0];

    const update: any = {
      diditStatus: status,
      diditSessionId: session_id,
      diditVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (idVerification) {
      update.diditExtracted = {
        firstName: idVerification.first_name || null,
        lastName: idVerification.last_name || null,
        dob: idVerification.date_of_birth || null,
        documentType: idVerification.document_type || null,
        documentNumber: idVerification.document_number || null,
        issuingState: idVerification.issuing_state || null,
      };
    }
    if (livenessCheck?.score != null) update.diditLivenessScore = livenessCheck.score;
    if (faceMatch?.score != null) update.diditFaceMatchScore = faceMatch.score;

    await firestore.collection('customers').doc(customerId).set(update, { merge: true });

    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Didit] webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// LINE Messaging API - webhook (incoming messages) + read endpoints
// ============================================================
// Unlike the Mail Inbox, which reads threads live from Gmail (see GET
// /api/mail/threads) and stores nothing itself, LINE's Messaging API has no
// "list all conversations" endpoint - the only way to receive messages is
// this webhook, which LINE calls whenever a customer messages the OA. So
// line_threads/{userId} (with a line_threads/{userId}/messages/{messageId}
// subcollection) is the sole source of truth for LINE conversation history,
// starting from whenever the webhook URL is first configured - there's no
// way to backfill anything from before that.
//
// Nothing here is reachable directly from the browser's Firestore client SDK
// (unlike e.g. email_templates) - both the webhook and the read endpoints
// below go through the Admin SDK on this server, so no Firestore security
// rules changes are needed for this feature.

let cachedLineChannelSecret: string | null = null;
async function getLineChannelSecret(): Promise<string> {
  if (!cachedLineChannelSecret) cachedLineChannelSecret = await getSecretValue('line-channel-secret');
  return cachedLineChannelSecret;
}

let cachedLineAccessToken: string | null = null;
async function getLineAccessToken(): Promise<string> {
  if (!cachedLineAccessToken) cachedLineAccessToken = await getSecretValue('line-channel-access-token');
  return cachedLineAccessToken;
}

// Fetches a LINE user's profile (display name + photo). Only called when the
// thread doc doesn't already have a successfully-fetched profile (see
// profileFetched below), rather than on every message, to avoid burning API
// calls unnecessarily.
async function fetchLineProfile(userId: string): Promise<{ displayName: string; pictureUrl: string | null; fetched: boolean }> {
  try {
    const token = await getLineAccessToken();
    const resp = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`LINE profile fetch failed: ${resp.status}`);
    const data: any = await resp.json();
    return { displayName: data.displayName || userId, pictureUrl: data.pictureUrl || null, fetched: true };
  } catch (err: any) {
    // fetched: false is the important part - it tells the caller not to mark
    // this customer's profile as done, so the next event for them retries
    // this lookup instead of leaving them permanently labeled by their raw
    // LINE user ID just because Secret Manager or LINE's API hiccuped once.
    console.warn('[LINE] Failed to fetch profile for', userId, err?.message || err);
    return { displayName: userId, pictureUrl: null, fetched: false };
  }
}

// Human-readable placeholder for message types we record metadata for but
// don't yet download/display full content for (photos, stickers, etc.) -
// downloading and hosting that media is deferred to a later pass; for now
// staff would need to check the LINE app itself to see the actual photo.
function describeLineMessage(message: any): { text: string; kind: string } {
  switch (message?.type) {
    case 'text': return { text: message.text || '', kind: 'text' };
    case 'image': return { text: '[Photo]', kind: 'image' };
    case 'video': return { text: '[Video]', kind: 'video' };
    case 'audio': return { text: '[Audio]', kind: 'audio' };
    case 'sticker': return { text: '[Sticker]', kind: 'sticker' };
    case 'file': return { text: `[File] ${message?.fileName || ''}`.trim(), kind: 'file' };
    case 'location': return { text: `[Location] ${message?.title || message?.address || ''}`.trim(), kind: 'location' };
    default: return { text: `[${message?.type || 'unknown'}]`, kind: message?.type || 'unknown' };
  }
}

// True unless we can positively prove `incoming` is not newer than
// `existing` - i.e. both are real Firestore Timestamps and incoming is <=
// existing. A missing/non-Timestamp value on either side means we can't
// prove staleness, so this defaults to "apply the write" rather than
// silently dropping data. Shared by every place below that needs to ignore
// an out-of-order/redelivered webhook event without ignoring a legitimate
// write that just happens to arrive without a comparable timestamp.
function isEventNewer(existing: unknown, incoming: unknown): boolean {
  if (!(incoming instanceof Timestamp) || !(existing instanceof Timestamp)) return true;
  return incoming.toMillis() > existing.toMillis();
}

async function handleLineEvent(event: any): Promise<void> {
  const userId = event?.source?.userId;
  // Group/room chats are disabled on this OA ("Allow bot to join group
  // chats" is off in LINE Official Account Manager), so source.type should
  // always be 'user' - skip anything else rather than mis-file it under a
  // group id as if it were a customer.
  if (!userId || event?.source?.type !== 'user') return;

  const threadRef = firestore.collection('line_threads').doc(userId);
  const eventAt = event.timestamp ? Timestamp.fromMillis(event.timestamp) : null;

  // Brings the thread's identity (display name/photo) and following status
  // up to date for a follow or message event. Used by both, so a customer's
  // profile gets fetched (and retried on prior failure - see profileFetched)
  // regardless of whether their first contact was a follow or straight into
  // a message. The profile fetch happens outside the transaction below
  // (transactions can retry on contention, and retrying a network call to
  // LINE's API as a side effect of that would be wasteful); the transaction
  // then re-checks event ordering before writing, since the network call
  // introduces a gap where a newer event could have landed in the meantime.
  async function upsertIdentity() {
    const existing = (await threadRef.get()).data();
    if (!isEventNewer(existing?.identityEventAt, eventAt)) return;
    const profile = existing?.profileFetched ? null : await fetchLineProfile(userId);
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(threadRef);
      if (!isEventNewer(snap.data()?.identityEventAt, eventAt)) return;
      tx.set(threadRef, {
        userId,
        ...(profile ? { displayName: profile.displayName, pictureUrl: profile.pictureUrl, profileFetched: profile.fetched } : {}),
        following: true,
        identityEventAt: eventAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        // Only stamped the first time this thread doc is written, via merge
        // semantics - an existing createdAt is never touched by a later
        // upsertIdentity call.
        ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
    });
  }

  if (event.type === 'follow') {
    await upsertIdentity();
    return;
  }

  if (event.type === 'unfollow') {
    // Customer blocked the OA - can't push messages to them anymore. Keep
    // their history, just flag it so a future UI can show that. Same
    // ordering guard as upsertIdentity, so an old follow redelivered after
    // this unfollow can't flip following back to true (or vice versa).
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(threadRef);
      if (!isEventNewer(snap.data()?.identityEventAt, eventAt)) return;
      tx.set(threadRef, {
        following: false,
        identityEventAt: eventAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return;
  }

  if (event.type === 'unsend') {
    // Customer deleted a message they'd already sent. LINE still delivers
    // the original content as its own event first, so the message document
    // should already exist - mark it retracted rather than deleting it
    // outright, so the doc id stays stable/idempotent and staff can see that
    // something was sent and withdrawn rather than the thread just skipping
    // a message. Only the previewed lastMessageText is refreshed, and only
    // when the unsent message was in fact the current preview - recomputing
    // the true latest surviving message would need a query Firestore can't
    // serve efficiently without excluding docs that predate the `unsent`
    // field (which is all of them so far), so an unsend of an older message
    // simply leaves the (still-correct) newer preview alone.
    const messageId = event.unsend?.messageId;
    if (!messageId) return;
    const msgRef = threadRef.collection('messages').doc(messageId);
    await firestore.runTransaction(async (tx) => {
      const [msgSnap, threadSnap] = await Promise.all([tx.get(msgRef), tx.get(threadRef)]);
      if (!msgSnap.exists) return; // original message event hasn't arrived (or was already pruned) - nothing to retract yet
      tx.set(msgRef, { text: '[Message deleted]', kind: 'unsent', unsent: true }, { merge: true });
      if (threadSnap.data()?.lastMessageAt?.isEqual?.(msgSnap.data()?.createdAt)) {
        tx.set(threadRef, { lastMessageText: '[Message deleted]', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });
    return;
  }

  if (event.type !== 'message') return; // ignore postback/beacon/etc for now - nothing uses those yet

  await upsertIdentity();

  const { text, kind } = describeLineMessage(event.message);
  // LINE's own message id, when present, doubles as a natural dedup key if
  // this webhook call is ever retried (e.g. because our 200 arrived late) -
  // re-writing the same doc id is a harmless no-op rather than a duplicate.
  const messageId = event.message?.id || `${userId}-${event.timestamp}`;
  const createdAt = eventAt || FieldValue.serverTimestamp();
  const msgRef = threadRef.collection('messages').doc(messageId);

  // A plain (non-transactional) .set() here would let a redelivered copy of
  // this same message event resurrect an already-unsent message: this
  // webhook returns a non-2xx (see anyFailed below) whenever any event in a
  // batch fails, which makes LINE redeliver the whole batch - including
  // events that already succeeded the first time. If the customer's unsend
  // for this message was processed in the gap before that redelivery
  // arrives, this write would otherwise blindly restore the original text
  // and undo the tombstone the unsend branch above just set.
  await firestore.runTransaction(async (tx) => {
    const existing = await tx.get(msgRef);
    if (existing.exists && existing.data()?.unsent) return;
    tx.set(msgRef, {
      id: messageId,
      from: 'customer',
      kind,
      text,
      // Reply tokens are single-use and expire a short time after the message
      // arrives - not usable yet (no reply endpoint in this phase) but kept
      // for when that's built, since it's free to store.
      replyToken: event.replyToken || null,
      createdAt,
    });
  });

  // Runs as a transaction, and only overwrites the summary if this event is
  // at least as new as whatever's already there. Without that check, two
  // overlapping webhook calls for the same customer (or LINE redelivering an
  // older event after a newer one already landed) could finish in either
  // order - whichever write lands last would win, letting an older message
  // clobber the summary with a stale preview/timestamp even though the
  // individual message documents above are all stored correctly.
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(threadRef);
    if (!isEventNewer(snap.data()?.lastMessageAt, createdAt)) return;
    tx.set(threadRef, {
      lastMessageText: text,
      lastMessageAt: createdAt,
      lastMessageFrom: 'customer',
      unread: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

// LINE webhook - incoming messages/events. Public endpoint (LINE calls this
// directly, so no staff auth) - authenticated instead via the
// x-line-signature header, an HMAC-SHA256 of the raw request body keyed with
// the channel secret (see req.rawBody, captured by the express.json() verify
// hook above).
app.post('/api/line/webhook', async (req: any, res: any) => {
  try {
    const channelSecret = await getLineChannelSecret();
    const signature = req.headers['x-line-signature'] as string | undefined;
    if (!signature || !req.rawBody) {
      console.error('[LINE] webhook missing signature or raw body');
      return res.status(401).send('Missing signature');
    }
    const expected = crypto.createHmac('sha256', channelSecret).update(req.rawBody).digest('base64');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    if (!valid) {
      console.error('[LINE] webhook signature mismatch');
      return res.status(401).send('Invalid signature');
    }

    const events: any[] = req.body?.events || [];
    let anyFailed = false;
    for (const event of events) {
      try {
        await handleLineEvent(event);
      } catch (err: any) {
        anyFailed = true;
        console.error('[LINE] Failed to handle event', event?.type, err?.message || err);
      }
    }

    // Process events before responding, rather than acking immediately and
    // handling them after (fire-and-forget) - this Cloud Run service throttles
    // CPU after the response is sent unless "CPU is always allocated" is on,
    // which would risk silently dropping in-flight Firestore writes. LINE's
    // timeout is generous enough that a handful of writes per call (almost
    // always one event per webhook call) comfortably finishes first.
    if (anyFailed) {
      // A non-2xx tells LINE to redeliver the whole batch rather than treating
      // it as delivered - without this, a transient Firestore failure would
      // log an error here and then vanish forever, since this webhook is the
      // sole source of LINE conversation history. Safe to redeliver: every
      // write is keyed by LINE's own message id (or a fallback derived from
      // userId+timestamp), so re-processing an event that already succeeded
      // in this same batch is a harmless overwrite, not a duplicate.
      return res.status(500).send('Partial failure - see logs');
    }
    res.status(200).send('OK');
  } catch (err: any) {
    console.error('[LINE] webhook error:', err?.message || err);
    if (!res.headersSent) res.status(500).send('Error');
  }
});

// Mirrors the frontend's own staff check (isStaff in src/App.tsx).
// requireStaffAuth above only confirms the caller is signed in with *some*
// Google account - it doesn't check they're Pattaya Rent A Car staff, so on
// its own it's not enough to gate customer LINE conversation data behind.
// (The same gap exists on other endpoints that use requireStaffAuth; fixing
// it there is tracked separately. It's fixed here because these two
// endpoints are new in this PR.)
function isStaffEmail(email: string | null | undefined): boolean {
  const e = (email || '').toLowerCase().trim();
  return e.endsWith('@pattayarentacar.com') || e === 'info@pattayarentacar.com';
}

// List LINE conversation threads, most recently active first - shaped to
// mirror what GET /api/mail/threads returns, so a future Mail Inbox UI can
// treat both similarly.
app.get('/api/line/threads', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    const decoded = await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    if (!isStaffEmail(decoded.email)) return res.status(403).json({ error: 'Forbidden' });
    const snap = await firestore.collection('line_threads').orderBy('lastMessageAt', 'desc').limit(100).get();
    const threads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ threads });
  } catch (err: any) {
    console.error('[LINE] threads list error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to load LINE threads' });
  }
});

// Get one LINE thread's full message history.
app.get('/api/line/threads/:userId', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    const decoded = await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    if (!isStaffEmail(decoded.email)) return res.status(403).json({ error: 'Forbidden' });
    const { userId } = req.params;
    const threadSnap = await firestore.collection('line_threads').doc(userId).get();
    if (!threadSnap.exists) return res.status(404).json({ error: 'Thread not found' });
    // Most recent 200, oldest-first for display: ordering desc-then-limit
    // keeps the newest messages when a thread has grown past 200 (asc+limit
    // would silently return only the oldest ones and hide anything recent),
    // then the array is reversed back to chronological order for the UI.
    const messagesSnap = await firestore
      .collection('line_threads').doc(userId).collection('messages')
      .orderBy('createdAt', 'desc').limit(200).get();
    const messages = messagesSnap.docs.map(d => d.data()).reverse();
    res.json({ thread: { id: threadSnap.id, ...threadSnap.data() }, messages });
  } catch (err: any) {
    console.error('[LINE] thread detail error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to load LINE thread' });
  }
});

// Fallback poll for staff to manually refresh verification status/decision from
// Didit directly, in case the webhook above was missed.
app.get('/api/verify/status', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : '';
    if (!customerId) return res.status(400).json({ error: 'customerId is required' });

    const custSnap = await firestore.collection('customers').doc(customerId).get();
    const sessionId = custSnap.data()?.diditSessionId;
    if (!sessionId) return res.status(404).json({ error: 'No verification session on file' });

    const apiKey = process.env.DIDIT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Didit is not configured' });

    const diditRes = await fetch(`${DIDIT_API_BASE}/session/${sessionId}/decision/`, {
      headers: { 'x-api-key': apiKey },
    });
    const diditData = await diditRes.json() as any;
    if (!diditRes.ok) {
      console.error('[Didit] status poll error:', diditData);
      return res.status(502).json({ error: 'Failed to fetch verification status' });
    }

    const idVerification = diditData.id_verifications?.[0];
    const extracted = idVerification ? {
      firstName: idVerification.first_name || null,
      lastName: idVerification.last_name || null,
      dob: idVerification.date_of_birth || null,
      documentType: idVerification.document_type || null,
      documentNumber: idVerification.document_number || null,
      issuingState: idVerification.issuing_state || null,
    } : null;

    await firestore.collection('customers').doc(customerId).set({
      diditStatus: diditData.status,
      diditVerifiedAt: FieldValue.serverTimestamp(),
      ...(extracted ? { diditExtracted: extracted } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ status: diditData.status, extracted });
  } catch (err: any) {
    console.error('[Didit] verify/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Mark a thread unread in our own app-level tracking only (does not touch the real
// Gmail UNREAD label). Deletes the stored read-state record so the thread shows as
// unread/bold again until it is next opened.
app.delete('/api/mail/threads/:id/read-state', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    await firestore.collection('mail_read_state').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Mail] mark unread error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bulk mark threads read in our own app-level tracking only (does not touch the real
// Gmail UNREAD label). For each thread ID, looks up its current last message from
// Gmail (same as GET /api/mail/threads) and writes the mail_read_state record - so a
// later reply on any of these threads makes it unread again automatically, exactly
// like opening a single thread does.
app.post('/api/mail/threads/read-state/bulk', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const ids: string[] = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id: any) => typeof id === 'string' && id)
      : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Missing ids' });
    if (ids.length > 100) return res.status(400).json({ error: 'Too many ids (max 100)' });

    const results = await Promise.all(ids.map(async (id) => {
      try {
        const full = await gmailApiFetch(`/threads/${id}?format=metadata`);
        const messages = full.messages || [];
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg) return { id, ok: false };
        await firestore.collection('mail_read_state').doc(id).set({
          readMessageId: lastMsg.id,
          readAt: FieldValue.serverTimestamp(),
        });
        return { id, ok: true };
      } catch (err: any) {
        console.error(`[Mail] bulk mark read error for ${id}:`, err.message);
        return { id, ok: false };
      }
    }));
    res.json({ results });
  } catch (err: any) {
    console.error('[Mail] bulk mark read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Lightweight unread count over recently loaded threads only (NOT a true mailbox-wide
// total, and NOT based on Gmail's real UNREAD label). Scans a bounded number of the
// most recent inbox pages using the same app-level read/unread logic as
// GET /api/mail/threads, and reports how many of those are unread.
app.get('/api/mail/unread-count', async (req: any, res: any) => {
  if (!requireStaffAuth(req, res)) return;
  try {
    await admin.auth().verifyIdToken((req.headers['authorization'] as string).slice(7));
    const MAX_PAGES = 5; // ~100 most recently loaded threads
    let pageToken: string | undefined = undefined;
    let unreadCount = 0;
    let scanned = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const listResp = await gmailApiFetch(
        `/threads?labelIds=INBOX&maxResults=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      );
      const threadStubs = listResp.threads || [];
      if (threadStubs.length === 0) break;
      const threads = await Promise.all(threadStubs.map(async (t: any) => {
        const full = await gmailApiFetch(`/threads/${t.id}?format=metadata`);
        const messages = full.messages || [];
        const lastMsg = messages[messages.length - 1];
        return { id: t.id, lastMessageId: lastMsg?.id || null };
      }));
      const readSnaps = await Promise.all(
        threads.map((t: any) => firestore.collection('mail_read_state').doc(t.id).get())
      );
      threads.forEach((t: any, i: number) => {
        scanned++;
        const readData = readSnaps[i].exists ? readSnaps[i].data() : null;
        const unread = !readData || readData!.readMessageId !== t.lastMessageId;
        if (unread) unreadCount++;
      });
      pageToken = listResp.nextPageToken || undefined;
      if (!pageToken) break;
    }
    res.json({ unreadCount, scanned });
  } catch (err: any) {
    console.error('[Mail] unread count error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Catch-all for unhandled API routes
  app.use(growthExecutorApp);
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });}

startServer().catch(err => {
  console.error("CRITICAL: Failed to start server:", err);
  // Delay exit to prevent tight restart loops
  setTimeout(() => process.exit(1), 5000);
});
