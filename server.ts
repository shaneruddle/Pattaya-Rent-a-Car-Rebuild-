
import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { format, parse, isValid } from "date-fns";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Pricing Cache: { [carType: string]: { headers: number[], data: { [date: string]: number[] } } }
  let pricingCache: { [carType: string]: { headers: number[], data: { [date: string]: number[] } } } | null = null;
  let lastFetchTime = 0;
  let isFetching = false;
  const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes cache for pricing data

  async function fetchAllPricingData(spreadsheetId: string, retries = 5): Promise<any> {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
    console.log(`Fetching spreadsheet from: ${url} (Retries left: ${retries})`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds timeout

    try {
      const response = await fetch(url, { 
        signal: controller.signal,
        headers: {
          'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Connection': 'keep-alive'
        }
      });
      
      if (!response.ok) {
        if ((response.status === 503 || response.status === 429) && retries > 0) {
          const delay = Math.pow(2, 6 - retries) * 1000; // Exponential backoff
          console.warn(`Google returned ${response.status}, retrying in ${delay}ms... ${retries} attempts left`);
          await new Promise(r => setTimeout(r, delay));
          return fetchAllPricingData(spreadsheetId, retries - 1);
        }
        throw new Error(`Google Sheets API returned ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('spreadsheetml') && !contentType.includes('application/octet-stream') && !contentType.includes('application/vnd.ms-excel')) {
        console.error(`Invalid content type: ${contentType}`);
        throw new Error('The spreadsheet is not public or the ID is incorrect. Please ensure "Anyone with the link" can view it.');
      }

      const arrayBuffer = await response.arrayBuffer();
      console.log(`Successfully downloaded spreadsheet (${arrayBuffer.byteLength} bytes)`);
      
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      
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
      if (retries > 0 && (error.name === 'AbortError' || error.message.includes('Premature close') || error.message.includes('fetch failed') || error.message.includes('Invalid response body'))) {
        const delay = Math.pow(2, 6 - retries) * 1000;
        console.warn(`Fetch error (${error.message}), retrying in ${delay}ms... ${retries} attempts left`);
        await new Promise(r => setTimeout(r, delay));
        return fetchAllPricingData(spreadsheetId, retries - 1);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
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

  // Pre-fetch pricing data on startup with a small delay
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
  }, 5000);

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
