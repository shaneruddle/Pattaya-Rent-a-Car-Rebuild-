/**
 * Growth Agent — Data Collector
 * Runs every Monday 07:00 BKK (00:00 UTC) via Cloud Scheduler
 * Collects previous week's data → writes to agent_weeks/{weekId}
 *
 * Auth:
 *  - GA4 / Firestore : growth-agent SA (ADC on Cloud Functions)
 *  - Search Console  : info@pattayarentacar.com refresh token (Secret Manager: GOOGLE_REFRESH_TOKEN)
 *  - Bing            : API key (Secret Manager: BING_API_KEY)
 *
 * TODO: Replace GOOGLE_REFRESH_TOKEN with one generated using the project's own
 *       OAuth client credentials (current token was generated via OAuth Playground
 *       and expires after 24h). See: https://console.cloud.google.com/apis/credentials
 */

import express, { Request, Response } from "express";
import admin from "firebase-admin";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { google } from "googleapis";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import fetch from "node-fetch";

// ── Constants ──────────────────────────────────────────────────────────────
const PROJECT_ID = "pattaya-rent-a-car-rebuild";
const GA4_PROPERTY_ID = "311694159";
const SC_SITE_URL = "sc-domain:pattayarentacar.com";
const OAUTH_CLIENT_ID = "700448424476-9fsmqpo3qsmud5qomll84kn2gjfndqk7.apps.googleusercontent.com";

// ── Init ───────────────────────────────────────────────────────────────────
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = getFirestore();
const secretClient = new SecretManagerServiceClient();

// ── Helpers ────────────────────────────────────────────────────────────────
async function getSecret(name: string): Promise<string> {
    const [version] = await secretClient.accessSecretVersion({
          name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
    });
    return version.payload?.data?.toString() || "";
}

/** Returns ISO week string e.g. "2026-W24" and Mon/Sun dates for a given Monday */
function getWeekInfo(monday: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = monday.getFullYear();

  // ISO week number
  const jan4 = new Date(year, 0, 4);
    const startOfWeek1 = new Date(jan4);
    startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const weekNum =
          Math.floor((monday.getTime() - startOfWeek1.getTime()) / 604800000) + 1;

  const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

  return {
        weekId: `${year}-W${pad(weekNum)}`,
        weekStart: monday.toISOString().slice(0, 10),
        weekEnd: sunday.toISOString().slice(0, 10),
  };
}

/** Get the Monday of the previous week (relative to now in BKK = UTC+7) */
function getPreviousWeekMonday(): Date {
    const nowBKK = new Date(Date.now() + 7 * 3600 * 1000);
    const dayOfWeek = nowBKK.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const thisMonday = new Date(nowBKK);
    thisMonday.setUTCDate(nowBKK.getUTCDate() - daysSinceMonday);
    thisMonday.setUTCHours(0, 0, 0, 0);
    const prevMonday = new Date(thisMonday);
    prevMonday.setUTCDate(thisMonday.getUTCDate() - 7);
    return prevMonday;
}

// ── GA4 Data ───────────────────────────────────────────────────────────────
async function fetchGA4Data(weekStart: string, weekEnd: string) {
    const analyticsData = google.analyticsdata("v1beta");
    const auth = new google.auth.GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const authClient = await auth.getClient();

  const channelRes = await analyticsData.properties.runReport({
        property: `properties/${GA4_PROPERTY_ID}`,
        auth: authClient as any,
        requestBody: {
                dateRanges: [{ startDate: weekStart, endDate: weekEnd }],
                dimensions: [{ name: "sessionDefaultChannelGrouping" }],
                metrics: [
                  { name: "sessions" },
                  { name: "newUsers" },
                  { name: "conversions" },
                  { name: "engagementRate" },
                        ],
                orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        },
  });

  const pagesRes = await analyticsData.properties.runReport({
        property: `properties/${GA4_PROPERTY_ID}`,
        auth: authClient as any,
        requestBody: {
                dateRanges: [{ startDate: weekStart, endDate: weekEnd }],
                dimensions: [{ name: "landingPagePlusQueryString" }],
                metrics: [{ name: "sessions" }, { name: "conversions" }],
                orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
                limit: 20,
        },
  });

  const channels = (channelRes.data.rows || []).map((r) => ({
        channel: r.dimensionValues?.[0]?.value || "unknown",
        sessions: parseInt(r.metricValues?.[0]?.value || "0"),
        newUsers: parseInt(r.metricValues?.[1]?.value || "0"),
        conversions: parseInt(r.metricValues?.[2]?.value || "0"),
        engagementRate: parseFloat(r.metricValues?.[3]?.value || "0"),
  }));

  const topPages = (pagesRes.data.rows || []).map((r) => ({
        page: r.dimensionValues?.[0]?.value || "",
        sessions: parseInt(r.metricValues?.[0]?.value || "0"),
        conversions: parseInt(r.metricValues?.[1]?.value || "0"),
  }));

  const totalSessions = channels.reduce((s, c) => s + c.sessions, 0);
    const totalConversions = channels.reduce((s, c) => s + c.conversions, 0);

  return { channels, topPages, totalSessions, totalConversions };
}

