// worker.mjs - Deep verification with web_search (Netlify Background Function v2)
// Processes one article at a time from the worker_queue blob store.
// Full web_search enabled. 15-minute execution window.
// Overwrites fast-verified results with deeper analysis.

import { getStore } from "@netlify/blobs";

const BLOB_TIMEOUT_MS  = 5000;
const CLAUDE_TIMEOUT_MS = 55000; // 55s — web_search can take 20-30s

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${label} exceeded ${ms}ms`)), ms)
    )
  ]);
}

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h);
}

async function deepVerify(article, apiKey) {
  const { title, sourceId } = article;
  const prompt = `I need you to verify a news article by searching from 3 completely different angles.

Subject: "${title}" from ${sourceId}

Search 3 different types of sources (government record, different news outlet, expert or organization, scientific paper, public database). For each angle, write one plain sentence about what that source found. Like explaining to a smart friend. No jargon. No opinions. No adjectives like "alarming" or "shocking." Just state what the evidence shows.

Then state in one plain sentence what all three angles together force to be true. Specific to this exact story. Not generic. Connect it to actual people, events, and facts.

Then state one specific thing that must also be true if that conclusion holds. Not yet reported. Required by the pattern of evidence. Specific to this story.

Return ONLY valid JSON, no markdown, no backticks:
{"corridors":[{"angle":"2-4 word label","finding":"plain sentence about this specific story"}],"forced_fourth":"plain sentence specific to this story","extension":"plain sentence specific to this story"}`;

  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    }),
    CLAUDE_TIMEOUT_MS, `deepVerify "${title.slice(0,40)}"`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API error');
  let txt = '';
  if (data.content) data.content.forEach(b => { if (b.type === 'text') txt += b.text; });
  const match = txt.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse JSON');
  return JSON.parse(match[0]);
}

export default async (req, context) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[worker] No API key'); return new Response('No API key', { status: 500 }); }

  const verStore   = getStore('verifications');
  const artStore   = getStore('articles');
  const queueStore = getStore('worker_queue');

  // Get next item from queue
  let queueKeys;
  try {
    const listing = await withTimeout(queueStore.list(), BLOB_TIMEOUT_MS, 'list queue');
    queueKeys = listing.blobs?.map(b => b.key) || [];
  } catch (e) {
    console.error(`[worker] Queue list failed: ${e.message}`);
    return new Response('Queue error', { status: 500 });
  }

  if (queueKeys.length === 0) {
    console.log('[worker] Queue empty, nothing to do');
    return new Response('Queue empty', { status: 200 });
  }

  // Process one article
  const key = queueKeys[0];
  let article;
  try {
    article = await withTimeout(queueStore.get(key, { type: 'json' }), BLOB_TIMEOUT_MS, `get queue item ${key}`);
  } catch (e) {
    console.error(`[worker] Failed to get queue item: ${e.message}`);
    return new Response('Queue get error', { status: 500 });
  }

  console.log(`[worker] Deep verify: ${article.title?.slice(0,60)}`);

  try {
    const result = await deepVerify(article, apiKey);

    // Save to verifications store (overwrites fast result)
    await withTimeout(verStore.setJSON(key, result), BLOB_TIMEOUT_MS, `save verification ${key}`);

    // Update article index entry to mark as deepVerified
    let index;
    try { index = await withTimeout(artStore.get('_index', { type: 'json' }), BLOB_TIMEOUT_MS, 'load index'); }
    catch (e) { index = null; }
    if (index?.articles) {
      const idx = index.articles.findIndex(a => a.id === key);
      if (idx >= 0) {
        index.articles[idx] = {
          ...index.articles[idx],
          corridors: result.corridors,
          forced_fourth: result.forced_fourth,
          extension: result.extension,
          deepVerified: true,
          deepVerifiedAt: Date.now()
        };
        await withTimeout(artStore.setJSON('_index', index), BLOB_TIMEOUT_MS, 'save index');
      }
    }

    // Remove from queue
    await withTimeout(queueStore.delete(key), BLOB_TIMEOUT_MS, `delete queue ${key}`);

    console.log(`[worker] Done: ${article.title?.slice(0,60)}`);
    return new Response(`Done: ${key}`, { status: 200 });

  } catch (e) {
    console.error(`[worker] Failed: ${e.message}`);
    // Leave in queue for retry next run
    return new Response(`Failed: ${e.message}`, { status: 500 });
  }
};

export const config = {
  path: '/api/worker',
  // Background function — 15 min timeout
  type: 'background'
};
