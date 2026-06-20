/**
 * Growth Agent — On-Demand
 * Single function: collect last 7 days → read previous 3 runs → analyse → write to agent_runs/{auto-id}
 */

import admin from "firebase-admin";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { google } from "googleapis";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import fetch from "node-fetch";
import Anthropic from "@anthropic-ai/sdk";

const PROJECT_ID = "pattaya-rent-a-car-rebuild";
const GA4_PROPERTY_ID = "311694159";
const SC_SITE_URL = "sc-domain:pattayarentacar.com";
const OAUTH_CLIENT_ID = "700448424476-9fsmqpo3qsmud5qomll84kn2gjfndqk7.apps.googleusercontent.com";

if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();
const secretClient = new SecretManagerServiceClient();

async function getSecret(name: string): Promise<string> {
  const [version] = await secretClient.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
  });
  return version.payload?.data?.toString() || "";
}

function getDateRange() {
  const nowBKK = new Date(Date.now() + 7 * 3600 * 1000);
  const end = new Date(nowBKK);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function fetchGA4(start: string, end: string, refreshToken: string, oauthSecret: string) {
  const analyticsData = google.analyticsdata("v1beta");
  const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, oauthSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const [channelRes, pagesRes] = await Promise.all([
    analyticsData.properties.runReport({
      property: `properties/${GA4_PROPERTY_ID}`,
      auth: oauth2Client as any,
      requestBody: {
        dateRanges: [{ startDate: start, endDate: end }],
        dimensions: [{ name: "sessionDefaultChannelGrouping" }],
        metrics: [{ name: "sessions" }, { name: "newUsers" }, { name: "conversions" }, { name: "engagementRate" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      },
    }),
    analyticsData.properties.runReport({
      property: `properties/${GA4_PROPERTY_ID}`,
      auth: oauth2Client as any,
      requestBody: {
        dateRanges: [{ startDate: start, endDate: end }],
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 20,
      },
    }),
  ]);

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

async function fetchSearchConsole(start: string, end: string, refreshToken: string, oauthSecret: string) {
  const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, oauthSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const sc = google.searchconsole({ version: "v1", auth: oauth2Client });

  const [queriesRes, pagesRes] = await Promise.all([
    sc.searchanalytics.query({ siteUrl: SC_SITE_URL, requestBody: { startDate: start, endDate: end, dimensions: ["query"], rowLimit: 25, dataState: "final" } }),
    sc.searchanalytics.query({ siteUrl: SC_SITE_URL, requestBody: { startDate: start, endDate: end, dimensions: ["page"], rowLimit: 20, dataState: "final" } }),
  ]);

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
  const avgPosition = topQueries.length > 0
    ? parseFloat((topQueries.reduce((s, q) => s + q.position, 0) / topQueries.length).toFixed(1))
    : 0;
  return { topQueries, topPages, totalClicks, totalImpressions, avgPosition };
}

async function fetchBing(start: string, end: string, apiKey: string) {
  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?apikey=${apiKey}&siteUrl=https://www.pattayarentacar.com&startDate=${start}&endDate=${end}`;
  const res = await fetch(url);
  const json = (await res.json()) as any;
  if (!json.d) return { topQueries: [], totalClicks: 0, totalImpressions: 0 };
  const rows = (json.d || []).slice(0, 20).map((r: any) => ({
    query: r.Query || "",
    clicks: r.Clicks || 0,
    impressions: r.Impressions || 0,
    avgPosition: r.AvgImpressionPosition || 0,
  }));
  return { topQueries: rows, totalClicks: rows.reduce((s: number, r: any) => s + r.clicks, 0), totalImpressions: rows.reduce((s: number, r: any) => s + r.impressions, 0) };
}

async function fetchEnquiries(start: string, end: string) {
  const startTs = Timestamp.fromDate(new Date(start + "T00:00:00Z"));
  const endTs = Timestamp.fromDate(new Date(end + "T23:59:59Z"));
  const snap = await db.collection("bookings").where("createdAt", ">=", startTs).where("createdAt", "<=", endTs).get();
  const docs = snap.docs.map((d) => d.data());
  const bySource: Record<string, number> = {};
  const byNat: Record<string, number> = {};
  let totalDays = 0, daysCount = 0;
  for (const e of docs) {
    const src = e.bookingSource || "direct";
    bySource[src] = (bySource[src] || 0) + 1;
    const nat = e.nationality || "unknown";
    byNat[nat] = (byNat[nat] || 0) + 1;
    if (typeof e.rentalDays === "number") { totalDays += e.rentalDays; daysCount++; }
  }
  return {
    total: docs.length,
    avgRentalDays: daysCount > 0 ? parseFloat((totalDays / daysCount).toFixed(1)) : 0,
    bySource: Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count })),
    byNationality: Object.entries(byNat).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nationality, count]) => ({ nationality, count })),
  };
}

