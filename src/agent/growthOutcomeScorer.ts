import express from "express";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "prac-growth-internal-2026";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

export const growthOutcomeScorerApp = express.Router();

// ── Auth middleware ───────────────────────────────────────────────────────────
growthOutcomeScorerApp.use("/internal/growth/score-outcomes", (req, res, next) => {
  if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
});

// ── POST /internal/growth/score-outcomes ─────────────────────────────────────
growthOutcomeScorerApp.post("/internal/growth/score-outcomes", async (req, res) => {
  const db = getFirestore();
  const log: string[] = [];

  try {
    // 1. Find the two most recent analysed weeks
    const weeksSnap = await db.collection("agent_weeks")
      .where("status", "==", "analysed")
      .orderBy("createdAt", "desc")
      .limit(2)
      .get();

    if (weeksSnap.empty) {
      return res.json({ ok: true, message: "No analysed weeks yet — nothing to score." });
    }

    const [latestWeek, prevWeek] = weeksSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    // Need at least 2 analysed weeks to compare
    if (!prevWeek) {
      return res.json({ ok: true, message: "Only one analysed week — need 2+ to score outcomes." });
    }

    log.push(`Scoring actions for ${prevWeek.weekId} using data from ${latestWeek.weekId}`);

    // 2. Get actions from the previous week that don't yet have an outcome
    const actionsSnap = await db.collection("agent_actions")
      .where("weekId", "==", prevWeek.weekId)
      .get();

    const unscoredActions = actionsSnap.docs
      .map(d => ({ ref: d.ref, id: d.id, ...d.data() })) as any[];

    if (unscoredActions.length === 0) {
      return res.json({ ok: true, message: `No actions for ${prevWeek.weekId}` });
    }

    log.push(`Found ${unscoredActions.length} actions to score`);

    // 3. Pull collected data for both weeks for comparison
    const collectLatest = await db.collection("agent_knowledge")
      .where("source", "==", latestWeek.weekId)
      .get();
    const collectPrev = await db.collection("agent_knowledge")
      .where("source", "==", prevWeek.weekId)
      .get();

    const latestFacts = collectLatest.docs.map(d => d.data().fact).join("\n");
    const prevFacts = collectPrev.docs.map(d => d.data().fact).join("\n");

    // 4. Build Claude prompt
    const actionsText = unscoredActions.map((a: any, i: number) =>
      `[${i+1}] Channel: ${a.channel} | Priority: P${a.priority} | Action: ${a.action}`
    ).join("\n");

    const prompt = `You are scoring the outcomes of growth actions recommended last week for Pattaya Rent a Car.

PREVIOUS WEEK (${prevWeek.weekId}) DATA SNAPSHOT:
${prevFacts || "(no data)"}

CURRENT WEEK (${latestWeek.weekId}) DATA SNAPSHOT:
${latestFacts || "(no data)"}

ACTIONS THAT WERE RECOMMENDED LAST WEEK:
${actionsText}

For each action, write a SHORT outcome note (max 12 words) based purely on whether the relevant channel's metrics improved, declined, or stayed flat week-over-week. If there is not enough data to assess, write "Insufficient data to score."

Return ONLY a JSON array like:
[
  { "index": 1, "outcome": "..." },
  { "index": 2, "outcome": "..." }
]
No markdown, no explanation — just the JSON array.`;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = (message.content[0] as any).text.trim();
    let scores: { index: number; outcome: string }[] = [];

    try {
      scores = JSON.parse(rawText);
    } catch {
      // Try to extract JSON array from response
      const match = rawText.match(/\[.*\]/s);
      if (match) scores = JSON.parse(match[0]);
    }

    log.push(`Got ${scores.length} outcome scores from Claude`);

    // 5. Write outcomes back to Firestore
    const batch = db.batch();
    for (const score of scores) {
      const action = unscoredActions[score.index - 1];
      if (action?.ref) {
        batch.update(action.ref, {
          outcome: score.outcome,
          outcomeAt: FieldValue.serverTimestamp(),
        });
      }
    }
    await batch.commit();

    log.push(`Wrote outcomes to ${scores.length} action docs`);

    return res.json({ ok: true, weekId: prevWeek.weekId, scored: scores.length, log });

  } catch (err: any) {
    console.error("growthOutcomeScorer error:", err);
    return res.status(500).json({ ok: false, error: err.message, log });
  }
});
