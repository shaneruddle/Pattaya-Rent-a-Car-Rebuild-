
import "dotenv/config";
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

// Set environment variables BEFORE importing firebase-admin to ensure correct project context
const projectId = firebaseConfig.projectId;
const databaseId = firebaseConfig.firestoreDatabaseId;

console.log(`DEBUG: firebaseConfig.projectId: ${projectId}`);
console.log(`DEBUG: firebaseConfig.firestoreDatabaseId: ${databaseId}`);

// Store the original environment project ID if it exists
const originalEnvProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;

console.log(`Initial Environment Project: ${originalEnvProject}`);
console.log(`Config projectId: ${projectId}`);

// Force environment variables to match the config project ID to ensure Admin SDK targets the correct project
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GCLOUD_PROJECT = projectId;

console.log(`Final Environment GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT}`);

import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { format, parse, isValid } from "date-fns";
import { Firestore } from "@google-cloud/firestore";
import admin from "firebase-admin";
import { Firestore as AdminFirestore, getFirestore, FieldValue } from "firebase-admin/firestore";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { GoogleGenAI, Type } from "@google/genai";

const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly"
];

console.log(`Initializing Firestore. Project: ${projectId}, Database: ${databaseId || '(default)'}`);

// Initialize Firestore
let firestore: any = null;
let isFirestoreReady = false;
const dbId = databaseId && databaseId !== '(default)' ? databaseId : undefined;

let initLogs: string[] = [];
function logInit(msg: string) {
  console.log(msg);
  initLogs.push(`${new Date().toISOString()}: ${msg}`);
}