function buildPrompt(data: { start: string; end: string; ga4: any; sc: any; bing: any; enquiries: any; dfs: any; prevRuns: any[]; knowledge: any[] }): string {
  const { start, end, ga4, sc, bing, enquiries, dfs, prevRuns, knowledge } = data;

  const knowledgeStr = knowledge.length
    ? knowledge.map((k: any) => `[${k.category || "general"}] ${k.content}`).join("\n")
    : "No knowledge context stored yet.";

  const prevRunsStr = prevRuns.length
    ? prevRuns.map((r: any, i: number) => {
        const ts = r.createdAt?.toDate?.() ?? (r.createdAt?._seconds ? new Date(r.createdAt._seconds * 1000) : null);
        const dateStr = ts ? ts.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown date";
        const actions = (r.actions || []).map((a: any) =>
          `    [${a.priority}/${a.category}] ${a.action}${a.isCarryOver ? " [CARRY-OVER]" : ""}`
        ).join("\n");
        return `Run ${i + 1} — ${dateStr} (data: ${r.period?.start} to ${r.period?.end})\nSummary: ${r.summary || "none"}\nActions:\n${actions || "    none"}`;
      }).join("\n\n")
    : "No previous runs yet — this is the first analysis.";

  const ga4Ok = ga4 && !ga4.error;
  const scOk = sc && !sc.error;
  const bingOk = bing && !bing.error;
  const dfsOk = dfs && !dfs.error && (dfs.rankings || dfs.ourRankedKeywords || dfs.topCompetitors);
  const unavailable: string[] = [];
  if (!ga4Ok) unavailable.push(`GA4 (${ga4?.error || "no data"})`);
  if (!scOk) unavailable.push(`Search Console (${sc?.error || "no data"})`);
  if (!bingOk) unavailable.push("Bing Webmaster");
  if (!dfsOk) unavailable.push(`DataForSEO Rankings (${dfs?.error || "no data"})`);
  unavailable.push("Google Ads (not yet integrated)");

  return [
    "You are a growth analyst for Pattaya Rent a Car (pattayarentacar.com), a car rental business in Pattaya, Thailand.",
    "",
    "## Business Context",
    knowledgeStr,
    "",
    "## Previous Analysis Runs (most recent first)",
    prevRunsStr,
    "",
    "## Current Data — " + start + " to " + end,
    "UNAVAILABLE: " + unavailable.join(", "),
    "",
    ga4Ok
      ? "GA4: sessions=" + ga4.totalSessions + ", conversions=" + ga4.totalConversions + "\nChannels: " + JSON.stringify(ga4.channels) + "\nTop pages: " + JSON.stringify((ga4.topPages || []).slice(0, 8))
      : "GA4: [UNAVAILABLE]",
    scOk
      ? "Search Console: clicks=" + sc.totalClicks + ", impressions=" + sc.totalImpressions + ", avgPos=" + sc.avgPosition + "\nTop queries: " + JSON.stringify((sc.topQueries || []).slice(0, 12)) + "\nTop pages: " + JSON.stringify((sc.topPages || []).slice(0, 8))
      : "Search Console: [UNAVAILABLE]",
    bingOk
      ? "Bing: clicks=" + bing.totalClicks + ", impressions=" + bing.totalImpressions + "\nTop queries: " + JSON.stringify((bing.topQueries || []).slice(0, 8))
      : "Bing: [UNAVAILABLE]",
    "Enquiries: total=" + (enquiries?.total ?? "N/A") + ", avgRentalDays=" + (enquiries?.avgRentalDays ?? "N/A"),
    "By source: " + JSON.stringify(enquiries?.bySource || []),
    "By nationality: " + JSON.stringify((enquiries?.byNationality || []).slice(0, 8)),
    dfsOk
      ? [
          "=== DataForSEO Intelligence ===",
          "Keyword Rankings (neutral Thai IP, top 30):",
          (dfs.rankings || []).map((r: any) => {
            const vol = dfs.searchVolumes?.[r.keyword] ? ` [vol:${dfs.searchVolumes[r.keyword]}/mo]` : '';
            const lp = dfs.serpFeatures?.localPackPresent?.[r.keyword] ? ' [LOCAL_PACK]' : '';
            const fs = dfs.serpFeatures?.featuredSnippetPresent?.[r.keyword] ? ' [FEATURED_SNIPPET]' : '';
            return `  [${r.notInTop30 ? "NOT IN TOP 30" : "pos " + r.position}]${vol}${lp}${fs} ${r.keyword}${r.url ? " → " + r.url : ""}`;
          }).join("\n"),
          "",
          "Quick-win keywords (we rank 4–20, not yet on page 1):",
          (dfs.quickWins || []).length > 0
            ? dfs.quickWins.map((k: any) => `  pos ${k.position} | vol ${k.searchVolume ?? '?'}/mo | ${k.keyword}`).join("\n")
            : "  none detected",
          "",
          "All keywords we rank for in Thailand (top 30 by position):",
          (dfs.ourRankedKeywords || []).slice(0, 30).map((k: any) =>
            `  pos ${k.position} | vol ${k.searchVolume ?? '?'}/mo | ${k.keyword}`).join("\n") || "  none",
          "",
          "Top SERP competitors (keyword overlap with us):",
          (dfs.topCompetitors || []).map((c: any) =>
            `  ${c.domain} — ${c.intersections} shared keywords, avg pos ${c.avgPosition}, ~${c.totalKeywords ?? '?'} total keywords`).join("\n") || "  none detected",
          "",
          "Keyword gaps (competitors rank for these, we don't — sorted by volume × overlap):",
          (dfs.keywordGaps || []).slice(0, 20).map((k: any) =>
            `  vol ${k.searchVolume}/mo | their pos ${k.theirPosition ?? '?'} | found on ${k.foundOn?.join(', ')} | ${k.keyword}`).join("\n") || "  none detected",
          "",
          "People Also Ask (from our tracked keywords):",
          (dfs.serpFeatures?.peopleAlsoAsk || []).map((q: string) => `  - ${q}`).join("\n") || "  none",
          "",
          dfs.backlinks ? `Backlinks: ${dfs.backlinks.referringDomains} referring domains, ${dfs.backlinks.totalBacklinks} total backlinks, domain rank ${dfs.backlinks.rank}` : "Backlinks: unavailable",
          dfs.gmb ? `Google My Business: rating ${dfs.gmb.rating}/5 from ${dfs.gmb.reviewsCount} reviews` : "Google My Business: unavailable",
          dfs.trends?.monthly ? `Google Trends (car rental pattaya, Thailand, last 12mo): ${dfs.trends.monthly.map((m: any) => m.period + ':' + m.value).join(', ')}` : "Google Trends: unavailable",
          Object.values(dfs.errors || {}).some(Boolean) ? "DFS partial errors: " + JSON.stringify(dfs.errors) : "",
        ].filter(Boolean).join("\n")
      : "DataForSEO: [UNAVAILABLE]",
    "",
    "## Rules",
    "1. Produce 3-6 CONCRETE, ACTIONABLE tasks a person can execute this week (e.g. 'Add FAQ schema to /jomtien', 'Create blog post targeting car rental Pattaya Beach').",
    "2. DO NOT repeat tasks from previous runs. If a previous task is still genuinely needed because Google/data hasn't propagated yet, include it with isCarryOver:true and updated reasoning showing current data still supports it.",
    "3. Base actions only on AVAILABLE data sources. No fabricated ad data.",
    "4. Order high → low priority.",
    "5. For each action, set skill_name to the best matching Cowork skill from this list (or null if none fits):",
    "   pattaya-rentacar-location-page — building a new area/location SEO landing page",
    "   pattaya-rentacar-vehicle-guide — building a new vehicle or fleet category SEO page",
    "   pattaya-car-rental-google-ads-optimizer — any Google Ads change (copy, bids, keywords, negatives)",
    "   pattaya-seo-onpage — on-page fixes: meta titles, meta descriptions, schema markup, hreflang, heading structure",
    "   pattaya-conversion — booking flow, CTA, form or UX changes to improve conversion rate",
    "   pattaya-technical — technical fixes: page speed, crawlability, redirects, structured data errors",
    "",
    'Return ONLY valid JSON (no markdown fences): {"summary":"...","highlights":["..."],"concerns":["..."],"actions":[{"priority":"high|medium|low","category":"seo|ads|content|conversion|technical|other","action":"...","reasoning":"...","isCarryOver":false,"skill_name":"pattaya-seo-onpage|null"}]}',
  ].join("\n");
}