// ── Search Console Data ────────────────────────────────────────────────────
async function fetchSearchConsoleData(
    weekStart: string,
    weekEnd: string,
    refreshToken: string
  ) {
    const oauthClientSecret = await getSecret("google-oauth-client-secret");
    const oauth2Client = new google.auth.OAuth2(
          OAUTH_CLIENT_ID,
          oauthClientSecret
        );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

  const searchconsole = google.searchconsole({ version: "v1", auth: oauth2Client });

  const queriesRes = await searchconsole.searchanalytics.query({
        siteUrl: SC_SITE_URL,
        requestBody: { startDate: weekStart, endDate: weekEnd, dimensions: ["query"], rowLimit: 25, dataState: "final" },
  });

  const pagesRes = await searchconsole.searchanalytics.query({
        siteUrl: SC_SITE_URL,
        requestBody: { startDate: weekStart, endDate: weekEnd, dimensions: ["page"], rowLimit: 20, dataState: "final" },
  });

  const topQueries = (queriesRes.data.rows || []).map((r) => ({
        query: r.keys?.[0] || "",
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: parseFloat((r.ctr || 0).toFixed(4)),
        position: parseFloat((r.position || 0).toFixed(1)),
  }));

  const topPages = (pagesRes.data.rows || []).map((r) => ({
        page: (r.keys?.[0] || "").replace("https://www.pattayarentacar.com", ""),
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: parseFloat((r.ctr || 0).toFixed(4)),
        position: parseFloat((r.position || 0).toFixed(1)),
  }));

  const totalClicks = topQueries.reduce((s, q) => s + q.clicks, 0);
    const totalImpressions = topQueries.reduce((s, q) => s + q.impressions, 0);
    const avgPosition =
          topQueries.length > 0
        ? parseFloat((topQueries.reduce((s, q) => s + q.position, 0) / topQueries.length).toFixed(1))
            : 0;

  return { topQueries, topPages, totalClicks, totalImpressions, avgPosition };
}

// ── Bing Data ──────────────────────────────────────────────────────────────
async function fetchBingData(weekStart: string, weekEnd: string, apiKey: string) {
    try {
          const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?apikey=${apiKey}&siteUrl=https://www.pattayarentacar.com&startDate=${weekStart}&endDate=${weekEnd}`;
          const res = await fetch(url);
          const json = (await res.json()) as any;
          if (!json.d) return { topQueries: [], totalClicks: 0, totalImpressions: 0 };
          const rows = (json.d || []).slice(0, 20).map((r: any) => ({
                  query: r.Query || "",
                  clicks: r.Clicks || 0,
                  impressions: r.Impressions || 0,
                  avgPosition: r.AvgImpressionPosition || 0,
          }));
          const totalClicks = rows.reduce((s: number, r: any) => s + r.clicks, 0);
          const totalImpressions = rows.reduce((s: number, r: any) => s + r.impressions, 0);
          return { topQueries: rows, totalClicks, totalImpressions };
    } catch (e) {
          console.error("Bing fetch failed:", e);
          return { topQueries: [], totalClicks: 0, totalImpressions: 0, error: String(e) };
    }
}

