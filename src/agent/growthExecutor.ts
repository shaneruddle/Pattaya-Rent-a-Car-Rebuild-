/**
 * Growth Agent — Executor
 * Called from the CMS when a user approves an action.
 *
 * Route: POST /api/growth/execute
 * Auth:  Firebase ID token (Authorization: Bearer <token>)
 * Body:  { taskId: string }
 *
 * Mount in server.ts:
 *   import { growthExecutorApp } from './agent/growthExecutor';
 *   app.use(growthExecutorApp);
 *
 * Requires env vars: ANTHROPIC_API_KEY
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';

if (!admin.apps.length) admin.initializeApp();
const db = getFirestore();

const CMS_ORIGIN = 'https://admin-pattayarentacar.web.app';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function verifyIdToken(authHeader: string | undefined): Promise<string> {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Missing auth token');
  const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
  return decoded.uid;
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------
async function executeTask(taskId: string): Promise<string> {
  const taskRef = db.collection('agent_tasks').doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) throw new Error(`Task ${taskId} not found`);

  const task = taskSnap.data()!;
  if (task.status !== 'queued') throw new Error(`Task already in status: ${task.status}`);

  await taskRef.update({ status: 'executing', executingAt: Timestamp.now() });

  const { runId, actionIndex, action: actionText, channel } = task;

  // Get full action context from agent_runs doc
  const runSnap = await db.collection('agent_runs').doc(runId).get();
  const fullAction = runSnap.data()?.actions?.[actionIndex] ?? null;

  // Knowledge context for the prompt
  const knowledgeSnap = await db.collection('agent_knowledge').get();
  const knowledgeStr = knowledgeSnap.docs
    .map(d => `[${d.data().category || 'general'}] ${d.data().content}`)
    .join('\n') || 'No knowledge context stored yet.';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  if (channel === 'seo' || channel === 'content') {
    const result = await executeSeoContentAction(client, actionText, fullAction, channel, knowledgeStr);
    await taskRef.update({ status: 'done', result, executedAt: Timestamp.now() });
    return result;
  } else {
    const coworkPrompt = await generateCoworkPrompt(client, actionText, fullAction, channel, knowledgeStr);
    await taskRef.update({ status: 'cowork_ready', coworkPrompt, executedAt: Timestamp.now() });
    return coworkPrompt;
  }
}

// ---------------------------------------------------------------------------
// Generate-prompt only (no autonomous execution)
// All channels go straight to cowork_ready — use this instead of executeTask
// when you want the user to handle every action via a Cowork session.
// ---------------------------------------------------------------------------
async function generatePromptTask(taskId: string): Promise<string> {
  const taskRef = db.collection('agent_tasks').doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) throw new Error(`Task ${taskId} not found`);

  const task = taskSnap.data()!;
  if (task.status !== 'queued') throw new Error(`Task already in status: ${task.status}`);

  await taskRef.update({ status: 'executing', executingAt: Timestamp.now() });

  const { runId, actionIndex, action: actionText, channel } = task;

  const runSnap = await db.collection('agent_runs').doc(runId).get();
  const fullAction = runSnap.data()?.actions?.[actionIndex] ?? null;

  const knowledgeSnap = await db.collection('agent_knowledge').get();
  const knowledgeStr = knowledgeSnap.docs
    .map(d => `[${d.data().category || 'general'}] ${d.data().content}`)
    .join('\n') || 'No knowledge context stored yet.';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const skillName: string | null = fullAction?.skill_name ?? null;
  const basePrompt = await generateCoworkPrompt(client, actionText, fullAction, channel, knowledgeStr);
  const coworkPrompt = skillName
    ? `${basePrompt}

---
**Skill:** Use the \`${skillName}\` skill for this task.`
    : basePrompt;
  await taskRef.update({ status: 'cowork_ready', coworkPrompt, executedAt: Timestamp.now() });
  return coworkPrompt;
}

// ---------------------------------------------------------------------------
// SEO / Content execution
// ---------------------------------------------------------------------------
async function executeSeoContentAction(
  client: Anthropic,
  actionText: string,
  fullAction: any,
  channel: string,
  knowledgeStr: string,
): Promise<string> {
  const intentMsg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Action for pattayarentacar.com: "${actionText}"

Identify: (1) pageType: location | vehicle_guide | new_blog_post | brief_only
(2) slug if applicable (e.g. "jomtien", "toyota-fortuner")

Return JSON only: {"pageType":"...","slug":"..."}`,
    }],
  });

  const intentRaw = intentMsg.content[0].type === 'text' ? intentMsg.content[0].text : '{}';
  let intent: { pageType: string; slug?: string };
  try {
    intent = JSON.parse(intentRaw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
  } catch {
    intent = { pageType: 'brief_only' };
  }

  if (intent.pageType === 'location' && intent.slug) {
    return updateLocationDraft(client, intent.slug, actionText, knowledgeStr);
  }
  if (intent.pageType === 'vehicle_guide' && intent.slug) {
    return updateVehicleGuideDraft(client, intent.slug, actionText, knowledgeStr);
  }
  if (intent.pageType === 'new_blog_post') {
    return createBlogPostDraft(client, actionText, knowledgeStr);
  }
  return generateCoworkPrompt(client, actionText, fullAction, channel, knowledgeStr);
}

// ---------------------------------------------------------------------------
// Location page SEO draft
// ---------------------------------------------------------------------------
async function updateLocationDraft(
  client: Anthropic,
  slug: string,
  actionText: string,
  knowledgeStr: string,
): Promise<string> {
  const docRef = db.collection('locations').doc(slug);
  const snap = await docRef.get();
  if (!snap.exists) {
    return `Location "${slug}" not found in CMS. Manual action required: ${actionText}`;
  }

  const data = snap.data()!;
  const en = data.translations?.en || {};

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Improve SEO for Pattaya Rent a Car location page: ${slug}

Business: Car rental in Pattaya, Thailand.
Knowledge: ${knowledgeStr}

Action: ${actionText}

Current (English):
- H1: ${en.h1 || ''}
- Intro: ${en.intro || ''}
- Meta title: ${data.seo?.metaTitle || ''}
- Meta desc: ${data.seo?.metaDescription || ''}

Return JSON only (metaTitle ≤60 chars, metaDescription ≤160 chars):
{"metaTitle":"...","metaDescription":"...","h1":"...","intro":"..."}`,
    }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
  let improved: any;
  try {
    improved = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
  } catch {
    return `Could not parse SEO improvements. Manual action: ${actionText}`;
  }

  await docRef.update({
    agentDraft: { ...improved, draftedAt: Timestamp.now(), sourceAction: actionText },
    updatedAt: Timestamp.now(),
  });

  return `Draft written to location "${slug}". Review at /locations/${slug} — look for the Agent Draft panel. Suggested: "${improved.h1}" / "${improved.metaTitle}". Apply manually when ready.`;
}

// ---------------------------------------------------------------------------
// Vehicle guide SEO draft
// ---------------------------------------------------------------------------
async function updateVehicleGuideDraft(
  client: Anthropic,
  slug: string,
  actionText: string,
  knowledgeStr: string,
): Promise<string> {
  const docRef = db.collection('vehicle_guides').doc(slug);
  const snap = await docRef.get();
  if (!snap.exists) {
    return `Vehicle guide "${slug}" not found in CMS. Manual action required: ${actionText}`;
  }

  const data = snap.data()!;
  const en = data.translations?.en || {};

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Improve SEO for Pattaya Rent a Car vehicle guide: ${slug} (${data.make} ${data.model})

Business: Car rental in Pattaya, Thailand.
Knowledge: ${knowledgeStr}

Action: ${actionText}

Current (English):
- Title: ${en.title || ''}
- H1: ${en.h1 || ''}
- Intro: ${en.intro || ''}
- Meta title: ${data.seo?.metaTitle || ''}
- Meta desc: ${data.seo?.metaDescription || ''}

Return JSON only (metaTitle ≤60 chars, metaDescription ≤160 chars):
{"metaTitle":"...","metaDescription":"...","title":"...","h1":"...","intro":"..."}`,
    }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
  let improved: any;
  try {
    improved = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
  } catch {
    return `Could not parse SEO improvements. Manual action: ${actionText}`;
  }

  await docRef.update({
    agentDraft: { ...improved, draftedAt: Timestamp.now(), sourceAction: actionText },
    updatedAt: Timestamp.now(),
  });

  return `Draft written to vehicle guide "${slug}". Review at /vehicle-guides/${slug}. Meta title → "${improved.metaTitle}". Apply manually when ready.`;
}

// ---------------------------------------------------------------------------
// New blog post draft
// ---------------------------------------------------------------------------
async function createBlogPostDraft(
  client: Anthropic,
  actionText: string,
  knowledgeStr: string,
): Promise<string> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Write a blog post draft for Pattaya Rent a Car (pattayarentacar.com).

Target: tourists, expats, business travellers renting cars in Pattaya, Thailand.
Knowledge: ${knowledgeStr}

Action/Topic: ${actionText}

Return JSON only:
{
  "slug": "kebab-case-slug",
  "metaTitle": "≤60 chars",
  "metaDescription": "≤160 chars",
  "h1": "Compelling H1",
  "intro": "2-3 sentence intro",
  "body": "Full HTML body using <h2>, <p>, <ul> tags. 600-800 words."
}`,
    }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
  let draft: any;
  try {
    draft = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
  } catch {
    return `Could not generate blog post. Manual action: ${actionText}`;
  }

  const slug = (draft.slug || `agent-draft-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  await db.collection('blog_posts').doc(slug).set({
    slug,
    status: 'draft',
    seo: { metaTitle: draft.metaTitle, metaDescription: draft.metaDescription },
    translations: {
      en: { title: draft.h1, h1: draft.h1, intro: draft.intro, body: draft.body },
    },
    agentGenerated: true,
    sourceAction: actionText,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  return `Blog post draft created: "${draft.h1}". Review at /blog/${slug} (status: draft). Publish when ready.`;
}

// ---------------------------------------------------------------------------
// Cowork prompt generator
// Produces a rich, self-contained prompt to paste into a Claude Cowork session.
// ---------------------------------------------------------------------------
async function generateCoworkPrompt(
  client: Anthropic,
  actionText: string,
  fullAction: any,
  channel: string,
  knowledgeStr: string,
): Promise<string> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are generating a Cowork task prompt for Pattaya Rent a Car's growth agent system.

The prompt will be pasted directly into a Claude Cowork session that has:
- Read/write access to the GitHub repo "Pattaya-Rent-a-Car-Rebuild-" (React/TypeScript frontend + Express/Node backend)
- Firebase/Firestore access for the PRAC project
- Deployment: push to main branch → Cloud Build → Cloud Run (us-west1) — no manual steps needed
- Google Chrome browsing capability to check live sites
- The user is Shane, the business owner

Task details:
- Action: ${actionText}
- Channel: ${channel}
- Reasoning: ${fullAction?.reasoning || 'N/A'}
- Expected impact: ${fullAction?.expectedImpact || 'N/A'}
- Metrics that triggered this: ${fullAction?.metrics ? JSON.stringify(fullAction.metrics) : 'N/A'}

Business knowledge context:
${knowledgeStr}

Write a complete, self-contained Cowork prompt in markdown with exactly these sections:

## Cowork Task: [short descriptive title]

**Background:** Why this task was identified and what problem it solves (2-3 sentences, reference the specific data/metrics that triggered it).

**Task:** Step-by-step instructions — exact file paths, code changes, API calls, or browser actions. Be specific enough that Claude can execute without asking questions. Include expected behaviour after the change.

**Deploy:** State whether a code deploy is required (push to main → Cloud Build → Cloud Run us-west1) or if this is config/CMS-only.

**Report back:** Exact instruction on what to paste into the Growth Dashboard result field when done — e.g. "Paste: what was changed, any before/after metrics, and any issues encountered."

Write the prompt as if briefing a senior developer who has never seen this business before. Use concrete file paths and variable names where you know them.`,
    }],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text : `Manual task required: ${actionText}`;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

const corsOptions = {
  origin: CMS_ORIGIN,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.options('/api/growth/execute', cors(corsOptions));
app.use('/api/growth/execute', cors(corsOptions));
app.options('/api/growth/generate-prompt', cors(corsOptions));
app.use('/api/growth/generate-prompt', cors(corsOptions));

app.use(express.json());

// Cowork-prompt-only path — used by the dashboard when autonomous execution is disabled.
app.post('/api/growth/generate-prompt', async (req: Request, res: Response) => {
  try {
    await verifyIdToken(req.headers.authorization);
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { taskId } = req.body;
  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ error: 'Missing taskId' });
    return;
  }

  try {
    const result = await generatePromptTask(taskId);
    res.json({ success: true, result });
  } catch (err: any) {
    console.error('growthExecutor generate-prompt error:', err);
    try {
      await db.collection('agent_tasks').doc(taskId).update({
        status: 'failed',
        error: err.message,
        executedAt: Timestamp.now(),
      });
    } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/growth/execute', async (req: Request, res: Response) => {
  try {
    await verifyIdToken(req.headers.authorization);
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { taskId } = req.body;
  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ error: 'Missing taskId' });
    return;
  }

  try {
    const result = await executeTask(taskId);
    res.json({ success: true, result });
  } catch (err: any) {
    console.error('growthExecutor error:', err);
    try {
      await db.collection('agent_tasks').doc(taskId).update({
        status: 'failed',
        error: err.message,
        executedAt: Timestamp.now(),
      });
    } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

export { app as growthExecutorApp };