async function fetchDataForSEO(login: string, password: string) {
  const TRACKED_KEYWORDS = [
    'car rental pattaya', 'rent a car pattaya', 'pattaya car hire',
    'car hire pattaya', 'pattaya rent a car', 'cheap car rental pattaya',
  ];
  const DOMAIN = 'pattayarentacar.com';
  const LOCATION = 1012728; // Thailand
  const LANG = 'en';
  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' };

  const dfsPost = async (endpoint: string, body: any[]): Promise<any> => {
    const res = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const json = (await res.json()) as any;
    if (!res.ok || json.status_code === 40000) throw new Error(`DFS ${endpoint}: ${json.status_message || res.status}`);
    return json;
  };

  // ── Round 1: all independent calls in parallel ────────────────────────────
  const [serpRes, volumeRes, ourRankedRes, competitorsRes, backlinksRes, gmbRes, trendsRes] =
    await Promise.allSettled([
      // 1. SERP rank check + SERP feature extraction
      dfsPost('serp/google/organic/live/advanced', TRACKED_KEYWORDS.map(keyword => ({
        keyword, location_code: LOCATION, language_code: LANG, depth: 30,
      }))),
      // 2. Search volumes for tracked keywords
      dfsPost('keywords_data/google_ads/search_volume/live', [{
        keywords: TRACKED_KEYWORDS, location_code: LOCATION, language_code: LANG,
      }]),
      // 3. All keywords our domain ranks for in Thailand (top 100 by volume)
      dfsPost('dataforseo_labs/google/ranked_keywords/live', [{
        target: DOMAIN, location_code: LOCATION, language_code: LANG, limit: 100,
      }]),
      // 4. Who are our SERP competitors in Thailand
      dfsPost('dataforseo_labs/google/competitors_domain/live', [{
        target: DOMAIN, location_code: LOCATION, language_code: LANG, limit: 10,
      }]),
      // 5. Backlink profile
      dfsPost('backlinks/summary/live', [{
        target: DOMAIN, include_subdomains: true,
      }]),
      // 6. Google My Business listing
      dfsPost('business_data/google/search/live', [{
        keyword: 'Pattaya Rent a Car', location_name: 'Pattaya,Thailand', language_name: 'English',
      }]),
      // 7. Google Trends – seasonal demand for primary keyword
      dfsPost('keywords_data/google_trends/explore/live', [{
        keywords: ['car rental pattaya'], location_name: 'Thailand',
        language_code: LANG, type: 'web_search', time_range: 'past_12_months',
      }]),
    ]);

  // ── Parse SERP + extract PAA / local pack / featured snippets ────────────
  const rankings: any[] = [];
  const paaQuestions: string[] = [];
  const localPackPresent: Record<string, boolean> = {};
  const featuredSnippetPresent: Record<string, boolean> = {};

  if (serpRes.status === 'fulfilled') {
    for (const task of (serpRes.value.tasks || [])) {
      const keyword = task.data?.keyword;
      const items: any[] = task.result?.[0]?.items || [];
      const organic = items.filter((i: any) => i.type === 'organic');
      const match = organic.find((i: any) => i.url?.includes('pattayarentacar.com'));
      rankings.push({ keyword, position: match?.rank_absolute ?? null, url: match?.url ?? null, notInTop30: !match });
      items.filter((i: any) => i.type === 'people_also_ask').forEach((p: any) => {
        (p.items || []).forEach((q: any) => { if (q.title && !paaQuestions.includes(q.title)) paaQuestions.push(q.title); });
      });
      localPackPresent[keyword] = items.some((i: any) => ['local_pack', 'maps'].includes(i.type));
      featuredSnippetPresent[keyword] = items.some((i: any) => i.type === 'featured_snippet');
    }
  }

  // ── Parse search volumes ─────────────────────────────────────────────────
  const searchVolumes: Record<string, number> = {};
  if (volumeRes.status === 'fulfilled') {
    for (const item of (volumeRes.value.tasks?.[0]?.result || [])) {
      if (item.keyword && item.search_volume != null) searchVolumes[item.keyword] = item.search_volume;
    }
  }

  // ── Parse our ranked keywords ─────────────────────────────────────────────
  let ourRankedKeywords: any[] = [];
  if (ourRankedRes.status === 'fulfilled') {
    ourRankedKeywords = (ourRankedRes.value.tasks?.[0]?.result?.[0]?.items || []).map((item: any) => ({
      keyword: item.keyword_data?.keyword,
      position: item.ranked_serp_element?.serp_item?.rank_absolute,
      searchVolume: item.keyword_data?.keyword_info?.search_volume,
      url: item.ranked_serp_element?.serp_item?.url,
    })).filter((k: any) => k.keyword);
    // Sort by position ascending for quick-win identification
    ourRankedKeywords.sort((a: any, b: any) => (a.position ?? 999) - (b.position ?? 999));
  }

  // ── Parse competitors ─────────────────────────────────────────────────────
  let topCompetitors: any[] = [];
  if (competitorsRes.status === 'fulfilled') {
    topCompetitors = (competitorsRes.value.tasks?.[0]?.result?.[0]?.items || []).slice(0, 5).map((item: any) => ({
      domain: item.domain,
      intersections: item.intersections,
      avgPosition: typeof item.avg_position === 'number' ? parseFloat(item.avg_position.toFixed(1)) : null,
      totalKeywords: item.full_domain_metrics?.organic?.count,
    }));
  }

  // ── Parse backlinks ───────────────────────────────────────────────────────
  let backlinks: any = null;
  if (backlinksRes.status === 'fulfilled') {
    const r = backlinksRes.value.tasks?.[0]?.result?.[0];
    if (r) backlinks = { referringDomains: r.referring_domains, totalBacklinks: r.total_count, rank: r.rank };
  }

  // ── Parse GMB ────────────────────────────────────────────────────────────
  let gmb: any = null;
  if (gmbRes.status === 'fulfilled') {
    const items: any[] = gmbRes.value.tasks?.[0]?.result?.[0]?.items || [];
    const biz = items.find((i: any) => i.title?.toLowerCase().includes('pattaya rent a car'));
    if (biz) gmb = { rating: biz.rating?.value, reviewsCount: biz.rating?.votes_count, category: biz.category };
  }

  // ── Parse trends ──────────────────────────────────────────────────────────
  let trends: any = null;
  if (trendsRes.status === 'fulfilled') {
    const data = trendsRes.value.tasks?.[0]?.result?.[0];
    if (data?.items) {
      trends = {
        keyword: 'car rental pattaya',
        monthly: (data.items as any[]).map((i: any) => ({ period: i.date_from?.slice(0, 7), value: i.values?.[0] ?? 0 })).slice(-12),
      };
    }
  }

  // ── Round 2: keyword gap — competitor ranked keywords vs ours ─────────────
  const ourKeywordSet = new Set(ourRankedKeywords.map((k: any) => k.keyword));
  let keywordGaps: any[] = [];

  if (topCompetitors.length >= 1) {
    const compTargets = topCompetitors.slice(0, 2);
    const compResults = await Promise.allSettled(
      compTargets.map(c =>
        dfsPost('dataforseo_labs/google/ranked_keywords/live', [{
          target: c.domain, location_code: LOCATION, language_code: LANG, limit: 100,
        }])
      )
    );
    const gapMap: Record<string, any> = {};
    compResults.forEach((res, idx) => {
      if (res.status !== 'fulfilled') return;
      const domain = compTargets[idx].domain;
      for (const item of (res.value.tasks?.[0]?.result?.[0]?.items || [])) {
        const kw = item.keyword_data?.keyword;
        if (!kw || ourKeywordSet.has(kw)) continue;
        if (!gapMap[kw]) {
          gapMap[kw] = {
            keyword: kw,
            searchVolume: item.keyword_data?.keyword_info?.search_volume ?? 0,
            foundOn: [domain],
            theirPosition: item.ranked_serp_element?.serp_item?.rank_absolute,
          };
        } else if (!gapMap[kw].foundOn.includes(domain)) {
          gapMap[kw].foundOn.push(domain);
        }
      }
    });
    keywordGaps = Object.values(gapMap)
      .filter((k: any) => k.searchVolume > 0)
      .sort((a: any, b: any) => {
        if (b.foundOn.length !== a.foundOn.length) return b.foundOn.length - a.foundOn.length;
        return b.searchVolume - a.searchVolume;
      })
      .slice(0, 25);
  }

  return {
    rankings,
    searchVolumes,
    ourRankedKeywords: ourRankedKeywords.slice(0, 30),
    quickWins: ourRankedKeywords.filter((k: any) => k.position >= 4 && k.position <= 20).slice(0, 10),
    topCompetitors,
    backlinks,
    gmb,
    trends,
    keywordGaps,
    serpFeatures: {
      localPackPresent,
      featuredSnippetPresent,
      peopleAlsoAsk: paaQuestions.slice(0, 10),
    },
    errors: {
      serp: serpRes.status === 'rejected' ? (serpRes as PromiseRejectedResult).reason?.message : null,
      volume: volumeRes.status === 'rejected' ? (volumeRes as PromiseRejectedResult).reason?.message : null,
      ourRanked: ourRankedRes.status === 'rejected' ? (ourRankedRes as PromiseRejectedResult).reason?.message : null,
      competitors: competitorsRes.status === 'rejected' ? (competitorsRes as PromiseRejectedResult).reason?.message : null,
      backlinks: backlinksRes.status === 'rejected' ? (backlinksRes as PromiseRejectedResult).reason?.message : null,
      gmb: gmbRes.status === 'rejected' ? (gmbRes as PromiseRejectedResult).reason?.message : null,
      trends: trendsRes.status === 'rejected' ? (trendsRes as PromiseRejectedResult).reason?.message : null,
    },
  };
}

