
import "dotenv/config";
import fs from 'fs';
import path from "path";
import { fileURLToPath } from "url";

// Read config immediately
const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const projectId = firebaseConfig.projectId;
const databaseId = firebaseConfig.firestoreDatabaseId;

console.log('[Init] Initial Env GOOGLE_CLOUD_PROJECT:', process.env.GOOGLE_CLOUD_PROJECT);
console.log('[Init] Initial Env GCLOUD_PROJECT:', process.env.GCLOUD_PROJECT);
console.log('[Init] Initial Env GOOGLE_CLOUD_QUOTA_PROJECT:', process.env.GOOGLE_CLOUD_QUOTA_PROJECT);

// Force environment variables to match the config project ID to ensure Admin SDK targets the correct project
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;

import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as XLSX from "xlsx";
import { format, parse, isValid } from "date-fns";
import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as Papa from "papaparse";
import https from "https";
import fetch from "node-fetch";

const httpsAgent = new https.Agent({ keepAlive: true });

const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/business.manage"
];

const dbId = databaseId && databaseId !== '(default)' ? databaseId : undefined;

// Initialize Firestore
let firestore: any = null;
let isFirestoreReady = false;

// Initialize Admin SDK and Firestore immediately to prevent 503 errors
try {
  if (admin.apps.length === 0) {
    console.log(`[Init] Initializing Admin SDK for project: ${projectId}`);
    admin.initializeApp({
      projectId: projectId,
      credential: admin.credential.applicationDefault(),
      storageBucket: firebaseConfig.storageBucket
    });
  }
  
  // Use the specific database ID if provided
  if (dbId) {
    console.log(`[Init] Using named database: ${dbId}`);
    firestore = getFirestore(admin.app(), dbId);
  } else {
    console.log(`[Init] Using default database`);
    firestore = getFirestore(admin.app());
  }
  
  // Configure Firestore settings for better reliability
  firestore.settings({
    ignoreUndefinedProperties: true,
  });
  
  console.log(`[Init] Firestore instance created successfully`);
} catch (e) {
  console.error("[Init] Immediate Firestore initialization failed:", e);
}

let initLogs: string[] = [];
function logInit(msg: string) {
  console.log(msg);
  initLogs.push(`${new Date().toISOString()}: ${msg}`);
}

