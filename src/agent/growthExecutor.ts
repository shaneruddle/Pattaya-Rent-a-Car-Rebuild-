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

async function verifyIdToken(authHeader: string | undefined): Promise<string> {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Missing auth token');
  const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
  return decoded.uid;
}

async function executeTask(taskId: string): Promise<string> {
  const taskRef = db.collection('agent_tasks').doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) throw new Error(`Task ${taskId} not found`);

  const task = taskSnap.data()!;
  if (task.status !== 'queued') throw new Error(`Task already in status: ${task.status}`);

  await taskRef.update({ status: 'executing', executingAt: Timestamp.now() });

  const { weekId, actionIndex, action: actionText, channel } = task;

  const actionsSnap = await db.collection('agent_actions').doc(weekId).get();
  const fullAction = actionsSnap.data()?.actions?.[actionIndex] ?? null;

  const knowledgeSnap = await db.collection('agent_knowledge').get();
  const knowledgeStr = knowledgeSnap.docs
    .map(d => `[${d.data().category || 'general'}] ${d.data().content}`)
    .join('\n') || 'No knowledge context stored yet.';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  let result: string;
  if (channel === 'seo' || channel === 'content') {
    result = await executeSeoContentAction(client, actionText, fullAction, channel, knowledgeStr);
  } else {
    result = await generateBrief(client, actionText, fullAction, channel, knowledgeStr);
  }

  await taskRef.update({ status: 'done', result, executedAt: Timestamp.now() });
  return result;
}

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
      content: `Action for pattayarentacar.com: "${actionText}"\n\nIdentify: (1) pageType: location | vehicle_guide | new_blog_post | brief_only\n(2) slug if applicable (e.g. "jomtien", "toyota-fortuner")\n\nReturn JSON only: {"pageType":"...","slug":"..."}`,
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
  return generateBrief(client, actionText, fullAction, channel, knowledgeStr);
}

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
      content: `Improve SEO for Pattaya Rent a Car location page: ${slug}\n\nBusiness: Car rental in Pattaya, Thailand.\nKnowledge: ${knowledgeStr}\n\nAction: ${actionText}\n\nCurrent (English):\n- H1: ${en.h1 || ''}\n- Intro: ${en.intro || ''}\n- Meta title: ${data.seo?.metaTitle || ''}\n- Meta desc: ${data.seo?.metaDescription || ''}\n\nReturn JSON only (metaTitle ≤60 chars, metaDescription ≤160 chars):\n{"metaTitle":"...","metaDescription":"...","h1":"...","intro":"..."}`,
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

  return `Draft written to location "${slug}". Review at /locations/${slug}. Suggested: "${improved.h1}" / "${improved.metaTitle}". Apply manually when ready.`;
}

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
      content: `Improve SEO for Pattaya Rent a Car vehicle guide: ${slug} (${data.make} ${data.model})\n\nBusiness: Car rental in Pattaya, Thailand.\nKnowledge: ${knowledgeStr}\n\nAction: ${actionText}\n\nCurrent (English):\n- Title: ${en.title || ''}\n- H1: ${en.h1 || ''}\n- Intro: ${en.intro || ''}\n- Meta title: ${data.seo?.metaTitle || ''}\n- Meta desc: ${data.seo?.metaDescription || ''}\n\nReturn JSON only (metaTitle ≤60 chars, metaDescription ≤160 chars):\n{"metaTitle":"...","metaDescription":"...","title":"...","h1":"...","intro":"..."}`,
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
      content: `Write a blog post draft for Pattaya Rent a Car (pattayarentacar.com).\n\nTarget: tourists, expats, business travellers renting cars in Pattaya, Thailand.\nKnowledge: ${knowledgeStr}\n\nAction/Topic: ${actionText}\n\nReturn JSON only:\n{\n  "slug": "kebab-case-slug",\n  "metaTitle": "≤60 chars",\n  "metaDescription": "≤160 chars",\n  "h1": "Compelling H1",\n  "intro": "2-3 sentence intro",\n  "body": "Full HTML body using <h2>, <p>, <ul> tags. 600-800 words."\n}`,
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

async function generateBrief(
  client: Anthropic,
  actionText: string,
  fullAction: any,
  channel: string,
  knowledgeStr: string,
): Promise<string> {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Write a concise implementation brief for this ${channel} action for Pattaya Rent a Car.\n\nAction: ${actionText}\nContext: ${fullAction?.reasoning || ''}\nKnowledge: ${knowledgeStr}\n\n3-5 specific sentences. What to do, where, and why. No fluff.`,
    }],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text : actionText;
}

const app = express();

app.use('/api/growth/execute', cors({
  origin: CMS_ORIGIN,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());

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