export async function runAnalysis(): Promise<{ runId: string; actionsCount: number }> {
  const { start, end } = getDateRange();
  console.log(`[growthAgent] Analysing ${start} to ${end}`);

  const [refreshToken, oauthSecret, bingApiKey, anthropicKey, dfsLogin, dfsPassword] = await Promise.all([
    getSecret("GOOGLE_REFRESH_TOKEN"),
    getSecret("google-oauth-client-secret"),
    getSecret("BING_API_KEY"),
    getSecret("ANTHROPIC_API_KEY"),
    getSecret("DATAFORSEO_LOGIN"),
    getSecret("DATAFORSEO_PASSWORD"),
  ]);

  const [ga4Res, scRes, bingRes, enquiriesRes, dfsRes] = await Promise.allSettled([
    fetchGA4(start, end, refreshToken, oauthSecret),
    fetchSearchConsole(start, end, refreshToken, oauthSecret),
    fetchBing(start, end, bingApiKey),
    fetchEnquiries(start, end),
    fetchDataForSEO(dfsLogin, dfsPassword),
  ]);

  const ga4 = ga4Res.status === "fulfilled" ? ga4Res.value : { error: (ga4Res as PromiseRejectedResult).reason?.message };
  const sc = scRes.status === "fulfilled" ? scRes.value : { error: (scRes as PromiseRejectedResult).reason?.message };
  const bing = bingRes.status === "fulfilled" ? bingRes.value : { error: (bingRes as PromiseRejectedResult).reason?.message };
  const enquiries = enquiriesRes.status === "fulfilled" ? enquiriesRes.value : null;
  const dfs = dfsRes.status === "fulfilled" ? dfsRes.value : { error: (dfsRes as PromiseRejectedResult).reason?.message };

  const [prevSnap, knowledgeSnap] = await Promise.all([
    db.collection("agent_runs").orderBy("createdAt", "desc").limit(3).get(),
    db.collection("agent_knowledge").get(),
  ]);

  const parsed = await (async () => {
    const prompt = buildPrompt({
      start, end, ga4, sc, bing, enquiries, dfs,
      prevRuns: prevSnap.docs.map((d) => d.data()),
      knowledge: knowledgeSnap.docs.map((d) => d.data()),
    });
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
    try { return JSON.parse(raw); }
    catch { return JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()); }
  })();

  const docRef = await db.collection("agent_runs").add({
    createdAt: Timestamp.now(),
    period: { start, end },
    ga4, searchConsole: sc, bing, enquiries, dataForSeo: dfs,
    summary: parsed.summary || "",
    highlights: parsed.highlights || [],
    concerns: parsed.concerns || [],
    actions: (parsed.actions || []).map((a: any, i: number) => ({ ...a, index: i })),
  });

  console.log(`[growthAgent] Run ${docRef.id} — ${(parsed.actions || []).length} actions`);
  return { runId: docRef.id, actionsCount: (parsed.actions || []).length };
}