async function verifyFirestore() {
  const configProjectId = projectId;
  const configDatabaseId = dbId;
  const startTime = Date.now();
  
  const maxRetries = 20; // Reduced retries
  let lastError: any = null;

  // Initial delay to let the environment settle - reduced to 5s to avoid blocking saveTokens
  await new Promise(resolve => setTimeout(resolve, 5000));

  for (let i = 0; i < maxRetries; i++) {
    try {
      if (i > 0) {
        // Longer delay between retries
        const delay = Math.min(30000 * i, 60000);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        
        // Very infrequent logs to avoid alarming the user
        if (i % 10 === 0) {
          logInit(`[Status] Syncing permissions with Google Cloud... (Elapsed: ${elapsed}s)`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // If we've failed a few times with a named database, try the default one as a fallback
      let currentFirestore = firestore;
      let currentDbId = configDatabaseId;
      
      // Try fallback much earlier (after 5 attempts)
      if (i >= 5 && configDatabaseId && configDatabaseId !== '(default)') {
        if (i === 5) logInit(`[Init] Named database syncing is taking longer than expected. Checking fallback...`);
        currentFirestore = getFirestore(admin.app());
        currentDbId = '(default)';
      }

      // Only log every 10th attempt or the first one
      if (i === 0 || i % 10 === 0) {
        logInit(`[Init] Connection Attempt ${i + 1}/${maxRetries}...`);
      }
      
      // Test connection with a simple read with a timeout
      const testDoc = currentFirestore.collection('system_config').doc('test_connection');
      
      // Use a promise race to implement a timeout for the get() call
      const doc = await Promise.race([
        testDoc.get(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore read timeout')), 10000))
      ]) as any;
      
      // If read works, try a write to verify full permissions
      try {
        await testDoc.set({ 
          timestamp: FieldValue.serverTimestamp(),
          status: 'ready',
          lastAttempt: i + 1,
          elapsed: Math.round((Date.now() - startTime) / 1000),
          verifiedAt: new Date().toISOString(),
          databaseUsed: currentDbId || '(default)'
        }, { merge: true });
      } catch (writeErr: any) {
        // If write fails but read works, we are almost there
        if (i % 10 === 0) {
          logInit(`[Init] Read successful, still syncing write permissions...`);
        }
        throw writeErr;
      }
      
      logInit(`[Init] SUCCESS: Firestore is now connected and ready!`);
      firestore = currentFirestore; // Update global instance if fallback worked
      isFirestoreReady = true;
      return;
    } catch (err: any) {
      lastError = err;
      const errCode = err.code !== undefined ? err.code : 'UNKNOWN';
      const isPermissionError = errCode === 5 || errCode === 7 || String(err.message).includes('PERMISSION_DENIED');
      
      // Log non-permission errors immediately as they are more likely to be configuration issues
      if (!isPermissionError) {
        logInit(`[Init] Connection attempt ${i + 1} failed with non-permission error: [${errCode}] ${err.message}`);
      } else if (i === maxRetries - 1) {
        logInit(`[Init] Final connection attempt failed: [${errCode}] ${err.message}`);
      }
      
      if (isPermissionError || String(err.message).includes('timeout')) {
        continue;
      }
      
      if (i < maxRetries - 1) continue;
    }
  }

  logInit(`FINAL NOTICE: All ${maxRetries} connection attempts timed out.`);
  logInit(`The app will continue in 'unverified' mode. If you see PERMISSION_DENIED, please refresh in 2 minutes.`);
  isFirestoreReady = true; // Mark as ready anyway to stop the loop
}

// Verify Firestore in the background
verifyFirestore().catch(err => {
  console.error("Critical Firestore verification failure:", err);
});


// Helper for Firestore error reporting as per guidelines
function handleFirestoreError(error: any, operation: string, path: string) {
  const currentProjectId = projectId;
  // @ts-ignore - databaseId is internal but useful for debugging
  const currentDatabaseId = firestore?.databaseId || '(default)';
  
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
    userMessage += " (Tip: This usually means the database permissions aren't synced yet. Please use the 'Firebase Setup' tool in the chat to fix this.)";
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

// Google OAuth Setup - Placeholder for clean start
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

function getRedirectUri() {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || `${(process.env.APP_URL || '').replace(/\/$/, '')}/api/auth/google/callback`;
}

const oauth2Client = new OAuth2Client(
  clientId,
  clientSecret,
  getRedirectUri()
);

const TOKEN_FILE = path.join(process.cwd(), 'google_oauth_tokens.json');

async function getStoredTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (e) {
    console.error("[OAuth] Error reading local token file:", e);
  }
  return null;
}

async function saveTokens(newTokens: any) {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(newTokens));
  } catch (e) {
    console.error("[OAuth] Error saving tokens:", e);
  }
}

async function deleteTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch (e) {
    console.error("[OAuth] Error deleting tokens:", e);
  }
}

// Cache for pricing data
let pricingCache: { [carType: string]: { headers: number[], data: { [date: string]: number[] } } } | null = null;

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

  // Start listening immediately to satisfy platform health checks
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  app.use(express.json({ limit: '50mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/debug/firestore/logs", (req, res) => {
    res.json({ 
      logs: initLogs,
      projectId,
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
  // Google OAuth Routes
  app.get("/api/auth/google/url", (req, res) => {
    if (!clientId || !clientSecret) {
      console.error("[OAuth] Missing Google OAuth credentials (GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET)");
      return res.status(500).json({ 
        error: "Google OAuth credentials not configured. Please add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to your environment variables." 
      });
    }

    const currentRedirectUri = getRedirectUri();
    console.log(`[OAuth] Generating auth URL with redirect_uri: ${currentRedirectUri}`);

    // Update the client with the current redirect URI in case APP_URL changed
    oauth2Client.setCredentials({}); // Clear any old creds
    (oauth2Client as any).redirectUri = currentRedirectUri;

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent"
    });
    res.json({ url });
  });

  app.get("/api/debug/oauth", (req, res) => {
    res.json({
      clientId: clientId ? `${clientId.substring(0, 10)}...` : 'MISSING',
      clientSecret: clientSecret ? 'PRESENT' : 'MISSING',
      redirectUri: getRedirectUri(),
      appUrl: process.env.APP_URL,
      googleOauthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
      scopes: SCOPES
    });
  });

  app.get("/api/debug/google-services", (req, res) => {
    const services = Object.keys(google).filter(k => typeof (google as any)[k] === 'function');
    res.json({ 
      availableServices: services,
      hasMyBusinessReviews: services.includes('mybusinessreviews'),
      hasMyBusinessAccountManagement: services.includes('mybusinessaccountmanagement'),
      hasMyBusinessBusinessInformation: services.includes('mybusinessbusinessinformation')
    });
  });

  app.get("/api/debug/tokens", (req, res) => {
    const exists = fs.existsSync(TOKEN_FILE);
    let stats = null;
    if (exists) {
      stats = fs.statSync(TOKEN_FILE);
    }
    res.json({ 
      exists, 
      path: TOKEN_FILE,
      size: stats?.size,
      mtime: stats?.mtime
    });
  });

  app.get(["/api/auth/google/callback", "/api/auth/google/callback/"], async (req, res) => {
    const { code } = req.query;
    const currentRedirectUri = getRedirectUri();
    console.log(`[OAuth] Callback received. Code: ${code ? 'PRESENT' : 'MISSING'}`);
    console.log(`[OAuth] Using Client ID: ${clientId ? clientId.substring(0, 10) + '...' : 'MISSING'}`);
    console.log(`[OAuth] Using Redirect URI: ${currentRedirectUri}`);

    try {
      // Ensure the client is using the latest redirect URI
      (oauth2Client as any).redirectUri = currentRedirectUri;
      
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);
      await saveTokens(tokens);
      
      // Send success message to parent window and close popup
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = "/?google_auth=success";
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("[OAuth] Error getting tokens:", error.message);
      if (error.response && error.response.data) {
        console.error("[OAuth] Error details:", JSON.stringify(error.response.data, null, 2));
      }
      
      const errorMsg = error.response?.data?.error_description || error.message || "Failed to authenticate with Google";
      
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_ERROR', 
                  error: ${JSON.stringify(errorMsg)} 
                }, '*');
                window.close();
              } else {
                window.location.href = "/?google_auth=error&message=" + encodeURIComponent(${JSON.stringify(errorMsg)});
              }
            </script>
            <p>Authentication failed: ${errorMsg}. This window should close automatically.</p>
          </body>
        </html>
      `);
    }
  });

  app.get("/api/auth/google/status", async (req, res) => {
    const tokens = await getStoredTokens();
    res.json({ authenticated: !!tokens });
  });

  app.post("/api/auth/google/logout", async (req, res) => {
    await deleteTokens();
    res.json({ success: true });
  });

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

      res.set('Content-Type', response.headers['content-type'] || 'application/octet-stream');
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

  // Search Console API Route
  app.get("/api/seo/search-data", async (req, res) => {
    const tokens = await getStoredTokens();
    if (!tokens) {
      return res.status(401).json({ error: "Not authenticated with Google" });
    }

    try {
      oauth2Client.setCredentials(tokens);
      const searchconsole = google.searchconsole({ version: "v1", auth: oauth2Client });
      
      // Get data for the last 30 days
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const response = await searchconsole.searchanalytics.query({
        siteUrl: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || "https://pattayarentacar.com/",
        requestBody: {
          startDate,
          endDate,
          dimensions: ["query"],
          rowLimit: 20
        }
      });

      res.json({ data: response.data.rows || [] });
    } catch (error: any) {
      console.error("Error fetching Search Console data:", error);
      if (error.code === 401) {
        await deleteTokens();
      }
      res.status(500).json({ error: "Failed to fetch SEO data", details: error.message });
    }
  });

  // Analytics API Route
  app.get("/api/seo/analytics-data", async (req, res) => {
    const tokens = await getStoredTokens();
    if (!tokens) {
      return res.status(401).json({ error: "Not authenticated with Google" });
    }

    try {
      oauth2Client.setCredentials(tokens);
      const analyticsdata = google.analyticsdata({ version: "v1beta", auth: oauth2Client });
      
      // We need the Property ID from the user, but for now we'll try to list properties
      // or assume one if we can. Actually, it's better to ask for it or let the user configure it.
      // For this demo, we'll just return a placeholder or try to fetch if we have a property ID in env.
      const propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID;
      if (!propertyId) {
        return res.status(400).json({ error: "Google Analytics Property ID not configured" });
      }

      const response = await analyticsdata.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "sessionMedium" }],
          metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "bounceRate" }]
        }
      });

      res.json({ data: response.data });
    } catch (error: any) {
      console.error("Error fetching Analytics data:", error);
      res.status(500).json({ error: "Failed to fetch Analytics data", details: error.message });
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
      const currentProjectId = projectId;
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
          activeProjectId: projectId,
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

  app.post("/api/auth/google/disconnect", async (req, res) => {
    res.json({ success: true });
  });

  let lastFetchTime = 0;
  let isFetching = false;
  let currentFetchPromise: Promise<any> | null = null;
  const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes cache for pricing data

  async function fetchAllPricingData(spreadsheetId: string, retries = 5): Promise<any> {
    if (currentFetchPromise) {
      console.log('Using existing fetch promise for pricing data');
      return currentFetchPromise;
    }

    const fetchTask = async (currentRetries: number): Promise<any> => {
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
      console.log(`Fetching spreadsheet from: ${url} (Retries left: ${currentRetries})`);
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || '';
        console.log(`Successfully downloaded spreadsheet (${buffer.byteLength} bytes), Content-Type: ${contentType}`);
        
        if (!contentType.includes('spreadsheetml') && !contentType.includes('application/octet-stream') && !contentType.includes('application/vnd.ms-excel') && !contentType.includes('application/zip')) {
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
              const formats = ["MM/dd/yyyy", "M/d/yyyy", "yyyy-MM-dd", "dd/MM/yyyy"];
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
        
        const status = error.response?.status || (error.message?.includes('status: ') ? parseInt(error.message.split('status: ')[1]) : null);
        const isRateLimit = status === 429 || status === 503;

        if (currentRetries > 0 && (isTimeout || isNetworkError || isRateLimit)) {
          const delay = Math.pow(2, 6 - currentRetries) * 1000;
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

  // Pre-fetch pricing data on startup with a longer delay and better error handling
  const DEFAULT_SPREADSHEET_ID = '1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo';
  setTimeout(() => {
    fetchAllPricingData(DEFAULT_SPREADSHEET_ID)
      .then(data => {
        pricingCache = data;
        lastFetchTime = Date.now();
      })
      .catch(err => {
        // Silently fail pre-fetch, it will retry on first request if needed
      });
  }, 30000);

  // Google API Routes - Placeholder for clean start
  app.get("/api/reviews", async (req, res) => {
    res.status(501).json({ error: "Google Maps API not yet configured" });
  });

  app.get("/api/reviews/google-business", async (req, res) => {
    res.status(501).json({ error: "Google Business API not yet configured" });
  });

  app.get("/api/auth/google/url", (req, res) => {
    res.status(501).json({ error: "Google Auth not yet configured" });
  });

  app.get("/api/auth/google/callback", (req, res) => {
    res.status(501).json({ error: "Google Auth not yet configured" });
  });

  app.get("/api/auth/google/status", (req, res) => {
    res.json({ authenticated: false });
  });

  app.post("/api/auth/google/logout", (req, res) => {
    res.json({ success: true });
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
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

startServer().catch(err => {
  console.error("CRITICAL: Failed to start server:", err);
  // Delay exit to prevent tight restart loops
  setTimeout(() => process.exit(1), 5000);
});