// ── Firestore Enquiries ────────────────────────────────────────────────────
async function fetchFirestoreEnquiries(weekStart: string, weekEnd: string) {
    const startTs = Timestamp.fromDate(new Date(weekStart + "T00:00:00Z"));
    const endTs = Timestamp.fromDate(new Date(weekEnd + "T23:59:59Z"));
    const snap = await db.collection("bookings").where("createdAt", ">=", startTs).where("createdAt", "<=", endTs).get();

  const enquiries = snap.docs.map((d) => d.data());
    const total = enquiries.length;
    const bySource: Record<string, number> = {};
    const byNationality: Record<string, number> = {};
    let totalRentalDays = 0, rentalDaysCount = 0;

  for (const e of enquiries) {
        const src = e.bookingSource || "direct";
        bySource[src] = (bySource[src] || 0) + 1;
        const nat = e.nationality || "unknown";
        byNationality[nat] = (byNationality[nat] || 0) + 1;
        if (e.rentalDays && typeof e.rentalDays === "number") {
                totalRentalDays += e.rentalDays;
                rentalDaysCount++;
        }
  }

  const avgRentalDays = rentalDaysCount > 0 ? parseFloat((totalRentalDays / rentalDaysCount).toFixed(1)) : 0;
    const topSources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count }));
    const topNationalities = Object.entries(byNationality).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nationality, count]) => ({ nationality, count }));

  return { total, bySource: topSources, byNationality: topNationalities, avgRentalDays };
}

// ── Main collector ─────────────────────────────────────────────────────────
async function collectData(force = false): Promise<{ weekId: string; status: string }> {
    const prevMonday = getPreviousWeekMonday();
    const { weekId, weekStart, weekEnd } = getWeekInfo(prevMonday);
    console.log(`Collecting data for ${weekId} (${weekStart} -> ${weekEnd})`);

  const existing = await db.collection("agent_weeks").doc(weekId).get();
    if (!force && existing.exists && existing.data()?.status !== "pending") {
          console.log(`Week ${weekId} already collected, skipping.`);
          return { weekId, status: "skipped" };
    }

  const [googleRefreshToken, bingApiKey] = await Promise.all([
        getSecret("GOOGLE_REFRESH_TOKEN"),
        getSecret("BING_API_KEY"),
      ]);

  const [ga4, sc, bing, enquiries] = await Promise.allSettled([
        fetchGA4Data(weekStart, weekEnd),
        fetchSearchConsoleData(weekStart, weekEnd, googleRefreshToken),
        fetchBingData(weekStart, weekEnd, bingApiKey),
        fetchFirestoreEnquiries(weekStart, weekEnd),
      ]);

  const now = Timestamp.now();
    const weekDoc = {
          weekId, weekStart, weekEnd,
          status: "collected",
          dataCollectedAt: now,
          analysedAt: null,
          scoredAt: null,
          createdAt: existing.exists ? existing.data()?.createdAt : now,
          updatedAt: now,
          ga4: ga4.status === "fulfilled" ? ga4.value : { error: (ga4 as PromiseRejectedResult).reason?.message },
          searchConsole: sc.status === "fulfilled" ? sc.value : { error: (sc as PromiseRejectedResult).reason?.message },
          bing: bing.status === "fulfilled" ? bing.value : { error: (bing as PromiseRejectedResult).reason?.message },
          enquiries: enquiries.status === "fulfilled" ? enquiries.value : { error: (enquiries as PromiseRejectedResult).reason?.message },
    };

  await db.collection("agent_weeks").doc(weekId).set(weekDoc, { merge: true });
    console.log(`Week ${weekId} collected and written to Firestore.`);
    return { weekId, status: "collected" };
}

// ── Express handler ────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.post("/internal/growth/collect", async (req: Request, res: Response) => {
    const secret = req.headers["x-internal-secret"];
    const expectedSecret = process.env.INTERNAL_SECRET || "";
    if (!secret || secret !== expectedSecret) {
          res.status(403).json({ error: "Forbidden" });
          return;
    }
    try {
          const result = await collectData();
          res.json({ success: true, ...result });
    } catch (err: any) {
    console.error("Data collection failed:", err);
          res.status(500).json({ success: false, error: err.message });
    }
});

export { app as growthCollectorApp, collectData };