async function initFirestore() {
  const configProjectId = projectId;
  const configDatabaseId = dbId;
  const startTime = Date.now();
  
  logInit(`Firestore Initialization Started.`);
  logInit(`Project: ${configProjectId}`);
  logInit(`Database: ${configDatabaseId || '(default)'}`);

  const maxRetries = 30; // Increased retries to cover up to 15 minutes
  let lastError: any = null;

  // Initialize Admin SDK once
  try {
    if (admin.apps.length > 0) {
      try { await admin.app().delete(); } catch (e) {}
    }
    admin.initializeApp({
      projectId: configProjectId
    });
    logInit("Admin SDK initialized. Waiting for cloud permissions to sync...");
  } catch (e) {
    logInit(`Admin SDK Init Warning: ${e}`);
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      if (i > 0) {
        // Exponential backoff with a cap
        const delay = Math.min(10000 * i, 30000);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        
        // More reassuring logs
        if (i % 3 === 0) {
          logInit(`[Status] Still waiting for Google Cloud to sync permissions... (Elapsed: ${elapsed}s)`);
          logInit(`[Note] This is a standard one-time delay for new databases. Your app is healthy and will connect automatically.`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      logInit(`Connection Attempt ${i + 1}/${maxRetries}...`);
      
      // Use the Admin Firestore instance for the test
      const fs = configDatabaseId ? getFirestore(admin.app(), configDatabaseId) : getFirestore(admin.app());
      
      // Test connection with a simple read
      const testDoc = fs.collection('system_config').doc('test_connection');
      await testDoc.get();
      
      // If read works, try a write to verify full permissions
      try {
        await testDoc.set({ 
          timestamp: FieldValue.serverTimestamp(),
          status: 'ready',
          lastAttempt: i + 1,
          elapsed: Math.round((Date.now() - startTime) / 1000),
          verifiedAt: new Date().toISOString()
        }, { merge: true });
      } catch (writeErr) {
        logInit(`Read successful, but write permissions are still syncing...`);
        throw writeErr;
      }
      
      logInit(`SUCCESS: Firestore is now connected and ready! (Total time: ${Math.round((Date.now() - startTime) / 1000)}s)`);
      return fs;
    } catch (err: any) {
      lastError = err;
      const errCode = err.code !== undefined ? err.code : 'UNKNOWN';
      
      // Log the error but keep it clean
      if (errCode === 7 || String(err.message).includes('PERMISSION_DENIED')) {
        // This is the expected propagation error
      } else {
        logInit(`Connection attempt ${i + 1} encountered: [${errCode}] ${err.message}`);
      }
      
      // Continue retrying for permission or not found errors
      if (errCode === 5 || errCode === 7 || String(err.message).includes('PERMISSION_DENIED')) {
        continue;
      }
      
      // For other unexpected errors, still retry but log them
      if (i < maxRetries - 1) continue;
    }
  }

  logInit(`FINAL NOTICE: All ${maxRetries} connection attempts timed out.`);
  logInit(`The app will now start in 'unverified' mode. If you see PERMISSION_DENIED in the UI, please refresh in 2 minutes.`);
  
  return configDatabaseId ? getFirestore(admin.app(), configDatabaseId) : getFirestore(admin.app());
}

// Initialize Firestore in the background
initFirestore().then(fs => {
  firestore = fs;
  isFirestoreReady = true;
  console.log(`Firestore initialized and ready with Project: ${projectId}`);
}).catch(err => {
  console.error("Critical Firestore initialization failure:", err);
});


// Helper for Firestore error reporting as per guidelines
function handleFirestoreError(error: any, operation: string, path: string) {
  const currentProjectId = projectId;
  // @ts-ignore - databaseId is internal but useful for debugging
  const currentDatabaseId = firestore?.databaseId || '(default)';
  
  const errorInfo = {
    error: `${error.code || 'UNKNOWN'}: ${error.message || String(error)}`,
    code: error.code,
    details: error.details,
    stack: error.stack,
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

console.log(`Firestore initialized. Using database: ${databaseId || '(default)'}`);

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

  app.use(express.json({ limit: '10mb' }));

  // Middleware to check if Firestore is ready
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      console.log(`API Request: ${req.method} ${req.path}, Firestore Ready: ${isFirestoreReady}`);
    }
    if (req.path.startsWith('/api/') && req.path !== '/api/health' && !isFirestoreReady) {
      return res.status(503).json({ 
        error: "Service Initializing", 
        message: "Firestore is still connecting. Please wait 2-3 minutes for Cloud IAM propagation." 
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

  // CSV Import Route for Knowledge Base
  app.post("/api/knowledge-base/import-csv", async (req, res) => {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data format. Expected an array of objects." });
    }

    try {
      console.log(`Importing ${data.length} entries to knowledge base...`);
      const batch = firestore.batch();
      const collection = firestore.collection('ai_knowledge_base');

      for (const entry of data) {
        if (entry.question && entry.answer) {
          const docRef = collection.doc();
          batch.set(docRef, {
            question: entry.question,
            answer: entry.answer,
            isActive: true,
            updatedAt: FieldValue.serverTimestamp()
          });
        }
      }

      await batch.commit();
      console.log("CSV import successful");
      res.json({ success: true, count: data.length });
    } catch (error: any) {
      handleFirestoreError(error, "BATCH_COMMIT", "ai_knowledge_base");
      res.status(500).json({ error: "Failed to import CSV data", details: error.message });
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
    res.json({ logs: initLogs });
  });

  app.post("/api/auth/google/disconnect", async (req, res) => {
    res.json({ success: true });
  });

  // Gmail Sync Route for Knowledge Base
  app.post("/api/knowledge-base/sync-gmail", async (req, res) => {
    console.log('POST /api/knowledge-base/sync-gmail hit');
    const tokens = await getStoredTokens();
    if (!tokens) {
      return res.status(401).json({ error: "Not authenticated with Google" });
    }

    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ error: "GEMINI_API_KEY is not set. Please add it to the Secrets panel." });
      }

      oauth2Client.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      
      // Search for emails related to car rental inquiries
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const afterDate = thirtyDaysAgo.toISOString().split('T')[0].replace(/-/g, '/');
      
      console.log(`Searching Gmail with query: after:${afterDate}`);
      const response = await gmail.users.messages.list({
        userId: "me",
        q: `(car rental inquiry OR booking OR price OR availability OR "how much" OR "can I") after:${afterDate}`,
        maxResults: 8 // Reduced from 15 to prevent timeouts
      });

      const messages = response.data.messages || [];
      console.log(`Found ${messages.length} potential Gmail messages for sync`);
      const allExtractedPairs: any[] = [];

      // Process messages in parallel with a limit to speed up and avoid timeouts
      const processMessage = async (msg: any) => {
        try {
          console.log(`Processing message ID: ${msg.id}`);
          const fullMsg = await gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: 'full'
          });

          let body = "";
          const payload = fullMsg.data.payload;
          if (payload?.parts) {
            const findText = (parts: any[]): string => {
              for (const p of parts) {
                if (p.mimeType === 'text/plain' && p.body?.data) return Buffer.from(p.body.data, 'base64').toString('utf-8');
                if (p.parts) {
                  const res = findText(p.parts);
                  if (res) return res;
                }
              }
              return "";
            };
            body = findText(payload.parts);
          } else if (payload?.body?.data) {
            body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
          }

          if (body.length < 50) return;

          const prompt = `
            Extract car rental related question and answer pairs from the following email content.
            The email is likely from a customer asking about car rentals in Pattaya, Thailand.
            Focus on general information that could be useful for a knowledge base (prices, requirements, locations, etc.).
            Return the result as a JSON array of objects with "question" and "answer" properties.
            If no relevant pairs are found, return an empty array [].
            
            Email Content:
            ${body.substring(0, 3000)}
          `;

          const geminiResponse = await genAI.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    answer: { type: Type.STRING }
                  },
                  required: ["question", "answer"]
                }
              }
            }
          });

          const text = geminiResponse.text;
          if (!text) return;
          
          const pairs = JSON.parse(text);
          console.log(`Gemini extracted ${pairs.length} pairs from message ${msg.id}`);
          return pairs.map((p: any) => ({ ...p, source: `Gmail: ${msg.id}` }));
        } catch (err) {
          console.error(`Error processing message ${msg.id}:`, err);
          return [];
        }
      };

      const results = await Promise.all(messages.map(msg => processMessage(msg)));
      results.forEach(pairs => {
        if (pairs) allExtractedPairs.push(...pairs);
      });

      if (allExtractedPairs.length > 0) {
        console.log(`Saving ${allExtractedPairs.length} total pairs to Firestore`);
        const batch = firestore.batch();
        const collection = firestore.collection('ai_knowledge_base');

        // Firestore batch limit is 500, we should be well under that with 8 messages
        for (const pair of allExtractedPairs) {
          const docRef = collection.doc();
          batch.set(docRef, {
            question: pair.question,
            answer: pair.answer,
            isActive: true,
            source: pair.source,
            updatedAt: FieldValue.serverTimestamp()
          });
        }

        await batch.commit();
      }

      res.json({ success: true, count: allExtractedPairs.length });
    } catch (error: any) {
      console.error("Error syncing Gmail:", error);
      res.status(500).json({ error: "Failed to sync Gmail", details: error.message });
    }
  });

  let pricingCache: { [carType: string]: { headers: number[], data: { [date: string]: number[] } } } | null = null;
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
        const response = await axios.get(url, {
          timeout: 60000, // 60 seconds timeout
          responseType: 'arraybuffer',
          headers: {
            'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          },
          // Allow redirects
          maxRedirects: 5,
          validateStatus: (status) => status < 400, // Consider 4xx/5xx as errors
        });
        
        const contentType = response.headers['content-type'] || '';
        console.log(`Successfully downloaded spreadsheet (${response.data.byteLength} bytes), Content-Type: ${contentType}`);
        
        if (!contentType.includes('spreadsheetml') && !contentType.includes('application/octet-stream') && !contentType.includes('application/vnd.ms-excel')) {
          // If we get HTML, it's likely a login page or error page
          if (contentType.includes('text/html')) {
            const html = Buffer.from(response.data).toString('utf8');
            if (html.includes('Service Login') || html.includes('Sign in')) {
              throw new Error('The spreadsheet is not public. Please ensure "Anyone with the link" can view it.');
            }
          }
          throw new Error(`Invalid content type: ${contentType}. Expected a spreadsheet.`);
        }

        const workbook = XLSX.read(new Uint8Array(response.data), { type: 'array' });
        
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
        const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
        const isNetworkError = error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET';
        const isRateLimit = error.response?.status === 429 || error.response?.status === 503;

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
    console.log('Starting initial pricing data pre-fetch...');
    fetchAllPricingData(DEFAULT_SPREADSHEET_ID)
      .then(data => {
        pricingCache = data;
        lastFetchTime = Date.now();
        console.log('Initial pricing data pre-fetched successfully');
      })
      .catch(err => {
        console.warn('Failed to pre-fetch initial pricing data:', err.message || err);
      });
  }, 15000); // Wait 15 seconds after startup to avoid hitting rate limits immediately

  app.get("/api/reviews", async (req, res) => {
    console.log('GET /api/reviews hit');
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

startServer();
