/**
 * Growth Agent — Analyser
 * Runs every Monday 07:30 BKK (00:30 UTC) via Cloud Scheduler
 * Reads agent_weeks/{weekId} (status: "collected") and recent context,
 * calls Anthropic API, writes results to agent_actions/{weekId},
 * and updates agent_weeks/{weekId}.status -> "analysed"
 *
 * Requires env vars:
 *   INTERNAL_SECRET   -- shared secret for route auth
 *   ANTHROPIC_API_KEY -- Anthropic API key
 */

import express, { Request, Response } from "express";
import admin from "firebase-admin";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = getFirestore();

interface AgentAction {
  priority: "high" | "medium" | "low";
  category: "seo" | "ads" | "content" | "conversion" | "technical" | "other";
  action: string;
  reasoning: string;
  metric?: string;
  targetValue?: string;
}

interface AnalysisResult {
  weekId: string;
  summary: string;
  highlights: string[];
  concerns: string[];
  actions: AgentAction[];
}

async function getUnanalysedWeek(force = false) {
  const snap = await db
    .collection("agent_weeks")
    .where("status", "==", "collected")
    .orderBy("weekStart", "desc")
    .limit(1)
    .get();
  if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };

  // force=true: also accept already-analysed weeks (for re-analysis without re-collecting)
  if (force) {
    const analysedSnap = await db
      .collection("agent_weeks")
      .where("status", "==", "analysed")
      .orderBy("weekStart", "desc")
      .limit(1)
      .get();
    if (!analysedSnap.empty) {
      await analysedSnap.docs[0].ref.update({ status: "collected" });
      return { id: analysedSnap.docs[0].id, data: analysedSnap.docs[0].data() };
    }
  }
  return null;
}

async function getRecentActions(excludeWeekId: string, limit = 4) {
  const snap = await db
    .collection("agent_actions")
    .orderBy("weekId", "desc")
    .limit(limit + 1)
    .get();
  return snap.docs
    .filter((d) => d.id !== excludeWeekId)
    .slice(0, limit)
    .map((d) => d.data());
}

async function getKnowledgeContext() {
  const snap = await db.collection("agent_knowledge").get();
  return snap.docs.map((d) => d.data());
}

