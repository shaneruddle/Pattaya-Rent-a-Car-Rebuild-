
import "dotenv/config";
import fs from 'fs';
const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

// Set environment variables BEFORE importing firebase-admin to ensure correct project context
const projectId = firebaseConfig.projectId;
const databaseId = firebaseConfig.firestoreDatabaseId;

const originalEnvProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
console.log(`[Init] Original Project ID from env: ${originalEnvProject}`);
console.log(`[Init] Target Project ID from config: ${projectId}`);
console.log(`[Init] Target Database ID from config: ${databaseId}`);

// Force environment variables to match the config project ID to ensure Admin SDK targets the correct project
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GCLOUD_PROJECT = projectId;

import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { format, parse, isValid } from "date-fns";
import admin from "firebase-admin";
import { Firestore as AdminFirestore, getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { GoogleGenAI, Type } from "@google/genai";
import * as Papa from "papaparse";

const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
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
  firestore = dbId ? getFirestore(admin.app(), dbId) : getFirestore(admin.app());
  console.log(`[Init] Firestore instance created immediately (Database: ${dbId || '(default)'})`);
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
  
  const maxRetries = 30; // Increased retries to cover up to 15 minutes
  let lastError: any = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      if (i > 0) {
        // Exponential backoff with a cap
        const delay = Math.min(10000 * i, 30000);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        
        // Less frequent logs
        if (i % 5 === 0) {
          logInit(`[Status] Still waiting for Google Cloud to sync permissions... (Elapsed: ${elapsed}s)`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      logInit(`Connection Attempt ${i + 1}/${maxRetries}... (Database: ${configDatabaseId || '(default)'})`);
      
      // Test connection with a simple read
      const testDoc = firestore.collection('system_config').doc('test_connection');
      console.log(`[Init] Testing read on ${testDoc.path}...`);
      await testDoc.get();
      
      // If read works, try a write to verify full permissions
      try {
        console.log(`[Init] Read successful, testing write on ${testDoc.path}...`);
        await testDoc.set({ 
          timestamp: FieldValue.serverTimestamp(),
          status: 'ready',
          lastAttempt: i + 1,
          elapsed: Math.round((Date.now() - startTime) / 1000),
          verifiedAt: new Date().toISOString()
        }, { merge: true });
      } catch (writeErr: any) {
        logInit(`Read successful, but write permissions are still syncing... (${writeErr.message})`);
        throw writeErr;
      }
      
      logInit(`SUCCESS: Firestore is now connected and ready! (Total time: ${Math.round((Date.now() - startTime) / 1000)}s)`);
      isFirestoreReady = true;
      return;
    } catch (err: any) {
      lastError = err;
      const errCode = err.code !== undefined ? err.code : 'UNKNOWN';
      
      if (errCode === 7 || String(err.message).includes('PERMISSION_DENIED')) {
        // Expected propagation error
      } else {
        logInit(`Connection attempt ${i + 1} encountered: [${errCode}] ${err.message}`);
      }
      
      if (errCode === 5 || errCode === 7 || String(err.message).includes('PERMISSION_DENIED')) {
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

  const errorInfo = {
    error: `${safeError.code || 'UNKNOWN'}: ${safeError.message}`,
    code: safeError.code,
    details: safeError.details,
    operation,
    path,
    projectId: currentProjectId,
    databaseId: currentDatabaseId,
    env: process.env.NODE_ENV
  };
  console.error(`Firestore Error [${operation}] on ${currentProjectId}/${currentDatabaseId}:`, JSON.stringify(errorInfo, null, 2));
  return null;
}

// Google OAuth Setup
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || `${process.env.APP_URL}/api/auth/google/callback`;

console.log(`Initializing OAuth Client with ID: ${clientId ? clientId.substring(0, 10) + '...' : 'MISSING'}`);

const oauth2Client = new OAuth2Client(
  clientId,
  clientSecret,
  redirectUri
);

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function getStoredTokens() {
  if (!firestore || !isFirestoreReady) {
    console.log("getStoredTokens called before Firestore is ready");
    return null;
  }
  const path = 'system_config/google_oauth_tokens';
  try {
    const doc = await firestore.collection('system_config').doc('google_oauth_tokens').get();
    if (doc.exists) {
      return doc.data();
    }
    return null;
  } catch (error: any) {
    return handleFirestoreError(error, "GET", path);
  }
}

async function saveTokens(tokens: any) {
  if (!firestore || !isFirestoreReady) {
    console.error("saveTokens called before Firestore is ready");
    return;
  }
  const path = 'system_config/google_oauth_tokens';
  try {
    await firestore.collection('system_config').doc('google_oauth_tokens').set({
      ...tokens,
      updatedAt: FieldValue.serverTimestamp()
    });
  } catch (error: any) {
    handleFirestoreError(error, "WRITE", path);
  }
}

async function deleteTokens() {
  if (!firestore || !isFirestoreReady) {
    console.error("deleteTokens called before Firestore is ready");
    return;
  }
  const path = 'system_config/google_oauth_tokens';
  try {
    await firestore.collection('system_config').doc('google_oauth_tokens').delete();
  } catch (error: any) {
    handleFirestoreError(error, "DELETE", path);
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
  setTimeout(() => process.exit(1), 1000);
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Middleware to check if Firestore is ready
  app.use((req, res, next) => {
    // Allow requests if firestore is initialized, even if full sync check (isFirestoreReady) is still running
    if (req.path.startsWith('/api/') && req.path !== '/api/health' && !firestore) {
      console.log(`[Middleware] 503 for ${req.path} - Firestore not ready`);
      return res.status(503).json({ 
        error: "Service Initializing", 
        message: "Firestore is still connecting. Please wait a few moments." 
      });
    }
    next();
  });

  // API routes go here
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Google OAuth Routes
  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent"
    });
    res.json({ url });
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    try {
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
    } catch (error) {
      console.error("Error getting tokens:", error);
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR' }, '*');
                window.close();
              } else {
                window.location.href = "/?google_auth=error";
              }
            </script>
            <p>Authentication failed. This window should close automatically.</p>
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

  // CSV Import Route for CRM (Customers)
  app.post("/api/crm/import-csv", async (req, res) => {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data format. Expected an array of objects." });
    }

    try {
      console.log(`Importing ${data.length} customers to CRM...`);
      const collection = firestore.collection('customers');
      
      const CHUNK_SIZE = 500;
      let importedCount = 0;

      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        const batch = firestore.batch();
        
        for (const customer of chunk) {
          if (customer.email && customer.firstName) {
            const docRef = collection.doc();
            batch.set(docRef, {
              ...customer,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp()
            });
            importedCount++;
          }
        }
        await batch.commit();
      }

      res.json({ success: true, count: importedCount });
    } catch (error: any) {
      console.error("CRM Import Error:", error);
      res.status(500).json({ error: "Failed to import CRM data", details: error.message });
    }
  });

  // CSV Import Route for Fleet (Vehicles)
  app.post("/api/fleet/import-csv", async (req, res) => {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data format. Expected an array of objects." });
    }

    try {
      console.log(`Importing ${data.length} vehicles to Fleet...`);
      const collection = firestore.collection('cars');
      
      const CHUNK_SIZE = 500;
      let importedCount = 0;

      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        const batch = firestore.batch();
        
        for (const vehicle of chunk) {
          if (vehicle.plateNumber && vehicle.name) {
            const docRef = collection.doc();
            batch.set(docRef, {
              ...vehicle,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp()
            });
            importedCount++;
          }
        }
        await batch.commit();
      }

      res.json({ success: true, count: importedCount });
    } catch (error: any) {
      console.error("Fleet Import Error:", error);
      res.status(500).json({ error: "Failed to import Fleet data", details: error.message });
    }
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

  app.get("/api/debug/firestore/logs", (req, res) => {
    res.json({ 
      logs: initLogs,
      projectId,
      databaseId,
      originalEnvProject,
      isFirestoreReady,
      firestoreDefined: !!firestore
    });
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
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds timeout

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          },
          redirect: 'follow',
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          const text = await response.text();
          if (text.includes('Service Login') || text.includes('Sign in')) {
            throw new Error('The spreadsheet is not public. Please ensure "Anyone with the link" can view it.');
          }
          throw new Error(`HTTP error! status: ${response.status} - ${text.substring(0, 500)}`);
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
        clearTimeout(timeoutId);
        const isTimeout = error.name === 'AbortError' || error.name === 'FetchError' && (error.type === 'request-timeout' || error.code === 'ETIMEDOUT' || error.message?.toLowerCase().includes('timeout') || error.message?.toLowerCase().includes('aborted'));
        const isNetworkError = error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.message?.toLowerCase().includes('stream has been aborted') || error.message?.toLowerCase().includes('premature close');
        const isRateLimit = error.status === 429 || error.status === 503;

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

  app.get("/api/reviews", async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const placeId = process.env.GOOGLE_PLACE_ID;

    if (!apiKey || !placeId) {
      console.warn('Google Maps API Key or Place ID not configured');
      return res.status(500).json({ error: 'Google Maps API Key or Place ID not configured' });
    }

    try {
      console.log(`Fetching business details for placeId: ${placeId}`);
      // Added geometry to fields for map coordinates
      const response = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,user_ratings_total,formatted_address,international_phone_number,opening_hours,geometry&key=${apiKey}`);
      const data = response.data;
      
      if (data.status !== 'OK') {
        console.error(`Google API error: ${data.status}`, data.error_message);
        throw new Error(`Google API returned status: ${data.status}`);
      }

      console.log('Successfully fetched business details');
      res.json(data.result);
    } catch (error) {
      console.error('Error fetching Google business details:', error);
      res.status(500).json({ error: 'Failed to fetch business details' });
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
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("CRITICAL: Failed to start server:", err);
  process.exit(1);
});