function buildPrompt(weekData: any, recentActions: any[], knowledge: any[]): string {
  const knowledgeStr = knowledge.length
    ? knowledge.map((k: any) => "[" + (k.category || "general") + "] " + k.content).join("\n")
    : "No knowledge context stored yet.";
  const recentStr = recentActions.length
    ? recentActions.map((a: any) =>
        "Week " + a.weekId + ": " + (a.summary || "(no summary)") +
        ". Actions: " + ((a.actions || []).map((ac: AgentAction) => ac.action).join("; ") || "none")
      ).join("\n")
    : "No prior weeks recorded yet.";
  const { weekId, weekStart, weekEnd, ga4, searchConsole, bing, enquiries } = weekData;

  // Build explicit data availability warnings so Claude knows what's missing
  const ga4Ok = ga4 && !ga4.error;
  const scOk = searchConsole && !searchConsole.error;
  const bingOk = bing && !bing.error;
  const dataWarnings: string[] = [];
  if (!ga4Ok) dataWarnings.push("GA4 Analytics: UNAVAILABLE (error: " + (ga4?.error || "no data") + ") — do NOT recommend GA4-specific actions");
  if (!scOk) dataWarnings.push("Search Console: UNAVAILABLE (error: " + (searchConsole?.error || "no data") + ")");
  if (!bingOk) dataWarnings.push("Bing Webmaster: UNAVAILABLE");
  dataWarnings.push("Google Ads: NOT YET INTEGRATED — do not fabricate ad spend/performance data");

  return [
    "You are a growth analyst for Pattaya Rent a Car (pattayarentacar.com), a car rental business in Pattaya, Thailand. Review last week's data and produce a concise analysis with prioritised actions.",
    "",
    "## Business Context",
    knowledgeStr,
    "## Recent History",
    recentStr,
    "## Data Availability This Week",
    dataWarnings.length > 0 ? "MISSING DATA SOURCES:\n" + dataWarnings.map(w => "  - " + w).join("\n") : "All data sources available.",
    "",
    "## This Week (" + weekId + ", " + weekStart + " to " + weekEnd + ")",
    ga4Ok
      ? "GA4: sessions=" + ga4.totalSessions + ", conversions=" + ga4.totalConversions + "\nChannels: " + JSON.stringify(ga4.channels) + "\nTop pages: " + JSON.stringify((ga4.topPages || []).slice(0, 8))
      : "GA4: [UNAVAILABLE — base actions on Search Console + enquiry data only]",
    scOk
      ? "Search Console: clicks=" + searchConsole.totalClicks + ", impressions=" + searchConsole.totalImpressions + ", avgPos=" + searchConsole.avgPosition + "\nTop queries: " + JSON.stringify((searchConsole.topQueries || []).slice(0, 12)) + "\nTop SC pages: " + JSON.stringify((searchConsole.topPages || []).slice(0, 8))
      : "Search Console: [UNAVAILABLE]",
    bingOk
      ? "Bing: clicks=" + bing.totalClicks + ", impressions=" + bing.totalImpressions + "\nBing queries: " + JSON.stringify((bing.topQueries || []).slice(0, 8))
      : "Bing: [UNAVAILABLE]",
    "Enquiries: total=" + (enquiries?.total ?? "N/A") + ", avgRentalDays=" + (enquiries?.avgRentalDays ?? "N/A"),
    "By source: " + JSON.stringify(enquiries?.bySource || []),
    "By nationality: " + JSON.stringify((enquiries?.byNationality || []).slice(0, 8)),
    "",
    "IMPORTANT: Produce 3-6 CONCRETE, ACTIONABLE tasks — not observations. Each action must be something a person can actually do this week (e.g. \"Add FAQ schema to /jomtien\", \"Create blog post targeting \'car rental Pattaya Beach\'\", \"Fix broken internal link on homepage\"). Avoid vague actions like \"monitor metrics\" or \"improve SEO\".",
    "Base actions only on data sources that are AVAILABLE. If GA4 is unavailable, still produce useful actions from Search Console + enquiries.",
    "",
    "Return ONLY a JSON object (no fences):",
    '{"summary":"...","highlights":["..."],"concerns":["..."],"actions":[{"priority":"high|medium|low","category":"seo|ads|content|conversion|technical|other","action":"...","reasoning":"...","metric":"optional","targetValue":"optional"}]}',
    "3-6 actions ordered high-to-low priority.",
  ].join("\n");
}

async function analyseWeek(force = false): Promise<AnalysisResult> {
  const week = await getUnanalysedWeek(force);
  if (!week) throw new Error("No collected weeks awaiting analysis");
  const { id: weekId, data: weekData } = week;
  console.log("Analysing week " + weekId);
  const [recentActions, knowledge] = await Promise.all([getRecentActions(weekId), getKnowledgeContext()]);
  const prompt = buildPrompt(weekData, recentActions, knowledge);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var not set");
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  const rawText = message.content[0].type === "text" ? message.content[0].text : "";
  let parsed: Omit<AnalysisResult, "weekId">;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const cleaned = rawText.replace(/^```jsons*/i, "").replace(/```s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  }
  const result: AnalysisResult = { weekId, ...parsed };
  const now = Timestamp.now();
  await db.collection("agent_actions").doc(weekId).set({
    weekId,
    summary: result.summary,
    highlights: result.highlights,
    concerns: result.concerns,
    actions: result.actions,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection("agent_weeks").doc(weekId).update({
    status: "analysed",
    analysedAt: now,
    updatedAt: now,
  });
  console.log("Week " + weekId + " analysed. " + result.actions.length + " actions written.");
  return result;
}

const app = express();
app.use(express.json());

app.post("/internal/growth/analyse", async (req: Request, res: Response) => {
  const secret = req.headers["x-internal-secret"];
  const expectedSecret = process.env.INTERNAL_SECRET || "";
  if (!secret || secret !== expectedSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const result = await analyseWeek();
    res.json({ success: true, weekId: result.weekId, actionsCount: result.actions.length });
  } catch (err: any) {
    console.error("Analysis failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export { app as growthAnalyserApp, analyseWeek };

